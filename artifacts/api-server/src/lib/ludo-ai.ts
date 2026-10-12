import { randomInt } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, roomsTable, type LudoBoardState } from "@workspace/db";
import { applyCaptureBonus, applyRoll, finishRoll, hasLegalMove, moveDestination, normalizeBoard, tokensFor } from "./ludo-rules";
import { colorForUser, LUDO_COLORS, roomPlayerIds } from "./ludo-room-tiers";
import { completeMatch, resolveMatchClock } from "./ludo-match";
import { deadline, nextPlayerId, turnExpired } from "./ludo-turns";
import { publishRoomUpdate } from "./ludo-events";
import { logger } from "./logger";
import { leadingColor } from "./ludo-ranking";
import { userForColor } from "./ludo-room-tiers";

type Color = (typeof LUDO_COLORS)[number];
type TokenKey = "redTokens" | "greenTokens" | "yellowTokens" | "blueTokens";
type AiMove = { tokenIndex: number; diceIndices: number[]; destination: number };
type Room = typeof roomsTable.$inferSelect;

const TOKEN_KEY: Record<Color, TokenKey> = {
  red: "redTokens",
  green: "greenTokens",
  yellow: "yellowTokens",
  blue: "blueTokens",
};

function activePieces(board: LudoBoardState, color: Color) {
  return LUDO_COLORS.filter(candidate => candidate !== color)
    .flatMap(candidate => tokensFor(board, candidate))
    .filter(position => position >= 0 && position < 57).length;
}

/** Server-side move choice: prefer winning, then captures, releases and progress. */
export function chooseAiMove(board: LudoBoardState, color: Color): AiMove | null {
  if (!board.dice || board.remainingDice.length === 0) return null;
  const diceOptions = board.remainingDice.map(index => [index]);
  if (board.remainingDice.length === 2) diceOptions.push([...board.remainingDice]);

  const ownTokens = tokensFor(board, color);
  const beforePieces = activePieces(board, color);
  let best: AiMove | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let tokenIndex = 0; tokenIndex < ownTokens.length; tokenIndex++) {
    for (const diceIndices of diceOptions) {
      const values = diceIndices.map(index => board.dice![index]);
      const destination = moveDestination(ownTokens[tokenIndex], values, board.dice);
      if (destination === null) continue;

      const movedTokens = [...ownTokens];
      movedTokens[tokenIndex] = destination;
      const afterMove = applyCaptureBonus({
        ...board,
        [TOKEN_KEY[color]]: movedTokens,
        remainingDice: board.remainingDice.filter(index => !diceIndices.includes(index)),
      }, color, tokenIndex);
      const piecesCaptured = beforePieces - activePieces(afterMove, color);
      const ownAfter = tokensFor(afterMove, color);
      const winsNow = ownAfter.every(position => position >= 57);
      const wasHome = ownTokens[tokenIndex] === -1;
      const finalPosition = ownAfter[tokenIndex];
      const score = (winsNow ? 100_000 : 0)
        + piecesCaptured * 1_000
        + (finalPosition === 57 ? 250 : 0)
        + (wasHome ? 150 : 0)
        + finalPosition;

      if (score > bestScore) {
        bestScore = score;
        best = { tokenIndex, diceIndices, destination };
      }
    }
  }
  return best;
}

async function updateRoom(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], roomId: string, board: LudoBoardState) {
  await tx.update(roomsTable).set({ board, updatedAt: new Date() }).where(eq(roomsTable.id, roomId));
}

async function playAiTurn(roomId: string): Promise<boolean> {
  return db.transaction(async tx => {
    const [locked] = await tx.select().from(roomsTable)
      .where(eq(roomsTable.id, roomId)).for("update", { skipLocked: true }).limit(1);
    if (!locked || locked.status !== "active") return false;

    let room: Room = { ...locked, board: normalizeBoard(locked.board) };
    const aiId = room.board.aiPlayerId;
    if (!aiId || room.board.turnUserId !== aiId) return false;

    const clock = await resolveMatchClock(tx, room);
    room = clock.room;
    if (room.status !== "active") return clock.changed;
    let board = normalizeBoard(room.board);
    if (board.turnUserId !== aiId) return clock.changed;

    const color = colorForUser(room, aiId);
    if (!color) throw new Error("AI player is not a match participant");

    if (turnExpired(board)) {
      board = {
        ...board,
        turnUserId: nextPlayerId(room, aiId),
        dice: null,
        hasRolled: false,
        remainingDice: [],
        turnMessage: "timeout",
        turnDeadlineAt: deadline(),
      };
      await updateRoom(tx, room.id, board);
      return true;
    }

    if (!board.hasRolled) {
      board = applyRoll(board, color, [randomInt(1, 7), randomInt(1, 7)], nextPlayerId(room, aiId), deadline());
    }
    if (!board.hasRolled) {
      await updateRoom(tx, room.id, board);
      return true;
    }

    const move = chooseAiMove(board, color);
    if (!move) {
      board = finishRoll(board, nextPlayerId(room, aiId), deadline(), true);
      await updateRoom(tx, room.id, board);
      return true;
    }

    const ownTokens = [...tokensFor(board, color)];
    const destination = moveDestination(ownTokens[move.tokenIndex], move.diceIndices.map(index => board.dice![index]), board.dice);
    if (destination === null) {
      board = finishRoll(board, nextPlayerId(room, aiId), deadline(), true);
      await updateRoom(tx, room.id, board);
      return true;
    }
    ownTokens[move.tokenIndex] = destination;
    board = {
      ...board,
      [TOKEN_KEY[color]]: ownTokens,
      remainingDice: board.remainingDice.filter(index => !move.diceIndices.includes(index)),
    };
    board = applyCaptureBonus(board, color, move.tokenIndex);

    const participants = roomPlayerIds(room);
    const participantColors = participants
      .map(playerId => colorForUser(room, playerId))
      .filter((candidate): candidate is Color => candidate !== null);
    const won = tokensFor(board, color).every(position => position >= 57);
    const winnerColor = board.isOvertime ? leadingColor(board, participantColors) : null;
    if (won || winnerColor) {
      const winnerId = winnerColor ? userForColor(room, winnerColor) : aiId;
      if (!winnerId) throw new Error("Unable to identify the AI match winner");
      await completeMatch(tx, room, board, winnerId, board.isOvertime ? "overtime" : "all_home");
      return true;
    }

    if (!hasLegalMove(board, color)) {
      board = finishRoll(board, nextPlayerId(room, aiId), deadline(), board.remainingDice.length > 0);
    }
    await updateRoom(tx, room.id, board);
    return true;
  });
}

export function startAiEngine() {
  let running = false;
  let retryAfter = 0;
  const timer = setInterval(() => {
    if (running || Date.now() < retryAfter) return;
    running = true;
    void (async () => {
      const candidates = await db.select({ id: roomsTable.id }).from(roomsTable)
        .where(and(
          eq(roomsTable.status, "active"),
          sql`${roomsTable.board}->>'aiPlayerId' is not null`,
        ))
        .limit(100);
      for (const candidate of candidates) {
        if (await playAiTurn(candidate.id)) publishRoomUpdate(candidate.id);
      }
      retryAfter = 0;
    })().catch(err => {
      retryAfter = Date.now() + 5000;
      logger.error({ err }, "Ludo AI turn processing failed; retrying shortly");
    }).finally(() => { running = false; });
  }, 900);
  timer.unref();
  return () => clearInterval(timer);
}
