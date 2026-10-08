import type { LudoBoardState } from "@workspace/db";

type Color = "red" | "green";

/** Keep legacy saved rooms playable without changing tokens, ownership or stakes. */
export function normalizeBoard(board: LudoBoardState): LudoBoardState {
  const paired = Array.isArray(board.dice) && board.dice.length === 2;
  return {
    ...board,
    dice: paired ? board.dice : null,
    hasRolled: paired && board.hasRolled,
    remainingDice: paired && board.hasRolled ? board.remainingDice ?? [0, 1] : [],
    consecutiveDoubles: board.consecutiveDoubles ?? 0,
    turnMessage: board.turnMessage ?? null,
  };
}

export function tokensFor(board: LudoBoardState, color: Color) {
  return color === "red" ? board.redTokens : board.greenTokens;
}

/** The six used to leave home is consumed; a second selected die moves from 0. */
export function moveDestination(position: number, values: number[]): number | null {
  if (values.length === 0 || values.some(value => !Number.isInteger(value) || value < 1 || value > 6)) return null;
  if (position < -1 || position >= 57) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  if (position === -1) return values.includes(6) ? sum - 6 : null;
  return position + sum <= 57 ? position + sum : null;
}

export function hasLegalMove(board: LudoBoardState, color: Color) {
  if (!board.dice || board.remainingDice.length === 0) return false;
  const options = board.remainingDice.map(index => [board.dice![index]]);
  if (board.remainingDice.length === 2) options.push(board.remainingDice.map(index => board.dice![index]));
  return tokensFor(board, color).some(position => options.some(values => moveDestination(position, values) !== null));
}

export function finishRoll(board: LudoBoardState, nextPlayer: string, nextDeadline: string, noMoves = false): LudoBoardState {
  const doubled = board.dice !== null && board.dice[0] === board.dice[1];
  return {
    ...board, hasRolled: false, remainingDice: [],
    turnUserId: doubled ? board.turnUserId : nextPlayer,
    consecutiveDoubles: doubled ? board.consecutiveDoubles : 0,
    turnMessage: doubled ? "double_bonus" : noMoves ? "no_moves" : null,
    turnDeadlineAt: nextDeadline,
  };
}

/** Production callers supply crypto-generated dice; no client-supplied roll is used. */
export function applyRoll(board: LudoBoardState, color: Color, dice: [number, number], nextPlayer: string, nextDeadline: string): LudoBoardState {
  const doubled = dice[0] === dice[1];
  const count = doubled ? board.consecutiveDoubles + 1 : 0;
  if (count >= 3) {
    return {
      ...board, dice, remainingDice: [], hasRolled: false, consecutiveDoubles: 0,
      turnUserId: nextPlayer, turnMessage: "third_double", turnDeadlineAt: nextDeadline,
    };
  }
  const rolled: LudoBoardState = {
    ...board, dice, remainingDice: [0, 1], hasRolled: true, consecutiveDoubles: count,
    turnMessage: null, turnDeadlineAt: nextDeadline,
  };
  return hasLegalMove(rolled, color) ? rolled : finishRoll(rolled, nextPlayer, nextDeadline, true);
}
