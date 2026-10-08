import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { and, eq, sql } from "drizzle-orm";
import { WebSocket } from "ws";
import { db, pool, footballRoomsTable, footballLedgerTable, usersTable, platformWalletTable } from "@workspace/db";
import app from "../src/app";
import { installRealtime } from "../src/lib/ludo-realtime";
import { initialFootballState, startFootball, updateFootballClock, REGULATION_MS } from "../src/lib/football-physics";
import { lockFootballStake, settleFootball } from "../src/lib/football-finance";

const schema = `football_test_${randomUUID().replaceAll("-", "")}`;
pool.options.options = `-csearch_path=${schema},public`;
const setup = await pool.connect();
await setup.query(`CREATE SCHEMA "${schema}"`);
const tables = await setup.query("select tablename from pg_tables where schemaname='public'");
for (const { tablename } of tables.rows) {
  assert.match(tablename, /^[a-z0-9_]+$/);
  await setup.query(`CREATE TABLE "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
}
await setup.query(`SET search_path TO "${schema}",public`); setup.release();
const server = createServer(app), wss = installRealtime(server);
server.listen(0, "127.0.0.1"); await once(server, "listening");
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`, base = `${origin}/api`;
type Seat = { id: string; cookie: string };
let requests = 0, fixtures = 0;
async function req(path: string, seat?: Seat, body?: unknown, method?: string, status: number | number[] = 200) {
  const r = await fetch(`${base}${path}`, { method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", ...(seat ? { cookie: seat.cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await r.json(); assert.ok((Array.isArray(status) ? status : [status]).includes(r.status), `${path}: ${r.status} ${JSON.stringify(data)}`); requests++;
  return { data, status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] };
}
async function seat(balance = 200000): Promise<Seat> {
  const name = `football_fixture${++fixtures}`;
  const result = await req("/auth/register", undefined, { username: name, email: `${name}@example.test`, password: "fixture-password-only" }, undefined, 201);
  await db.update(usersTable).set({ balanceKobo: balance }).where(eq(usersTable.id, result.data.user.id));
  return { id: result.data.user.id, cookie: result.cookie! };
}
async function paid(id: string, winner: Seat, loser: Seat, expectedAvailable: number) {
  assert.equal((await req("/wallet", winner)).data.balanceNaira, expectedAvailable);
  assert.equal((await req("/wallet", loser)).data.balanceNaira, 1000);
  const entries = await db.select().from(footballLedgerTable).where(eq(footballLedgerTable.roomId, id));
  assert.equal(entries.filter(e => e.type === "stake_lock").length, 2);
  assert.equal(entries.filter(e => e.type === "prize").length, 1);
  assert.equal(entries.find(e => e.type === "prize")?.amountKobo, 180000);
  assert.equal(entries.filter(e => e.type === "commission").length, 1);
  assert.equal(entries.find(e => e.type === "commission")?.amountKobo, 20000);
}
try {
  await req("/football/lobby", undefined, undefined, undefined, 401);
  const host = await seat(), opponent = await seat(), outsider = await seat();
  await req("/football/rooms", host, { stakeNaira: 50 }, undefined, 400);
  await req("/football/rooms", host, { stakeNaira: 1000, club: "invalid_club" }, undefined, 400);
  const first = (await req("/football/rooms", host, { stakeNaira: 1000, club: "barcelona" })).data;
  assert.equal(first.state.homeClub, "barcelona");
  assert.equal(first.status, "waiting"); assert.equal(first.state.players.length, 22);
  assert.equal((await req("/wallet", host)).data.balanceNaira, 2000);
  assert.equal((await req("/wallet", host)).data.escrowedNaira, 0);
  assert.equal((await req(`/football/rooms/${first.id}`, opponent)).data.viewerTeam, null);
  const joins = await Promise.all([1, 2].map(() => req("/football/rooms", opponent, { stakeNaira: 1000, roomId: first.id, club: "real_madrid" }, undefined, [200, 409])));
  const active = joins.find(r => r.status === 200)!.data;
  assert.equal(active.status, "active"); assert.equal(active.state.remainingMs, REGULATION_MS);
  assert.equal(active.state.halfDurationMs, 180000); assert.equal(active.state.addedTimeMs, 0);
  assert.equal(active.state.halftimeBreakMs, 0);
  assert.equal(active.state.homeClub, "barcelona"); assert.equal(active.state.awayClub, "real_madrid");
  assert.deepEqual((await req(`/football/rooms/${first.id}`, host)).data.state.homeClub, "barcelona");
  const joinedAgain = (await req("/football/rooms", opponent, { stakeNaira: 1000, roomId: first.id })).data;
  assert.equal(joinedAgain.id, first.id);
  assert.equal(joinedAgain.state.awayClub, "real_madrid", "Resuming cannot change the locked-in club.");
  for (const s of [host, opponent]) {
    const w = (await req("/wallet", s)).data;
    assert.equal(w.balanceNaira, 1000); assert.equal(w.escrowedNaira, 1000); assert.equal(w.totalBalanceNaira, 2000);
  }
  await req(`/football/rooms/${first.id}`, outsider, undefined, undefined, 404);
  await req(`/football/rooms/${first.id}`, host, undefined, "DELETE", 409);
  const ws = new WebSocket(`${origin.replace("http", "ws")}/api/ws`, { headers: { cookie: host.cookie, origin } });
  await once(ws, "open");
  const sub = once(ws, "message");
  ws.send(JSON.stringify({ type: "football.subscribe", roomId: first.id }));
  let snapshot = JSON.parse((await sub)[0].toString());
  if (snapshot.type === "connected") snapshot = JSON.parse((await once(ws, "message"))[0].toString());
  assert.equal(snapshot.type, "football.snapshot"); assert.equal(snapshot.room.viewerTeam, "home");
  const forged = once(ws, "message");
  ws.send(JSON.stringify({ type: "football.input", roomId: first.id, seq: 1, moveX: 0, moveY: 0, scoreHome: 99, action: "shoot" }));
  assert.equal(JSON.parse((await forged)[0].toString()).type, "football.error");
  ws.close();
  // Atomic full-time close: two simultaneous settlement callers.
  const [row] = await db.select().from(footballRoomsTable).where(eq(footballRoomsTable.id, first.id));
  const state = structuredClone(row.state); state.scoreHome = 2; state.scoreAway = 1;
  updateFootballClock(state, Date.parse(state.startedAt!) + REGULATION_MS);
  assert.equal(state.phase, "finished");
  await Promise.all([1, 2].map(() => db.transaction(async tx => {
    const [locked] = await tx.select().from(footballRoomsTable).where(eq(footballRoomsTable.id, first.id)).for("update");
    return settleFootball(tx, locked, state);
  })));
  await paid(first.id, host, opponent, 2800);
  assert.equal((await req("/football/lobby", host)).data.myRoom, null);

  // Cancellation never debits; insufficient opponent balance rolls back both.
  const freeHost = await seat(), poor = await seat(0);
  const wait = (await req("/football/rooms", freeHost, { stakeNaira: 1000 })).data;
  await req("/football/rooms", poor, { stakeNaira: 1000, roomId: wait.id }, undefined, 409);
  assert.equal((await req("/wallet", freeHost)).data.balanceNaira, 2000);
  assert.equal((await db.select().from(footballLedgerTable).where(eq(footballLedgerTable.roomId, wait.id))).length, 0);
  await req(`/football/rooms/${wait.id}`, poor, undefined, "DELETE", 409);
  await req(`/football/rooms/${wait.id}`, freeHost, undefined, "DELETE");
  assert.equal((await req("/wallet", freeHost)).data.balanceNaira, 2000);

  // Golden goal uses identical funded escrow and exactly-once settlement.
  const a = await seat(), b = await seat();
  const initial = initialFootballState(); startFootball(initial);
  const [gold] = await db.insert(footballRoomsTable).values({ hostUserId: a.id, opponentUserId: b.id, stakeKobo: 100000, status: "active", state: initial }).returning();
  await db.transaction(async tx => { await lockFootballStake(tx, gold, a.id); await lockFootballStake(tx, gold, b.id); });
  updateFootballClock(initial, Date.parse(initial.startedAt!) + REGULATION_MS);
  assert.equal(initial.phase, "overtime"); assert.equal(initial.winnerTeam, null);
  await db.update(footballRoomsTable).set({ state: initial }).where(eq(footballRoomsTable.id, gold.id));
  assert.equal((await req("/wallet", a)).data.escrowedNaira, 1000);
  initial.scoreAway = 1; initial.phase = "finished"; initial.winnerTeam = "away"; initial.lastEvent = "GOLDEN GOAL";
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(footballRoomsTable).where(eq(footballRoomsTable.id, gold.id)).for("update");
    await settleFootball(tx, locked, initial);
  });
  await paid(gold.id, b, a, 2800);
  const [house] = await db.select().from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
  assert.equal(house.balanceKobo, 40000);
  console.log(`PASS ${requests} football HTTP checks, authenticated WebSocket forgery rejection, concurrent settlement and PostgreSQL 90/10 conservation (isolated fixtures).`);
} finally {
  for (const ws of wss.clients) ws.terminate();
  server.close(); server.closeAllConnections();
  const c = await pool.connect(); await c.query(`DROP SCHEMA "${schema}" CASCADE`); c.release();
  await pool.end();
}
