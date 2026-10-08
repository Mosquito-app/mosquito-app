import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, footballRoomsTable, footballLedgerTable, platformWalletTable } from "@workspace/db";
import app from "../src/app";
import { installRealtime } from "../src/lib/ludo-realtime";
import { initialFootballState, startFootball, updateFootballClock, HALF_MS, FIRST_HALF_END_MS, REGULATION_MS } from "../src/lib/football-physics";
import { startFootballEngine } from "../src/lib/football-manager";

// Disposable cloned PostgreSQL schema + real production frontend bundle,
// normal login/match APIs, actual server game loop and WebSockets.
// Synthetic test stakes only: this is NOT a provider deposit proof.
const schema = `football_browser_${randomUUID().replaceAll("-", "")}`;
pool.options.options = `-csearch_path=${schema},public`;
const c = await pool.connect();
await c.query(`CREATE SCHEMA "${schema}"`);
for (const { tablename } of (await c.query("select tablename from pg_tables where schemaname='public'")).rows) {
  assert.match(tablename, /^[a-z0-9_]+$/);
  await c.query(`CREATE TABLE "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
}
await c.query(`SET search_path TO "${schema}",public`); c.release();
const publicDir = resolve("../ludo-stake-game/dist/public");
let testedRoom: string | null = null;
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) { app(req, res); return; }
  if (["/__qa/prepare-golden", "/__qa/prepare-stage"].includes(req.url ?? "") && req.method === "POST") {
    try {
      let body = ""; for await (const chunk of req) body += chunk;
      const { roomId, stage } = JSON.parse(body);
      const [row] = await db.select().from(footballRoomsTable).where(eq(footballRoomsTable.id, roomId));
      assert.equal(row.status, "active");
      const users = await db.select().from(usersTable);
      assert.ok(users.find(u => u.id === row.hostUserId)?.username.startsWith("football_browser_"));
      assert.ok(users.find(u => u.id === row.opponentUserId)?.username.startsWith("football_browser_"));
      const now = Date.now(), state = initialFootballState(now, row.state.homeClub, row.state.awayClub);
      const elapsed = req.url === "/__qa/prepare-golden" ? REGULATION_MS + 1
        : stage === "halftime" ? FIRST_HALF_END_MS + 5000
        : stage === "second_added" ? REGULATION_MS - 15000 : HALF_MS + 1000;
      startFootball(state, now - elapsed);
      updateFootballClock(state, now); state.pauseUntil = 0;
      state.lastTickAt = now;
      state.sequence = row.state.sequence + 100000;
      const shooter = state.players.find(p => p.id === state.controlledHome)!;
      if (req.url === "/__qa/prepare-golden") { shooter.x = 27; shooter.y = 2; }
      const keeper = state.players.find(p => p.id === "away-1")!;
      if (req.url === "/__qa/prepare-golden") { keeper.x = 42; keeper.y = 3; }
      if (req.url === "/__qa/prepare-golden") state.ball = { x: 27, y: 2, z: 0.22, vx: 0, vy: 0, vz: 0, ownerId: shooter.id };
      if (stage === "dive") state.ball = { x: 34, y: 10, z: 1.2, vx: 0, vy: -5, vz: 0, ownerId: null };
      if (stage === "tackle") {
        const defender = state.players.find(p => p.id === state.controlledAway)!;
        defender.x = shooter.x + 1; defender.y = shooter.y;
      }
      state.lastTouchId = shooter.id; state.ballFreeAt = stage === "dive" || stage === "tackle" ? now + 10000 : now;
      await db.update(footballRoomsTable).set({ state, engineOwner: "isolated-qa-handoff", leaseUntil: new Date(now - 1) }).where(eq(footballRoomsTable.id, roomId));
      testedRoom = roomId; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ ok: true, sequence: state.sequence })); return;
    } catch { res.statusCode = 400; res.end('{"error":"Invalid isolated QA fixture"}'); return; }
  }
  try {
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    let file = resolve(publicDir, "." + path);
    if (!file.startsWith(publicDir + "/") && file !== publicDir) { res.statusCode = 403; res.end(); return; }
    if (!extname(file)) file = resolve(publicDir, "index.html");
    const data = await readFile(file);
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
    res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream"); res.end(data);
  } catch { res.statusCode = 404; res.end(); }
});
const wss = installRealtime(server), stop = startFootballEngine();
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
try {
  for (const team of ["home", "away"]) {
    const username = `football_browser_${team}`;
    const r = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, email: `${username}@example.test`, password: "football-qa-fixture-only" }) });
    assert.equal(r.status, 201);
    const data = await r.json();
    await db.update(usersTable).set({ balanceKobo: 200000 }).where(eq(usersTable.id, data.user.id));
  }
  const code = await new Promise<number>(done => {
    const child = spawn(process.execPath, ["tests/browser-football.mjs", base], { stdio: "inherit" });
    child.on("exit", result => done(result ?? 1));
  });
  assert.equal(code, 0, "Football browser checks failed");
  assert.ok(testedRoom);
  const entries = await db.select().from(footballLedgerTable).where(eq(footballLedgerTable.roomId, testedRoom));
  assert.equal(entries.filter(e => e.type === "stake_lock").length, 2);
  assert.equal(entries.filter(e => e.type === "prize").length, 1);
  assert.equal(entries.find(e => e.type === "prize")?.amountKobo, 180000);
  assert.equal(entries.find(e => e.type === "commission")?.amountKobo, 20000);
  const [house] = await db.select().from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
  assert.equal(house.balanceKobo, 20000);
  console.log("PASS actual browser golden-goal shot and atomic PostgreSQL ₦1,800 / ₦200 settlement, isolated from real sandbox wallets.");
} finally {
  stop(); for (const ws of wss.clients) ws.terminate();
  server.close(); server.closeAllConnections();
  await new Promise(r => setTimeout(r, 200));
  const cleanup = await pool.connect(); await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`); cleanup.release();
  await pool.end();
}
