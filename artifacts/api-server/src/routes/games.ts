import { randomInt } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  CancelRoomParams,
  CancelRoomResponse,
  GetLobbyResponse,
  GetRoomParams,
  GetRoomResponse,
  JoinRoomBody,
  JoinRoomResponse,
  MoveTokenBody,
  MoveTokenParams,
  MoveTokenResponse,
  RollDiceParams,
  RollDiceResponse,
} from "@workspace/api-zod";
import {
  db,
  roomsTable,
  usersTable,
  walletTransactionsTable,
  type LudoBoardState,
  type RoomStatus,
} from "@workspace/db";
import { getAuthenticatedUser } from "../lib/ludo-auth";
import { publishRoomUpdate } from "../lib/ludo-events";
import { deadline, nextPlayerId, splitPot, turnExpired } from "../lib/ludo-turns";
import { applyCaptureBonus, applyRoll, finishRoll, hasLegalMove, moveDestination, normalizeBoard, tokensFor } from "../lib/ludo-rules";
import { completeMatch, matchDeadline, resolveMatchClock } from "../lib/ludo-match";
import { boardScores, leadingColor } from "../lib/ludo-ranking";

const router: IRouter = Router();
const STAKES_NAIRA = [500, 1000, 2000] as const;

class GameActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function colorFor(room: {
  hostUserId: string;
  opponentUserId: string | null;
}, userId: string): "red" | "green" | null {
  if (room.hostUserId === userId) return "red";
  if (room.opponentUserId === userId) return "green";
  return null;
}

function startBoard(hostUserId: string): LudoBoardState {
  return {
    turnUserId: hostUserId,
    dice: null,
    remainingDice: [],
    consecutiveDoubles: 0,
    turnMessage: null,
    captureBonusPending: false,
    hasRolled: false,
    redTokens: [-1, -1, -1, -1],
    greenTokens: [-1, -1, -1, -1],
    winnerUserId: null,
    turnDeadlineAt: null,
    matchDeadlineAt: null, isOvertime: false, endReason: null,
  };
}


async function getRoomForViewer(roomId: string, viewerId: string) {
  const [room] = await db
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.id, roomId))
    .limit(1);
  if (!room) return null;

  const myColor = colorFor(room, viewerId);
  if (!myColor) return null;

  const [host] = await db
    .select({ username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, room.hostUserId))
    .limit(1);
  let opponentUsername: string | null = null;
  if (room.opponentUserId) {
    const [opponent] = await db
      .select({ username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, room.opponentUserId))
      .limit(1);
    opponentUsername = opponent?.username ?? null;
  }

  return GetRoomResponse.parse({
    id: room.id,
    stakeNaira: Math.floor(room.stakeKobo / 100),
    potNaira: room.stakeKobo * 2 / 100,
    prizeNaira: splitPot(room.stakeKobo * 2).prizeKobo / 100,
    commissionNaira: splitPot(room.stakeKobo * 2).commissionKobo / 100,
    status: room.status as RoomStatus,
    hostUserId: room.hostUserId,
    hostUsername: host?.username ?? "Player",
    opponentUserId: room.opponentUserId,
    opponentUsername,
    myColor,
    board: normalizeBoard(room.board),
    createdAt: room.createdAt,
    serverTimeAt: new Date().toISOString(),
    scores: boardScores(room.board),
  });
}

async function loadLockedRoom(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  roomId: string,
  viewerId: string,
) {
  const [room] = await tx
    .select()
    .from(roomsTable)
    .where(eq(roomsTable.id, roomId))
    .for("update")
    .limit(1);
  if (!room || !colorFor(room, viewerId)) {
    throw new GameActionError(404, "Match not found.");
  }
  return { ...room, board: normalizeBoard(room.board) };
}

function currentPlayerColor(room: {
  hostUserId: string;
  opponentUserId: string | null;
}, userId: string) {
  return colorFor(room, userId);
}

