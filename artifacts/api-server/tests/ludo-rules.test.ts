import assert from "node:assert/strict";
import type { LudoBoardState } from "@workspace/db";
import { applyCaptureHome, applyRoll, finishRoll, hasLegalMove, moveDestination, normalizeBoard } from "../src/lib/ludo-rules";

const initial = (): LudoBoardState => ({
  turnUserId: "red", dice: null, remainingDice: [], hasRolled: false, consecutiveDoubles: 0,
  turnMessage: null, lastMove: null, redTokens: [-1, -1, -1, -1], greenTokens: [-1, -1, -1, -1],
  winnerUserId: null, turnDeadlineAt: null,
});
const nextDeadline = new Date(Date.now() + 30000).toISOString();
let checks = 0;
const check = (actual: unknown, expected: unknown) => { assert.deepEqual(actual, expected); checks++; };

check(moveDestination(-1, [6], [6, 1]), 0);
check(moveDestination(-1, [6]), null);
check(moveDestination(-1, [6, 6]), 6);
check(moveDestination(-1, [6, 3]), 3);
check(moveDestination(-1, [3, 6]), 3);
check(moveDestination(-1, [6, 1]), 1);
check(moveDestination(-1, [1, 6]), 1);
check(moveDestination(-1, [6, 2]), 2);
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

// Any six releases a pawn, but only exact double-six can earn a bonus roll.
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
  const home = applyRoll(initial(), "red", [a, b], "green", nextDeadline);
  const permitted = a === 6 || b === 6;
  check(home.dice, [a, b]);
  check(home.hasRolled, permitted);
  check(home.turnUserId, permitted ? "red" : "green");
  check(home.consecutiveDoubles, a === 6 && b === 6 ? 1 : 0);
  check(moveDestination(-1, [a, b]), permitted ? a + b - 6 : null);
}

const nonBonus = applyRoll({ ...initial(), redTokens: [10, -1, -1, -1] }, "red", [6, 2], "green", nextDeadline);
check(finishRoll(nonBonus, "green", nextDeadline).turnUserId, "green");
check(finishRoll(nonBonus, "green", nextDeadline).turnMessage, null);
for (let value = 1; value <= 5; value++) {
  const doubles = applyRoll({ ...initial(), redTokens: [10, -1, -1, -1] }, "red", [value, value], "green", nextDeadline);
  check(finishRoll(doubles, "green", nextDeadline).turnUserId, "green");
}

// Consecutive double-sixes grant two repeat rolls; the third ends the turn without undoing moves.
let chain: LudoBoardState = { ...initial(), redTokens: [0, -1, -1, -1] };
for (const count of [1, 2]) {
  chain = applyRoll(chain, "red", [6, 6], "green", nextDeadline);
  check(chain.consecutiveDoubles, count);
  const after = finishRoll(chain, "green", nextDeadline);
  check(after.turnUserId, "red");
  check(after.turnMessage, "double_six_bonus");
  check(after.consecutiveDoubles, count);
  chain = after;
}
chain = applyRoll(chain, "red", [6, 6], "green", nextDeadline);
check(chain.consecutiveDoubles, 3);
chain = { ...chain, redTokens: [24, -1, -1, -1] };
const thirdDouble = finishRoll(chain, "green", nextDeadline);
check(thirdDouble.turnUserId, "green");
check(thirdDouble.turnMessage, "double_six_limit");
check(thirdDouble.redTokens, [24, -1, -1, -1]);
check(thirdDouble.consecutiveDoubles, 0);

const interruptedChain = applyRoll({ ...initial(), consecutiveDoubles: 2, redTokens: [10, -1, -1, -1] }, "red", [6, 1], "green", nextDeadline);
check(interruptedChain.consecutiveDoubles, 0);
check(finishRoll(interruptedChain, "green", nextDeadline).turnUserId, "green");

const blocked = applyRoll(initial(), "red", [5, 5], "green", nextDeadline);
check(blocked.turnMessage, "no_moves");
check(blocked.turnUserId, "green"); check(blocked.consecutiveDoubles, 0);
check(hasLegalMove({ ...initial(), dice: [3, 4], remainingDice: [0, 1], redTokens: [55, -1, -1, -1] }, "red"), false);
check(hasLegalMove({ ...initial(), dice: [1, 6], remainingDice: [0], redTokens: [56, -1, -1, -1] }, "red"), true);

const legacy = normalizeBoard({ ...initial(), dice: 6, hasRolled: true, captureBonusPending: true } as unknown as LudoBoardState);
check(legacy.dice, null); check(legacy.hasRolled, false);
check(legacy.redTokens, [-1, -1, -1, -1]);
check(legacy.captureBonusPending, false);

const cap = applyCaptureHome({ ...initial(), dice: [1, 2], remainingDice: [1], hasRolled: true,
  redTokens: [6, -1, -1, -1], greenTokens: [32, 42, -1, -1] }, "red", 0);
check(cap.redTokens, [57, -1, -1, -1]);
check(cap.greenTokens, [-1, 42, -1, -1]);
check(cap.lastMove, { kind: "capture_home", color: "red", tokenIndex: 0 });
check(cap.captureBonusPending, false); check(cap.remainingDice, [1]);
const capDone = finishRoll(cap, "green", nextDeadline);
check(capDone.turnUserId, "green"); check(capDone.turnMessage, "capture_home");
check(capDone.hasRolled, false);
const nextCapRoll = applyRoll(capDone, "green", [1, 2], "red", nextDeadline);
check(nextCapRoll.lastMove, null);

const greenCap = applyCaptureHome({ ...initial(), turnUserId: "green", redTokens: [32, -1, -1, -1],
  greenTokens: [6, -1, -1, -1] }, "green", 0);
check(greenCap.greenTokens[0], 57); check(greenCap.redTokens[0], -1);
for (const safe of [0, 8, 13, 21, 26, 34, 39, 47]) {
  const safeBoard = { ...initial(), redTokens: [safe, -1, -1, -1], greenTokens: [(safe + 26) % 52, -1, -1, -1] };
  check(applyCaptureHome(safeBoard, "red", 0), safeBoard);
}
const finishCap = applyCaptureHome({ ...initial(), redTokens: [50, 57, 57, 57], greenTokens: [24, -1, -1, -1] }, "red", 0);
check(finishCap.redTokens, [57, 57, 57, 57]); check(finishCap.greenTokens[0], -1);

console.log(`PASS ${checks} deterministic two-dice rule checks, including all 36 rolls, three-double-six cap, and capture-to-home.`);
