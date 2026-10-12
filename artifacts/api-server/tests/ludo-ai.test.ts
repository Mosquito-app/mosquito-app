import assert from "node:assert/strict";
import type { LudoBoardState } from "@workspace/db";
import { chooseAiMove } from "../src/lib/ludo-ai";

const board = (): LudoBoardState => ({
  turnUserId: "ai",
  dice: null,
  remainingDice: [],
  consecutiveDoubles: 0,
  turnMessage: null,
  hasRolled: false,
  redTokens: [-1, -1, -1, -1],
  greenTokens: [-1, -1, -1, -1],
  yellowTokens: [-1, -1, -1, -1],
  blueTokens: [-1, -1, -1, -1],
  winnerUserId: null,
  turnDeadlineAt: null,
});

assert.deepEqual(
  chooseAiMove({ ...board(), dice: [6, 1], remainingDice: [0, 1] }, "red"),
  { tokenIndex: 0, diceIndices: [0, 1], destination: 1 },
);
assert.equal(
  chooseAiMove({ ...board(), dice: [5, 5], remainingDice: [0, 1] }, "red"),
  null,
);
assert.deepEqual(
  chooseAiMove({ ...board(), dice: [1, 2], remainingDice: [0, 1], redTokens: [54, -1, -1, -1] }, "red"),
  { tokenIndex: 0, diceIndices: [0, 1], destination: 57 },
);
assert.deepEqual(
  chooseAiMove({ ...board(), dice: [1, 2], remainingDice: [0, 1], redTokens: [5, -1, -1, -1], greenTokens: [32, -1, -1, -1] }, "red"),
  { tokenIndex: 0, diceIndices: [0], destination: 6 },
);

console.log("PASS server AI selects legal entries, split moves, captures, and exact finishes.");
