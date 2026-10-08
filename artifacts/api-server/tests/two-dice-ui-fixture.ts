import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, roomsTable, sessionsTable, walletTransactionsTable, commissionLedgerTable } from "@workspace/db";

const report = JSON.parse(await readFile("test-results/two-dice-ui.json", "utf8"));
const ids = report.players.map((player: { id: string }) => player.id);
try {
  assert.equal(ids.length, 2);
  for (const player of report.players) {
    const [user] = await db.select({ username: usersTable.username, email: usersTable.email })
      .from(usersTable).where(eq(usersTable.id, player.id));
    assert.ok(user); assert.equal(user.username, player.username);
    assert.match(user.username, /^qa2_[a-f0-9]{8}$/);
    assert.equal(user.email, `${user.username}@example.com`);
  }
  if (process.argv.includes("--cleanup")) {
    // Remove only these disposable UI fixtures, never provider-funded QA accounts.
    await db.transaction(async tx => {
      const fixtureRooms = await tx.select({ id: roomsTable.id, status: roomsTable.status })
        .from(roomsTable).where(inArray(roomsTable.hostUserId, ids));
      assert.ok(fixtureRooms.every(room => room.status !== "completed"), "Unexpected settlement requires investigation, not deletion");
      for (const room of fixtureRooms) {
        assert.equal((await tx.select().from(commissionLedgerTable).where(eq(commissionLedgerTable.roomId, room.id))).length, 0);
      }
      await tx.delete(walletTransactionsTable).where(inArray(walletTransactionsTable.userId, ids));
      await tx.delete(roomsTable).where(inArray(roomsTable.hostUserId, ids));
      await tx.delete(sessionsTable).where(inArray(sessionsTable.userId, ids));
      await tx.delete(usersTable).where(inArray(usersTable.id, ids));
    });
    console.log("Disposable board-test users, stakes, sessions and room removed; real payment records untouched.");
  } else {
    // Create a board-only fixture, not money or a provider-backed match.
    // Never auto-match these accounts into another user's waiting table.
    const [room] = await db.insert(roomsTable).values({
      hostUserId: ids[0], opponentUserId: ids[1], stakeKobo: 50000, status: "active",
      board: {
        redTokens: [0, 10, -1, -1], greenTokens: [0, 10, -1, -1],
        turnUserId: ids[0], dice: null, remainingDice: [], hasRolled: false,
        consecutiveDoubles: 0, turnMessage: null, winnerUserId: null,
        turnDeadlineAt: new Date(Date.now() + 30000).toISOString(),
      },
    }).returning({ id: roomsTable.id });
    report.roomId = room.id;
    await writeFile("test-results/two-dice-ui.json", JSON.stringify(report, null, 2));
    console.log("Disposable board-only room created with two movable tokens per player; no wallet credit or Paystack deposit.");
  }
} finally { await pool.end(); }
