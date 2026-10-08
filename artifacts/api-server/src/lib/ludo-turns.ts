import { eq } from "drizzle-orm";
import { db, roomsTable, type LudoBoardState } from "@workspace/db";
import { publishRoomUpdate } from "./ludo-events";
import { logger } from "./logger";
import { normalizeBoard } from "./ludo-rules";
import { resolveMatchClock } from "./ludo-match";
export { splitPot } from "./ludo-match";

export const TURN_MS = 30_000;
export const deadline = () => new Date(Date.now() + TURN_MS).toISOString();
export function nextPlayerId(room: { hostUserId: string; opponentUserId: string | null }, currentId: string) {
  return currentId === room.hostUserId ? room.opponentUserId! : room.hostUserId;
}
export function turnExpired(board: LudoBoardState, now = Date.now()) {
  return board.turnDeadlineAt !== null && Date.parse(board.turnDeadlineAt) <= now;
}

export async function expireTurns(now = Date.now()) {
  const candidates = await db.select().from(roomsTable).where(eq(roomsTable.status, "active"));
  for (const candidate of candidates) {
    const candidateBoard = normalizeBoard(candidate.board);
    if (candidateBoard.matchDeadlineAt && !candidateBoard.isOvertime &&
      Date.parse(candidateBoard.matchDeadlineAt) > now && !turnExpired(candidateBoard, now)) continue;
    const changed = await db.transaction(async tx => {
      const [locked] = await tx.select().from(roomsTable)
        .where(eq(roomsTable.id, candidate.id)).for("update", { skipLocked: true }).limit(1);
      if (!locked || locked.status !== "active" || !locked.opponentUserId) return false;
      const resolved = await resolveMatchClock(tx, locked, now);
      const room = resolved.room;
      if (room.status !== "active" || !turnExpired(room.board, now)) return resolved.changed;
      const board: LudoBoardState = {
        ...normalizeBoard(room.board),
        turnUserId: nextPlayerId(room, room.board.turnUserId),
        dice: null, hasRolled: false,
        remainingDice: [], consecutiveDoubles: 0, turnMessage: "timeout",
        captureBonusPending: false,
        turnDeadlineAt: new Date(now + TURN_MS).toISOString(),
      };
      await tx.update(roomsTable).set({ board, updatedAt: new Date() }).where(eq(roomsTable.id, room.id));
      return true;
    });
    if (changed) publishRoomUpdate(candidate.id);
  }
}

export function startTurnTimer() {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void expireTurns().catch(err => logger.error({ err }, "Turn expiry failed")).finally(() => { running = false; });
  }, 1000);
  timer.unref();
  return timer;
}
