import {
  index,
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type RoomStatus = "waiting" | "active" | "completed" | "cancelled";
export type WalletTransactionType =
  | "deposit"
  | "stake_lock"
  | "stake_release"
  | "prize"
  | "withdrawal_lock"
  | "withdrawal_release";
export type DepositStatus = "pending" | "success" | "failed";

export type LudoBoardState = {
  turnUserId: string;
  /** Internal marker used only by free practice matches against the server AI. */
  aiPlayerId?: string;
  playerOrder?: string[];
  joinWindowOpen?: boolean;
  dice: number[] | null;
  remainingDice: number[];
  consecutiveDoubles: number;
  turnMessage: "third_double" | "double_bonus" | "capture_bonus" | "six_bonus" | "capture_plus_ten" | "no_moves" | "timeout" | null;
  captureBonusPending?: boolean;
  hasRolled: boolean;
  redTokens: number[];
  greenTokens: number[];
  yellowTokens?: number[];
  blueTokens?: number[];
  winnerUserId: string | null;
  turnDeadlineAt: string | null;
  // Legacy JSON boards may omit these; normalizeBoard supplies API defaults.
  matchDeadlineAt?: string | null;
  isOvertime?: boolean;
  endReason?: "all_home" | "timeout" | "overtime" | null;
};

export const usersTable = pgTable(
  "ludo_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordHash: text("password_hash").notNull(),
    balanceKobo: integer("balance_kobo").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("ludo_users_balance_nonnegative", sql`${table.balanceKobo} >= 0`),
    uniqueIndex("ludo_users_email_unique").on(table.email),
    uniqueIndex("ludo_users_username_unique").on(table.username),
  ],
);

export const sessionsTable = pgTable(
  "ludo_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ludo_sessions_token_hash_unique").on(table.tokenHash),
    index("ludo_sessions_user_id_idx").on(table.userId),
    index("ludo_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const roomsTable = pgTable(
  "ludo_rooms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tierId: text("tier_id"),
    stakeKobo: integer("stake_kobo").notNull(),
    status: text("status").$type<RoomStatus>().notNull().default("waiting"),
    hostUserId: uuid("host_user_id")
      .notNull()
      .references(() => usersTable.id),
    opponentUserId: uuid("opponent_user_id").references(() => usersTable.id),
    thirdUserId: uuid("third_user_id").references(() => usersTable.id),
    fourthUserId: uuid("fourth_user_id").references(() => usersTable.id),
    board: jsonb("board").$type<LudoBoardState>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("ludo_rooms_lobby_idx").on(table.status, table.stakeKobo, table.createdAt),
    index("ludo_rooms_host_user_idx").on(table.hostUserId, table.status),
    index("ludo_rooms_opponent_user_idx").on(table.opponentUserId, table.status),
    index("ludo_rooms_third_user_idx").on(table.thirdUserId, table.status),
    index("ludo_rooms_fourth_user_idx").on(table.fourthUserId, table.status),
  ],
);

export const walletTransactionsTable = pgTable(
  "ludo_wallet_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    type: text("type").$type<WalletTransactionType>().notNull(),
    amountKobo: integer("amount_kobo").notNull(),
    description: text("description").notNull(),
    roomId: uuid("room_id").references(() => roomsTable.id),
    depositReference: text("deposit_reference"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ludo_wallet_transactions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    uniqueIndex("ludo_wallet_transactions_deposit_ref_unique")
      .on(table.depositReference)
      .where(sql`${table.depositReference} is not null`),
    uniqueIndex("ludo_wallet_match_action_unique")
      .on(table.roomId, table.userId, table.type)
      .where(sql`${table.roomId} is not null`),
  ],
);

export const depositIntentsTable = pgTable(
  "ludo_deposit_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    amountKobo: integer("amount_kobo").notNull(),
    status: text("status").$type<DepositStatus>().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ludo_deposit_intents_reference_unique").on(table.reference),
    index("ludo_deposit_intents_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
  ],
);