import type { Server } from "node:http";
import type { Request } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, roomsTable, footballRoomsTable } from "@workspace/db";
import { WebSocketServer, WebSocket } from "ws";
import { getAuthenticatedUser } from "./ludo-auth";
import { roomEvents } from "./ludo-events";
import { logger } from "./logger";
import { z } from "zod/v4";
import { footballEvents, footballInput, footballRoomView, stopFootballInput } from "./football-manager";

const FootballInputPacket = z.object({
  type: z.literal("football.input"), roomId: z.uuid(), seq: z.number().int().min(0),
  moveX: z.number().finite().min(-1).max(1), moveY: z.number().finite().min(-1).max(1),
  action: z.enum(["pass", "shoot", "tackle", "switch"]).optional(),
}).strict();

export function installRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const subscriptions = new Map<WebSocket, { userId: string; roomId: string | null; footballId: string | null; seq: number; windowAt: number; packets: number; alive: boolean }>();

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.split("?")[0] !== "/api/ws") { socket.destroy(); return; }
    let originHost = "";
    try { originHost = new URL(req.headers.origin ?? "").host; } catch { /* reject below */ }
    const allowed = [req.headers.host, req.headers["x-forwarded-host"], process.env.REPLIT_DEV_DOMAIN,
      ...(process.env.REPLIT_DOMAINS?.split(",") ?? [])].filter(Boolean);
    if (!originHost || !allowed.includes(originHost)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return;
    }
    void getAuthenticatedUser(req as Request).then(user => {
      if (!user) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => {
        subscriptions.set(ws, { userId: user.id, roomId: null, footballId: null, seq: -1, windowAt: Date.now(), packets: 0, alive: true });
        wss.emit("connection", ws);
      });
    }).catch(err => { logger.error({ err }, "WebSocket authentication failed"); socket.destroy(); });
  });

  wss.on("connection", ws => {
    ws.send(JSON.stringify({ type: "connected" }));
    ws.on("pong", () => { const sub = subscriptions.get(ws); if (sub) sub.alive = true; });
    ws.on("error", () => { ws.terminate(); });
    ws.on("close", () => {
      const sub = subscriptions.get(ws);
      if (sub?.footballId) stopFootballInput(sub.footballId, sub.userId);
      subscriptions.delete(ws);
    });
    ws.on("message", raw => {
      void (async () => {
        const sub = subscriptions.get(ws);
        if (!sub) return;
        let message: unknown;
        try { message = JSON.parse(raw.toString()); } catch { ws.close(1008, "Invalid message"); return; }
        if (message && typeof message === "object" && "type" in message && message.type === "football.input") {
          const packet = FootballInputPacket.safeParse(message);
          if (!packet.success || packet.data.roomId !== sub.footballId) {
            ws.send(JSON.stringify({ type: "football.error", message: "Invalid controls or match subscription." })); return;
          }
          const now = Date.now();
          if (now - sub.windowAt >= 1000) { sub.windowAt = now; sub.packets = 0; }
          if (++sub.packets > 35 || packet.data.seq <= sub.seq) return;
          sub.seq = packet.data.seq;
          footballInput(sub.footballId!, sub.userId, packet.data);
          return;
        }
        if (message && typeof message === "object" && "type" in message && message.type === "football.subscribe" &&
          "roomId" in message && typeof message.roomId === "string" && z.uuid().safeParse(message.roomId).success) {
          const [room] = await db.select().from(footballRoomsTable).where(and(eq(footballRoomsTable.id, message.roomId),
            or(eq(footballRoomsTable.hostUserId, sub.userId), eq(footballRoomsTable.opponentUserId, sub.userId)))).limit(1);
          if (!room) { ws.close(1008, "Not a football participant"); return; }
          if (sub.footballId && sub.footballId !== room.id) stopFootballInput(sub.footballId, sub.userId);
          sub.footballId = room.id; sub.roomId = null; sub.seq = -1;
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "football.snapshot", room: await footballRoomView(room, sub.userId) }));
          return;
        }
        if (!message || typeof message !== "object" || !("type" in message) || message.type !== "subscribe" ||
          !("roomId" in message) || typeof message.roomId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(message.roomId)) { ws.close(1008, "Invalid subscription"); return; }
        const [room] = await db.select({ id: roomsTable.id }).from(roomsTable).where(and(
          eq(roomsTable.id, message.roomId),
          or(
            eq(roomsTable.hostUserId, sub.userId),
            eq(roomsTable.opponentUserId, sub.userId),
            eq(roomsTable.thirdUserId, sub.userId),
            eq(roomsTable.fourthUserId, sub.userId),
          ),
        )).limit(1);
        if (!room) { ws.close(1008, "Match not found"); return; }
        sub.roomId = room.id;
        if (sub.footballId) stopFootballInput(sub.footballId, sub.userId);
        sub.footballId = null;
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "room.updated", roomId: room.id }));
      })().catch(err => { logger.error({ err }, "WebSocket subscription failed"); ws.close(1011, "Subscription failed"); });
    });
  });
  const broadcast = (roomId: string) => {
    for (const [ws, sub] of subscriptions) {
      if (sub.roomId === roomId && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "room.updated", roomId }));
    }
  };
  roomEvents.on("updated", broadcast);
  const footballBroadcast = (room: Awaited<ReturnType<typeof footballRoomView>>) => {
    for (const [ws, sub] of subscriptions) {
      if (sub.footballId === room.id && ws.readyState === WebSocket.OPEN) {
        // Drop slow sockets instead of building an unbounded snapshot queue.
        if (ws.bufferedAmount > 100_000) { ws.terminate(); continue; }
        ws.send(JSON.stringify({ type: "football.snapshot", room: { ...room,
          viewerTeam: sub.userId === room.hostUserId ? "home" : "away" } }));
      }
    }
  };
  footballEvents.on("snapshot", footballBroadcast);
  const heartbeat = setInterval(() => {
    for (const [ws, sub] of subscriptions) {
      if (!sub.alive) { ws.terminate(); continue; }
      sub.alive = false; ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  server.on("close", () => { clearInterval(heartbeat); roomEvents.off("updated", broadcast); footballEvents.off("snapshot", footballBroadcast); wss.close(); });
  return wss;
}
