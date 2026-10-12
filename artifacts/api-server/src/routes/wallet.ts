import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetWalletResponse,
  InitializeDepositBody,
  InitializeDepositResponse,
  VerifyDepositBody,
  VerifyDepositResponse,
} from "@workspace/api-zod";
import {
  db,
  depositIntentsTable,
  roomsTable,
  footballRoomsTable,
  unityMatchesTable,
  usersTable,
  walletTransactionsTable,
  withdrawalsTable,
} from "@workspace/db";
import { getAuthenticatedUser } from "../lib/ludo-auth";
import { withdrawalDto } from "../lib/ludo-withdrawals";
import {
  getPaystackMode,
  getPaystackModeForReference,
  getPaystackSecretKey,
  getPublicPaystackMode,
  paystackRequest,
  PaystackTestError,
} from "../lib/paystack-test";

const router: IRouter = Router();

function getCheckoutCallbackUrl(mode: "test" | "live"): string | undefined {
  if (mode === "live") {
    const configuredUrl = process.env.PAYSTACK_LIVE_CALLBACK_URL;
    if (!configuredUrl) return undefined;
    try {
      const callback = new URL(configuredUrl);
      const allowedHosts = (process.env.REPLIT_DOMAINS ?? "").split(",").map((domain) =>
        domain.trim().replace(/^https?:\/\//, "").split("/")[0].toLowerCase(),
      ).filter(Boolean);
      if (callback.protocol !== "https:" || callback.username || callback.password ||
          callback.search || callback.hash || !allowedHosts.includes(callback.host.toLowerCase())) {
        return undefined;
      }
      return callback.toString();
    } catch {
      return undefined;
    }
  }

  const rawDomain = process.env.NODE_ENV === "production"
    ? process.env.REPLIT_DOMAINS?.split(",")[0]?.trim()
    : process.env.REPLIT_DEV_DOMAIN ?? process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (!rawDomain || !/^[a-z0-9.-]+(?::\d+)?$/i.test(rawDomain)) return undefined;
  return `https://${rawDomain}/`;
}

router.get("/wallet", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view your sandbox wallet." });
    return;
  }

  const { transactionRows, openRooms, withdrawalRows, balanceKobo } = await db.transaction(async tx => {
    const [currentUser] = await tx.select({ balanceKobo: usersTable.balanceKobo }).from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
    const transactionRows = await tx
      .select()
      .from(walletTransactionsTable)
      .where(eq(walletTransactionsTable.userId, user.id))
      .orderBy(desc(walletTransactionsTable.createdAt))
      .limit(20);
    const openRooms = await tx
      .select({
        stakeKobo: roomsTable.stakeKobo,
        status: roomsTable.status,
      })
      .from(roomsTable)
      .where(
        and(
          inArray(roomsTable.status, ["waiting", "active"]),
          sql`(${roomsTable.hostUserId} = ${user.id} or ${roomsTable.opponentUserId} = ${user.id} or ${roomsTable.thirdUserId} = ${user.id} or ${roomsTable.fourthUserId} = ${user.id})`,
        ),
      );
    const withdrawalRows = await tx.select().from(withdrawalsTable).where(eq(withdrawalsTable.userId, user.id)).orderBy(desc(withdrawalsTable.createdAt));
    const footballEscrows = await tx.select({ stakeKobo: footballRoomsTable.stakeKobo, status: footballRoomsTable.status })
      .from(footballRoomsTable).where(and(eq(footballRoomsTable.status, "active"),
        sql`(${footballRoomsTable.hostUserId} = ${user.id} or ${footballRoomsTable.opponentUserId} = ${user.id})`));
    const unityEscrows = await tx.select({ stakeKobo: unityMatchesTable.stakeKobo })
      .from(unityMatchesTable).where(and(eq(unityMatchesTable.status, "ACTIVE"),
        sql`(${unityMatchesTable.player1Id} = ${user.id} or ${unityMatchesTable.player2Id} = ${user.id})`));
    return { transactionRows, openRooms: [...openRooms, ...footballEscrows,
      ...unityEscrows.map(r => ({ ...r, status: "active" as const }))], withdrawalRows, balanceKobo: currentUser.balanceKobo };
  }, { isolationLevel: "repeatable read" });

  const escrowedKobo = openRooms.reduce(
    (total, room) => total + room.stakeKobo,
    0,
  );
  const withdrawalHeldKobo = withdrawalRows.filter(row => row.status === "pending").reduce((sum, row) => sum + row.amountKobo, 0);
  const response = {
    paymentMode: getPublicPaystackMode(),
    balanceNaira: Math.floor(balanceKobo / 100),
    totalBalanceNaira: (balanceKobo + escrowedKobo + withdrawalHeldKobo) / 100,
    escrowedNaira: Math.floor(escrowedKobo / 100),
    withdrawalHeldNaira: withdrawalHeldKobo / 100,
    withdrawals: withdrawalRows.slice(0, 20).map(withdrawalDto),
    transactions: transactionRows.map((transaction) => ({
      id: transaction.id,
      type: transaction.type,
      amountNaira: transaction.amountKobo / 100,
      description: transaction.description,
      createdAt: transaction.createdAt,
    })),
  };

  res.json(GetWalletResponse.parse(response));
});

