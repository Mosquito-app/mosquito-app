import type { LudoBoardState } from "@workspace/db";

/** Current progress, not cumulative rolls: captures send progress back to zero.
 * A cap in base scores 0; entering the starting square scores 1; finish scores 58. */
export function tokenRank(tokens: number[]) {
  return {
    tokensHome: tokens.filter(position => position === 57).length,
    totalProgress: tokens.reduce((sum, position) => sum + Math.max(0, position + 1), 0),
  };
}

export function boardScores(board: LudoBoardState) {
  return { red: tokenRank(board.redTokens), green: tokenRank(board.greenTokens) };
}

export function leadingColor(board: LudoBoardState): "red" | "green" | null {
  const { red, green } = boardScores(board);
  const difference = red.tokensHome - green.tokensHome || red.totalProgress - green.totalProgress;
  return difference > 0 ? "red" : difference < 0 ? "green" : null;
}