function sendGameError(
  req: Request,
  res: Response,
  error: unknown,
  fallback: string,
) {
  if (error instanceof GameActionError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  req.log.error({ err: error }, fallback);
  res.status(500).json({ error: "The match could not be updated." });
}

router.get("/lobby", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view the lobby." });
    return;
  }

  const waitingRooms = await db
    .select({
      room: roomsTable,
      hostUsername: usersTable.username,
    })
    .from(roomsTable)
    .innerJoin(usersTable, eq(roomsTable.hostUserId, usersTable.id))
    .where(eq(roomsTable.status, "waiting"))
    .orderBy(desc(roomsTable.createdAt))
    .limit(50);

  const count500 = waitingRooms.filter((entry) => entry.room.stakeKobo === 50000).length;
  const count1000 = waitingRooms.filter((entry) => entry.room.stakeKobo === 100000).length;
  const payload = {
    myRoomId: (await db.select({ id: roomsTable.id }).from(roomsTable).where(and(
      inArray(roomsTable.status, ["waiting", "active"]),
      or(eq(roomsTable.hostUserId, user.id), eq(roomsTable.opponentUserId, user.id)),
    )).limit(1))[0]?.id ?? null,
    rooms: waitingRooms.map(({ room, hostUsername }) => ({
      id: room.id,
      stakeNaira: Math.floor(room.stakeKobo / 100),
      hostUsername,
      createdAt: room.createdAt,
    })),
    stakeCounts: [
      { stakeNaira: 500, waitingPlayers: count500 },
      { stakeNaira: 1000, waitingPlayers: count1000 },
      { stakeNaira: 2000, waitingPlayers: waitingRooms.filter(entry => entry.room.stakeKobo === 200000).length },
    ],
  };

  res.json(GetLobbyResponse.parse(payload));
});

router.post("/rooms", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to join a match." });
    return;
  }

  const parsed = JoinRoomBody.safeParse(req.body);
  if (!parsed.success || !STAKES_NAIRA.includes(parsed.data.stakeNaira as 500 | 1000 | 2000)) {
    res.status(400).json({ error: "Choose a ₦500, ₦1,000 or ₦2,000 sandbox match." });
    return;
  }

  const stakeKobo = parsed.data.stakeNaira * 100;
  let joinedRoomId = "";

  try {
    await db.transaction(async (tx) => {
      // Serialize this stake's queue check so simultaneous arrivals pair,
      // rather than both reserving separate waiting rooms.
      await tx.execute(sql`select pg_advisory_xact_lock(1280656463, ${stakeKobo})`);
      const [lockedUser] = await tx
        .select({ balanceKobo: usersTable.balanceKobo })
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .for("update")
        .limit(1);
      const [existingRoom] = await tx.select({ id: roomsTable.id }).from(roomsTable).where(and(
        inArray(roomsTable.status, ["waiting", "active"]),
        or(eq(roomsTable.hostUserId, user.id), eq(roomsTable.opponentUserId, user.id)),
      )).limit(1);
      if (existingRoom) { joinedRoomId = existingRoom.id; return; }
      if (!lockedUser || lockedUser.balanceKobo < stakeKobo) {
        throw new GameActionError(400, "Your available sandbox balance is too low for this stake.");
      }

      const [openRoom] = await tx
        .select()
        .from(roomsTable)
        .where(
          and(
            eq(roomsTable.status, "waiting"),
            eq(roomsTable.stakeKobo, stakeKobo),
            ne(roomsTable.hostUserId, user.id),
            ...(parsed.data.roomId ? [eq(roomsTable.id, parsed.data.roomId)] : []),
          ),
        )
        .orderBy(asc(roomsTable.createdAt))
        .for("update", { skipLocked: true })
        .limit(1);
      if (parsed.data.roomId && !openRoom) throw new GameActionError(400, "That waiting table is no longer available.");

      await tx
        .update(usersTable)
        .set({ balanceKobo: lockedUser.balanceKobo - stakeKobo })
        .where(eq(usersTable.id, user.id));

      if (openRoom) {
        const board = startBoard(openRoom.hostUserId);
        board.turnUserId = openRoom.hostUserId;
        board.turnDeadlineAt = deadline();
        board.matchDeadlineAt = matchDeadline();
        await tx
          .update(roomsTable)
          .set({
            opponentUserId: user.id,
            status: "active",
            board,
            updatedAt: new Date(),
          })
          .where(eq(roomsTable.id, openRoom.id));
        joinedRoomId = openRoom.id;
      } else {
        const [room] = await tx
          .insert(roomsTable)
          .values({
            stakeKobo,
            hostUserId: user.id,
            board: startBoard(user.id),
          })
          .returning({ id: roomsTable.id });
        joinedRoomId = room.id;
      }

      await tx.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "stake_lock",
        amountKobo: -stakeKobo,
        description: `Sandbox stake reserved — room ${joinedRoomId.slice(0, 8)}`,
        roomId: joinedRoomId,
      });
    });

    publishRoomUpdate(joinedRoomId);
    const room = await getRoomForViewer(joinedRoomId, user.id);
    if (!room) {
      res.status(500).json({ error: "The match was created but could not be loaded." });
      return;
    }
    res.status(201).json(JoinRoomResponse.parse(room));
  } catch (error) {
    sendGameError(req, res, error, "Unable to reserve stake and join match");
  }
});

