import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { eq } from "drizzle-orm";
import { WebSocket } from "ws";
import { db, pool, roomsTable, sessionsTable, usersTable, walletTransactionsTable, commissionLedgerTable, platformWalletTable, withdrawalsTable, type LudoBoardState } from "@workspace/db";
import app from "../src/app";
import { installRealtime } from "../src/lib/ludo-realtime";
import { expireTurns } from "../src/lib/ludo-turns";
import { publishRoomUpdate } from "../src/lib/ludo-events";

// Provider fixtures never use the configured credential or send external requests.
process.env.PAYSTACK_TEST_SECRET_KEY = "sk_test_fixture_not_a_credential";
const nativeFetch = globalThis.fetch;
const deposits = new Map<string, { amount: number; status: string; domain: string }>();
const transfers = new Map<string, Record<string, unknown>>();
let transferStatus = "success";
let recipientAccepted = true;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.paystack.co") return nativeFetch(input, init);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const reply = (data: unknown, status = 200, message = "") => new Response(JSON.stringify({ status: status < 400, data, message }), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/transaction/initialize") {
    deposits.set(body.reference, { amount: body.amount, status: "pending", domain: "test" });
    return reply({ authorization_url: `https://checkout.paystack.com/${body.reference}` });
  }
  if (url.pathname.startsWith("/transaction/verify/")) {
    const ref = url.pathname.split("/").at(-1)!;
    const item = deposits.get(ref);
    return item ? reply({ ...item, reference: ref, currency: "NGN" }) : reply(null, 404);
  }
  if (url.pathname === "/transferrecipient") return recipientAccepted
    ? reply({ domain: "test", recipient_code: "RCP_test_fixture" })
    : reply(null, 400, "Cannot resolve account");
  if (url.pathname === "/transfer") {
    const data = transfers.get(body.reference) ?? {
      domain: "test", reference: body.reference, currency: "NGN",
      amount: body.amount, status: transferStatus, transfer_code: "TRF_test_fixture",
    };
    transfers.set(body.reference, data);
    return reply(data);
  }
  if (url.pathname.startsWith("/transfer/verify/")) {
    const data = transfers.get(url.pathname.split("/").at(-1)!);
    return data ? reply(data) : reply(null, 404);
  }
  throw new Error(`Unmocked provider endpoint: ${url.pathname}`);
};

// Clone table definitions into an isolated schema; never mutate users' balances.
const schema = `ludo_test_${randomUUID().replaceAll("-", "")}`;
const tables = ["ludo_users", "ludo_sessions", "ludo_rooms", "ludo_wallet_transactions", "ludo_deposit_intents", "ludo_platform_wallet", "ludo_commission_ledger", "ludo_withdrawals"];
pool.options.options = `-csearch_path=${schema},public`;
const setup = await pool.connect();
await setup.query(`CREATE SCHEMA "${schema}"`);
for (const table of tables) await setup.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
await setup.query(`SET search_path TO "${schema}", public`);
setup.release();

