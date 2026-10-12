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
const providerAuthorizationHeaders: string[] = [];
let transferStatus = "success";
let recipientAccepted = true;
let recipientNetworkUnavailable = false;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== "https://api.paystack.co") return nativeFetch(input, init);
  providerAuthorizationHeaders.push(new Headers(init?.headers).get("authorization") ?? "");
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const reply = (data: unknown, status = 200, message = "") => new Response(JSON.stringify({ status: status < 400, data, message }), { status, headers: { "content-type": "application/json" } });
  if (url.pathname === "/transaction/initialize") {
    const domain = String(body.reference).startsWith("pay_live_") ? "live" : "test";
    deposits.set(body.reference, { amount: body.amount, status: "pending", domain });
    return reply({ authorization_url: `https://checkout.paystack.com/${body.reference}` });
  }
  if (url.pathname.startsWith("/transaction/verify/")) {
    const ref = url.pathname.split("/").at(-1)!;
    const item = deposits.get(ref);
    return item ? reply({ ...item, reference: ref, currency: "NGN" }) : reply(null, 404);
  }
  if (url.pathname === "/transferrecipient" && recipientNetworkUnavailable) {
    throw new Error("Simulated Paystack test API timeout");
  }
  if (url.pathname === "/transferrecipient") return recipientAccepted
    ? reply({ domain: new Headers(init?.headers).get("authorization")?.includes("sk_live_") ? "live" : "test", recipient_code: new Headers(init?.headers).get("authorization")?.includes("sk_live_") ? "RCP_live_fixture" : "RCP_test_fixture" })
    : reply(null, 400, "Cannot resolve account");
  if (url.pathname === "/transfer") {
    const data = transfers.get(body.reference) ?? {
      domain: String(body.reference).startsWith("wd_live_") ? "live" : "test",
      reference: body.reference, currency: "NGN",
      amount: body.amount, status: transferStatus,
      transfer_code: String(body.reference).startsWith("wd_live_") ? "TRF_live_fixture" : "TRF_test_fixture",
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
  const { data, response } = await request("/auth/register", undefined, { username: name, email, password: "sandbox-password-123" }, 200);
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
    board: { ...room.board, dice: null, remainingDice: [], consecutiveDoubles: 0, turnMessage: null, lastMove: null, captureBonusPending: false, hasRolled: false, turnUserId: room.hostUserId,
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
  const tooShort = await request("/auth/register", undefined, {
    username: "shortpassword",
    email: "shortpassword@example.test",
    password: "123",
  }, 400);
  assert.equal(tooShort.data.error, "Password must be at least 4 characters long.");
  const normalizedRegistration = await request("/auth/register", undefined, {
    username: "normaluser",
    email: "  MixedCase@Example.test  ",
    password: "1234",
  }, 200);
  assert.equal(normalizedRegistration.data.user.email, "mixedcase@example.test");
  const normalizedSeat = {
    id: normalizedRegistration.data.user.id,
    email: normalizedRegistration.data.user.email,
    cookie: normalizedRegistration.response.headers.get("set-cookie")!.split(";")[0],
  };
  assert.equal((await request("/auth/me", normalizedSeat)).data.user.id, normalizedSeat.id);
  const normalizedLogin = await request("/auth/login", undefined, {
    email: "  MIXEDCASE@EXAMPLE.TEST ",
    password: "1234",
  });
  assert.equal(normalizedLogin.data.user.id, normalizedSeat.id);
  const longPassword = "p".repeat(80);
  const longPasswordAccount = await request("/auth/register", undefined, {
    username: "longpassword",
    email: "longpassword@example.test",
    password: longPassword,
  }, 200);
  const longPasswordLogin = await request("/auth/login", undefined, {
    email: "longpassword@example.test",
    password: longPassword,
  });
  assert.equal(longPasswordLogin.data.user.id, longPasswordAccount.data.user.id);
  const host = await register("testhost");
  const green = await register("testgreen");
  const outsider = await register("testoutside");
  const duplicateEmail = await request("/auth/register", undefined, { username: `dupe${randomUUID().replaceAll("-", "").slice(0, 12)}`, email: host.email, password: "1234" }, 409);
  assert.equal(duplicateEmail.data.error, "Email already registered");
  const duplicateUsername = await request("/auth/register", undefined, { username: "testhost", email: `different-${randomUUID()}@example.test`, password: "1234" }, 409);
  assert.equal(duplicateUsername.data.error, "Username already registered");
  await request("/auth/login", undefined, { email: host.email, password: "wrong" }, 401);
  await db.update(sessionsTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessionsTable.userId, host.id));
  await request("/auth/me", host, undefined, 401);
  const login = await request("/auth/login", undefined, { email: host.email, password: "sandbox-password-123" });
  host.cookie = login.response.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await request("/auth/me", host)).data.user.id, host.id);
  console.log("PASS local registration, login, duplicates, authorization and expired sessions");

  const passwordSeat = await register("passwordchange");
  await request("/auth/reset-password", undefined, {
    currentPassword: "sandbox-password-123",
    newPassword: "123456",
  }, 401);
  await request("/auth/reset-password", passwordSeat, {
    currentPassword: "sandbox-password-123",
    newPassword: "123",
  }, 400);
  await request("/auth/reset-password", passwordSeat, {
    currentPassword: "wrong-password",
    newPassword: "123456",
  }, 401);
  const oldPasswordCookie = passwordSeat.cookie;
  const reset = await request("/auth/reset-password", passwordSeat, {
    currentPassword: "sandbox-password-123",
    newPassword: "123456",
  });
  assert.equal(reset.data.success, true);
  const freshSeat = {
    ...passwordSeat,
    cookie: reset.response.headers.get("set-cookie")!.split(";")[0],
  };
  await request("/auth/me", { ...passwordSeat, cookie: oldPasswordCookie }, undefined, 401);
  await request("/auth/login", undefined, {
    email: passwordSeat.email,
    password: "sandbox-password-123",
  }, 401);
  const newPasswordLogin = await request("/auth/login", undefined, {
    email: passwordSeat.email,
    password: "123456",
  });
  assert.equal(newPasswordLogin.data.user.id, passwordSeat.id);
  assert.equal((await request("/auth/me", freshSeat)).data.user.id, passwordSeat.id);
  console.log("PASS authenticated password reset, 4-character minimum and session invalidation");

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

  const liveEnvKeys = ["NODE_ENV", "PAYSTACK_MODE", "PAYSTACK_SECRET_KEY", "PAYSTACK_PUBLIC_KEY", "PAYSTACK_LIVE_CALLBACK_URL", "REPLIT_DOMAINS"] as const;
  const previousLiveEnv = Object.fromEntries(liveEnvKeys.map(key => [key, process.env[key]]));
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    process.env.PAYSTACK_MODE = "live";
    process.env.PAYSTACK_SECRET_KEY = "sk_live_fixture_only";
    process.env.PAYSTACK_PUBLIC_KEY = "pk_live_fixture_only";
    process.env.PAYSTACK_LIVE_CALLBACK_URL = "https://mosquito.test.replit.app/";
    process.env.REPLIT_DOMAINS = "mosquito.test.replit.app";
    const liveInit = await request("/deposits/initialize", host, { amountNaira: 500 }, 201);
    assert.equal(liveInit.data.paymentMode, "live");
    assert.equal(liveInit.data.reference.startsWith("pay_live_"), true);
    assert.equal(providerAuthorizationHeaders.at(-1), "Bearer sk_live_fixture_only");
    deposits.get(liveInit.data.reference)!.status = "success";
    const liveDeposit = await request("/deposits/verify", host, { reference: liveInit.data.reference });
    assert.equal(liveDeposit.data.status, "success");
    assert.equal(liveDeposit.data.paymentMode, "live");
    assert.equal(liveDeposit.data.balanceNaira, 10500);
    assert.equal((await request("/deposits/verify", host, { reference: liveInit.data.reference })).data.balanceNaira, 10500);

    const [commissionBeforeLiveCashout] = await db.select().from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
    const liveWithdrawal = await request("/withdrawals", host, {
      amountNaira: 500, requestId: randomUUID(), recipientName: "Live Fixture", accountNumber: "1111111111", bankCode: "044",
    }, 201);
    assert.equal(liveWithdrawal.data.reference.startsWith("wd_live_"), true);
    assert.equal(liveWithdrawal.data.status, "success");
    assert.equal(liveWithdrawal.data.simulated, false);
    assert.equal(transfers.get(liveWithdrawal.data.reference)?.domain, "live");
    assert.equal(providerAuthorizationHeaders.some(header => header === "Bearer sk_live_fixture_only"), true);
    const [commissionAfterLiveCashout] = await db.select().from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
    assert.equal(commissionAfterLiveCashout.balanceKobo, commissionBeforeLiveCashout.balanceKobo + 5_000);
    recipientAccepted = false;
    const balanceBeforeRejectedLiveRecipient = (await request("/wallet", host)).data.balanceNaira;
    await request("/withdrawals", host, {
      amountNaira: 500, requestId: randomUUID(), recipientName: "Unresolved Fixture", accountNumber: "2222222222", bankCode: "044",
    }, 502);
    assert.equal((await request("/wallet", host)).data.balanceNaira, balanceBeforeRejectedLiveRecipient);
    recipientAccepted = true;
    console.log("PASS live-mode deposit verification, idempotent credit, real-transfer path, commission and no simulation on recipient failure (provider mocked)");
  } finally {
    for (const key of liveEnvKeys) {
      const value = previousLiveEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const configuredTestKey = process.env.PAYSTACK_TEST_SECRET_KEY;
  delete process.env.PAYSTACK_TEST_SECRET_KEY;
  await request("/withdrawals", host, {
    amountNaira: 500,
    requestId: randomUUID(),
    recipientName: "Sandbox Player",
    accountNumber: "0000000000",
    bankCode: "011",
  }, 503);
  if (configuredTestKey) process.env.PAYSTACK_TEST_SECRET_KEY = configuredTestKey;
  const mockWithdrawalUser = await register("mockwithdrawal");
  await credit(mockWithdrawalUser, 1000);
  const [commissionBeforeSimulation] = await db.select().from(platformWalletTable)
    .where(eq(platformWalletTable.id, "commission"));
  const commissionBalanceBeforeSimulation = commissionBeforeSimulation?.balanceKobo ?? 0;
  const simulatedBody = {
    amountNaira: 500,
    requestId: randomUUID(),
    recipientName: "Sandbox Player",
    accountNumber: "0000000000",
    bankCode: "011",
  };
  recipientAccepted = false;
  const simulatedInvalidRecipient = await request("/withdrawals", mockWithdrawalUser, simulatedBody, 201);
  assert.equal(simulatedInvalidRecipient.data.status, "success");
  assert.equal(simulatedInvalidRecipient.data.simulated, true);
  assert.equal(simulatedInvalidRecipient.data.reference.startsWith("wd_"), true);
  assert.equal(transfers.has(simulatedInvalidRecipient.data.reference), false);
  const mockWalletAfterFirstSimulation = await request("/wallet", mockWithdrawalUser);
  assert.equal(mockWalletAfterFirstSimulation.data.balanceNaira, 500);
  assert.equal(mockWalletAfterFirstSimulation.data.withdrawals[0].simulated, true);
  const simulatedRepeat = await request("/withdrawals", mockWithdrawalUser, simulatedBody, 201);
  assert.equal(simulatedRepeat.data.id, simulatedInvalidRecipient.data.id);
  recipientNetworkUnavailable = true;
  const simulatedNetworkFailure = await request("/withdrawals", mockWithdrawalUser, {
    ...simulatedBody,
    requestId: randomUUID(),
  }, 201);
  assert.equal(simulatedNetworkFailure.data.status, "success");
  assert.equal(simulatedNetworkFailure.data.simulated, true);
  assert.equal((await request("/wallet", mockWithdrawalUser)).data.balanceNaira, 0);
  recipientNetworkUnavailable = false;
  recipientAccepted = true;
  const [commissionAfterSimulation] = await db.select().from(platformWalletTable)
    .where(eq(platformWalletTable.id, "commission"));
  assert.equal(commissionAfterSimulation.balanceKobo, commissionBalanceBeforeSimulation + 10_000);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 10000);
  recipientAccepted = true;
  console.log("PASS test-mode withdrawal simulation on unresolved recipient/network failure, ₦50 fee and idempotency");

  const lobby = (await request("/lobby", host)).data;
  assert.equal(lobby.tiers.length, 9);
  assert.deepEqual(lobby.tiers.map((tier: { id: string }) => tier.id), [
    "oga-chairman", "big-doings", "senior-man", "sharp-guy", "quick-clash",
    "street-king", "board-master", "area-hustler", "practice-ground",
  ]);
  await request("/rooms", outsider, { tierId: "oga-chairman" }, 400);
  const freeRoom = (await request("/rooms", outsider, { tierId: "practice-ground" }, 201)).data;
  assert.equal(freeRoom.stakeNaira, 0);
  assert.equal(freeRoom.status, "waiting");
  await request(`/rooms/${freeRoom.id}/cancel`, outsider, {});

  const waiting = (await request("/rooms", host, { tierId: "sharp-guy" }, 201)).data;
  assert.equal(waiting.status, "waiting");
  const roomId = waiting.id;
  const repeat = (await request("/rooms", host, { tierId: "sharp-guy" }, 201)).data;
  assert.equal(repeat.id, roomId);
  const held = (await request("/wallet", host)).data;
  assert.equal(held.balanceNaira, 8000); assert.equal(held.escrowedNaira, 2000); assert.equal(held.totalBalanceNaira, 10000);
  await request("/withdrawals", host, { amountNaira: 9000, requestId: randomUUID(), recipientName: "Sandbox Player", accountNumber: "0000000000", bankCode: "011" }, 400);
  const active = (await request("/rooms", green, { tierId: "sharp-guy", roomId }, 201)).data;
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
  assert.equal(captured.board.redTokens[0], 57); assert.equal(captured.board.greenTokens[0], -1); assert.equal(captured.board.turnUserId, green.id);
  assert.equal(captured.board.turnMessage, "capture_home"); assert.equal(captured.board.hasRolled, false);
  await event;
  await fixture(roomId, { turnUserId: green.id, greenTokens: [5, -1, -1, -1], redTokens: [32, -1, -1, -1], dice: [1, 2], remainingDice: [0], hasRolled: true });
  const greenMove = (await request(`/rooms/${roomId}/move`, green, { tokenIndex: 0, diceIndices: [0] })).data;
  assert.equal(greenMove.board.turnUserId, host.id); assert.equal(greenMove.board.redTokens[0], -1);
  assert.equal(greenMove.board.greenTokens[0], 57);
  await fixture(roomId, { redTokens: [7, -1, -1, -1], greenTokens: [34, -1, -1, -1], dice: [1, 2], remainingDice: [0], hasRolled: true });
  assert.equal((await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] })).data.board.greenTokens[0], 34);
  await fixture(roomId, { redTokens: [-1, -1, -1, -1], dice: [6, 6], remainingDice: [0], consecutiveDoubles: 1, hasRolled: true });
  const six = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] })).data;
  assert.equal(six.board.redTokens[0], 0); assert.equal(six.board.turnUserId, host.id);
  assert.deepEqual(six.board.remainingDice, [1]);
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
  await fixture(roomId, { redTokens: [-1, -1, -1, -1], dice: [3, 4], remainingDice: [0, 1], hasRolled: true });
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0, 1] }, 400);
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] }, 400);
  await fixture(roomId, { redTokens: [-1, -1, -1, -1], dice: [6, 1], remainingDice: [0, 1], hasRolled: true });
  const entered = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0, 1] })).data;
  assert.equal(entered.board.redTokens[0], 1); assert.equal(entered.board.turnUserId, green.id);
  assert.equal(entered.board.turnMessage, "turn_passed");
  await fixture(roomId, { redTokens: [5, 10, -1, -1], greenTokens: [32, -1, -1, -1], dice: [1, 2], remainingDice: [0, 1], hasRolled: true });
  const firstCapture = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0] })).data;
  assert.equal(firstCapture.board.captureBonusPending, false); assert.equal(firstCapture.board.redTokens[0], 57);
  assert.equal(firstCapture.board.greenTokens[0], -1);
  await request(`/rooms/${roomId}/roll`, host, {}, 400);
  const lastDie = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 1, diceIndices: [1] })).data;
  assert.deepEqual(lastDie.board.redTokens.slice(0, 2), [57, 12]);
  assert.equal(lastDie.board.turnUserId, green.id); assert.equal(lastDie.board.hasRolled, false);
  assert.equal(lastDie.board.turnMessage, "capture_home"); assert.equal(lastDie.board.captureBonusPending, false);

  // Only this isolated test process controls server randomness, never the client.
  const actualRandomInt = crypto.randomInt;
  try {
    crypto.randomInt = (() => 5) as typeof crypto.randomInt;
    syncBuiltinESMExports();
    await fixture(roomId, { redTokens: [0, -1, -1, -1], greenTokens: [0, -1, -1, -1] });
    const redRoll = (await request(`/rooms/${roomId}/roll`, host, {})).data;
    assert.deepEqual(redRoll.board.dice, [5, 5]); assert.equal(redRoll.board.consecutiveDoubles, 0);
    const redMove = (await request(`/rooms/${roomId}/move`, host, { tokenIndex: 0, diceIndices: [0, 1] })).data;
    assert.equal(redMove.board.redTokens[0], 10);
    assert.equal(redMove.board.turnUserId, green.id); assert.equal(redMove.board.hasRolled, false);
    assert.equal(redMove.board.turnMessage, "turn_passed");
    const greenRoll = (await request(`/rooms/${roomId}/roll`, green, {})).data;
    assert.deepEqual(greenRoll.board.dice, [5, 5]);
    const greenMove = (await request(`/rooms/${roomId}/move`, green, { tokenIndex: 0, diceIndices: [0, 1] })).data;
    assert.equal(greenMove.board.greenTokens[0], 10);
    assert.equal(greenMove.board.turnUserId, host.id); assert.equal(greenMove.board.hasRolled, false);
    assert.equal(greenMove.board.turnMessage, "turn_passed");
  } finally {
    crypto.randomInt = actualRandomInt;
    syncBuiltinESMExports();
  }
  console.log("PASS split dice, combined sum, any-six entry, used-die protection, double-six bonus and non-double-six turn passing");

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
  assert.equal(winner.board.lastMove.kind, "capture_home");
  assert.equal((await request("/wallet", host)).data.balanceNaira, 11600);
  const [commission] = await db.select().from(platformWalletTable);
  assert.equal(commission.balanceKobo, commissionBalanceBeforeSimulation + 50_000);
  assert.equal((await db.select().from(commissionLedgerTable)).length, 1);
  await request(`/rooms/${roomId}/move`, host, { tokenIndex: 3, diceIndices: [0] }, 400);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 11600);
  const cancelRoom = (await request("/rooms", host, { tierId: "area-hustler" }, 201)).data;
  await request(`/rooms/${cancelRoom.id}/cancel`, outsider, {}, 404);
  await request(`/rooms/${cancelRoom.id}/cancel`, host, {});
  await request(`/rooms/${cancelRoom.id}/cancel`, host, {}, 400);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 11600);
  console.log("PASS capture-to-home wins settle the ₦4,000 pot → ₦3,600 prize + ₦400 commission exactly once");

  const third = await register("testthird");
  const fourth = await register("testfourth");
  await Promise.all([credit(third), credit(fourth), credit(outsider)]);
  const fourRoom = (await request("/rooms", host, { tierId: "street-king" }, 201)).data;
  assert.equal(fourRoom.status, "waiting");
  assert.equal(fourRoom.maxPlayers, 4);
  assert.equal(fourRoom.playerCount, 1);
  const twoSeats = (await request("/rooms", green, { tierId: "street-king", roomId: fourRoom.id }, 201)).data;
  assert.equal(twoSeats.status, "active");
  assert.equal(twoSeats.playerCount, 2);
  assert.equal(twoSeats.board.joinWindowOpen, true);
  const threeSeats = (await request("/rooms", third, { tierId: "street-king", roomId: fourRoom.id }, 201)).data;
  assert.equal(threeSeats.playerCount, 3);
  assert.equal(threeSeats.players[2].color, "yellow");
  const fourSeats = (await request("/rooms", fourth, { tierId: "street-king", roomId: fourRoom.id }, 201)).data;
  assert.equal(fourSeats.playerCount, 4);
  assert.equal(fourSeats.players[3].color, "blue");
  assert.equal(fourSeats.board.joinWindowOpen, false);
  await request("/rooms", outsider, { tierId: "street-king", roomId: fourRoom.id }, 400);
  assert.deepEqual(fourSeats.board.playerOrder, [host.id, green.id, third.id, fourth.id]);
  assert.equal((await request("/wallet", third)).data.escrowedNaira, 2000);
  const fourPlayerSocket = await connect(third);
  const fourPlayerUpdate = messageOf(fourPlayerSocket, "room.updated");
  fourPlayerSocket.send(JSON.stringify({ type: "subscribe", roomId: fourRoom.id }));
  assert.equal((await fourPlayerUpdate).roomId, fourRoom.id);
  fourPlayerSocket.terminate();

  const actualRandomIntForFour = crypto.randomInt;
  let fourRollIndex = 0;
  try {
    crypto.randomInt = (() => ([1, 2][fourRollIndex++ % 2])) as typeof crypto.randomInt;
    syncBuiltinESMExports();
    await fixture(fourRoom.id, {
      playerOrder: [host.id, green.id, third.id, fourth.id],
      joinWindowOpen: true,
      redTokens: [0, -1, -1, -1],
      greenTokens: [-1, -1, -1, -1],
      yellowTokens: [-1, -1, -1, -1],
      blueTokens: [-1, -1, -1, -1],
    });
    const hostRoll = (await request(`/rooms/${fourRoom.id}/roll`, host, {})).data;
    assert.deepEqual(hostRoll.board.dice, [1, 2]);
    assert.equal(hostRoll.board.joinWindowOpen, false);
    await request(`/rooms/${fourRoom.id}/move`, host, { tokenIndex: 0, diceIndices: [0] });
    const hostEndTurn = (await request(`/rooms/${fourRoom.id}/move`, host, { tokenIndex: 0, diceIndices: [1] })).data;
    assert.equal(hostEndTurn.board.turnUserId, green.id);
    const greenPass = (await request(`/rooms/${fourRoom.id}/roll`, green, {})).data;
    assert.equal(greenPass.board.turnUserId, third.id);
    const yellowPass = (await request(`/rooms/${fourRoom.id}/roll`, third, {})).data;
    assert.equal(yellowPass.board.turnUserId, fourth.id);
    const bluePass = (await request(`/rooms/${fourRoom.id}/roll`, fourth, {})).data;
    assert.equal(bluePass.board.turnUserId, host.id);
  } finally {
    crypto.randomInt = actualRandomIntForFour;
    syncBuiltinESMExports();
  }
  await fixture(fourRoom.id, {
    playerOrder: [host.id, green.id, third.id, fourth.id],
    joinWindowOpen: false,
    turnUserId: host.id,
    redTokens: [57, 57, 57, 56],
    greenTokens: [-1, -1, -1, -1],
    yellowTokens: [-1, -1, -1, -1],
    blueTokens: [-1, -1, -1, -1],
    dice: [1, 2],
    remainingDice: [0],
    hasRolled: true,
  });
  const [commissionBeforeFourPlayer] = await db.select().from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
  const fourWinner = (await request(`/rooms/${fourRoom.id}/move`, host, { tokenIndex: 3, diceIndices: [0] })).data;
  assert.equal(fourWinner.status, "completed");
  assert.equal(fourWinner.playerCount, 4);
  assert.equal(fourWinner.potNaira, 8000);
  assert.equal(fourWinner.prizeNaira, 7200);
  assert.equal(fourWinner.commissionNaira, 800);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 16800);
  assert.equal((await request("/wallet", green)).data.escrowedNaira, 0);
  const [commissionAfterFourPlayer] = await db.select().from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
  assert.equal(commissionAfterFourPlayer.balanceKobo, commissionBeforeFourPlayer.balanceKobo + 80_000);
  console.log("PASS four-player activation, seat colors, turn order, stake locks and 90/10 settlement");

  const boardMaster = (await request("/rooms", host, { tierId: "board-master" }, 201)).data;
  await request("/rooms", green, { tierId: "board-master", roomId: boardMaster.id }, 201);
  crypto.randomInt = (() => 1) as typeof crypto.randomInt;
  syncBuiltinESMExports();
  const firstRoll = (await request(`/rooms/${boardMaster.id}/roll`, host, {})).data;
  crypto.randomInt = actualRandomIntForFour;
  syncBuiltinESMExports();
  assert.equal(firstRoll.board.joinWindowOpen, false);
  await request("/rooms", third, { tierId: "board-master", roomId: boardMaster.id }, 400);
  await fixture(boardMaster.id, {
    turnUserId: host.id, joinWindowOpen: false,
    redTokens: [57, 57, 57, 56], greenTokens: [-1, -1, -1, -1],
    dice: [1, 2], remainingDice: [0], hasRolled: true,
  });
  const boardMasterWin = (await request(`/rooms/${boardMaster.id}/move`, host, { tokenIndex: 3, diceIndices: [0] })).data;
  assert.equal(boardMasterWin.status, "completed");
  console.log("PASS late fourth-seat join window closes on the first roll");

  const wdBody = { amountNaira: 500, requestId: randomUUID(), recipientName: "Sandbox Player", accountNumber: "9876543210", bankCode: "044" };
  const [commissionBeforeWithdrawal] = await db.select().from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
  const withdrawals = await Promise.all([1, 2].map(() => request("/withdrawals", host, wdBody, 201)));
  assert.equal(withdrawals[0].data.id, withdrawals[1].data.id);
  assert.equal(withdrawals[0].data.status, "success");
  assert.equal(transfers.get(withdrawals[0].data.reference)?.amount, 45_000);
  const [commissionAfterWithdrawal] = await db.select().from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
  assert.equal(commissionAfterWithdrawal.balanceKobo, commissionBeforeWithdrawal.balanceKobo + 5_000);
  assert.equal((await request("/wallet", host)).data.balanceNaira, 17100);
  await request(`/withdrawals/${withdrawals[0].data.id}/verify`, outsider, {}, 404);
  await request("/withdrawals", host, { ...wdBody, requestId: randomUUID(), amountNaira: 500000 }, 400);
  transferStatus = "pending";
  const pending = (await request("/withdrawals", host, { ...wdBody, requestId: randomUUID() }, 201)).data;
  const wallet = (await request("/wallet", host)).data;
  assert.equal(wallet.balanceNaira, 16600); assert.equal(wallet.withdrawalHeldNaira, 500); assert.equal(wallet.totalBalanceNaira, 17100);
  transfers.get(pending.reference)!.status = "success";
  await request(`/withdrawals/${pending.id}/verify`, host, {});
  await request(`/withdrawals/${pending.id}/verify`, host, {});
  assert.equal((await request("/wallet", host)).data.balanceNaira, 16600);
  transferStatus = "failed";
  const failed = (await request("/withdrawals", host, { ...wdBody, requestId: randomUUID() }, 201)).data;
  assert.equal(failed.status, "failed");
  await request(`/withdrawals/${failed.id}/verify`, host, {});
  assert.equal((await request("/wallet", host)).data.balanceNaira, 16600);
  assert.equal((await db.select().from(withdrawalsTable)).length, 5);
  process.env.PAYSTACK_TEST_SECRET_KEY = "sk_live_fixture_rejected";
  await request("/deposits/initialize", host, { amountNaira: 500 }, 503);
  await request("/withdrawals", host, { ...wdBody, requestId: randomUUID() }, 503);
  process.env.PAYSTACK_TEST_SECRET_KEY = "sk_test_fixture_not_a_credential";
  const concurrentSeats = await Promise.all([host, green].map(seat => request("/rooms", seat, { tierId: "quick-clash" }, 201)));
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
