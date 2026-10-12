import { and, eq, sql } from "drizzle-orm";
import { db, footballRoomsTable, footballLedgerTable, platformWalletTable, usersTable, walletTransactionsTable, type FootballState } from "@workspace/db";
import { splitPot } from "./ludo-match";

export type FootballRow = typeof footballRoomsTable.$inferSelect;
export type FinanceTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function lockFootballStake(tx: FinanceTx, room: FootballRow, userId: string) {
  const debited = await tx.update(usersTable).set({
    balanceKobo: sql`${usersTable.balanceKobo} - ${room.stakeKobo}`,
  }).where(and(eq(usersTable.id, userId), sql`${usersTable.balanceKobo} >= ${room.stakeKobo}`)).returning({ id: usersTable.id });
  if (!debited.length) throw new Error("Not enough Mosquito Wallet balance.");
  const [entry] = await tx.insert(walletTransactionsTable).values({
    userId, type: "stake_lock", amountKobo: -room.stakeKobo,
    description: `Mosquito Wallet · Football escrow — ${room.id.slice(0, 8)}`,
  }).returning({ id: walletTransactionsTable.id });
  await tx.insert(footballLedgerTable).values({
    roomId: room.id, userId, type: "stake_lock", amountKobo: room.stakeKobo, walletTransactionId: entry.id,
  });
}

/** Room row must be locked. Payout, commission and match close are one commit. */
export async function settleFootball(tx: FinanceTx, room: FootballRow, state: FootballState): Promise<FootballRow> {
  if (room.status === "completed") return room;
  if (room.status !== "active" || !room.opponentUserId || state.phase !== "finished" || !state.winnerTeam) {
    throw new Error("Football settlement requires a finished funded match.");
  }
  const winnerUserId = state.winnerTeam === "home" ? room.hostUserId : room.opponentUserId;
  const locks = await tx.select().from(footballLedgerTable).where(and(
    eq(footballLedgerTable.roomId, room.id), eq(footballLedgerTable.type, "stake_lock"),
  ));
  if (locks.length !== 2 || !locks.some(e => e.userId === room.hostUserId && e.amountKobo === room.stakeKobo) ||
      !locks.some(e => e.userId === room.opponentUserId && e.amountKobo === room.stakeKobo)) {
    throw new Error("Football escrow is not fully funded.");
  }
  const { prizeKobo, commissionKobo } = splitPot(room.stakeKobo * 2);
  const [closed] = await tx.update(footballRoomsTable).set({
    status: "completed", state, winnerUserId, engineOwner: null, leaseUntil: null, updatedAt: new Date(),
  }).where(and(eq(footballRoomsTable.id, room.id), eq(footballRoomsTable.status, "active"))).returning();
  if (!closed) throw new Error("Football match already settled.");
  await tx.update(usersTable).set({ balanceKobo: sql`${usersTable.balanceKobo} + ${prizeKobo}` }).where(eq(usersTable.id, winnerUserId));
  const [walletEntry] = await tx.insert(walletTransactionsTable).values({
    userId: winnerUserId, type: "prize", amountKobo: prizeKobo,
    description: `Mosquito Wallet · Football ${state.lastEvent.startsWith("GOLDEN") ? "golden goal" : "full-time"} prize — ${room.id.slice(0, 8)}`,
  }).returning({ id: walletTransactionsTable.id });
  await tx.insert(footballLedgerTable).values([
    { roomId: room.id, userId: winnerUserId, type: "prize", amountKobo: prizeKobo, walletTransactionId: walletEntry.id },
    { roomId: room.id, type: "commission", amountKobo: commissionKobo },
  ]);
  await tx.insert(platformWalletTable).values({ id: "commission", balanceKobo: commissionKobo })
    .onConflictDoUpdate({ target: platformWalletTable.id,
      set: { balanceKobo: sql`${platformWalletTable.balanceKobo} + ${commissionKobo}` } });
  return closed;
}