const server = createServer(app);
const wss = installRealtime(server);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address() as { port: number };
const base = `http://127.0.0.1:${address.port}`;
const origin = base;
let checks = 0;
type Seat = { cookie: string; id: string; email: string };
async function request(path: string, seat?: Seat, body?: unknown, expected: number | number[] = 200) {
  const response = await nativeFetch(`${base}/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(seat ? { cookie: seat.cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? null : await response.json();
  if (Array.isArray(expected)) assert.ok(expected.includes(response.status), `${path}: ${JSON.stringify(data)}`);
  else assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  checks++;
  return { data, response };
}
async function register(name: string): Promise<Seat> {
  const email = `${name}@example.test`;
  const { data, response } = await request("/auth/register", undefined, { username: name, email, password: "sandbox-password-123" }, 201);
  return { id: data.user.id, email, cookie: response.headers.get("set-cookie")!.split(";")[0] };
}
async function credit(seat: Seat, amount = 10000) {
  const initialized = await request("/deposits/initialize", seat, { amountNaira: amount }, 201);
  const ref = initialized.data.reference;
  const pending = await request("/deposits/verify", seat, { reference: ref });
  assert.equal(pending.data.status, "pending");
  deposits.get(ref)!.status = "success";
  await Promise.all([1, 2, 3].map(() => request("/deposits/verify", seat, { reference: ref })));
  const ledger = await db.select().from(walletTransactionsTable).where(eq(walletTransactionsTable.depositReference, ref));
  assert.equal(ledger.length, 1);
  return ref;
}
async function fixture(roomId: string, board: Partial<LudoBoardState>) {
  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, roomId));
  await db.update(roomsTable).set({
    board: { ...room.board, dice: null, remainingDice: [], consecutiveDoubles: 0, turnMessage: null, captureBonusPending: false, hasRolled: false, turnUserId: room.hostUserId,
      turnDeadlineAt: new Date(Date.now() + 30_000).toISOString(), ...board },
  }).where(eq(roomsTable.id, roomId));
}
async function connect(seat: Seat) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/api/ws`, { headers: { cookie: seat.cookie, origin } });
  await once(ws, "open");
  return ws;
}
function messageOf(ws: WebSocket, type: string) {
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { ws.off("message", handler); reject(new Error(`No WS ${type}`)); }, 3000);
    function handler(raw: unknown) {
      const message = JSON.parse(String(raw));
      if (message.type === type) { clearTimeout(timer); ws.off("message", handler); resolve(message); }
    }
    ws.on("message", handler);
  });
}

