import type { LudoBoardState } from "@workspace/db";
import type { LudoColor } from "./ludo-room-tiers";
import { tokensFor } from "./ludo-rules";

/** Current progress, not cumulative rolls: captures send progress back to zero.
 * A cap in base scores 0; entering the starting square scores 1; finish scores 58. */
export function tokenRank(tokens: number[]) {
  return {
    tokensHome: tokens.filter(position => position === 57).length,
    totalProgress: tokens.reduce((sum, position) => sum + Math.max(0, position + 1), 0),
  };
}

export function boardScores(board: LudoBoardState) {
  return {
    red: tokenRank(tokensFor(board, "red")),
    green: tokenRank(tokensFor(board, "green")),
    yellow: tokenRank(tokensFor(board, "yellow")),
    blue: tokenRank(tokensFor(board, "blue")),
  };
}

export function leadingColor(board: LudoBoardState, colors: LudoColor[] = ["red", "green"]): LudoColor | null {
  if (colors.length < 2) return null;
  const scores = boardScores(board);
  const ranked = colors.map((color) => ({ color, ...scores[color] }))
    .sort((a, b) => b.tokensHome - a.tokensHome || b.totalProgress - a.totalProgress);
  const first = ranked[0], second = ranked[1];
  return first.tokensHome === second.tokensHome && first.totalProgress === second.totalProgress ? null : first.color;
}
