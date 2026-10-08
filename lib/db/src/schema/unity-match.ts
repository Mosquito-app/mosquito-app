import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable, walletTransactionsTable } from "./ludo";

export type UnityMatchState = "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED";
/** Separate from browser Football: Node simulation discovery must not take
 * ownership of matches whose score authority is the private Unity server. */
export const unityMatchesTable = pgTable("unity_matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  idempotencyKey: uuid("idempotency_key").notNull().unique(),
  tokenId: uuid("token_id").defaultRandom().notNull(),
  player1Id: uuid("player1_id").notNull().references(() => usersTable.id),
  player2Id: uuid("player2_id").notNull().references(() => usersTable.id),
  gameType: text("game_type").notNull().default("football_11v11"),
  stakeKobo: integer("stake_kobo").notNull(),
  status: text("status").$type<UnityMatchState>().notNull().default("PENDING"),
  overtime: boolean("overtime").notNull().default(false),
  drawRule: text("draw_rule").notNull().default("golden_goal"),
  player1Score: integer("player1_score"),
  player2Score: integer("player2_score"),
  winnerId: uuid("winner_id").references(() => usersTable.id),
  winnerPayoutKobo: integer("winner_payout_kobo").notNull().default(0),
  commissionKobo: integer("commission_kobo").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, t => [
  check("unity_distinct_players", sql`${t.player1Id} <> ${t.player2Id}`),
  check("unity_valid_stake", sql`${t.stakeKobo} between 100 and 100000000`),
  check("unity_valid_status", sql`${t.status} in ('PENDING','ACTIVE','COMPLETED','CANCELLED')`),
  check("unity_valid_game", sql`${t.gameType} = 'football_11v11' and ${t.drawRule} = 'golden_goal'`),
  check("unity_winner_participant", sql`${t.winnerId} is null or ${t.winnerId} in (${t.player1Id},${t.player2Id})`),
  check("unity_completed_winner", sql`${t.status} <> 'COMPLETED' or (${t.winnerId} is not null and ${t.completedAt} is not null)`),
  index("unity_player1_status").on(t.player1Id, t.status),
  index("unity_player2_status").on(t.player2Id, t.status),
]);
export const unityEscrowLedgerTable = pgTable("unity_escrow_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").notNull().references(() => unityMatchesTable.id),
  userId: uuid("user_id").references(() => usersTable.id),
  type: text("type").$type<"stake_lock" | "prize" | "commission">().notNull(),
  amountKobo: integer("amount_kobo").notNull(),
  walletTransactionId: uuid("wallet_transaction_id").references(() => walletTransactionsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("unity_positive_ledger", sql`${t.amountKobo} > 0`),
  check("unity_valid_ledger_type", sql`${t.type} in ('stake_lock','prize','commission')`),
  uniqueIndex("unity_player_entry_once").on(t.matchId, t.userId, t.type),
  uniqueIndex("unity_commission_once").on(t.matchId).where(sql`${t.type} = 'commission'`),
  uniqueIndex("unity_prize_once").on(t.matchId).where(sql`${t.type} = 'prize'`),
]);
export const insertUnityMatchSchema = createInsertSchema(unityMatchesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type UnityMatch = typeof unityMatchesTable.$inferSelect;
export type InsertUnityMatch = typeof unityMatchesTable.$inferInsert;
