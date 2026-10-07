import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { WebSocket } from "ws";
import { db, pool, usersTable, sessionsTable, depositIntentsTable, walletTransactionsTable, withdrawalsTable } from "@workspace/db";
import { paystackTestRequest } from "../src/lib/paystack-test";

// Calls only the running DEVELOPMENT preview. The API itself rejects non-test keys.
const api = "http://localhost:80/api";
let cookie = "";
let userId = "";
async function request(path: string, body?: unknown) {
  const res = await fetch(`${api}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  return { res, data };
}
try {
  const suffix = randomUUID().slice(0, 8);
  const registration = await request("/auth/register", {
    username: `smoke_${suffix}`, email: `smoke_${suffix}@example.com`, password: randomUUID(),
  });
  if (registration.res.status !== 201) throw new Error(`Preview registration failed (${registration.res.status}).`);
  userId = registration.data.user.id;
  cookie = registration.res.headers.get("set-cookie")!.split(";")[0];
  const checkout = await request("/deposits/initialize", { amountNaira: 2000 });
  if (checkout.res.status !== 201) throw new Error(`Paystack checkout unavailable: ${checkout.data.error}`);
  console.log("PASS running-preview Paystack hosted TEST checkout initialization (₦2,000)");
  const verified = await request("/deposits/verify", { reference: checkout.data.reference });
  console.log(`Unpaid test checkout verification: HTTP ${verified.res.status}, status ${verified.data.status ?? "unavailable"}; no credited deposit claimed.`);

  await db.transaction(async tx => {
    await tx.update(usersTable).set({ balanceKobo: 50000 }).where(eq(usersTable.id, userId));
    await tx.insert(walletTransactionsTable).values({
      userId, type: "deposit", amountKobo: 50000, description: "Temporary isolated smoke-test fixture (not a completed Paystack deposit)",
    });
  });
  let withdrawal = await request("/withdrawals", {
    amountNaira: 500, requestId: randomUUID(), recipientName: "Sandbox Player",
    accountNumber: "0000000000", bankCode: "011",
  });
  if (withdrawal.res.status !== 201) {
    console.log(`Paystack TEST withdrawal unavailable: HTTP ${withdrawal.res.status}; ${withdrawal.data.error}`);
    const diagnostic = await paystackTestRequest("/transferrecipient", "POST", {
      type: "nuban", name: "Sandbox Player", account_number: "0001234567", bank_code: "058", currency: "NGN",
    });
    console.log("Recipient diagnostic:", JSON.stringify({
      providerStatus: diagnostic.statusCode, accepted: diagnostic.ok, reason: diagnostic.failureReason,
      message: diagnostic.failureMessage,
      testDomain: diagnostic.data?.domain === "test", hasRecipient: typeof diagnostic.data?.recipient_code === "string",
    }));
  } else {
    if (withdrawal.data.status === "pending") withdrawal = await request(`/withdrawals/${withdrawal.data.id}/verify`, {});
    console.log(`Running-preview Paystack TEST transfer: ${withdrawal.data.status}; no real bank funds moved.`);
  }
  const origin = `https://${process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0]}`;
  const ws = new WebSocket("ws://localhost:80/api/ws", { headers: { cookie, origin } });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("Proxy WebSocket timed out")); }, 5000);
    ws.on("message", raw => {
      if (JSON.parse(String(raw)).type === "connected") { clearTimeout(timer); ws.terminate(); resolve(); }
    });
    ws.on("error", err => { clearTimeout(timer); reject(err); });
  });
  console.log("PASS authenticated WebSocket connection through the shared preview proxy");
} finally {
  if (userId) await db.transaction(async tx => {
    await tx.delete(walletTransactionsTable).where(eq(walletTransactionsTable.userId, userId));
    await tx.delete(withdrawalsTable).where(eq(withdrawalsTable.userId, userId));
    await tx.delete(depositIntentsTable).where(eq(depositIntentsTable.userId, userId));
    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
    await tx.delete(usersTable).where(eq(usersTable.id, userId));
  });
  await pool.end();
}
