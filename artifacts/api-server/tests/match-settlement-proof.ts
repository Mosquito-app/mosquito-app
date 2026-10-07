import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, roomsTable, walletTransactionsTable, commissionLedgerTable, platformWalletTable } from "@workspace/db";

const original = JSON.parse(await readFile("test-results/report.json", "utf8"));
const baselinePath = "test-results/settlement-baseline.json";
try {
  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, original.roomId));
  assert.ok(room); assert.equal(room.stakeKobo, 200000);
  assert.equal(room.hostUserId, original.players[0].id);
  assert.equal(room.opponentUserId, original.players[1].id);
  const [platform] = await db.select({ balanceKobo: platformWalletTable.balanceKobo })
    .from(platformWalletTable).where(eq(platformWalletTable.id, "commission"));
  const ledger = await db.select({ userId: walletTransactionsTable.userId, type: walletTransactionsTable.type, amountKobo: walletTransactionsTable.amountKobo })
    .from(walletTransactionsTable).where(eq(walletTransactionsTable.roomId, room.id));
  const commissions = await db.select({ amountKobo: commissionLedgerTable.amountKobo })
    .from(commissionLedgerTable).where(eq(commissionLedgerTable.roomId, room.id));
  if (process.argv.includes("--before")) {
    assert.equal(room.status, "active");
    assert.equal(commissions.length, 0);
    assert.equal(ledger.filter(row => row.type === "prize").length, 0);
    for (const player of original.players) {
      const [user] = await db.select({ balanceKobo: usersTable.balanceKobo }).from(usersTable).where(eq(usersTable.id, player.id));
      assert.equal(user.balanceKobo, 0);
    }
    const baseline = { roomId: room.id, platformBalanceKobo: platform?.balanceKobo ?? 0 };
    await writeFile(baselinePath, JSON.stringify(baseline, null, 2));
    console.log(`Baseline recorded: active ₦4,000 room, no prize or commission booked; platform balance ₦${baseline.platformBalanceKobo / 100}.`);
  } else {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    assert.equal(baseline.roomId, room.id);
    assert.equal(room.status, "completed");
    const winnerId = room.board.winnerUserId;
    assert.ok(original.players.some(player => player.id === winnerId));
    const winnerTokens = winnerId === room.hostUserId ? room.board.redTokens : room.board.greenTokens;
    assert.deepEqual(winnerTokens, [57, 57, 57, 57]);
    const prizes = ledger.filter(row => row.type === "prize");
    assert.equal(prizes.length, 1); assert.equal(prizes[0].userId, winnerId);
    assert.equal(prizes[0].amountKobo, 360000);
    assert.equal(commissions.length, 1); assert.equal(commissions[0].amountKobo, 40000);
    assert.equal((platform?.balanceKobo ?? 0) - baseline.platformBalanceKobo, 40000);
    const balances = [];
    for (const [index, player] of original.players.entries()) {
      const [user] = await db.select({ balanceKobo: usersTable.balanceKobo }).from(usersTable).where(eq(usersTable.id, player.id));
      assert.equal(user.balanceKobo, player.id === winnerId ? 360000 : 0);
      const stakes = ledger.filter(row => row.type === "stake_lock" && row.userId === player.id);
      assert.equal(stakes.length, 1); assert.equal(stakes[0].amountKobo, -200000);
      balances.push({ player: index + 1, winner: player.id === winnerId, balanceNaira: user.balanceKobo / 100 });
    }
    assert.equal(prizes[0].amountKobo + commissions[0].amountKobo, room.stakeKobo * 2);
    const result = {
      outcome: "passed", roomId: room.id, status: room.status, winnerId, winnerTokens,
      winnerPrizeNaira: 3600, platformCommissionNaira: 400, prizeLedgerRows: prizes.length,
      commissionLedgerRows: commissions.length, platformBalanceBeforeNaira: baseline.platformBalanceKobo / 100,
      platformBalanceAfterNaira: (platform?.balanceKobo ?? 0) / 100, balances,
    };
    await writeFile("test-results/settlement-proof.json", JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    console.log("PASS PostgreSQL: ₦3,600 winner credit + ₦400 commission; single settlement; all stakes accounted for.");
  }
} finally { await pool.end(); }
