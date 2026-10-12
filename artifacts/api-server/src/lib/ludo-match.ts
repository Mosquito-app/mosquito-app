import { and, eq, sql } from "drizzle-orm";
import {
  db, roomsTable, usersTable, walletTransactionsTable, commissionLedgerTable,
  platformWalletTable, type LudoBoardState,
} from "@workspace/db";
import { normalizeBoard } from "./ludo-rules";
import { leadingColor } from "./ludo-ranking";
import { colorForUser, roomPlayerIds, userForColor, LUDO_COLORS } from "./ludo-room-tiers";

export const MATCH_MS = 8 * 60 * 1000;
export const matchDeadline = (now = Date.now()) => new Date(now + MATCH_MS).toISOString();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Room = typeof roomsTable.$inferSelect;

export function splitPot(potKobo: number) {
  const commissionKobo = Math.floor(potKobo / 10);
  return { prizeKobo: potKobo - commissionKobo, commissionKobo };
}

/** Callers hold the room row lock. Closing the room and both ledger credits are
 * one transaction; the active-status guard also prevents duplicate settlement. */
export async function completeMatch(
  tx: Tx, room: Room, board: LudoBoardState, winnerUserId: string,
  reason: NonNullable<LudoBoardState["endReason"]>,
): Promise<Room> {
  const players = roomPlayerIds(room);
  if (players.length < 2 || !players.includes(winnerUserId)) {
    throw new Error("Invalid match winner");
  }
  const finished: LudoBoardState = {
    ...board, winnerUserId, endReason: reason, hasRolled: false,
    remainingDice: [], turnDeadlineAt: null,
  };
  const closed = await tx.update(roomsTable).set({
    status: "completed", board: finished, updatedAt: new Date(),
  }).where(and(eq(roomsTable.id, room.id), eq(roomsTable.status, "active"))).returning({ id: roomsTable.id });
  if (closed.length !== 1) throw new Error("Match is already closed");
  const { prizeKobo, commissionKobo } = splitPot(room.stakeKobo * players.length);
  await tx.update(usersTable).set({
    balanceKobo: sql`${usersTable.balanceKobo} + ${prizeKobo}`,
  }).where(eq(usersTable.id, winnerUserId));
  await tx.insert(walletTransactionsTable).values({
    userId: winnerUserId, type: "prize", amountKobo: prizeKobo,
    description: `Sandbox match prize — room ${room.id.slice(0, 8)}`, roomId: room.id,
  });
  await tx.insert(commissionLedgerTable).values({ roomId: room.id, amountKobo: commissionKobo });
  await tx.insert(platformWalletTable).values({ id: "commission", balanceKobo: commissionKobo })
    .onConflictDoUpdate({ target: platformWalletTable.id,
      set: { balanceKobo: sql`${platformWalletTable.balanceKobo} + ${commissionKobo}` } });
  return { ...room, status: "completed", board: finished };
}

/** Evaluate before any roll/move and during the background timer sweep.
 * Never accept a post-deadline movement before scoring the existing board. */
export async function resolveMatchClock(tx: Tx, room: Room, now = Date.now()) {
  const board = normalizeBoard(room.board);
  room = { ...room, board };
  const allPlayers = roomPlayerIds(room);
  const players = allPlayers.filter(playerId => !board.forfeitedUserIds?.includes(playerId));
  if (room.status !== "active" || players.length === 0) return { room, changed: false };
  if (players.length === 1) {
    return {
      room: await completeMatch(tx, room, board, players[0], "forfeit"),
      changed: true,
    };
  }
  if (!board.matchDeadlineAt) {
    // Old active rooms have no trustworthy start timestamp. Persist one grace
    // window once, rather than resetting it on reads or retroactively charging.
    board.matchDeadlineAt = matchDeadline(now);
    await tx.update(roomsTable).set({ board, updatedAt: new Date(now) }).where(eq(roomsTable.id, room.id));
    return { room, changed: true };
  }
  if (!board.isOvertime && Date.parse(board.matchDeadlineAt) > now) return { room, changed: false };
  const colors = players.map((id) => colorForUser(room, id)).filter((color): color is NonNullable<typeof color> => color !== null);
  const leader = players.length === 1 ? colorForUser(room, players[0]) : leadingColor(board, colors.length ? colors : [...LUDO_COLORS.slice(0, players.length)]);
  if (leader) {
    const winner = userForColor(room, leader);
    if (!winner) throw new Error("Timeout winner is not a room participant");
    return { room: await completeMatch(tx, room, board, winner, board.isOvertime ? "overtime" : "timeout"), changed: true };
  }
  if (!board.isOvertime) {
    board.isOvertime = true;
    await tx.update(roomsTable).set({ board, updatedAt: new Date(now) }).where(eq(roomsTable.id, room.id));
    return { room, changed: true };
  }
  return { room, changed: false };
}
