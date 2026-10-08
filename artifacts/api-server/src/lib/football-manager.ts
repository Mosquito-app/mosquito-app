import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool, footballRoomsTable, usersTable, type FootballState, type FootballTeam } from "@workspace/db";
import { GetFootballRoomResponse } from "@workspace/api-zod";
import { advanceFootball, type FootballInput, type FootballInputs } from "./football-physics";
import { settleFootball, type FootballRow } from "./football-finance";
import { logger } from "./logger";

const OWNER = randomUUID();
const CHANNEL = "mosquito_football";
export const footballEvents = new EventEmitter();
type Match = { row: FootballRow; names: { home: string; away: string | null }; inputs: FootballInputs;
  received: Partial<Record<FootballTeam, number>>; persistedAt: number; broadcastAt: number; expiresAt: number; busy: boolean };
const matches = new Map<string, Match>();
type RoomDTO = ReturnType<typeof GetFootballRoomResponse.parse>;
const remoteSnapshots = new Map<string, RoomDTO>();
let busReady = false;
let stopped = false;
let discoveryPromise: Promise<void> | null = null;
const connectRelay = () => pool.connect();

async function namesFor(row: FootballRow) {
  const users = await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable)
    .where(inArray(usersTable.id, [row.hostUserId, ...(row.opponentUserId ? [row.opponentUserId] : [])]));
  return { home: users.find(u => u.id === row.hostUserId)?.username ?? "Home",
    away: users.find(u => u.id === row.opponentUserId)?.username ?? null };
}
function dto(row: FootballRow, names: Match["names"], viewerId?: string): RoomDTO {
  return GetFootballRoomResponse.parse({
    id: row.id, status: row.status, stakeNaira: row.stakeKobo / 100, potNaira: row.stakeKobo * 2 / 100,
    prizeNaira: row.stakeKobo * 1.8 / 100, commissionNaira: row.stakeKobo * 0.2 / 100,
    hostUserId: row.hostUserId, opponentUserId: row.opponentUserId, winnerUserId: row.winnerUserId,
    hostUsername: names.home, opponentUsername: names.away,
    viewerTeam: viewerId === row.hostUserId ? "home" : viewerId === row.opponentUserId ? "away" : null,
    createdAt: row.createdAt.toISOString(), state: row.state,
  });
}
export async function footballRoomView(row: FootballRow, viewerId: string) {
  const owned = matches.get(row.id);
  const remote = remoteSnapshots.get(row.id);
  if (owned && owned.row.status === row.status) return dto(owned.row, owned.names, viewerId);
  if (remote && remote.state.sequence >= row.state.sequence && remote.status === row.status) {
    return { ...remote, viewerTeam: viewerId === row.hostUserId ? "home" as const : viewerId === row.opponentUserId ? "away" as const : null };
  }
  return dto(row, await namesFor(row), viewerId);
}
async function notify(payload: Record<string, unknown>) {
  if (!busReady) return;
  // < 8kB PostgreSQL notification limit: fixed 22-player snapshots are ~4kB.
  await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, JSON.stringify({ ...payload, origin: OWNER })]);
}
function emitSnapshot(match: Match) {
  const room = dto(match.row, match.names);
  footballEvents.emit("snapshot", room);
  void notify({ kind: "snapshot", room }).catch(err => logger.warn({ err }, "Football snapshot relay failed"));
}
function receiveInput(roomId: string, userId: string, input: FootballInput) {
  const match = matches.get(roomId);
  if (!match || match.row.status !== "active" || match.expiresAt <= Date.now()) return;
  const team = userId === match.row.hostUserId ? "home" : userId === match.row.opponentUserId ? "away" : null;
  if (!team) return;
  // Keep a one-shot action if a subsequent movement packet arrives before tick.
  const prior = match.inputs[team];
  match.inputs[team] = { ...input, action: input.action ?? prior?.action };
  match.received[team] = Date.now();
}
export function footballInput(roomId: string, userId: string, input: FootballInput) {
  receiveInput(roomId, userId, input);
  void notify({ kind: "input", roomId, userId, input }).catch(err => logger.warn({ err }, "Football input relay failed"));
}
export function stopFootballInput(roomId: string, userId: string) {
  footballInput(roomId, userId, { moveX: 0, moveY: 0 });
}
async function discoverMatches() {
  const rows = await db.select().from(footballRoomsTable).where(eq(footballRoomsTable.status, "active"));
  for (const row of rows) {
    const existing = matches.get(row.id);
    if (existing && existing.expiresAt > Date.now()) continue;
    matches.delete(row.id);
    const now = Date.now();
    const [claimed] = await db.update(footballRoomsTable).set({ engineOwner: OWNER, leaseUntil: new Date(now + 9000) })
      .where(and(eq(footballRoomsTable.id, row.id), eq(footballRoomsTable.status, "active"),
        sql`(${footballRoomsTable.leaseUntil} is null or ${footballRoomsTable.leaseUntil} < ${new Date(now)} or ${footballRoomsTable.engineOwner} = ${OWNER})`)).returning();
    if (!claimed) continue;
    matches.set(row.id, { row: claimed, names: await namesFor(claimed), inputs: {}, received: {},
      persistedAt: now, broadcastAt: 0, expiresAt: now + 9000, busy: false });
  }
}
export function discoverFootballMatches() {
  if (!discoveryPromise) discoveryPromise = discoverMatches().finally(() => { discoveryPromise = null; });
  return discoveryPromise;
}
async function checkpoint(match: Match, now: number) {
  const snapshot = structuredClone(match.row.state);
  const [saved] = await db.update(footballRoomsTable).set({ state: snapshot, leaseUntil: new Date(now + 9000), updatedAt: new Date(now) })
    .where(and(eq(footballRoomsTable.id, match.row.id), eq(footballRoomsTable.status, "active"),
      eq(footballRoomsTable.engineOwner, OWNER), sql`${footballRoomsTable.leaseUntil} > ${new Date(now)}`)).returning({ id: footballRoomsTable.id });
  if (!saved) { matches.delete(match.row.id); return false; }
  match.persistedAt = now; match.expiresAt = now + 9000;
  return true;
}
async function tickMatch(match: Match, now: number) {
  if (match.busy) return;
  if (now >= match.expiresAt) { matches.delete(match.row.id); return; }
  match.busy = true;
  try {
    const before = { phase: match.row.state.phase, h: match.row.state.scoreHome, a: match.row.state.scoreAway };
    for (const team of ["home", "away"] as const) {
      if (now - (match.received[team] ?? 0) > 350) match.inputs[team] = { moveX: 0, moveY: 0 };
    }
    advanceFootball(match.row.state, match.inputs, now);
    for (const input of Object.values(match.inputs)) if (input) delete input.action;
    const s = match.row.state;
    if (s.phase === "finished") {
      const ended = await db.transaction(async tx => {
        const [row] = await tx.select().from(footballRoomsTable).where(eq(footballRoomsTable.id, match.row.id)).for("update");
        if (!row || row.status !== "active" || row.engineOwner !== OWNER || !row.leaseUntil || row.leaseUntil.getTime() <= now) return null;
        return settleFootball(tx, row, structuredClone(s));
      });
      if (ended) { match.row = ended; emitSnapshot(match); }
      matches.delete(match.row.id);
      return;
    }
    if (now - match.persistedAt >= 2500 || before.phase !== s.phase || before.h !== s.scoreHome || before.a !== s.scoreAway) {
      if (!await checkpoint(match, now)) return;
    }
    if (now - match.broadcastAt >= 65) { match.broadcastAt = now; emitSnapshot(match); }
  } catch (err) {
    // Fail closed: reload only durable state before admitting further actions.
    matches.delete(match.row.id);
    logger.error({ err, roomId: match.row.id }, "Football engine paused after database error");
  } finally { match.busy = false; }
}
export function startFootballEngine() {
  stopped = false;
  let relayClient: Awaited<ReturnType<typeof connectRelay>> | null = null;
  let discovering = false;
  const discover = () => {
    if (discovering) return;
    discovering = true;
    void discoverFootballMatches().catch(err => logger.error({ err }, "Football discovery failed")).finally(() => { discovering = false; });
  };
  const frames = setInterval(() => { const now = Date.now(); for (const match of matches.values()) void tickMatch(match, now); }, 1000 / 30);
  const discovery = setInterval(discover, 2000);
  frames.unref(); discovery.unref(); discover();
  // Shared DB relay keeps sockets on different production workers in sync;
  // renewable row leases allow exactly ONE physics/settlement owner per match.
  const listen = async () => {
    if (stopped) return;
    try {
      const client = await connectRelay();
      if (stopped) { client.release(); return; }
      relayClient = client;
      await client.query(`LISTEN ${CHANNEL}`); busReady = true;
      client.on("notification", msg => {
        try {
          const data = JSON.parse(msg.payload ?? "{}");
          if (data.origin === OWNER) return;
          if (data.kind === "input") receiveInput(data.roomId, data.userId, data.input);
          if (data.kind === "snapshot") {
            const room = GetFootballRoomResponse.parse(data.room);
            remoteSnapshots.set(room.id, room);
            if (remoteSnapshots.size > 200) remoteSnapshots.delete(remoteSnapshots.keys().next().value!);
            footballEvents.emit("snapshot", room);
          }
        } catch (err) { logger.warn({ err }, "Invalid football relay packet"); }
      });
      const failed = (err: unknown) => {
        busReady = false; client.release(true);
        if (relayClient === client) relayClient = null;
        logger.warn({ err }, "Football relay reconnecting");
        if (!stopped) setTimeout(() => void listen(), 2000).unref();
      };
      client.once("error", failed);
      client.once("end", () => { if (busReady) failed(new Error("Relay disconnected")); });
    } catch (err) {
      busReady = false; logger.error({ err }, "Football relay unavailable");
      if (!stopped) setTimeout(() => void listen(), 2000).unref();
    }
  };
  void listen();
  return () => {
    stopped = true; busReady = false; clearInterval(frames); clearInterval(discovery);
    const client = relayClient; relayClient = null;
    if (client) {
      client.removeAllListeners("notification"); client.removeAllListeners("error"); client.removeAllListeners("end");
      void client.query(`UNLISTEN ${CHANNEL}`).finally(() => client.release());
    }
    matches.clear(); remoteSnapshots.clear();
  };
}