router.post("/deposits/initialize", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to start a wallet deposit." });
    return;
  }
  const parsed = InitializeDepositBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Deposit between ₦500 and ₦500,000." });
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
  const callbackUrl = getCheckoutCallbackUrl(mode);
  if (mode === "live" && !callbackUrl) {
    res.status(503).json({ error: "Live Paystack callback URL is not configured for this production domain." });
    return;
  }

  const amountKobo = parsed.data.amountNaira * 100;
  const reference = mode === "live"
    ? `pay_live_${randomBytes(18).toString("hex")}`
    : `ludo_${randomBytes(18).toString("hex")}`;
  await db.insert(depositIntentsTable).values({
    userId: user.id,
    reference,
    amountKobo,
    status: "pending",
  });

  try {
    const response = await paystackRequest(mode, "/transaction/initialize", "POST", {
      email: user.email,
      amount: amountKobo,
      currency: "NGN",
      reference,
      callback_url: callbackUrl,
    });
    const authorizationUrl = typeof response.data?.authorization_url === "string"
      ? response.data.authorization_url
      : "";
    let safeCheckoutUrl = false;
    try {
      safeCheckoutUrl = new URL(authorizationUrl).origin === "https://checkout.paystack.com";
    } catch {
      safeCheckoutUrl = false;
    }

    if (!response.ok || response.payload.status !== true || !safeCheckoutUrl) {
      await db
        .update(depositIntentsTable)
        .set({ status: "failed" })
        .where(eq(depositIntentsTable.reference, reference));
      req.log.warn({ statusCode: response.statusCode }, `Paystack ${mode} checkout initialization failed`);
      res.status(502).json({ error: `Paystack could not start the ${mode} checkout.` });
      return;
    }

    res.status(201).json(
      InitializeDepositResponse.parse({
        authorizationUrl,
        reference,
        amountNaira: parsed.data.amountNaira,
        paymentMode: mode,
      }),
    );
  } catch (error) {
    await db
      .update(depositIntentsTable)
      .set({ status: "failed" })
      .where(eq(depositIntentsTable.reference, reference));
    req.log.error({ err: error }, `Paystack ${mode} checkout request failed`);
    res.status(502).json({ error: `Paystack ${mode} checkout is temporarily unavailable.` });
  }
});

