import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { CreateWithdrawalBody, CreateWithdrawalResponse } from "@workspace/api-zod";
import { db, usersTable, walletTransactionsTable, withdrawalsTable } from "@workspace/db";
import { getAuthenticatedUser } from "../lib/ludo-auth";
import { getPaystackMode, getPaystackSecretKey, paystackRequest, PaystackTestError } from "../lib/paystack-test";
import {
  MOCK_TEST_RECIPIENT_CODE,
  initiateTransfer,
  reconcileWithdrawal,
  WITHDRAWAL_SERVICE_FEE_KOBO,
  withdrawalDto,
} from "../lib/ludo-withdrawals";

const router: IRouter = Router();
const SERVICE_FEE_NAIRA = WITHDRAWAL_SERVICE_FEE_KOBO / 100;
const WITHDRAWAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.post("/withdrawals", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to request a wallet withdrawal." });
    return;
  }

  const parsed = CreateWithdrawalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid withdrawal amount and bank account." });
    return;
  }

  const input = parsed.data;
  if (input.amountNaira <= SERVICE_FEE_NAIRA) {
    res.status(400).json({ error: "Withdrawal amount must be greater than ₦50." });
    return;
  }
  let mode: "test" | "live";
  try {
    mode = getPaystackMode();
    getPaystackSecretKey(mode);
  } catch (error) {
    res.status(error instanceof PaystackTestError ? error.status : 503)
      .json({ error: error instanceof Error ? error.message : "Paystack is not configured." });
    return;
  }

  const [priorRequest] = await db.select().from(withdrawalsTable).where(and(
    eq(withdrawalsTable.userId, user.id),
    eq(withdrawalsTable.requestId, input.requestId),
  )).limit(1);
  if (priorRequest) {
    res.status(201).json(CreateWithdrawalResponse.parse(withdrawalDto(priorRequest)));
    return;
  }

  const amountKobo = input.amountNaira * 100;
  const [currentUser] = await db
    .select({ balanceKobo: usersTable.balanceKobo })
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);
  if (!currentUser || currentUser.balanceKobo < amountKobo) {
    res.status(400).json({ error: "Insufficient Mosquito Wallet balance." });
    return;
  }

  let recipientCode: string;
  try {
    const recipient = await paystackTestRequest("/transferrecipient", "POST", {
      type: "nuban",
      name: input.recipientName.trim(),
      account_number: input.accountNumber,
      bank_code: input.bankCode,
      currency: "NGN",
    });
    const code = recipient.data?.recipient_code;
    if (!recipient.ok || typeof code !== "string" || !code.trim()) {
      req.log.warn(
        { statusCode: recipient.statusCode, reason: recipient.failureReason },
        "Paystack test recipient unavailable; using local simulated withdrawal",
      );
      recipientCode = MOCK_TEST_RECIPIENT_CODE;
    } else {
      recipientCode = code;
    }
  } catch (error) {
    if (error instanceof PaystackTestError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.warn(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Paystack test recipient request failed; using local simulated withdrawal",
    );
    recipientCode = MOCK_TEST_RECIPIENT_CODE;
  }

  const reference = `wd_${randomBytes(18).toString("hex")}`;
  const reservation = await db.transaction(async tx => {
    const [lockedUser] = await tx.select({ id: usersTable.id, balanceKobo: usersTable.balanceKobo })
      .from(usersTable).where(eq(usersTable.id, user.id)).for("update").limit(1);
    if (!lockedUser) return { kind: "missing_user" as const };

    const [existing] = await tx.select().from(withdrawalsTable).where(and(
      eq(withdrawalsTable.userId, user.id),
      eq(withdrawalsTable.requestId, input.requestId),
    )).limit(1);
    if (existing) return { kind: "existing" as const, row: existing };
    if (lockedUser.balanceKobo < amountKobo) return { kind: "insufficient" as const };

    const [withdrawal] = await tx.insert(withdrawalsTable).values({
      userId: user.id,
      requestId: input.requestId,
      reference,
      recipientCode,
      amountKobo,
    }).returning();
    await tx.update(usersTable)
      .set({ balanceKobo: sql`${usersTable.balanceKobo} - ${amountKobo}` })
      .where(and(eq(usersTable.id, user.id), sql`${usersTable.balanceKobo} >= ${amountKobo}`));
    await tx.insert(walletTransactionsTable).values({
      userId: user.id,
      type: "withdrawal_lock",
      amountKobo,
      description: `Sandbox withdrawal requested — ${reference.slice(-8)}`,
    });
    return { kind: "created" as const, row: withdrawal };
  });

  if (reservation.kind === "missing_user") {
    res.status(401).json({ error: "Sign in to request a test withdrawal." });
    return;
  }
  if (reservation.kind === "insufficient") {
    res.status(400).json({ error: "Insufficient Mosquito Wallet balance." });
    return;
  }

  let withdrawal = reservation.row;
  if (withdrawal.status === "pending") {
    try {
      if (reservation.kind === "created") await initiateTestTransfer(withdrawal);
      else await reconcileWithdrawal(withdrawal);
      const [updated] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, withdrawal.id)).limit(1);
      if (updated) withdrawal = updated;
    } catch {
      // A timed-out provider request may already have been accepted; reconciliation checks
      // the same reference rather than refunding or creating a second withdrawal.
      req.log.warn({ withdrawalId: withdrawal.id }, "Test withdrawal will be reconciled");
    }
  }

  res.status(201).json(CreateWithdrawalResponse.parse(withdrawalDto(withdrawal)));
});

router.post("/withdrawals/:withdrawalId/verify", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to verify a test withdrawal." });
    return;
  }

  const withdrawalId = req.params.withdrawalId;
  if (typeof withdrawalId !== "string" || !WITHDRAWAL_ID.test(withdrawalId)) {
    res.status(404).json({ error: "Test withdrawal not found." });
    return;
  }

  const [withdrawal] = await db.select().from(withdrawalsTable).where(and(
    eq(withdrawalsTable.id, withdrawalId),
    eq(withdrawalsTable.userId, user.id),
  )).limit(1);
  if (!withdrawal) {
    res.status(404).json({ error: "Test withdrawal not found." });
    return;
  }

  if (withdrawal.status === "pending") {
    try {
      await reconcileWithdrawal(withdrawal);
    } catch {
      req.log.warn({ withdrawalId }, "Test withdrawal verification will retry");
    }
  }

  const [updated] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, withdrawalId)).limit(1);
  res.json(CreateWithdrawalResponse.parse(withdrawalDto(updated ?? withdrawal)));
});

export default router;
