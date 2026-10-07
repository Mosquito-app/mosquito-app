import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, usersTable, walletTransactionsTable, withdrawalsTable } from "@workspace/db";
import { CreateWithdrawalBody, CreateWithdrawalResponse, VerifyWithdrawalParams, VerifyWithdrawalResponse } from "@workspace/api-zod";
import { getAuthenticatedUser } from "../lib/ludo-auth";
import { paystackTestRequest, PaystackTestError } from "../lib/paystack-test";
import { initiateTestTransfer, reconcileWithdrawal, withdrawalDto } from "../lib/ludo-withdrawals";

const router: IRouter = Router();
router.post("/withdrawals", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Sign in to request a test withdrawal." }); return; }
  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter a valid test amount and bank recipient details." }); return; }
  const input = parsed.data;
  const [previous] = await db.select().from(withdrawalsTable).where(and(
    eq(withdrawalsTable.userId, user.id), eq(withdrawalsTable.requestId, input.requestId),
  )).limit(1);
  if (previous) { res.status(201).json(CreateWithdrawalResponse.parse(withdrawalDto(previous))); return; }
  if (user.balanceKobo < input.amountNaira * 100) {
    res.status(400).json({ error: "Insufficient available sandbox funds. Match stakes cannot be withdrawn." }); return;
  }
  try {
    const recipient = await paystackTestRequest("/transferrecipient", "POST", {
      type: "nuban", name: input.recipientName.trim(), account_number: input.accountNumber,
      bank_code: input.bankCode, currency: "NGN",
    });
    if (!recipient.ok && recipient.failureReason === "invalid_recipient") {
      res.status(400).json({ error: "Paystack cannot resolve those recipient details. Check the account number and matching bank code. No funds were reserved; transfers remain test-only." });
      return;
    }
    if (!recipient.ok || recipient.data?.domain !== "test" || typeof recipient.data.recipient_code !== "string") {
      res.status(502).json({ error: "Paystack could not create that test recipient. No funds were reserved." }); return;
    }
    const recipientCode = recipient.data.recipient_code;
    const withdrawal = await db.transaction(async tx => {
      const [locked] = await tx.select().from(usersTable).where(eq(usersTable.id, user.id)).for("update").limit(1);
      const [duplicate] = await tx.select().from(withdrawalsTable).where(and(
        eq(withdrawalsTable.userId, user.id), eq(withdrawalsTable.requestId, input.requestId),
      )).limit(1);
      if (duplicate) return duplicate;
      if (!locked || locked.balanceKobo < input.amountNaira * 100) throw new PaystackTestError(400, "Insufficient available sandbox funds.");
      const [row] = await tx.insert(withdrawalsTable).values({
        userId: user.id, requestId: input.requestId, reference: `ludo_w_${randomUUID()}`,
        amountKobo: input.amountNaira * 100, recipientCode,
      }).returning();
      await tx.update(usersTable).set({ balanceKobo: locked.balanceKobo - row.amountKobo }).where(eq(usersTable.id, user.id));
      await tx.insert(walletTransactionsTable).values({
        userId: user.id, type: "withdrawal_lock", amountKobo: -row.amountKobo,
        description: `Paystack test withdrawal — ${row.reference.slice(-8)}`,
      });
      return row;
    });
    if (withdrawal.status === "pending") {
      try { await initiateTestTransfer(withdrawal); }
      catch { req.log.warn("Test transfer response unresolved; funds remain held for reconciliation"); }
    }
    const [latest] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, withdrawal.id)).limit(1);
    res.status(201).json(CreateWithdrawalResponse.parse(withdrawalDto(latest)));
  } catch (error) {
    if (error instanceof PaystackTestError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.error("Test withdrawal request failed");
    res.status(502).json({ error: "Paystack test transfers are unavailable. Please retry the same request." });
  }
});

router.post("/withdrawals/:withdrawalId/verify", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Sign in to verify a withdrawal." }); return; }
  const params = VerifyWithdrawalParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid withdrawal id." }); return; }
  const [row] = await db.select().from(withdrawalsTable).where(and(
    eq(withdrawalsTable.id, params.data.withdrawalId), eq(withdrawalsTable.userId, user.id),
  )).limit(1);
  if (!row) { res.status(404).json({ error: "Test withdrawal not found." }); return; }
  try { await reconcileWithdrawal(row); } catch { req.log.warn("Test transfer verification delayed"); }
  const [latest] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, row.id)).limit(1);
  res.json(VerifyWithdrawalResponse.parse(withdrawalDto(latest)));
});
export default router;
