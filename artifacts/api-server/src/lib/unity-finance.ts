import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, unityMatchesTable, unityEscrowLedgerTable, usersTable, walletTransactionsTable,
  platformWalletTable, type UnityMatch } from "@workspace/db";
import type { UnityMatchInput, UnityMatchResultInput } from "@workspace/api-zod";
import { splitPot } from "./ludo-match";
import { UnityError } from "./unity-auth";

const sameStart = (m: UnityMatch, input: UnityMatchInput) =>
  m.player1Id === input.player1Id && m.player2Id === input.player2Id &&
  m.stakeKobo === input.stakeAmount * 100 && m.gameType === input.gameType;

export async function fundUnityMatch(input: UnityMatchInput, key: string) {
  if (input.player1Id === input.player2Id) throw new UnityError(400, "A match requires two different players.");
  return db.transaction(async tx => {
    // Same key is serialized across workers; retries never acquire fresh funds.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`unity-start:${key}`}, 0))`);
    const [existing] = await tx.select().from(unityMatchesTable).where(eq(unityMatchesTable.idempotencyKey, key));
    if (existing) {
      if (!sameStart(existing, input)) throw new UnityError(409, "Idempotency key already belongs to a different match request.");
      if (!["ACTIVE", "COMPLETED"].includes(existing.status)) throw new UnityError(409, "This session cannot be started again.");
      return existing;
    }
    // Consistent wallet lock order also protects concurrent Ludo/withdrawals.
    const players = await tx.select().from(usersTable)
      .where(inArray(usersTable.id, [input.player1Id, input.player2Id])).orderBy(asc(usersTable.id)).for("update");
    if (players.length !== 2) throw new UnityError(404, "Both Mosquito player accounts must exist.");
    const stakeKobo = input.stakeAmount * 100;
    if (players.some(p => p.balanceKobo < stakeKobo)) throw new UnityError(409, "Both players need sufficient Mosquito Wallet balance.");
    const [match] = await tx.insert(unityMatchesTable).values({
      id: randomUUID(), tokenId: randomUUID(), idempotencyKey: key, player1Id: input.player1Id,
      player2Id: input.player2Id, stakeKobo, gameType: input.gameType, status: "ACTIVE",
    }).returning();
    for (const player of players) {
      const [debited] = await tx.update(usersTable).set({ balanceKobo: sql`${usersTable.balanceKobo} - ${stakeKobo}` })
        .where(and(eq(usersTable.id, player.id), sql`${usersTable.balanceKobo} >= ${stakeKobo}`)).returning({ id: usersTable.id });
      if (!debited) throw new UnityError(409, "Insufficient wallet funds.");
      const [entry] = await tx.insert(walletTransactionsTable).values({
        userId: player.id, type: "stake_lock", amountKobo: -stakeKobo,
        description: `Mosquito Wallet · Unity Football test escrow — ${match.id.slice(0, 8)}`,
      }).returning();
      await tx.insert(unityEscrowLedgerTable).values({
        matchId: match.id, userId: player.id, type: "stake_lock", amountKobo: stakeKobo, walletTransactionId: entry.id,
      });
    }
    return match;
  });
}

export async function closeUnityMatch(input: UnityMatchResultInput, tokenId: string) {
  return db.transaction(async tx => {
    const [match] = await tx.select().from(unityMatchesTable).where(eq(unityMatchesTable.id, input.matchId)).for("update");
    if (!match) throw new UnityError(404, "Match session not found.");
    if (match.tokenId !== tokenId) throw new UnityError(401, "Match token does not belong to this escrow session.");
    const equal = input.player1Score === input.player2Score;
    const derivedWinner = equal ? null : input.player1Score > input.player2Score ? match.player1Id : match.player2Id;
    if (input.isDraw !== equal || input.winnerId !== derivedWinner) {
      throw new UnityError(400, "Winner and draw flag must agree with the scores and match participants.");
    }
    if (match.status === "COMPLETED") {
      if (match.player1Score !== input.player1Score || match.player2Score !== input.player2Score || match.winnerId !== input.winnerId) {
        throw new UnityError(409, "Completed match has a different recorded result.");
      }
      return match; // Identical retries return recorded amounts without writes.
    }
    if (match.status !== "ACTIVE") throw new UnityError(409, "Match escrow is not active.");
    const locks = await tx.select().from(unityEscrowLedgerTable)
      .where(and(eq(unityEscrowLedgerTable.matchId, match.id), eq(unityEscrowLedgerTable.type, "stake_lock")));
    if (locks.length !== 2 || ![match.player1Id, match.player2Id].every(id => locks.some(e => e.userId === id && e.amountKobo === match.stakeKobo))) {
      throw new UnityError(409, "Escrow session is not fully funded.");
    }
    if (match.overtime) {
      const baseline1 = match.player1Score ?? 0, baseline2 = match.player2Score ?? 0;
      if (equal) {
        if (input.player1Score !== baseline1 || input.player2Score !== baseline2) throw new UnityError(409, "Golden Goal ends at the first goal.");
        return match;
      }
      if (input.player1Score < baseline1 || input.player2Score < baseline2 ||
          input.player1Score + input.player2Score !== baseline1 + baseline2 + 1) {
        throw new UnityError(409, "Golden Goal result must contain exactly one new goal.");
      }
    }
    const now = new Date();
    if (input.isDraw) {
      const [updated] = await tx.update(unityMatchesTable).set({
        overtime: true, player1Score: input.player1Score, player2Score: input.player2Score, updatedAt: now,
      }).where(eq(unityMatchesTable.id, match.id)).returning();
      return updated; // No debit, refund, commission or close on a tied score.
    }
    const players = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(inArray(usersTable.id, [match.player1Id, match.player2Id])).orderBy(asc(usersTable.id)).for("update");
    if (players.length !== 2 || !derivedWinner) throw new UnityError(409, "Participant account unavailable.");
    const { prizeKobo, commissionKobo } = splitPot(match.stakeKobo * 2);
    await tx.update(usersTable).set({ balanceKobo: sql`${usersTable.balanceKobo} + ${prizeKobo}` })
      .where(eq(usersTable.id, derivedWinner));
    const [entry] = await tx.insert(walletTransactionsTable).values({
      userId: derivedWinner, type: "prize", amountKobo: prizeKobo,
      description: `Mosquito Wallet · Unity Football ${match.overtime ? "Golden Goal" : "full-time"} test prize — ${match.id.slice(0, 8)}`,
    }).returning();
    await tx.insert(unityEscrowLedgerTable).values([
      { matchId: match.id, userId: derivedWinner, type: "prize", amountKobo: prizeKobo, walletTransactionId: entry.id },
      { matchId: match.id, type: "commission", amountKobo: commissionKobo },
    ]);
    await tx.insert(platformWalletTable).values({ id: "commission", balanceKobo: commissionKobo })
      .onConflictDoUpdate({ target: platformWalletTable.id, set: { balanceKobo: sql`${platformWalletTable.balanceKobo} + ${commissionKobo}` } });
    const [closed] = await tx.update(unityMatchesTable).set({
      status: "COMPLETED", player1Score: input.player1Score, player2Score: input.player2Score,
      winnerId: derivedWinner, winnerPayoutKobo: prizeKobo, commissionKobo, completedAt: now, updatedAt: now,
    }).where(eq(unityMatchesTable.id, match.id)).returning();
    return closed;
  });
}