try {
  await request("/healthz");
  await request("/wallet", undefined, undefined, 401);
  const host = await register("testhost");
  const green = await register("testgreen");
  const outsider = await register("testoutside");
  await request("/auth/register", undefined, { username: "testhost", email: host.email, password: "sandbox-password-123" }, 409);
  await request("/auth/login", undefined, { email: host.email, password: "wrong" }, 401);
  await db.update(sessionsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessionsTable.userId, host.id));
  await request("/auth/me", host, undefined, 401);
  const login = await request("/auth/login", undefined, { email: host.email, password: "sandbox-password-123" });
  host.cookie = login.response.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await request("/auth/me", host)).data.user.id, host.id);
  console.log("PASS local registration, login, duplicates, authorization and expired sessions");

  await request("/deposits/initialize", host, { amountNaira: 1 }, 400);
  const hostRef = await credit(host);
  await credit(green);
  await request("/deposits/verify", outsider, { reference: hostRef }, 404);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 10000);
  const bad = await request("/deposits/initialize", host, { amountNaira: 500 }, 201);
  deposits.get(bad.data.reference)!.status = "success";
  deposits.get(bad.data.reference)!.domain = "live";
  assert.equal((await request("/deposits/verify", host, { reference: bad.data.reference })).data.status, "failed");
  assert.equal((await request("/wallet", host)).data.balanceNaira, 10000);
  recipientAccepted = false;
  await request("/withdrawals", host, { amountNaira: 500, requestId: randomUUID(), recipientName: "Sandbox Player", accountNumber: "0000000000", bankCode: "011" }, 400);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 10000);
  recipientAccepted = true;
  console.log("PASS deposit pending/success, concurrent credit-once, ownership, test-domain enforcement");

  const waiting = (await request("/rooms", host, { stakeNaira: 2000 }, 201)).data;
  assert.equal(waiting.status, "waiting");
  const roomId = waiting.id;
  const repeat = (await request("/rooms", host, { stakeNaira: 2000 }, 201)).data;
  assert.equal(repeat.id, roomId);
  const held = (await request("/wallet", host)).data;
  assert.equal(held.balanceNaira, 8000); assert.equal(held.escrowedNaira, 2000); assert.equal(held.totalBalanceNaira, 10000);
  await request("/withdrawals", host, { amountNaira: 9000, requestId: randomUUID(), recipientName: "Sandbox Player", accountNumber: "0000000000", bankCode: "011" }, 400);
  const active = (await request("/rooms", green, { stakeNaira: 2000, roomId }, 201)).data;
  assert.equal(active.status, "active"); assert.equal(active.potNaira, 4000); assert.equal(active.prizeNaira, 3600); assert.equal(active.commissionNaira, 400);
  assert.equal((await request("/wallet", green)).data.escrowedNaira, 2000);
  await request(`/rooms/${roomId}`, outsider, undefined, 404);
  await request(`/rooms/${roomId}/roll`, outsider, {}, 404);
  await request(`/rooms/${roomId}/roll`, green, {}, 400);
  await request("/rooms/not-a-uuid", host, undefined, 400);
  await fixture(roomId, { redTokens: [0, -1, -1, -1] });
  const rolled = (await request(`/rooms/${roomId}/roll`, host, { dice: 99 })).data;
  assert.equal(rolled.board.dice.length, 2);
  assert.ok(rolled.board.dice.every((value: number) => value >= 1 && value <= 6));
  assert.deepEqual(rolled.board.remainingDice, [0, 1]);
  await request(`/rooms/${roomId}/roll`, host, {}, 400);
  console.log("PASS matchmaking, duplicate-join protection, escrow totals and server-owned dice");

  const socket = await connect(host);
  let event = messageOf(socket, "room.updated");
  socket.send(JSON.stringify({ type: "subscribe", roomId }));
  assert.equal((await event).roomId, roomId);
  await fixture(roomId, { redTokens: [5, -1, -1, -1], greenTokens: [32, -1, -1, -1], dice: [1, 2], remainingDice: [0], hasRolled: true });
  event = messageOf(socket, "room.updated");
  const captured = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] })).data;
  assert.equal(captured.board.redTokens[0], 16); assert.equal(captured.board.greenTokens[0], -1); assert.equal(captured.board.turnUserId, host.id);
  assert.equal(captured.board.turnMessage, "capture_bonus"); assert.equal(captured.board.hasRolled, false);
  await event;
  await fixture(roomId, { turnUserId: green.id, greenTokens: [5, -1, -1, -1], redTokens: [32, -1, -1, -1], dice: [1, 2], remainingDice: [0], hasRolled: true });
  const greenMove = (await request(`/rooms/${roomId}/move`, green, { tokenIndex: 0, diceIndices: [0] })).data;
  assert.equal(greenMove.board.turnUserId, green.id); assert.equal(greenMove.board.redTokens[0], -1);
  assert.equal(greenMove.board.greenTokens[0], 16);
  await fixture(roomId, { redTokens: [7, -1, -1, -1], greenTokens: [34, -1, -1, -1], dice: [1, 2], remainingDice: [0], hasRolled: true });
  assert.equal((await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] })).data.board.greenTokens[0], 34);
  await fixture(roomId, { redTokens: [-1, -1, -1, -1], dice: [6, 6], remainingDice: [0], consecutiveDoubles: 1, hasRolled: true });
  const six = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] })).data;
  assert.equal(six.board.redTokens[0], 0); assert.equal(six.board.turnUserId, host.id);
  await fixture(roomId, { redTokens: [56, -1, -1, -1], dice: [2, 3], remainingDice: [0], hasRolled: true });
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] }, 400);

  await fixture(roomId, { redTokens: [0, 10, -1, -1], greenTokens: [-1, -1, -1, -1], dice: [2, 3], remainingDice: [0, 1], hasRolled: true });
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0 }, 400);
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0, 0] }, 400);
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [2] }, 400);
  const splitFirst = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] })).data;
  assert.equal(splitFirst.board.redTokens[0], 2);
  assert.deepEqual(splitFirst.board.remainingDice, [1]);
  assert.equal(splitFirst.board.turnUserId, host.id);
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] }, 400);
  await request(`/rooms/${roomId}/roll`, host, {}, 400);
  const splitSecond = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 1, diceIndices: [1] })).data;
  assert.deepEqual(splitSecond.board.redTokens.slice(0, 2), [2, 13]);
  assert.equal(splitSecond.board.turnUserId, green.id);
  await fixture(roomId, { redTokens: [0, -1, -1, -1], dice: [2, 3], remainingDice: [0, 1], hasRolled: true });
  const combined = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0, 1] })).data;
  assert.equal(combined.board.redTokens[0], 5); assert.equal(combined.board.turnUserId, green.id);
  await fixture(roomId, { redTokens: [-1, -1, -1, -1], dice: [1, 5], remainingDice: [0, 1], hasRolled: true });
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0, 1] }, 400);
  await fixture(roomId, { redTokens: [-1, -1, -1, -1], dice: [6, 3], remainingDice: [0, 1], hasRolled: true });
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0, 1] }, 400);
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] }, 400);
  await fixture(roomId, { redTokens: [-1, -1, -1, -1], dice: [6, 1], remainingDice: [0, 1], hasRolled: true });
  const entered = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0, 1] })).data;
  assert.equal(entered.board.redTokens[0], 1); assert.equal(entered.board.turnUserId, green.id);
  await fixture(roomId, { redTokens: [5, 10, -1, -1], greenTokens: [32, -1, -1, -1], dice: [1, 2], remainingDice: [0, 1], hasRolled: true });
  const firstCapture = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] })).data;
  assert.equal(firstCapture.board.captureBonusPending, true); assert.equal(firstCapture.board.redTokens[0], 16);
  await request(`/rooms/${roomId}/roll`, host, {}, 400);
  const lastDie = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 1, diceIndices: [1] })).data;
  assert.equal(lastDie.board.turnUserId, host.id); assert.equal(lastDie.board.hasRolled, false);
  assert.equal(lastDie.board.turnMessage, "capture_bonus"); assert.equal(lastDie.board.captureBonusPending, false);

  // Only this isolated test process controls server randomness, never the client.
  const actualRandomInt = crypto.randomInt;
  try {
    crypto.randomInt = (() => 5) as typeof crypto.randomInt;
    syncBuiltinESMExports();
    await fixture(roomId, { redTokens: [0, -1, -1, -1] });
    for (let count = 1; count <= 2; count++) {
      const double = (await request(`/rooms/${roomId}/roll`, host, { dice: [1, 2] })).data;
      assert.deepEqual(double.board.dice, [5, 5]); assert.equal(double.board.consecutiveDoubles, count);
      const bonus = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0, 1] })).data;
      assert.equal(bonus.board.turnUserId, host.id); assert.equal(bonus.board.hasRolled, false);
      assert.equal(bonus.board.turnMessage, "double_bonus");
    }
    const forfeited = (await request(`/rooms/${roomId}/roll`, host, {})).data;
    assert.equal(forfeited.board.redTokens[0], 20);
    assert.equal(forfeited.board.turnUserId, green.id); assert.equal(forfeited.board.hasRolled, false);
    assert.equal(forfeited.board.turnMessage, "third_double");
    assert.equal(forfeited.board.consecutiveDoubles, 0); assert.deepEqual(forfeited.board.remainingDice, []);
  } finally {
    crypto.randomInt = actualRandomInt;
    syncBuiltinESMExports();
  }
  console.log("PASS split dice, combined sum, six-only entry, used-die protection, doubles bonus and third-double forfeiture");

  await fixture(roomId, { turnDeadlineAt: new Date(Date.now() - 1000).toISOString() });
  await request(`/rooms/${roomId}/roll`, host, {}, 400);
  await expireTurns();
  assert.equal((await request(`/rooms/${roomId}`, green)).data.board.turnUserId, green.id);
  const unauthorizedSocket = await connect(outsider);
  const closed = once(unauthorizedSocket, "close");
  unauthorizedSocket.send(JSON.stringify({ type: "subscribe", roomId }));
  assert.equal((await closed)[0], 1008);
  socket.terminate();
  console.log("PASS WebSocket delivery and authorization, both-player turns, capture, safe cells, six, overshoot and timeout");

  await fixture(roomId, { redTokens: [57, 57, 57, 49], greenTokens: [24, -1, -1, -1], dice: [1, 2], remainingDice: [0], hasRolled: true });
  const endings = await Promise.all([1, 2].map(() => request(`/rooms/${roomId}/move`, host, { tokenIndex: 3, diceIndices: [0] }, [200, 400])));
  assert.deepEqual(endings.map(x => x.response.status).sort(), [200, 400]);
  const winner = endings.find(x => x.response.status === 200)!.data;
  assert.equal(winner.status, "completed"); assert.equal(winner.board.winnerUserId, host.id);
  assert.deepEqual(winner.board.redTokens, [57, 57, 57, 57]);
  assert.equal(winner.board.greenTokens[0], -1);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 11600);
  const [commission] = await db.select().from(platformWalletTable);
  assert.equal(commission.balanceKobo, 40000);
  assert.equal((await db.select().from(commissionLedgerTable)).length, 1);
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 3, diceIndices: [0] }, 400);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 11600);
  const cancelRoom = (await request("/rooms", host, { stakeNaira: 500 }, 201)).data;
  await request(`/rooms/${cancelRoom.id}/cancel`, outsider, {}, 404);
  await request(`/rooms/${cancelRoom.id}/cancel`, host, {});
  await request(`/rooms/${cancelRoom.id}/cancel`, host, {}, 400);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 11600);
  console.log("PASS atomic ₦4,000 pot → ₦3,600 prize + ₦400 commission, no double settlement and cancellation refunds once");

  const wdBody = { amountNaira: 500, requestId: randomUUID(), recipientName: "Sandbox Player", accountNumber: "9876543210", bankCode: "044" };
  const withdrawals = await Promise.all([1, 2].map(() => request("/withdrawals", host, wdBody, 201)));
  assert.equal(withdrawals[0].data.id, withdrawals[1].data.id);
  assert.equal(withdrawals[0].data.status, "success");
  assert.equal((await request("/wallet", host)).data.balanceNaira, 11100);
  await request(`/withdrawals/${withdrawals[0].data.id}/verify`, outsider, {}, 404);
  await request("/withdrawals", host, { ...wdBody, requestId: randomUUID(), amountNaira: 500000 }, 400);
  transferStatus = "pending";
  const pending = (await request("/withdrawals", host, { ...wdBody, requestId: randomUUID() }, 201)).data;
  const wallet = (await request("/wallet", host)).data;
  assert.equal(wallet.balanceNaira, 10600); assert.equal(wallet.withdrawalHeldNaira, 500); assert.equal(wallet.totalBalanceNaira, 11100);
  transfers.get(pending.reference)!.status = "success";
  await request(`/withdrawals/${pending.id}/verify`, host, {});
  await request(`/withdrawals/${pending.id}/verify`, host, {});
  assert.equal((await request("/wallet", host)).data.balanceNaira, 10600);
  transferStatus = "failed";
  const failed = (await request("/withdrawals", host, { ...wdBody, requestId: randomUUID() }, 201)).data;
  assert.equal(failed.status, "failed");
  await request(`/withdrawals/${failed.id}/verify`, host, {});
  assert.equal((await request("/wallet", host)).data.balanceNaira, 10600);
  assert.equal((await db.select().from(withdrawalsTable)).length, 3);
  process.env.PAYSTACK_TEST_SECRET_KEY = "sk_live_fixture_rejected";
  await request("/deposits/initialize", host, { amountNaira: 500 }, 503);
  await request("/withdrawals", host, { ...wdBody, requestId: randomUUID() }, 503);
  process.env.PAYSTACK_TEST_SECRET_KEY = "sk_test_fixture_not_a_credential";
  const concurrentSeats = await Promise.all([host, green].map(seat => request("/rooms", seat, { stakeNaira: 1000 }, 201)));
  assert.equal(concurrentSeats[0].data.id, concurrentSeats[1].data.id);
  assert.equal((await request(`/rooms/${concurrentSeats[0].data.id}`, host)).data.status, "active");
  console.log("PASS simultaneous empty-queue arrivals pair into one match");
  await request("/auth/logout", host, {}, 204);
  await request("/auth/me", host, undefined, 401);
  console.log(`PASS withdrawals credit/debit-once, pending reconciliation, failure refunds and test-key enforcement. ${checks} API checks.`);
} finally {
  for (const ws of wss.clients) ws.terminate();
  await new Promise<void>(resolve => server.close(() => resolve()));
  globalThis.fetch = nativeFetch;
  await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
  await pool.end();
}
