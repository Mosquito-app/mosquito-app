import type { Server } from "node:http";
import type { Request } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, roomsTable } from "@workspace/db";
import { WebSocketServer, WebSocket } from "ws";
import { getAuthenticatedUser } from "./ludo-auth";
import { roomEvents } from "./ludo-events";
import { logger } from "./logger";

export function installRealtime(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const subscriptions = new Map<WebSocket, { userId: string; roomId: string | null; alive: boolean }>();

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
        subscriptions.set(ws, { userId: user.id, roomId: null, alive: true });
        wss.emit("connection", ws);
      });
    }).catch(err => { logger.error({ err }, "WebSocket authentication failed"); socket.destroy(); });
  });

  wss.on("connection", ws => {
    ws.send(JSON.stringify({ type: "connected" }));
    ws.on("pong", () => { const sub = subscriptions.get(ws); if (sub) sub.alive = true; });
    ws.on("error", () => { ws.terminate(); });
    ws.on("close", () => subscriptions.delete(ws));
    ws.on("message", raw => {
      void (async () => {
        const sub = subscriptions.get(ws);
        if (!sub) return;
        let message: unknown;
        try { message = JSON.parse(raw.toString()); } catch { ws.close(1008, "Invalid message"); return; }
        if (!message || typeof message !== "object" || !("type" in message) || message.type !== "subscribe" ||
          !("roomId" in message) || typeof message.roomId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(message.roomId)) { ws.close(1008, "Invalid subscription"); return; }
        const [room] = await db.select({ id: roomsTable.id }).from(roomsTable).where(and(
          eq(roomsTable.id, message.roomId),
          or(eq(roomsTable.hostUserId, sub.userId), eq(roomsTable.opponentUserId, sub.userId)),
        )).limit(1);
        if (!room) { ws.close(1008, "Match not found"); return; }
        sub.roomId = room.id;
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
  const heartbeat = setInterval(() => {
    for (const [ws, sub] of subscriptions) {
      if (!sub.alive) { ws.terminate(); continue; }
      sub.alive = false; ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  server.on("close", () => { clearInterval(heartbeat); roomEvents.off("updated", broadcast); wss.close(); });
  return wss;
}
