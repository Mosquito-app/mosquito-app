import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { usersTable, walletTransactionsTable, type RoomStatus } from "./ludo";

export type FootballTeam = "home" | "away";
export type FootballPhase = "waiting" | "first_half" | "second_half" | "overtime" | "finished";
export type FootballPlayer = { id: string; team: FootballTeam; number: number; role: "GK" | "DEF" | "MID" | "FWD"; x: number; y: number };
export type FootballState = {
  players: FootballPlayer[];
  ball: { x: number; y: number; vx: number; vy: number; ownerId: string | null };
  scoreHome: number; scoreAway: number;
  controlledHome: string; controlledAway: string;
  phase: FootballPhase; homeDirection: -1 | 1;
  startedAt: string | null; serverTimeAt: string;
  elapsedMs: number; remainingMs: number; lastTickAt: number;
  pauseUntil: number; ballFreeAt: number; lastTouchId: string | null;
  lastActionHomeAt: number; lastActionAwayAt: number;
  lastEvent: string; sequence: number; winnerTeam: FootballTeam | null;
};

export const footballRoomsTable = pgTable("football_rooms", {
  id: uuid("id").defaultRandom().primaryKey(),
  stakeKobo: integer("stake_kobo").notNull(),
  status: text("status").$type<RoomStatus>().notNull().default("waiting"),
  hostUserId: uuid("host_user_id").notNull().references(() => usersTable.id),
  opponentUserId: uuid("opponent_user_id").references(() => usersTable.id),
  winnerUserId: uuid("winner_user_id").references(() => usersTable.id),
  state: jsonb("state").$type<FootballState>().notNull(),
  engineOwner: text("engine_owner"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  check("football_stake_positive", sql`${t.stakeKobo} > 0`),
  index("football_lobby_idx").on(t.status, t.stakeKobo, t.createdAt),
  index("football_host_idx").on(t.hostUserId, t.status),
  index("football_opponent_idx").on(t.opponentUserId, t.status),
]);

/** Football escrow audit links to the existing Mosquito Wallet transaction
 * ledger without changing Ludo's room foreign keys or historical receipts. */
export const footballLedgerTable = pgTable("football_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id").notNull().references(() => footballRoomsTable.id),
  userId: uuid("user_id").references(() => usersTable.id),
  type: text("type").$type<"stake_lock" | "prize" | "commission">().notNull(),
  amountKobo: integer("amount_kobo").notNull(),
  walletTransactionId: uuid("wallet_transaction_id").references(() => walletTransactionsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("football_player_action_unique").on(t.roomId, t.userId, t.type),
  uniqueIndex("football_commission_once").on(t.roomId).where(sql`${t.type} = 'commission'`),
]);
