import assert from "node:assert/strict";
import type { LudoBoardState } from "@workspace/db";
import { applyCaptureBonus, applyRoll, finishRoll, hasLegalMove, moveDestination, normalizeBoard } from "../src/lib/ludo-rules";

const initial = (): LudoBoardState => ({
  turnUserId: "red", dice: null, remainingDice: [], hasRolled: false, consecutiveDoubles: 0,
  turnMessage: null, redTokens: [-1, -1, -1, -1], greenTokens: [-1, -1, -1, -1],
  winnerUserId: null, turnDeadlineAt: null,
});
const nextDeadline = new Date(Date.now() + 30000).toISOString();
let checks = 0;
const check = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };

check(moveDestination(-1, [6], [6, 1]), 0);
check(moveDestination(-1, [6]), null);
check(moveDestination(-1, [6, 6]), 6);
check(moveDestination(-1, [6, 3]), null);
check(moveDestination(-1, [3, 6]), null);
check(moveDestination(-1, [6, 1]), 1);
check(moveDestination(-1, [1, 6]), 1);
check(moveDestination(-1, [1, 5]), null);
check(moveDestination(-1, [5, 5]), null);
check(moveDestination(10, [3, 4]), 17);
check(moveDestination(10, [3]), 13);
check(moveDestination(53, [2, 2]), 57);
check(moveDestination(56, [2]), null);
check(moveDestination(57, [1]), null);
check(moveDestination(5, [99]), null);
check(moveDestination(5, []), null);
check(moveDestination(-2, [6]), null);

// All 36 roll combinations obey the entry and movement rules.
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
  const home = applyRoll(initial(), "red", [a, b], "green", nextDeadline);
  const permitted = (a === 6 && (b === 6 || b === 1)) || (a === 1 && b === 6);
  check(home.dice, [a, b]);
  check(home.hasRolled, permitted);
  check(home.turnUserId, permitted || a === b ? "red" : "green");
  check(moveDestination(-1, [a, b]), permitted ? a + b - 6 : null);
}
let board = { ...initial(), redTokens: [0, -1, -1, -1] };
board = applyRoll(board, "red", [5, 5], "green", nextDeadline);
check(board.consecutiveDoubles, 1);
check(board.turnUserId, "red");
board = finishRoll({ ...board, redTokens: [10, -1, -1, -1] }, "green", nextDeadline);
check(board.turnMessage, "double_bonus"); check(board.hasRolled, false);
board = applyRoll(board, "red", [4, 4], "green", nextDeadline);
check(board.consecutiveDoubles, 2);
board = finishRoll({ ...board, redTokens: [18, -1, -1, -1] }, "green", nextDeadline);
const beforeThird = structuredClone(board.redTokens);
board = applyRoll(board, "red", [6, 6], "green", nextDeadline);
check(board.redTokens, beforeThird); check(board.hasRolled, false);
check(board.remainingDice, []); check(board.turnUserId, "green");
check(board.consecutiveDoubles, 0); check(board.turnMessage, "third_double");
check(board.turnDeadlineAt, nextDeadline);

board = applyRoll({ ...initial(), consecutiveDoubles: 2, redTokens: [10, -1, -1, -1] }, "red", [6, 2], "green", nextDeadline);
check(board.consecutiveDoubles, 0);
board = finishRoll(board, "green", nextDeadline);
check(board.turnUserId, "green"); // A single six is not a double bonus.
const blocked = applyRoll(initial(), "red", [5, 5], "green", nextDeadline);
check(blocked.turnMessage, "double_bonus");
check(blocked.consecutiveDoubles, 1);
check(hasLegalMove({ ...initial(), dice: [3, 4], remainingDice: [0, 1], redTokens: [55, -1, -1, -1] }, "red"), false);
check(hasLegalMove({ ...initial(), dice: [1, 6], remainingDice: [0], redTokens: [56, -1, -1, -1] }, "red"), true);
const legacy = normalizeBoard({ ...initial(), dice: 6, hasRolled: true } as unknown as LudoBoardState);
check(legacy.dice, null); check(legacy.hasRolled, false);
check(legacy.redTokens, [-1, -1, -1, -1]);
check(legacy.captureBonusPending, false);
const cap = applyCaptureBonus({ ...initial(), dice: [1, 2], remainingDice: [1], hasRolled: true,
  redTokens: [6, -1, -1, -1], greenTokens: [32, 42, -1, -1] }, "red", 0);
check(cap.redTokens, [16, -1, -1, -1]); check(cap.greenTokens, [-1, -1, -1, -1]);
check(cap.captureBonusPending, true); check(cap.remainingDice, [1]);
const capDone = finishRoll(cap, "green", nextDeadline);
check(capDone.turnUserId, "red"); check(capDone.turnMessage, "capture_bonus");
check(capDone.captureBonusPending, false); check(capDone.hasRolled, false);
const nextCapRoll = applyRoll(capDone, "red", [1, 2], "green", nextDeadline);
check(nextCapRoll.captureBonusPending, false);
check(finishRoll(nextCapRoll, "green", nextDeadline).turnUserId, "green");
const greenCap = applyCaptureBonus({ ...initial(), turnUserId: "green", redTokens: [32, -1, -1, -1],
  greenTokens: [6, -1, -1, -1] }, "green", 0);
check(greenCap.greenTokens[0], 16); check(greenCap.redTokens[0], -1);
for (const safe of [0, 8, 13, 21, 26, 34, 39, 47]) {
  const safeBoard = { ...initial(), redTokens: [safe, -1, -1, -1], greenTokens: [(safe + 26) % 52, -1, -1, -1] };
  check(applyCaptureBonus(safeBoard, "red", 0), safeBoard);
}
const finishCap = applyCaptureBonus({ ...initial(), redTokens: [50, 57, 57, 57], greenTokens: [24, -1, -1, -1] }, "red", 0);
check(finishCap.redTokens, [57, 57, 57, 57]); check(finishCap.greenTokens[0], -1);
const doubleCap = finishRoll({ ...cap, dice: [1, 1], consecutiveDoubles: 1 }, "green", nextDeadline);
check(doubleCap.turnUserId, "red"); check(doubleCap.consecutiveDoubles, 1);
console.log(`PASS ${checks} deterministic two-dice rule checks, including all 36 rolls and third-double forfeiture.`);
