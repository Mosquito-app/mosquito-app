import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Request, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "ludo_session";
const SESSION_DAYS = 30;

export type AuthenticatedUser = {
  id: string;
  username: string;
  email: string;
  balanceKobo: number;
};

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(
  password: string,
  salt: string,
): Promise<string> {
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return derived.toString("hex");
}

export async function passwordMatches(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = Buffer.from(await hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
  );
}

function readCookie(req: Request, key: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === key) {
      return part.slice(separator + 1).trim() || null;
    }
  }

  return null;
}

export async function getAuthenticatedUser(
  req: Request,
): Promise<AuthenticatedUser | null> {
  const token = readCookie(req, COOKIE_NAME);
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;

  const [session] = await db
    .select({ userId: sessionsTable.userId })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.tokenHash, hashSessionToken(token)),
        gt(sessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) return null;

  const [user] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      email: usersTable.email,
      balanceKobo: usersTable.balanceKobo,
    })
    .from(usersTable)
    .where(eq(usersTable.id, session.userId))
    .limit(1);

  return user ?? null;
}

export async function createSession(userId: string, res: Response): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessionsTable).values({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt,
  });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = readCookie(req, COOKIE_NAME);
  if (token && /^[A-Za-z0-9_-]{40,60}$/.test(token)) {
    await db
      .delete(sessionsTable)
      .where(eq(sessionsTable.tokenHash, hashSessionToken(token)));
  }

  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}