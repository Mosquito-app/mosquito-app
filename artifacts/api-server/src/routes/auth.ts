import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import { db, usersTable } from "@workspace/db";
import {
  createSession,
  destroySession,
  getAuthenticatedUser,
  hashPassword,
  passwordMatches,
} from "../lib/ludo-auth";
import { randomBytes } from "node:crypto";

const router: IRouter = Router();

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

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid username, email, and password." });
    return;
  }

  const username = parsed.data.username.trim().toLowerCase();
  const email = parsed.data.email.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    res.status(400).json({
      error: "Username must be 3–24 characters using letters, numbers, or underscores.",
    });
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
    res.status(201).json(RegisterResponse.parse({ user: toUserResponse(user) }));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      res.status(409).json({ error: "That email or username is already registered." });
      return;
    }

    req.log.error({ err: error }, "Unable to register local account");
    res.status(500).json({ error: "Unable to create account right now." });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email and password." });
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

export default router;