router.get("/rooms/:roomId", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to view this match." });
    return;
  }
  const params = GetRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid match id." });
    return;
  }

  const room = await getRoomForViewer(params.data.roomId, user.id);
  if (!room) {
    res.status(404).json({ error: "Match not found." });
    return;
  }
  res.json(room);
});

router.post("/rooms/:roomId/roll", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to play." });
    return;
  }
  const params = RollDiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid match id." });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      let room = await loadLockedRoom(tx, params.data.roomId, user.id);
      if (room.status !== "active") {
        throw new GameActionError(400, "This match is not active.");
      }
      room = (await resolveMatchClock(tx, room)).room;
      if (room.status === "completed") return;
      if (turnExpired(room.board)) throw new GameActionError(400, "Your turn timer expired. Refresh the board.");
      if (room.board.turnUserId !== user.id) {
        throw new GameActionError(400, "Wait for your turn to roll.");
      }
      if (room.board.hasRolled) {
        throw new GameActionError(400, "Move one of your tokens before rolling again.");
      }

      const dice: [number, number] = [randomInt(1, 7), randomInt(1, 7)];
      const color = currentPlayerColor(room, user.id);
      if (!color) throw new GameActionError(404, "Match not found.");
      const board = applyRoll(room.board, color, dice, nextPlayerId(room, user.id), deadline());

      await tx
        .update(roomsTable)
        .set({ board, updatedAt: new Date() })
        .where(eq(roomsTable.id, room.id));
    });

    publishRoomUpdate(params.data.roomId);
    const room = await getRoomForViewer(params.data.roomId, user.id);
    if (!room) {
      res.status(404).json({ error: "Match not found." });
      return;
    }
    res.json(RollDiceResponse.parse(room));
  } catch (error) {
    sendGameError(req, res, error, "Unable to roll die");
  }
});

