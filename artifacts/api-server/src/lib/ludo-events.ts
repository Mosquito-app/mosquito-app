import { EventEmitter } from "node:events";

export const roomEvents = new EventEmitter();
export function publishRoomUpdate(roomId: string) {
  roomEvents.emit("updated", roomId);
}
