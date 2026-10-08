import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { and, eq } from "drizzle-orm";
import { decodeJwt, SignJWT } from "jose";
import { db, pool, usersTable, unityMatchesTable, unityEscrowLedgerTable, platformWalletTable,
  walletTransactionsTable } from "@workspace/db";
import app from "../src/app";

// Ephemeral credentials and synthetic funds, never deployment credentials.
const credential = randomBytes(32).toString("hex");
process.env.UNITY_BRIDGE_SECRET = credential;
const signingCredential = randomBytes(32).toString("hex");
process.env.SESSION_SECRET = signingCredential;
process.env.UNITY_ALLOWED_ORIGINS = "https://unity.example.test";
const schema = `unity_test_${randomUUID().replaceAll("-", "")}`;
pool.options.options = `-csearch_path=${schema},public`;
const setup = await pool.connect();
await setup.query(`CREATE SCHEMA "${schema}"`);
for (const { tablename } of (await setup.query("select tablename from pg_tables where schemaname='public'")).rows) {
  assert.match(tablename, /^[a-z0-9_]+$/);
  await setup.query(`CREATE TABLE "${schema}"."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
}
await setup.query(`SET search_path TO "${schema}",public`); setup.release();
const server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
let checks = 0;
async function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}, expected = 200) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  assert.equal(r.status, expected, `Unexpected HTTP status for ${method} ${path}`);
  checks++;
  return { r, data: r.status === 204 ? null : await r.json() };
}
const auth = { "X-Unity-Server-Key": credential };
async function player(name: string, funds: number) {
  const { r, data } = await request("/auth/register", "POST", {
    email: `${name}@example.test`, username: name, password: "unity-fixture-password-only",
  }, {}, 201);
  await db.update(usersTable).set({ balanceKobo: funds * 100 }).where(eq(usersTable.id, data.user.id));
  return { id: data.user.id as string, cookie: r.headers.get("set-cookie")!.split(";")[0] };
}
async function balance(id: string) {
  const [p] = await db.select({ balanceKobo: usersTable.balanceKobo }).from(usersTable).where(eq(usersTable.id, id));
  return p.balanceKobo / 100;
}
try {
  const p1 = await player("unity_player_one", 10000), p2 = await player("unity_player_two", 10000);
  const p3 = await player("unity_insufficient", 500);
  const input = { player1Id: p1.id, player2Id: p2.id, stakeAmount: 2000, gameType: "football_11v11" };
  const key = randomUUID(), startHeaders = { ...auth, "Idempotency-Key": key };
  await request("/match/start", "POST", input, {}, 401);
  await request("/match/start", "POST", input, { "X-Unity-Server-Key": "not-authorized" }, 401);
  delete process.env.UNITY_BRIDGE_SECRET;
  await request("/match/start", "POST", input, startHeaders, 503);
  process.env.UNITY_BRIDGE_SECRET = credential;
  await request("/match/start", "POST", input, auth, 400);
  await request("/match/start", "POST", { ...input, player2Id: p1.id }, startHeaders, 400);
  await request("/match/start", "POST", { ...input, stakeAmount: 2.5 }, startHeaders, 400);
  await request("/match/start", "POST", { ...input, stakeAmount: -1 }, startHeaders, 400);
  await request("/match/start", "POST", { ...input, gameType: "other" }, startHeaders, 400);
  await request("/match/start", "POST", { ...input, admin: true }, startHeaders, 400);
  await request("/match/start", "POST", { ...input, player2Id: randomUUID() }, startHeaders, 404);
  await request("/match/start", "POST", { ...input, player2Id: p3.id }, startHeaders, 409);
  assert.equal(await balance(p1.id), 10000); assert.equal(await balance(p3.id), 500);
  assert.equal((await db.select().from(unityMatchesTable)).length, 0, "Failed funding rolled back the entire session.");
  const [a, b] = await Promise.all([request("/match/start", "POST", input, startHeaders), request("/match/start", "POST", input, startHeaders)]);
  const match = a.data;
  assert.equal(match.matchId, b.data.matchId);
  assert.equal(match.status, "ACTIVE"); assert.equal(match.player1.id, p1.id); assert.equal(match.player2.id, p2.id);
  assert.equal(await balance(p1.id), 8000); assert.equal(await balance(p2.id), 8000);
  assert.equal((await db.select().from(unityEscrowLedgerTable)).length, 2);
  await request("/match/start", "POST", { ...input, stakeAmount: 1000 }, startHeaders, 409);
  const wallet = (await request("/wallet", "GET", undefined, { cookie: p1.cookie })).data;
  assert.equal(wallet.balanceNaira, 8000); assert.equal(wallet.escrowedNaira, 2000); assert.equal(wallet.totalBalanceNaira, 10000);
  const bearer = { Authorization: `Bearer ${match.matchToken}` };
  const path = `/match/status/${match.matchId}`;
  await request(path, "GET", undefined, {}, 401);
  const status = (await request(path, "GET", undefined, bearer)).data;
  assert.equal(status.status, "ACTIVE"); assert.equal(status.totalPool, 4000); assert.equal(status.sandboxOnly, true);
  assert.equal(status.tokenId, undefined);
  await request(`/match/status/${randomUUID()}`, "GET", undefined, bearer, 401);
  await request(`/match/status/${randomUUID()}`, "GET", undefined, auth, 404);
  const allowed = await request(path, "GET", undefined, { ...bearer, Origin: "https://unity.example.test" });
  assert.equal(allowed.r.headers.get("access-control-allow-origin"), "https://unity.example.test");
  assert.equal(allowed.r.headers.get("cache-control"), "no-store");
  assert.equal(allowed.r.headers.get("access-control-allow-credentials"), null);
  await request(path, "GET", undefined, { ...bearer, Origin: "https://evil.example.test" }, 403);
  const options = await request("/match/end", "OPTIONS", undefined, {
    Origin: "https://unity.example.test", "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type,x-unity-server-key",
  }, 204);
  assert.match(options.r.headers.get("access-control-allow-headers")!, /Authorization/);
  const result = { matchId: match.matchId, matchToken: match.matchToken, player1Score: 2, player2Score: 1, winnerId: p1.id, isDraw: false };
  await request("/match/end", "POST", result, bearer, 401,);
  await request("/match/end", "POST", { ...result, winnerId: p3.id }, auth, 400);
  await request("/match/end", "POST", { ...result, winnerId: p2.id }, auth, 400);
  await request("/match/end", "POST", { ...result, isDraw: true }, auth, 400);
  await request("/match/end", "POST", { ...result, player1Score: 1.5 }, auth, 400);
  await request("/match/end", "POST", { ...result, matchId: randomUUID() }, auth, 401);
  await request("/match/end", "POST", { ...result, matchToken: match.matchToken + "tampered" }, auth, 401);
  const bad = await new SignJWT({ purpose: "match_status", gameType: "football_11v11" })
    .setProtectedHeader({ alg: "HS256" }).setIssuer("mosquito-app").setAudience("mosquito-unity-match")
    .setSubject(match.matchId).setJti(randomUUID()).setIssuedAt().setExpirationTime("1h").sign(randomBytes(32));
  await request("/match/end", "POST", { ...result, matchToken: bad }, auth, 401);
  const testKey = createHmac("sha256", signingCredential).update("mosquito:unity-match:jwt:v1").digest();
  const claims = decodeJwt(match.matchToken);
  const expired = await new SignJWT(claims).setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(testKey);
  await request("/match/end", "POST", { ...result, matchToken: expired }, auth, 401);
  const wrongSession = await new SignJWT({ ...claims, jti: randomUUID() }).setProtectedHeader({ alg: "HS256" }).sign(testKey);
  await request("/match/end", "POST", { ...result, matchToken: wrongSession }, auth, 401);
  const wrongAudience = await new SignJWT({ ...claims, aud: "another-app" }).setProtectedHeader({ alg: "HS256" }).sign(testKey);
  await request("/match/end", "POST", { ...result, matchToken: wrongAudience }, auth, 401);
  const [paid1, paid2] = await Promise.all([request("/match/end", "POST", result, auth), request("/match/end", "POST", result, auth)]);
  assert.deepEqual(paid1.data, paid2.data); assert.equal(paid1.data.message, "Escrow settled successfully");
  assert.equal(paid1.data.winnerPayout, 3600); assert.equal(paid1.data.commissionLogged, 400);
  assert.equal(await balance(p1.id), 11600); assert.equal(await balance(p2.id), 8000);
  const paidStatus = (await request(path, "GET", undefined, bearer)).data;
  assert.equal(paidStatus.status, "COMPLETED"); assert.equal(paidStatus.winnerId, p1.id);
  assert.equal(paidStatus.winnerPayout, 3600);
  await request("/match/end", "POST", { ...result, player1Score: 3 }, auth, 409);
  assert.equal((await db.select().from(unityEscrowLedgerTable).where(and(eq(unityEscrowLedgerTable.matchId, match.matchId),
    eq(unityEscrowLedgerTable.type, "prize")))).length, 1);
  const renewed = (await request("/match/start", "POST", input, startHeaders)).data;
  assert.equal(renewed.matchId, match.matchId); assert.equal(renewed.status, "COMPLETED");
  assert.equal(await balance(p1.id), 11600, "Token renewal must not debit a settled session.");
  // Draw keeps all funds locked, then one Golden Goal settles exactly once.
  const overtime = (await request("/match/start", "POST", { ...input, stakeAmount: 1000 },
    { ...auth, "Idempotency-Key": randomUUID() })).data;
  const draw = { matchId: overtime.matchId, matchToken: overtime.matchToken, player1Score: 2, player2Score: 2, winnerId: null, isDraw: true };
  const drawOut = (await request("/match/end", "POST", draw, auth)).data;
  assert.equal(drawOut.status, "ACTIVE"); assert.equal(drawOut.overtime, true); assert.equal(drawOut.settled, false);
  assert.equal(drawOut.winnerPayout, 0); assert.equal(drawOut.commissionLogged, 0);
  await request("/match/end", "POST", draw, auth);
  await request("/match/end", "POST", { ...draw, player1Score: 3, player2Score: 3 }, auth, 409);
  await request("/match/end", "POST", { ...draw, player1Score: 5, isDraw: false, winnerId: p1.id }, auth, 409);
  const goal = (await request("/match/end", "POST", { ...draw, player2Score: 3, isDraw: false, winnerId: p2.id }, auth)).data;
  assert.equal(goal.winnerPayout, 1800); assert.equal(goal.commissionLogged, 200);
  const [house] = await db.select().from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
  assert.equal(house.balanceKobo, 60000);
  const locks = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.type, "stake_lock"));
  const prizes = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.type, "prize"));
  assert.equal(locks.length, 4); assert.equal(prizes.length, 2);
  assert.equal(await balance(p1.id) + await balance(p2.id) + house.balanceKobo / 100, 20000, "Financial conservation after both settlements.");
  assert.equal((await request("/wallet", "GET", undefined, { cookie: p1.cookie })).data.escrowedNaira, 0);
  // Two different matches race for an account which can fund only one.
  const competing = { player1Id: p1.id, player2Id: p3.id, stakeAmount: 500, gameType: "football_11v11" };
  const raced = await Promise.all([1, 2].map(async () => {
    const r = await fetch(base + "/match/start", { method: "POST", headers: {
      "content-type": "application/json", ...auth, "Idempotency-Key": randomUUID(),
    }, body: JSON.stringify(competing) });
    checks++; return { status: r.status, data: await r.json() };
  }));
  assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]);
  assert.equal(await balance(p3.id), 0, "Concurrent different-key starts must not overdraw a wallet.");
  const funded = raced.find(r => r.status === 200)!.data;
  await request("/match/end", "POST", { matchId: funded.matchId, matchToken: funded.matchToken,
    player1Score: 0, player2Score: 1, winnerId: p3.id, isDraw: false }, auth);
  assert.equal(await balance(p3.id), 900);
  console.log(`PASS ${checks} Unity bridge HTTP checks: server authority, JWT scope/tampering, CORS allowlist, atomic funding, idempotent/concurrent 90/10 settlement, wallet visibility and Golden Goal (isolated synthetic funds).`);
} finally {
  server.close(); server.closeAllConnections();
  const cleanup = await pool.connect(); await cleanup.query(`DROP SCHEMA "${schema}" CASCADE`); cleanup.release();
  await pool.end();
}
