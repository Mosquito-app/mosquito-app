import { eq } from "drizzle-orm";
import { db, roomsTable, type LudoBoardState } from "@workspace/db";
import { publishRoomUpdate } from "./ludo-events";
import { logger } from "./logger";

export const TURN_MS = 30_000;
export const deadline = () => new Date(Date.now() + TURN_MS).toISOString();
export function nextPlayerId(room: { hostUserId: string; opponentUserId: string | null }, currentId: string) {
  return currentId === room.hostUserId ? room.opponentUserId! : room.hostUserId;
}
export function turnExpired(board: LudoBoardState, now = Date.now()) {
  return board.turnDeadlineAt !== null && Date.parse(board.turnDeadlineAt) <= now;
}
export function splitPot(potKobo: number) {
  const commissionKobo = Math.floor(potKobo / 10);
  return { prizeKobo: potKobo - commissionKobo, commissionKobo };
}

export async function expireTurns(now = Date.now()) {
  const candidates = await db.select().from(roomsTable).where(eq(roomsTable.status, "active"));
  for (const candidate of candidates) {
    if (!turnExpired(candidate.board, now)) continue;
    const changed = await db.transaction(async tx => {
      const [room] = await tx.select().from(roomsTable)
        .where(eq(roomsTable.id, candidate.id)).for("update", { skipLocked: true }).limit(1);
      if (!room || room.status !== "active" || !room.opponentUserId || !turnExpired(room.board, now)) return false;
      const board: LudoBoardState = {
        ...room.board,
        turnUserId: nextPlayerId(room, room.board.turnUserId),
        dice: null, hasRolled: false,
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
