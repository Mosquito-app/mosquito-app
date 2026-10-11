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
import { colorForUser, getRoomTier, LUDO_COLORS, ROOM_TIERS, roomPlayerIds, userForColor } from "../lib/ludo-room-tiers";

const router: IRouter = Router();

class GameActionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function startBoard(hostUserId: string, maxPlayers: number): LudoBoardState {
  return {
    turnUserId: hostUserId,
    playerOrder: [hostUserId],
    joinWindowOpen: maxPlayers > 2,
    dice: null,
    remainingDice: [],
    consecutiveDoubles: 0,
    turnMessage: null,
    captureBonusPending: false,
    hasRolled: false,
    redTokens: [-1, -1, -1, -1],
    greenTokens: [-1, -1, -1, -1],
    yellowTokens: [-1, -1, -1, -1],
    blueTokens: [-1, -1, -1, -1],
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

  const myColor = colorForUser(room, viewerId);
  if (!myColor) return null;

  const playerIds = roomPlayerIds(room);
  const playerRows = await db
    .select({ id: usersTable.id, username: usersTable.username })
    .from(usersTable)
    .where(inArray(usersTable.id, playerIds));
  const usernameById = new Map(playerRows.map((player) => [player.id, player.username]));
  const players = playerIds.map((userId, index) => ({
    userId, username: usernameById.get(userId) ?? "Player", color: LUDO_COLORS[index],
  }));
  const tier = getRoomTier(room.tierId);
  const poolKobo = room.stakeKobo * playerIds.length;
  const { prizeKobo, commissionKobo } = splitPot(poolKobo);

  return GetRoomResponse.parse({
    id: room.id,
    tierId: room.tierId,
    tierName: tier?.name ?? "Legacy match",
    stakeNaira: Math.floor(room.stakeKobo / 100),
    potNaira: poolKobo / 100,
    prizeNaira: prizeKobo / 100,
    commissionNaira: commissionKobo / 100,
    maxPotNaira: room.stakeKobo * (tier?.maxPlayers ?? 2) / 100,
    maxPlayers: tier?.maxPlayers ?? 2,
    playerCount: playerIds.length,
    players,
    status: room.status as RoomStatus,
    hostUserId: room.hostUserId,
    hostUsername: usernameById.get(room.hostUserId) ?? "Player",
    opponentUserId: room.opponentUserId,
    opponentUsername: room.opponentUserId ? usernameById.get(room.opponentUserId) ?? null : null,
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
  if (!room || !colorForUser(room, viewerId)) {
    throw new GameActionError(404, "Match not found.");
  }
  return { ...room, board: normalizeBoard(room.board) };
}

function currentPlayerColor(room: Parameters<typeof colorForUser>[0], userId: string) {
  return colorForUser(room, userId);
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

  const openRooms = await db
    .select()
    .from(roomsTable)
    .where(inArray(roomsTable.status, ["waiting", "active"]))
    .orderBy(desc(roomsTable.createdAt))
    .limit(100);
  const joinable = openRooms.filter((room) => {
    const tier = getRoomTier(room.tierId);
    return tier
      && !roomPlayerIds(room).includes(user.id)
      && roomPlayerIds(room).length < tier.maxPlayers
      && (room.status === "waiting" || normalizeBoard(room.board).joinWindowOpen);
  }).slice(0, 50);
  const allPlayerIds = [...new Set(joinable.flatMap((room) => roomPlayerIds(room)))];
  const playerRows = allPlayerIds.length
    ? await db.select({ id: usersTable.id, username: usersTable.username }).from(usersTable).where(inArray(usersTable.id, allPlayerIds))
    : [];
  const usernameById = new Map(playerRows.map((player) => [player.id, player.username]));
  const myRoom = await db.select({ id: roomsTable.id }).from(roomsTable).where(and(
    inArray(roomsTable.status, ["waiting", "active"]),
    or(
      eq(roomsTable.hostUserId, user.id),
      eq(roomsTable.opponentUserId, user.id),
      eq(roomsTable.thirdUserId, user.id),
      eq(roomsTable.fourthUserId, user.id),
    ),
  )).limit(1);
  const rooms = joinable.map((room) => {
    const tier = getRoomTier(room.tierId)!;
    const ids = roomPlayerIds(room);
    return {
      id: room.id,
      tierId: tier.id,
      tierName: tier.name,
      stakeNaira: tier.stakeNaira,
      potNaira: room.stakeKobo * ids.length / 100,
      maxPotNaira: room.stakeKobo * tier.maxPlayers / 100,
      playerCount: ids.length,
      maxPlayers: tier.maxPlayers,
      status: room.status as RoomStatus,
      joinWindowOpen: room.status === "waiting" || normalizeBoard(room.board).joinWindowOpen,
      players: ids.map((userId, index) => ({
        userId,
        username: usernameById.get(userId) ?? "Player",
        color: LUDO_COLORS[index],
      })),
      createdAt: room.createdAt,
    };
  });
  const payload = {
    myRoomId: myRoom[0]?.id ?? null,
    rooms,
    tiers: ROOM_TIERS.map((tier) => ({
      id: tier.id,
      name: tier.name,
      stakeNaira: tier.stakeNaira,
      minPlayers: tier.minPlayers,
      maxPlayers: tier.maxPlayers,
      minPotNaira: tier.stakeNaira * tier.minPlayers,
      maxPotNaira: tier.stakeNaira * tier.maxPlayers,
      openRoomCount: joinable.filter((room) => room.tierId === tier.id).length,
    })),
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
  const tier = parsed.success ? getRoomTier(parsed.data.tierId) : undefined;
  if (!parsed.success || !tier) {
    res.status(400).json({ error: "Choose one of the available Mosquito App room tiers." });
    return;
  }

  const stakeKobo = tier.stakeNaira * 100;
  let joinedRoomId = "";

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(1280656463, hashtext(${tier.id}))`);
      const [lockedUser] = await tx
        .select({ balanceKobo: usersTable.balanceKobo })
        .from(usersTable)
        .where(eq(usersTable.id, user.id))
        .for("update")
        .limit(1);
      const [existingRoom] = await tx.select({ id: roomsTable.id }).from(roomsTable).where(and(
        inArray(roomsTable.status, ["waiting", "active"]),
        or(
          eq(roomsTable.hostUserId, user.id),
          eq(roomsTable.opponentUserId, user.id),
          eq(roomsTable.thirdUserId, user.id),
          eq(roomsTable.fourthUserId, user.id),
        ),
      )).limit(1);
      if (existingRoom) { joinedRoomId = existingRoom.id; return; }
      if (!lockedUser || lockedUser.balanceKobo < stakeKobo) {
        throw new GameActionError(400, "Your available sandbox balance is too low for this stake.");
      }

      const eligibleRooms = await tx
        .select()
        .from(roomsTable)
        .where(
          and(
            inArray(roomsTable.status, ["waiting", "active"]),
            eq(roomsTable.tierId, tier.id),
            ...(parsed.data.roomId ? [eq(roomsTable.id, parsed.data.roomId)] : []),
          ),
        )
        .orderBy(asc(roomsTable.createdAt))
        .for("update", { skipLocked: true })
        .limit(50);
      const openRoom = eligibleRooms.find((candidate) => {
        const count = roomPlayerIds(candidate).length;
        return count < tier.maxPlayers
          && (candidate.status === "waiting" || normalizeBoard(candidate.board).joinWindowOpen);
      });
      if (parsed.data.roomId && !openRoom) throw new GameActionError(400, "That waiting table is no longer available.");

      await tx
        .update(usersTable)
        .set({ balanceKobo: lockedUser.balanceKobo - stakeKobo })
        .where(eq(usersTable.id, user.id));

      if (openRoom) {
        const board = normalizeBoard(openRoom.board);
        const playerIds = roomPlayerIds(openRoom);
        const nextSeat = playerIds.length;
        if (nextSeat >= tier.maxPlayers) throw new GameActionError(400, "That room is full.");
        const roomPatch = nextSeat === 1
          ? { opponentUserId: user.id }
          : nextSeat === 2
            ? { thirdUserId: user.id }
            : { fourthUserId: user.id };
        board.playerOrder = [...playerIds, user.id];
        const startsNow = openRoom.status === "waiting" && board.playerOrder.length >= tier.minPlayers;
        if (startsNow) {
          board.turnUserId = openRoom.hostUserId;
          board.turnDeadlineAt = deadline();
          board.matchDeadlineAt = matchDeadline();
          board.joinWindowOpen = tier.maxPlayers > board.playerOrder.length;
        } else if (openRoom.status === "active" && board.joinWindowOpen) {
          board.joinWindowOpen = board.playerOrder.length < tier.maxPlayers;
        }
        await tx
          .update(roomsTable)
          .set({
            ...roomPatch,
            status: startsNow ? "active" : openRoom.status,
            board,
            updatedAt: new Date(),
          })
          .where(eq(roomsTable.id, openRoom.id));
        joinedRoomId = openRoom.id;
      } else {
        const [room] = await tx
          .insert(roomsTable)
          .values({
            tierId: tier.id,
            stakeKobo,
            hostUserId: user.id,
            board: startBoard(user.id, tier.maxPlayers),
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
      const board = applyRoll(
        { ...room.board, joinWindowOpen: false },
        color,
        dice,
        nextPlayerId(room, user.id),
        deadline(),
      );

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
      if (room.status !== "active" || roomPlayerIds(room).length < 2) {
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
        yellowTokens: color === "yellow" ? ownTokens : room.board.yellowTokens,
        blueTokens: color === "blue" ? ownTokens : room.board.blueTokens,
        remainingDice: room.board.remainingDice.filter(index => !indices.includes(index)),
      };

      board = applyCaptureBonus(board, color, selected);
      const won = tokensFor(board, color).every((tokenPosition) => tokenPosition >= 57);
      const participantColors = roomPlayerIds(room)
        .map((playerId) => colorForUser(room, playerId))
        .filter((participantColor): participantColor is NonNullable<typeof participantColor> => participantColor !== null);
      const overtimeLeader = board.isOvertime ? leadingColor(board, participantColors) : null;
      if (won || overtimeLeader) {
        const winner = overtimeLeader ? userForColor(room, overtimeLeader) : user.id;
        if (!winner) throw new GameActionError(500, "Unable to identify the winning player.");
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