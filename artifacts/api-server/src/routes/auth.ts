import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { z } from "zod";
import {
  createSession,
  destroySession,
  getAuthenticatedUser,
  hashPassword,
  passwordMatches,
} from "../lib/ludo-auth";

const router: IRouter = Router();

const ResetPasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(4, "Password must be at least 4 characters long")
});

function toUserResponse(user: {
  id: string;
  username: string;
  email: string;
  balanceKobo: number;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    balanceNaira: Math.floor(user.balanceKobo / 100),
  };
}

function normalizeEmailBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const record = body as Record<string, unknown>;
  return {
    ...record,
    email:
      typeof record.email === "string"
        ? record.email.trim().toLowerCase()
        : record.email,
  };
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(normalizeEmailBody(req.body));
  if (!parsed.success) {
    const passwordIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "password",
    );
    const emailIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "email",
    );
    const usernameIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "username",
    );
    res.status(400).json({
      error: passwordIssue
        ? "Password must be at least 4 characters long."
        : emailIssue
          ? "Enter a valid email address."
          : usernameIssue
            ? "Enter a valid username."
            : "Enter valid account details.",
    });
    return;
  }

  const username = parsed.data.username.trim().toLowerCase();
  const email = parsed.data.email.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    res.status(400).json({ error: "Username must be 3–24 characters using letters, numbers, or underscores." });
    return;
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(parsed.data.password, salt);

  try {
    const [user] = await db
      .insert(usersTable)
      .values({ username, email, passwordSalt: salt, passwordHash })
      .returning({
        id: usersTable.id,
        username: usersTable.username,
        email: usersTable.email,
        balanceKobo: usersTable.balanceKobo,
      });

    await createSession(user.id, res);
    res.status(200).json(RegisterResponse.parse({ user: toUserResponse(user) }));
  } catch (error) {
    const cause =
      typeof error === "object" && error !== null && "cause" in error
        ? error.cause
        : error;
    const code =
      typeof cause === "object" && cause !== null && "code" in cause
        ? cause.code
        : undefined;
    if (code === "23505") {
      const constraint =
        typeof cause === "object" && cause !== null && "constraint" in cause
          ? String(cause.constraint)
          : "";
      const [existingEmail] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      res.status(409).json({
        error: /email/i.test(constraint) || existingEmail
          ? "Email already registered"
          : "Username already registered",
      });
      return;
    }

    req.log.error(
      { errorType: error instanceof Error ? error.name : "unknown" },
      "Unable to register local account",
    );
    res.status(500).json({ error: "Unable to create account right now." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(normalizeEmailBody(req.body));
  if (!parsed.success) {
    res.status(400).json({
      error:
        parsed.error.issues.find((issue) => issue.path[0] === "password")?.message ??
        parsed.error.issues[0]?.message ??
        "Enter a valid email and password.",
    });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (
    !user ||
    !(await passwordMatches(
      parsed.data.password,
      user.passwordSalt,
      user.passwordHash,
    ))
  ) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }

  await createSession(user.id, res);
  res.json(LoginResponse.parse({ user: toUserResponse(user) }));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await destroySession(req, res);
  res.sendStatus(204);
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue." });
    return;
  }

  res.json(GetCurrentUserResponse.parse({ user: toUserResponse(user) }));
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to reset your password." });
    return;
  }

  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error:
        parsed.error.issues[0]?.message ??
        "Enter your current password and a new password of at least 4 characters.",
    });
    return;
  }

  const [credentials] = await db
    .select({
      passwordSalt: usersTable.passwordSalt,
      passwordHash: usersTable.passwordHash,
    })
    .from(usersTable)
    .where(eq(usersTable.id, user.id))
    .limit(1);

  if (
    !credentials ||
    !(await passwordMatches(
      parsed.data.currentPassword,
      credentials.passwordSalt,
      credentials.passwordHash,
    ))
  ) {
    res.status(401).json({ error: "Current password is incorrect." });
    return;
  }

  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(parsed.data.newPassword, salt);
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ passwordSalt: salt, passwordHash })
      .where(eq(usersTable.id, user.id));
    await tx.delete(sessionsTable).where(eq(sessionsTable.userId, user.id));
  });

  // Invalidate every previous session, then issue a fresh session for this browser.
  await createSession(user.id, res);
  res.json({ success: true, message: "Password updated successfully." });
});

export default router;