router.post("/rooms/:roomId/move", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to play." });
    return;
  }
  const params = MoveTokenParams.safeParse(req.params);
  const body = MoveTokenBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Choose one of your four tokens." });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      let room = await loadLockedRoom(tx, params.data.roomId, user.id);
      if (room.status !== "active" || !room.opponentUserId) {
        throw new GameActionError(400, "This match is not active.");
      }
      room = (await resolveMatchClock(tx, room)).room;
      if (room.status === "completed") return;
      if (turnExpired(room.board)) throw new GameActionError(400, "Your turn timer expired. Refresh the board.");
      if (room.board.turnUserId !== user.id) {
        throw new GameActionError(400, "Wait for your turn.");
      }
      if (!room.board.hasRolled || room.board.dice === null) {
        throw new GameActionError(400, "Roll the die before moving a token.");
      }

      const color = currentPlayerColor(room, user.id);
      if (!color) throw new GameActionError(404, "Match not found.");
      const ownTokens = [...tokensFor(room.board, color)];
      const selected = body.data.tokenIndex;
      const indices: number[] = body.data.diceIndices;
      if (new Set(indices).size !== indices.length || indices.some(index => !room.board.remainingDice.includes(index))) {
        throw new GameActionError(400, "Choose only unused dice from this roll.");
      }
      const values = indices.map(index => room.board.dice![index]);
      const position = ownTokens[selected];
      const destination = position === undefined ? null : moveDestination(position, values, room.board.dice);
      if (destination === null) {
        throw new GameActionError(400, "That token cannot move with this roll.");
      }

      const nextPosition = destination;
      ownTokens[selected] = nextPosition;
      let board: LudoBoardState = {
        ...room.board,
        redTokens: color === "red" ? ownTokens : room.board.redTokens,
        greenTokens: color === "green" ? ownTokens : room.board.greenTokens,
        remainingDice: room.board.remainingDice.filter(index => !indices.includes(index)),
      };

      board = applyCaptureBonus(board, color, selected);
      const won = tokensFor(board, color).every((tokenPosition) => tokenPosition >= 57);
      const overtimeLeader = board.isOvertime ? leadingColor(board) : null;
      if (won || overtimeLeader) {
        const winner = overtimeLeader ? overtimeLeader === "red" ? room.hostUserId : room.opponentUserId! : user.id;
        await completeMatch(tx, room, board, winner, board.isOvertime ? "overtime" : "all_home");
        return;
      }

      if (!hasLegalMove(board, color)) {
        board = finishRoll(board, nextPlayerId(room, user.id), deadline(), board.remainingDice.length > 0);
      }
      await tx
        .update(roomsTable)
        .set({ board, updatedAt: new Date() })
        .where(eq(roomsTable.id, room.id));
    });

    publishRoomUpdate(params.data.roomId);
    const room = await getRoomForViewer(params.data.roomId, user.id);
    if (!room) {
      res.status(404).json({ error: "Match not found." });
      return;
    }
    res.json(MoveTokenResponse.parse(room));
  } catch (error) {
    sendGameError(req, res, error, "Unable to move token");
  }
});

router.post("/rooms/:roomId/cancel", async (req, res): Promise<void> => {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to cancel a match." });
    return;
  }
  const params = CancelRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid match id." });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      const room = await loadLockedRoom(tx, params.data.roomId, user.id);
      if (room.status !== "waiting" || room.hostUserId !== user.id) {
        throw new GameActionError(400, "Only the owner can cancel a waiting room.");
      }

      await tx
        .update(roomsTable)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(roomsTable.id, room.id));
      await tx
        .update(usersTable)
        .set({ balanceKobo: sql`${usersTable.balanceKobo} + ${room.stakeKobo}` })
        .where(eq(usersTable.id, user.id));
      await tx.insert(walletTransactionsTable).values({
        userId: user.id,
        type: "stake_release",
        amountKobo: room.stakeKobo,
        description: `Sandbox stake returned — room ${room.id.slice(0, 8)}`,
        roomId: room.id,
      });
    });

    publishRoomUpdate(params.data.roomId);
    const room = await getRoomForViewer(params.data.roomId, user.id);
    if (!room) {
      res.status(404).json({ error: "Match not found." });
      return;
    }
    res.json(CancelRoomResponse.parse(room));
  } catch (error) {
    sendGameError(req, res, error, "Unable to cancel waiting room");
  }
});

export default router;