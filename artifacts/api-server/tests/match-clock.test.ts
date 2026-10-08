import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { eq } from "drizzle-orm";
import { db, pool, roomsTable, usersTable, walletTransactionsTable, commissionLedgerTable, platformWalletTable, type LudoBoardState } from "@workspace/db";
import app from "../src/app";
import { MATCH_MS } from "../src/lib/ludo-match";
import { leadingColor, tokenRank } from "../src/lib/ludo-ranking";
import { expireTurns } from "../src/lib/ludo-turns";

// Real PostgreSQL and API routes, but isolated synthetic stakes: no provider
// payment, no mutation of the app's real sandbox accounts or commission wallet.
const schema = `clock_test_${randomUUID().replaceAll("-", "")}`;
pool.options.options = `-csearch_path=${schema},public`;
const setup = await pool.connect();
await setup.query(`CREATE SCHEMA "${schema}"`);
for (const table of ["ludo_users", "ludo_sessions", "ludo_rooms", "ludo_wallet_transactions", "ludo_deposit_intents", "ludo_platform_wallet", "ludo_commission_ledger", "ludo_withdrawals"]) {
  await setup.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
}
await setup.query(`SET search_path TO "${schema}", public`);
setup.release();
const server = createServer(app);
server.listen(0, "127.0.0.1"); await once(server, "listening");
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
type Seat = { id: string; cookie: string };
let requests = 0, pairs = 0;
async function request(path: string, seat: Seat | null, body?: unknown, allowed = [200]) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(seat ? { cookie: seat.cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.ok(allowed.includes(response.status), `${path}: ${response.status} ${JSON.stringify(data)}`);
  requests++;
  return { status: response.status, data };
}
async function register(name: string): Promise<Seat> {
  const response = await fetch(`${base}/auth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: name, email: `${name}@example.test`, password: "clock-fixture-password" }),
  });
  assert.equal(response.status, 201);
  const data = await response.json();
  await db.update(usersTable).set({ balanceKobo: 200000 }).where(eq(usersTable.id, data.user.id));
  return { id: data.user.id, cookie: response.headers.get("set-cookie")!.split(";")[0] };
}
async function pair() {
  pairs++;
  const red = await register(`clock_red${pairs}`), green = await register(`clock_green${pairs}`);
  const waiting = (await request("/rooms", red, { stakeNaira: 2000 }, [201])).data;
  assert.equal(waiting.board.matchDeadlineAt, null);
  // Waiting time must never consume the playing clock.
  await db.update(roomsTable).set({ createdAt: new Date(Date.now() - 86400000) }).where(eq(roomsTable.id, waiting.id));
  const joined = (await request("/rooms", green, { stakeNaira: 2000, roomId: waiting.id }, [201])).data;
  const remaining = Date.parse(joined.board.matchDeadlineAt) - Date.now();
  assert.ok(remaining <= MATCH_MS && remaining > MATCH_MS - 2000);
  assert.equal(joined.board.isOvertime, false);
  assert.deepEqual(joined.scores.red, { tokensHome: 0, totalProgress: 0 });
  return { red, green, id: waiting.id, deadline: joined.board.matchDeadlineAt };
}
async function configure(id: string, fields: Partial<LudoBoardState>) {
  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, id));
  await db.update(roomsTable).set({ board: {
    ...room.board, turnDeadlineAt: new Date(Date.now() + 30000).toISOString(),
    matchDeadlineAt: new Date(Date.now() - 100).toISOString(), ...fields,
  } }).where(eq(roomsTable.id, id));
}
async function paidExactlyOnce(id: string, winner: Seat, loser: Seat) {
  assert.equal((await request("/wallet", winner)).data.balanceNaira, 3600);
  assert.equal((await request("/wallet", loser)).data.balanceNaira, 0);
  const prizes = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.roomId, id));
  assert.equal(prizes.filter(row => row.type === "prize").length, 1);
  assert.equal(prizes.find(row => row.type === "prize")!.amountKobo, 360000);
  const commissions = await db.select().from(commissionLedgerTable).where(eq(commissionLedgerTable.roomId, id));
  assert.equal(commissions.length, 1); assert.equal(commissions[0].amountKobo, 40000);
}
try {
  assert.deepEqual(tokenRank([-1, 0, 56, 57]), { tokensHome: 1, totalProgress: 116 });
  assert.equal(leadingColor({ redTokens: [57, -1, -1, -1], greenTokens: [56, 56, 56, 56] } as LudoBoardState), "red");
  assert.equal(leadingColor({ redTokens: [10, 10, -1, -1], greenTokens: [20, -1, -1, -1] } as LudoBoardState), "red");
  assert.equal(leadingColor({ redTokens: [10, -1, 0, 57], greenTokens: [57, 0, -1, 10] } as LudoBoardState), null);
  console.log("PASS ranking: tokens home first, total current progress second, released tokens score, captures lose progress, exact ties");

  const first = await pair();
  await configure(first.id, { redTokens: [57, -1, -1, -1], greenTokens: [56, 56, 56, 56], turnUserId: first.green.id, dice: [1, 2], remainingDice: [0, 1], hasRolled: true });
  await Promise.all([
    expireTurns(),
    request(`/rooms/${first.id}/move`, first.green, { tokenIndex: 0, diceIndices: [0] }, [200, 400]),
    expireTurns(),
  ]);
  const ended = (await request(`/rooms/${first.id}`, first.red)).data;
  assert.equal(ended.status, "completed"); assert.equal(ended.board.winnerUserId, first.red.id);
  assert.equal(ended.board.endReason, "timeout");
  assert.deepEqual(ended.board.greenTokens, [56, 56, 56, 56], "Late movement cannot change timeout ranking");
  await paidExactlyOnce(first.id, first.red, first.green);
  await expireTurns();
  await request(`/rooms/${first.id}/roll`, first.red, {}, [400]);
  await paidExactlyOnce(first.id, first.red, first.green);
  console.log("PASS exact deadline, late move rejected before scoring, concurrent timer/action settlement, ₦3,600/₦400 credited once");

  const second = await pair();
  await configure(second.id, { redTokens: [10, 9, -1, -1], greenTokens: [20, 0, -1, -1] });
  // Even without a sweep, a late action must finish the match first.
  const direct = (await request(`/rooms/${second.id}/roll`, second.red, {})).data;
  assert.equal(direct.board.winnerUserId, second.green.id);
  assert.equal(direct.board.endReason, "timeout");
  await paidExactlyOnce(second.id, second.green, second.red);
  console.log("PASS total-progress tiebreaker and opponent payout on request-time expiry");

  const third = await pair();
  await configure(third.id, { redTokens: [0, 10, -1, -1], greenTokens: [0, 10, -1, -1], turnDeadlineAt: new Date(Date.now() - 100).toISOString() });
  await expireTurns();
  const overtime = (await request(`/rooms/${third.id}`, third.red)).data;
  assert.equal(overtime.status, "active"); assert.equal(overtime.board.isOvertime, true);
  assert.equal(overtime.board.winnerUserId, null); assert.equal(overtime.board.turnUserId, third.green.id);
  assert.equal((await db.select().from(commissionLedgerTable).where(eq(commissionLedgerTable.roomId, third.id))).length, 0);
  assert.equal((await request("/wallet", third.red)).data.balanceNaira, 0);
  const actualRandom = crypto.randomInt;
  try {
    crypto.randomInt = (() => 5) as typeof crypto.randomInt; syncBuiltinESMExports();
    const rolled = (await request(`/rooms/${third.id}/roll`, third.green, {})).data;
    assert.equal(rolled.status, "active"); assert.equal(rolled.board.isOvertime, true);
    assert.deepEqual(rolled.board.dice, [5, 5]); assert.equal(rolled.board.winnerUserId, null);
  } finally { crypto.randomInt = actualRandom; syncBuiltinESMExports(); }
  const sudden = await Promise.all([1, 2].map(() => request(`/rooms/${third.id}/move`, third.green, { tokenIndex: 0, diceIndices: [0] }, [200, 400])));
  assert.deepEqual(sudden.map(r => r.status).sort(), [200, 400]);
  const result = sudden.find(r => r.status === 200)!.data;
  assert.equal(result.status, "completed"); assert.equal(result.board.endReason, "overtime");
  assert.equal(result.board.winnerUserId, third.green.id);
  assert.deepEqual(result.board.greenTokens, [5, 10, -1, -1]);
  assert.deepEqual(result.board.remainingDice, [], "Overtime ends before spending the second die or earning a bonus");
  assert.equal(result.board.turnDeadlineAt, null);
  await paidExactlyOnce(third.id, third.green, third.red);
  await expireTurns(); await paidExactlyOnce(third.id, third.green, third.red);
  console.log("PASS exact tie enters overtime, turn timeout and doubles do not settle, first partial movement wins instantly, replay cannot pay twice");

  const fourth = await pair();
  await configure(fourth.id, { matchDeadlineAt: new Date(Date.now() + 60000).toISOString(), redTokens: [57, 57, 57, 56], dice: [1, 3], remainingDice: [0, 1], hasRolled: true });
  const finished = (await request(`/rooms/${fourth.id}/move`, fourth.red, { tokenIndex: 3, diceIndices: [0] })).data;
  assert.equal(finished.board.endReason, "all_home"); await paidExactlyOnce(fourth.id, fourth.red, fourth.green);
  console.log("PASS ordinary all-home win settles before the 14-minute limit");

  const fifth = await pair();
  const [legacy] = await db.select().from(roomsTable).where(eq(roomsTable.id, fifth.id));
  const oldBoard = { ...legacy.board }; delete oldBoard.matchDeadlineAt; delete oldBoard.isOvertime; delete oldBoard.endReason;
  await db.update(roomsTable).set({ board: oldBoard }).where(eq(roomsTable.id, fifth.id));
  await expireTurns();
  const migrated = (await request(`/rooms/${fifth.id}`, fifth.red)).data;
  assert.ok(Date.parse(migrated.board.matchDeadlineAt) > Date.now() + MATCH_MS - 2000);
  await expireTurns();
  assert.equal((await request(`/rooms/${fifth.id}`, fifth.red)).data.board.matchDeadlineAt, migrated.board.matchDeadlineAt);
  assert.deepEqual(migrated.board.redTokens, [-1, -1, -1, -1]);
  assert.equal((await request("/wallet", fifth.red)).data.balanceNaira, 0);
  const [commission] = await db.select().from(platformWalletTable);
  assert.equal(commission.balanceKobo, 4 * 40000);
  console.log(`PASS legacy clock initializes once without resetting stakes; ${requests} API checks plus PostgreSQL invariants`);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.execute(`DROP SCHEMA "${schema}" CASCADE`); await pool.end();
}
