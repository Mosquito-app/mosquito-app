import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { db, pool, usersTable, depositIntentsTable, walletTransactionsTable, roomsTable } from "@workspace/db";

const report = JSON.parse(await readFile("test-results/report.json", "utf8"));
try {
  for (const [index, player] of report.players.entries()) {
    const [user] = await db.select({ balanceKobo: usersTable.balanceKobo }).from(usersTable).where(eq(usersTable.id, player.id));
    assert.ok(user, "Registered QA user must exist in PostgreSQL");
    const [intent] = await db.select({
      status: depositIntentsTable.status, amountKobo: depositIntentsTable.amountKobo,
      verifiedAt: depositIntentsTable.verifiedAt,
    }).from(depositIntentsTable).where(and(
      eq(depositIntentsTable.reference, player.reference), eq(depositIntentsTable.userId, player.id),
    ));
    assert.ok(intent); assert.equal(intent.amountKobo, 200000);
    const ledger = await db.select({ amountKobo: walletTransactionsTable.amountKobo })
      .from(walletTransactionsTable).where(and(
        eq(walletTransactionsTable.userId, player.id), eq(walletTransactionsTable.depositReference, player.reference),
      ));
    if (report.outcome === "success") {
      assert.equal(intent.status, "success"); assert.ok(intent.verifiedAt);
      assert.equal(ledger.length, 1); assert.equal(ledger[0].amountKobo, 200000);
      assert.equal(user.balanceKobo, 0); // ₦2,000 now held in the active match.
    } else {
      assert.equal(user.balanceKobo, 0); assert.equal(ledger.length, 0);
    }
    console.log(`Player ${index + 1} PostgreSQL: balanceKobo=${user.balanceKobo}, depositStatus=${intent.status}, creditedLedgerRows=${ledger.length}`);
  }
  if (report.outcome === "success") {
    const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, report.roomId));
    assert.equal(room.status, "active"); assert.equal(room.stakeKobo, 200000);
    assert.equal(room.hostUserId, report.players[0].id); assert.equal(room.opponentUserId, report.players[1].id);
    console.log("PASS PostgreSQL confirms both real test deposits and the shared active match");
  } else console.log("CONFIRMED: unpaid checkouts did not create wallet credit; payment and matchmaking QA remain blocked.");
} finally { await pool.end(); }
