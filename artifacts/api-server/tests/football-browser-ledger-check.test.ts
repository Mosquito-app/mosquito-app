import assert from "node:assert/strict";
import { getTableName } from "drizzle-orm";
import { pool, footballRoomsTable, footballLedgerTable, platformWalletTable, usersTable } from "@workspace/db";

// Recover verification/cleanup if the software-rendered browser stalls in
// teardown. Never inspect or mutate application wallets in public.
const client = await pool.connect();
try {
  const schemas = await client.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'football_browser_%' ORDER BY oid DESC");
  const schema = schemas.rows[0]?.nspname;
  assert.match(schema ?? "", /^football_browser_[a-f0-9]{32}$/);
  const table = (t: Parameters<typeof getTableName>[0]) => `"${schema}"."${getTableName(t)}"`;
  const rooms = await client.query(`SELECT id, status FROM ${table(footballRoomsTable)}`);
  assert.equal(rooms.rows.length, 1); assert.equal(rooms.rows[0].status, "completed");
  const ledger = await client.query(`SELECT type, amount_kobo FROM ${table(footballLedgerTable)} WHERE room_id = $1`, [rooms.rows[0].id]);
  assert.equal(ledger.rows.filter(r => r.type === "stake_lock").length, 2);
  assert.equal(ledger.rows.filter(r => r.type === "prize").length, 1);
  assert.equal(ledger.rows.find(r => r.type === "prize").amount_kobo, 180000);
  assert.equal(ledger.rows.find(r => r.type === "commission").amount_kobo, 20000);
  const house = await client.query(`SELECT balance_kobo FROM ${table(platformWalletTable)} WHERE id = 'commission'`);
  assert.equal(house.rows[0].balance_kobo, 20000);
  const players = await client.query(`SELECT username, balance_kobo FROM ${table(usersTable)}`);
  assert.equal(players.rows.length, 2);
  assert.equal(players.rows.find(r => r.username === "football_browser_home").balance_kobo, 280000);
  assert.equal(players.rows.find(r => r.username === "football_browser_away").balance_kobo, 100000);
  console.log("PASS browser match PostgreSQL: two ₦1,000 escrow stakes, one ₦1,800 winner prize, ₦200 commission, winner balance ₦2,800. Public wallets untouched.");
  await client.query(`DROP SCHEMA "${schema}" CASCADE`);
} finally { client.release(); await pool.end(); }
