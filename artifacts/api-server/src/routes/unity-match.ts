import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { StartUnityMatchBody, StartUnityMatchResponse, EndUnityMatchBody, EndUnityMatchResponse,
  GetUnityMatchStatusParams, GetUnityMatchStatusResponse } from "@workspace/api-zod";
import { db, unityMatchesTable, usersTable } from "@workspace/db";
import { fundUnityMatch, closeUnityMatch } from "../lib/unity-finance";
import { issueUnityToken, verifyUnityToken, requireUnityServer, assertUnitySigningConfigured, UnityError } from "../lib/unity-auth";

const router: IRouter = Router();
function failure(req: Request, res: Response, error: unknown) {
  const status = error instanceof UnityError ? error.status : 500;
  // Never log result bodies, JWTs, server keys, account emails or SQL errors.
  req.log[status >= 500 ? "error" : "warn"]({ event: "unity.request_rejected", status }, "Unity bridge request failed");
  res.status(status).json({ error: error instanceof UnityError ? error.message : "Unity match request could not be completed." });
}
router.post("/match/start", async (req, res): Promise<void> => {
  try {
    requireUnityServer(req);
    const input = StartUnityMatchBody.strict().safeParse(req.body);
    const key = z.uuid().safeParse(req.get("Idempotency-Key"));
    if (!input.success || !key.success) throw new UnityError(400, "Valid player IDs, whole-NGN stake, game type and UUID Idempotency-Key are required.");
    // Check signing configuration before any balance mutation.
    assertUnitySigningConfigured();
    const match = await fundUnityMatch(input.data, key.data);
    const players = await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable)
      .where(inArray(usersTable.id, [match.player1Id, match.player2Id]));
    const token = await issueUnityToken(match);
    req.log.info({ event: "unity.match_started", matchId: match.id, status: match.status, stakeAmount: match.stakeKobo / 100 }, "Unity match ready");
    res.json(StartUnityMatchResponse.parse({
      success: true, matchId: match.id, ...token, player1: players.find(p => p.id === match.player1Id),
      player2: players.find(p => p.id === match.player2Id), stakeAmount: match.stakeKobo / 100, status: match.status,
    }));
  } catch (error) { failure(req, res, error); }
});
router.post("/match/end", async (req, res): Promise<void> => {
  try {
    requireUnityServer(req);
    const input = EndUnityMatchBody.strict().safeParse(req.body);
    if (!input.success) throw new UnityError(400, "Valid match ID, token, integer scores, winner ID and draw flag are required.");
    const tokenId = await verifyUnityToken(input.data.matchToken, input.data.matchId);
    const match = await closeUnityMatch(input.data, tokenId);
    req.log.info({ event: match.status === "COMPLETED" ? "unity.match_settled" : "unity.match_overtime",
      matchId: match.id, status: match.status, winnerPayout: match.winnerPayoutKobo / 100,
      commissionLogged: match.commissionKobo / 100 }, "Unity match result recorded");
    res.json(EndUnityMatchResponse.parse({
      success: true, message: match.status === "COMPLETED" ? "Escrow settled successfully" : "Sudden Death Overtime activated; escrow remains locked",
      winnerPayout: match.winnerPayoutKobo / 100, commissionLogged: match.commissionKobo / 100,
      status: match.status, overtime: match.overtime, settled: match.status === "COMPLETED",
    }));
  } catch (error) { failure(req, res, error); }
});
router.get("/match/status/:matchId", async (req, res): Promise<void> => {
  try {
    const params = GetUnityMatchStatusParams.safeParse(req.params);
    if (!params.success) throw new UnityError(400, "A valid UUID match ID is required.");
    let tokenId: string | undefined;
    if (req.get("X-Unity-Server-Key")) requireUnityServer(req);
    else {
      const auth = req.get("Authorization");
      if (!auth?.startsWith("Bearer ")) throw new UnityError(401, "A match-scoped Bearer token is required.");
      tokenId = await verifyUnityToken(auth.slice(7), params.data.matchId);
    }
    const [match] = await db.select().from(unityMatchesTable).where(eq(unityMatchesTable.id, params.data.matchId));
    if (!match) throw new UnityError(404, "Match session not found.");
    if (tokenId !== undefined && tokenId !== match.tokenId) throw new UnityError(401, "Invalid escrow session token.");
    res.json(GetUnityMatchStatusResponse.parse({
      matchId: match.id, status: match.status, gameType: match.gameType, player1Id: match.player1Id,
      player2Id: match.player2Id, stakeAmount: match.stakeKobo / 100, totalPool: match.stakeKobo * 2 / 100,
      player1Score: match.player1Score, player2Score: match.player2Score, winnerId: match.winnerId,
      overtime: match.overtime, drawRule: match.drawRule, winnerPayout: match.winnerPayoutKobo / 100,
      commissionLogged: match.commissionKobo / 100, startedAt: match.createdAt.toISOString(),
      completedAt: match.completedAt?.toISOString() ?? null, sandboxOnly: true,
    }));
  } catch (error) { failure(req, res, error); }
});
export default router;
