import assert from "node:assert/strict";
import { nextPlayerId } from "../src/lib/ludo-turns";
import type { LudoBoardState } from "@workspace/db";

const room = {
  hostUserId: "player-a",
  opponentUserId: "player-b",
  thirdUserId: "player-c",
  fourthUserId: "player-d",
  board: {
    forfeitedUserIds: ["player-b", "player-d"],
  } as LudoBoardState,
};

assert.equal(nextPlayerId(room, "player-a"), "player-c");
assert.equal(nextPlayerId(room, "player-c"), "player-a");
console.log("PASS forfeited players are skipped in the Ludo turn order.");
