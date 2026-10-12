import type { LudoBoardState } from "@workspace/db";
import type { LudoColor } from "./ludo-room-tiers";

const TOKEN_KEY: Record<LudoColor, "redTokens" | "greenTokens" | "yellowTokens" | "blueTokens"> = {
  red: "redTokens", green: "greenTokens", yellow: "yellowTokens", blue: "blueTokens",
};
const COLOR_OFFSET: Record<LudoColor, number> = { red: 0, green: 26, yellow: 13, blue: 39 };

/** Keep legacy saved rooms playable without changing tokens, ownership or stakes. */
export function normalizeBoard(board: LudoBoardState): LudoBoardState {
  const paired = Array.isArray(board.dice) && board.dice.length === 2;
  return {
    ...board,
    redTokens: board.redTokens ?? [-1, -1, -1, -1],
    greenTokens: board.greenTokens ?? [-1, -1, -1, -1],
    yellowTokens: board.yellowTokens ?? [-1, -1, -1, -1],
    blueTokens: board.blueTokens ?? [-1, -1, -1, -1],
    playerOrder: board.playerOrder ?? [],
    joinWindowOpen: board.joinWindowOpen ?? false,
    forfeitedUserIds: board.forfeitedUserIds ?? [],
    dice: paired ? board.dice : null,
    hasRolled: paired && board.hasRolled,
    remainingDice: paired && board.hasRolled ? board.remainingDice ?? [0, 1] : [],
    consecutiveDoubles: Math.max(0, Math.min(3, board.consecutiveDoubles ?? 0)),
    turnMessage: board.turnMessage ?? null,
    lastMove: board.lastMove ?? null,
    captureBonusPending: false,
    matchDeadlineAt: board.matchDeadlineAt ?? null,
    isOvertime: board.isOvertime ?? false,
    endReason: board.endReason ?? null,
  };
}

export function tokensFor(board: LudoBoardState, color: LudoColor) {
  return board[TOKEN_KEY[color]] ?? [-1, -1, -1, -1];
}

/** Any six in the server roll may release a token; the six itself is consumed. */
export function entryRollAllowed(dice: number[] | null | undefined): boolean {
  return !!dice && dice.length === 2 && dice.includes(6);
}

export function moveDestination(position: number, values: number[], fullRoll: number[] | null = values): number | null {
  if (values.length === 0 || values.some(value => !Number.isInteger(value) || value < 1 || value > 6)) return null;
  if (position < -1 || position >= 57) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  if (position === -1) return entryRollAllowed(fullRoll) && values.includes(6) ? sum - 6 : null;
  return position + sum <= 57 ? position + sum : null;
}

export function hasLegalMove(board: LudoBoardState, color: LudoColor) {
  if (!board.dice || board.remainingDice.length === 0) return false;
  const options = board.remainingDice.map(index => [board.dice![index]]);
  if (board.remainingDice.length === 2) options.push(board.remainingDice.map(index => board.dice![index]));
  return tokensFor(board, color).some(position => options.some(values => moveDestination(position, values, board.dice) !== null));
}

export function finishRoll(board: LudoBoardState, nextPlayer: string, nextDeadline: string, noMoves = false): LudoBoardState {
  const doubleSix = board.dice?.[0] === 6 && board.dice?.[1] === 6;
  const bonusRoll = doubleSix && board.consecutiveDoubles < 3;
  const reachedDoubleSixLimit = doubleSix && board.consecutiveDoubles >= 3;
  return {
    ...board, hasRolled: false, remainingDice: [],
    turnUserId: bonusRoll ? board.turnUserId : nextPlayer,
    captureBonusPending: false,
    consecutiveDoubles: bonusRoll ? board.consecutiveDoubles : 0,
    turnMessage: bonusRoll ? "double_six_bonus" : reachedDoubleSixLimit ? "double_six_limit" :
      board.lastMove?.kind === "capture_home" ? "capture_home" : noMoves ? "no_moves" : null,
    turnDeadlineAt: nextDeadline,
  };
}

/** Production callers supply crypto-generated dice; no client-supplied roll is used. */
export function applyRoll(board: LudoBoardState, color: LudoColor, dice: [number, number], nextPlayer: string, nextDeadline: string): LudoBoardState {
  const isDoubleSix = dice[0] === 6 && dice[1] === 6;
  const rolled: LudoBoardState = {
    ...board, dice, remainingDice: [0, 1], hasRolled: true,
    consecutiveDoubles: isDoubleSix ? Math.min(3, board.consecutiveDoubles + 1) : 0,
    captureBonusPending: false,
    lastMove: null,
    turnMessage: null, turnDeadlineAt: nextDeadline,
  };
  return hasLegalMove(rolled, color) ? rolled : finishRoll(rolled, nextPlayer, nextDeadline, true);
}

const SAFE_SQUARES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
function trackSquare(color: LudoColor, position: number): number | null {
  return position >= 0 && position <= 51 ? (position + COLOR_OFFSET[color]) % 52 : null;
}

/** Captures on unsafe track squares send rivals to base and immediately count the capturing pawn as home. */
export function applyCaptureHome(board: LudoBoardState, color: LudoColor, tokenIndex: number): LudoBoardState {
  const tokens = {
    red: [...board.redTokens],
    green: [...board.greenTokens],
    yellow: [...(board.yellowTokens ?? [-1, -1, -1, -1])],
    blue: [...(board.blueTokens ?? [-1, -1, -1, -1])],
  };
  const own = tokens[color];
  const rivals = LUDO_RIVALS.filter((rival) => rival !== color);
  const captureAt = (position: number) => {
    const square = trackSquare(color, position);
    if (square === null || SAFE_SQUARES.has(square)) return false;
    let captured = false;
    for (const rival of rivals) tokens[rival].forEach((p, i) => {
      if (trackSquare(rival, p) === square) { tokens[rival][i] = -1; captured = true; }
    });
    return captured;
  };
  if (own[tokenIndex] === undefined || !captureAt(own[tokenIndex])) return board;
  own[tokenIndex] = 57;
  return {
    ...board, redTokens: tokens.red, greenTokens: tokens.green, yellowTokens: tokens.yellow, blueTokens: tokens.blue,
    captureBonusPending: false,
    lastMove: { kind: "capture_home", color, tokenIndex },
    turnMessage: "capture_home",
  };
}

const LUDO_RIVALS: LudoColor[] = ["red", "green", "yellow", "blue"];
