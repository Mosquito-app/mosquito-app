import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { roomsTable, usersTable } from "./ludo";

export const platformWalletTable = pgTable("ludo_platform_wallet", {
  id: text("id").primaryKey(),
  balanceKobo: integer("balance_kobo").notNull().default(0),
}, (table) => [check("ludo_platform_balance_nonnegative", sql`${table.balanceKobo} >= 0`)]);

export const commissionLedgerTable = pgTable("ludo_commission_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id").notNull().references(() => roomsTable.id),
  amountKobo: integer("amount_kobo").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("ludo_commission_room_unique").on(table.roomId)]);

export const withdrawalsTable = pgTable("ludo_withdrawals", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  requestId: uuid("request_id").notNull(),
  reference: text("reference").notNull(),
  recipientCode: text("recipient_code").notNull(),
  amountKobo: integer("amount_kobo").notNull(),
  status: text("status").$type<"pending" | "success" | "failed">().notNull().default("pending"),
  transferCode: text("transfer_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ludo_withdrawals_reference_unique").on(table.reference),
  uniqueIndex("ludo_withdrawal_request_unique").on(table.userId, table.requestId),
  index("ludo_withdrawals_status_idx").on(table.status),
]);