router.post("/deposits/verify", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to verify your wallet deposit." });
    return;
  }
  const parsed = VerifyDepositBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid deposit reference is required." });
    return;
  }
  const [intent] = await db
    .select()
    .from(depositIntentsTable)
    .where(
      and(
        eq(depositIntentsTable.reference, parsed.data.reference),
        eq(depositIntentsTable.userId, user.id),
      ),
    )
    .limit(1);
  if (!intent) {
    res.status(404).json({ error: "Deposit reference not found." });
    return;
  }
  const mode = getPaystackModeForReference(intent.reference);

  if (intent.status === "success") {
    const [currentUser] = await db
      .select({ balanceKobo: usersTable.balanceKobo })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    res.json(
      VerifyDepositResponse.parse({
        status: "success",
        amountNaira: Math.floor(intent.amountKobo / 100),
        balanceNaira: Math.floor((currentUser?.balanceKobo ?? 0) / 100),
        paymentMode: mode,
      }),
    );
    return;
  }

  try {
    getPaystackSecretKey(mode);
  } catch (error) {
    res.status(error instanceof PaystackTestError ? error.status : 503)
      .json({ error: error instanceof Error ? error.message : "Paystack is not configured." });
    return;
  }

  try {
    const response = await paystackRequest(mode, `/transaction/verify/${encodeURIComponent(intent.reference)}`);
    const data = response.data;
    if (!response.ok || response.payload.status !== true || !data) {
      req.log.warn({ statusCode: response.statusCode }, `Paystack ${mode} verification request failed`);
      res.status(502).json({ error: `Paystack could not verify the ${mode} deposit yet.` });
      return;
    }

    const isSuccess =
      data.status === "success" &&
      data.domain === mode &&
      data.currency === "NGN" &&
      data.amount === intent.amountKobo &&
      data.reference === intent.reference;
    const isFailed = data.status === "failed" || data.status === "abandoned";

    if (isFailed || (data.status === "success" && !isSuccess)) {
      await db
        .update(depositIntentsTable)
        .set({ status: "failed" })
        .where(eq(depositIntentsTable.id, intent.id));
      const [currentUser] = await db
        .select({ balanceKobo: usersTable.balanceKobo })
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .limit(1);
      res.json(
        VerifyDepositResponse.parse({
          status: "failed",
          amountNaira: Math.floor(intent.amountKobo / 100),
          balanceNaira: Math.floor((currentUser?.balanceKobo ?? 0) / 100),
        paymentMode: mode,
        }),
      );
      return;
    }

    if (!isSuccess) {
      res.json(
        VerifyDepositResponse.parse({
          status: "pending",
          amountNaira: Math.floor(intent.amountKobo / 100),
          balanceNaira: Math.floor(user.balanceKobo / 100),
          paymentMode: mode,
        }),
      );
      return;
    }

    const newBalanceKobo = await db.transaction(async (tx) => {
      const [lockedIntent] = await tx
        .select()
        .from(depositIntentsTable)
        .where(eq(depositIntentsTable.id, intent.id))
        .for("update")
        .limit(1);
      if (!lockedIntent || lockedIntent.status === "failed") {
        return null;
      }

      const [lockedUser] = await tx
        .select({ balanceKobo: usersTable.balanceKobo })
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .for("update")
        .limit(1);
      if (!lockedUser) return null;

      if (lockedIntent.status === "pending") {
        await tx
          .update(usersTable)
          .set({
            balanceKobo: sql`${usersTable.balanceKobo} + ${lockedIntent.amountKobo}`,
          })
          .where(eq(usersTable.id, user.id));
        await tx.insert(walletTransactionsTable).values({
          userId: user.id,
          type: "deposit",
          amountKobo: lockedIntent.amountKobo,
          description: `Paystack ${mode}-mode deposit`,
          depositReference: lockedIntent.reference,
        });
        await tx
          .update(depositIntentsTable)
          .set({ status: "success", verifiedAt: new Date() })
          .where(eq(depositIntentsTable.id, lockedIntent.id));
        return lockedUser.balanceKobo + lockedIntent.amountKobo;
      }

      return lockedUser.balanceKobo;
    });

    const [currentUser] = await db
      .select({ balanceKobo: usersTable.balanceKobo })
      .from(usersTable)
      .where(eq(usersTable.id, user.id))
      .limit(1);
    res.json(
      VerifyDepositResponse.parse({
        status: newBalanceKobo === null ? "failed" : "success",
        amountNaira: Math.floor(intent.amountKobo / 100),
        balanceNaira: Math.floor((currentUser?.balanceKobo ?? 0) / 100),
        paymentMode: mode,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, `Paystack ${mode} verification request failed`);
    res.status(502).json({ error: `Paystack ${mode} verification is temporarily unavailable.` });
  }
});

export default router;