import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";
import type { UnityMatch } from "@workspace/db";

export class UnityError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
const issuer = "mosquito-app";
const audience = "mosquito-unity-match";
export const UNITY_TOKEN_SECONDS = 24 * 60 * 60;

function signingKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new UnityError(503, "Unity JWT signing is not configured.");
  // Separate cryptographic context from existing browser session credentials.
  return createHmac("sha256", secret).update("mosquito:unity-match:jwt:v1").digest();
}
export function requireUnityServer(req: Request) {
  const expected = process.env.UNITY_BRIDGE_SECRET;
  if (!expected || expected.length < 32) throw new UnityError(503, "Unity bridge server authentication is not configured.");
  const supplied = req.get("X-Unity-Server-Key");
  if (!supplied || supplied.length > 512 ||
      !timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(expected).digest())) {
    throw new UnityError(401, "Valid private Unity server credentials are required.");
  }
}
export function assertUnitySigningConfigured() { signingKey(); }
export async function issueUnityToken(match: Pick<UnityMatch, "id" | "tokenId">) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + UNITY_TOKEN_SECONDS;
  const matchToken = await new SignJWT({ purpose: "match_status", gameType: "football_11v11" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer).setAudience(audience).setSubject(match.id).setJti(match.tokenId)
    .setIssuedAt(issuedAt).setExpirationTime(exp).sign(signingKey());
  return { matchToken, tokenExpiresAt: new Date(exp * 1000).toISOString() };
}
export async function verifyUnityToken(token: string, matchId: string) {
  const key = signingKey();
  if (!token || token.length > 2048) throw new UnityError(401, "Invalid match token.");
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], issuer, audience,
      requiredClaims: ["exp", "iat", "sub", "jti"], maxTokenAge: UNITY_TOKEN_SECONDS });
    if (payload.sub !== matchId || payload.purpose !== "match_status" || payload.gameType !== "football_11v11" ||
        typeof payload.jti !== "string") throw new Error("Wrong match scope.");
    return payload.jti;
  } catch { throw new UnityError(401, "Invalid, expired or mismatched match token."); }
}

/** Runs BEFORE the app's legacy permissive CORS middleware. JWT GETs do not
 * need cookies; native/private server requests may omit Origin entirely. */
export function unityCors(req: Request, res: Response, next: NextFunction) {
  res.locals.unityCors = true;
  res.setHeader("Cache-Control", "no-store");
  res.vary("Origin");
  const origin = req.get("Origin");
  if (origin) {
    const allowed = (process.env.UNITY_ALLOWED_ORIGINS ?? "").split(",").map(v => v.trim()).filter(v => {
      try { const u = new URL(v); return ["http:", "https:"].includes(u.protocol) && u.origin === v; } catch { return false; }
    });
    if (!allowed.includes(origin)) {
      req.log.warn({ event: "unity.cors_rejected" }, "Unity origin rejected");
      res.status(403).json({ error: "This Unity WebGL origin is not allowed." }); return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Unity-Server-Key, Idempotency-Key");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  // The default cors() below must not overwrite this route's allowlist.
  next();
}
