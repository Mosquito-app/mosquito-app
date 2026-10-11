import { and, eq, lt, sql } from "drizzle-orm";
import { db, platformWalletTable, usersTable, walletTransactionsTable, withdrawalsTable } from "@workspace/db";
import { paystackTestRequest } from "./paystack-test";
import { logger } from "./logger";

export const WITHDRAWAL_SERVICE_FEE_KOBO = 5_000;
export const MOCK_TEST_RECIPIENT_CODE = "RCP_test_mock123";
const SIMULATED_TEST_TRANSFER_PREFIX = "SIMULATED_TEST:";

type WithdrawalRow = typeof withdrawalsTable.$inferSelect;
export function isSimulatedWithdrawal(row: WithdrawalRow) {
  return row.transferCode?.startsWith(SIMULATED_TEST_TRANSFER_PREFIX) ?? false;
}

export function withdrawalDto(row: WithdrawalRow) {
  return {
    id: row.id,
    reference: row.reference,
    amountNaira: row.amountKobo / 100,
    status: row.status,
    createdAt: row.createdAt,
    simulated: isSimulatedWithdrawal(row),
  };
}

function matchesTransfer(row: WithdrawalRow, data: Record<string, unknown> | null) {
  return data?.domain === "test" && data.reference === row.reference &&
    data.amount === row.amountKobo - WITHDRAWAL_SERVICE_FEE_KOBO && data.currency === "NGN";
}

async function finalize(row: WithdrawalRow, status: "success" | "failed", transferCode?: string) {
  await db.transaction(async tx => {
    const [locked] = await tx.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, row.id)).for("update").limit(1);
    if (!locked || locked.status !== "pending") return;
    if (status === "failed") {
      await tx.update(usersTable).set({ balanceKobo: sql`${usersTable.balanceKobo} + ${locked.amountKobo}` })
        .where(eq(usersTable.id, locked.userId));
      await tx.insert(walletTransactionsTable).values({
        userId: locked.userId, type: "withdrawal_release", amountKobo: locked.amountKobo,
        description: `Failed test withdrawal refunded — ${locked.reference.slice(-8)}`,
      });
    } else {
      await tx.insert(platformWalletTable).values({
        id: "commission",
        balanceKobo: WITHDRAWAL_SERVICE_FEE_KOBO,
      }).onConflictDoUpdate({
        target: platformWalletTable.id,
        set: { balanceKobo: sql`${platformWalletTable.balanceKobo} + ${WITHDRAWAL_SERVICE_FEE_KOBO}` },
      });
    }
    await tx.update(withdrawalsTable).set({ status, transferCode: transferCode ?? null }).where(eq(withdrawalsTable.id, row.id));
  });
}

export async function completeSimulatedTestTransfer(row: WithdrawalRow) {
  if (row.recipientCode !== MOCK_TEST_RECIPIENT_CODE) {
    throw new Error("Only mock-recipient withdrawals may use local test settlement.");
  }
  await finalize(
    row,
    "success",
    `${SIMULATED_TEST_TRANSFER_PREFIX}${row.reference}`,
  );
}

export async function initiateTestTransfer(row: WithdrawalRow) {
  if (row.recipientCode === MOCK_TEST_RECIPIENT_CODE) {
    await completeSimulatedTestTransfer(row);
    return;
  }

  const result = await paystackTestRequest("/transfer", "POST", {
    source: "balance", amount: row.amountKobo - WITHDRAWAL_SERVICE_FEE_KOBO, currency: "NGN", recipient: row.recipientCode,
    reference: row.reference, reason: "LudoRoom sandbox withdrawal — no real funds",
  });
  if (result.ok && matchesTransfer(row, result.data)) {
    const code = typeof result.data?.transfer_code === "string" ? result.data.transfer_code : undefined;
    if (result.data?.status === "success") await finalize(row, "success", code);
    else if (result.data?.status === "failed" || result.data?.status === "reversed") await finalize(row, "failed", code);
    return;
  }
  // Never refund an ambiguous request: a timeout or server error may occur after acceptance.
  if (result.statusCode >= 400 && result.statusCode < 500) {
    const verification = await paystackTestRequest(`/transfer/verify/${encodeURIComponent(row.reference)}`);
    if (verification.statusCode === 404) await finalize(row, "failed");
    else if (verification.ok && matchesTransfer(row, verification.data)) {
      if (verification.data?.status === "success") await finalize(row, "success");
      else if (["failed", "reversed"].includes(String(verification.data?.status))) await finalize(row, "failed");
    }
  }
}
export async function reconcileWithdrawal(row: WithdrawalRow) {
  if (row.status !== "pending") return;
  if (row.recipientCode === MOCK_TEST_RECIPIENT_CODE) {
    await completeSimulatedTestTransfer(row);
    return;
  }

  const result = await paystackTestRequest(`/transfer/verify/${encodeURIComponent(row.reference)}`);
  if (result.ok && matchesTransfer(row, result.data)) {
    if (result.data?.status === "success") await finalize(row, "success");
    else if (["failed", "reversed"].includes(String(result.data?.status))) await finalize(row, "failed");
  } else if (result.statusCode === 404) {
    // Retry ONLY the original reference; Paystack deduplicates this reference.
    await initiateTestTransfer(row);
  }
}
export function startWithdrawalReconciliation() {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      const rows = await db.select().from(withdrawalsTable).where(and(
        eq(withdrawalsTable.status, "pending"), lt(withdrawalsTable.createdAt, new Date(Date.now() - 20_000)),
      )).limit(20);
      for (const row of rows) {
        try { await reconcileWithdrawal(row); } catch { logger.warn("Test withdrawal reconciliation delayed"); }
      }
    })().catch(err => logger.error({ err }, "Withdrawal reconciliation failed")).finally(() => { running = false; });
  }, 15_000);
  timer.unref();
  return timer;
}
