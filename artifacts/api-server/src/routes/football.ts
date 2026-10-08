import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { CancelFootballRoomParams, GetFootballRoomParams, JoinFootballRoomBody, GetFootballLobbyResponse, GetFootballRoomResponse } from "@workspace/api-zod";
import { db, footballRoomsTable, usersTable } from "@workspace/db";
import { getAuthenticatedUser } from "../lib/ludo-auth";
import { initialFootballState, startFootball } from "../lib/football-physics";
import { lockFootballStake } from "../lib/football-finance";
import { discoverFootballMatches, footballRoomView } from "../lib/football-manager";

const router: IRouter = Router();
const open = inArray(footballRoomsTable.status, ["waiting", "active"]);
const participant = (id: string) => or(eq(footballRoomsTable.hostUserId, id), eq(footballRoomsTable.opponentUserId, id));
class MatchError extends Error { constructor(readonly status: number, message: string) { super(message); } }

router.get("/football/lobby", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Sign in to Mosquito App." }); return; }
  const waiting = await db.select().from(footballRoomsTable).where(eq(footballRoomsTable.status, "waiting")).orderBy(asc(footballRoomsTable.createdAt)).limit(30);
  const [mine] = await db.select().from(footballRoomsTable).where(and(open, participant(user.id))).limit(1);
  res.json(GetFootballLobbyResponse.parse({
    rooms: await Promise.all(waiting.map(row => footballRoomView(row, user.id))),
    myRoom: mine ? await footballRoomView(mine, user.id) : null,
  }));
});
router.post("/football/rooms", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Sign in to play football." }); return; }
  const body = JoinFootballRoomBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose ₦500, ₦1,000 or ₦2,000." }); return; }
  const stakeKobo = body.data.stakeNaira * 100;
  try {
    const row = await db.transaction(async tx => {
      // Serialize matchmaking for this user. Wallet locks are sorted below.
      // A non-blocking advisory lock avoids opposite host/join lock cycles.
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`football-user:${user.id}`}, 0)) as acquired`);
      if (!(lock.rows[0] as { acquired: boolean }).acquired) throw new MatchError(409, "A football request is already in progress.");
      const [existing] = await tx.select().from(footballRoomsTable).where(and(open, participant(user.id))).limit(1);
      if (existing) return existing;
      const filters = [eq(footballRoomsTable.status, "waiting"), eq(footballRoomsTable.stakeKobo, stakeKobo), ne(footballRoomsTable.hostUserId, user.id)];
      if (body.data.roomId) filters.push(eq(footballRoomsTable.id, body.data.roomId));
      const [waiting] = await tx.select().from(footballRoomsTable).where(and(...filters)).orderBy(asc(footballRoomsTable.createdAt)).limit(1).for("update", { skipLocked: true });
      if (body.data.roomId && !waiting) throw new MatchError(409, "That football room is no longer available.");
      if (!waiting) {
        const [me] = await tx.select().from(usersTable).where(eq(usersTable.id, user.id)).for("update");
        if (!me || me.balanceKobo < stakeKobo) throw new MatchError(409, "Add test funds to Mosquito Wallet before joining.");
        const [created] = await tx.insert(footballRoomsTable).values({ hostUserId: user.id, stakeKobo, state: initialFootballState() }).returning();
        return created;
      }
      const hostLock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`football-user:${waiting.hostUserId}`}, 0)) as acquired`);
      if (!(hostLock.rows[0] as { acquired: boolean }).acquired) throw new MatchError(409, "Host is updating this room. Try again.");
      const participants = await tx.select().from(usersTable).where(inArray(usersTable.id, [waiting.hostUserId, user.id])).orderBy(asc(usersTable.id)).for("update");
      if (participants.length !== 2 || participants.some(p => p.balanceKobo < stakeKobo)) throw new MatchError(409, "Both players need enough test funds in Mosquito Wallet.");
      await lockFootballStake(tx, waiting, waiting.hostUserId);
      await lockFootballStake(tx, waiting, user.id);
      const state = initialFootballState(); startFootball(state);
      const [active] = await tx.update(footballRoomsTable).set({ status: "active", opponentUserId: user.id, state, updatedAt: new Date() })
        .where(eq(footballRoomsTable.id, waiting.id)).returning();
      return active;
    });
    if (row.status === "active") await discoverFootballMatches();
    res.json(GetFootballRoomResponse.parse(await footballRoomView(row, user.id)));
  } catch (err) {
    if (err instanceof MatchError) { res.status(err.status).json({ error: err.message }); return; }
    req.log.error({ err }, "Football matchmaking failed"); res.status(500).json({ error: "Football room could not be opened. No partial stake debit was committed." });
  }
});
router.get("/football/rooms/:roomId", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Sign in to view a football match." }); return; }
  const params = GetFootballRoomParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid room." }); return; }
  const [row] = await db.select().from(footballRoomsTable).where(and(eq(footballRoomsTable.id, params.data.roomId),
    or(participant(user.id), eq(footballRoomsTable.status, "waiting"))));
  if (!row) { res.status(404).json({ error: "Football room not found or not your match." }); return; }
  res.json(GetFootballRoomResponse.parse(await footballRoomView(row, user.id)));
});
export default router;
router.delete("/football/rooms/:roomId", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) { res.status(401).json({ error: "Sign in to cancel a waiting room." }); return; }
  const params = CancelFootballRoomParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid room." }); return; }
  const row = await db.transaction(async tx => {
    const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${`football-user:${user.id}`}, 0)) as acquired`);
    if (!(lock.rows[0] as { acquired: boolean }).acquired) return null;
    const [room] = await tx.select().from(footballRoomsTable).where(eq(footballRoomsTable.id, params.data.roomId)).for("update");
    if (!room || room.status !== "waiting" || room.hostUserId !== user.id) return null;
    const [closed] = await tx.update(footballRoomsTable).set({ status: "cancelled", updatedAt: new Date() }).where(eq(footballRoomsTable.id, room.id)).returning();
    return closed;
  });
  if (!row) { res.status(409).json({ error: "Only the host can cancel a waiting football room." }); return; }
  res.json(GetFootballRoomResponse.parse(await footballRoomView(row, user.id)));
});
