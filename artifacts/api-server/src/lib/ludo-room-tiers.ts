export const LUDO_COLORS = ["red", "green", "yellow", "blue"] as const;
export type LudoColor = (typeof LUDO_COLORS)[number];

export const ROOM_TIERS = [
  { id: "oga-chairman", name: "Oga Chairman", stakeNaira: 50_000, minPlayers: 2, maxPlayers: 2 },
  { id: "big-doings", name: "Big Doings", stakeNaira: 25_000, minPlayers: 2, maxPlayers: 2 },
  { id: "senior-man", name: "Senior Man", stakeNaira: 5_000, minPlayers: 2, maxPlayers: 2 },
  { id: "sharp-guy", name: "Sharp Guy", stakeNaira: 2_000, minPlayers: 2, maxPlayers: 2 },
  { id: "quick-clash", name: "Quick Clash", stakeNaira: 1_000, minPlayers: 2, maxPlayers: 2 },
  { id: "street-king", name: "Street King", stakeNaira: 2_000, minPlayers: 2, maxPlayers: 4 },
  { id: "board-master", name: "Board Master", stakeNaira: 1_000, minPlayers: 2, maxPlayers: 4 },
  { id: "area-hustler", name: "Area Hustler", stakeNaira: 500, minPlayers: 2, maxPlayers: 4 },
  { id: "practice-ground", name: "Practice Ground", stakeNaira: 0, minPlayers: 2, maxPlayers: 4 },
] as const;

export type RoomTier = (typeof ROOM_TIERS)[number];

export function getRoomTier(id: string | null | undefined): RoomTier | undefined {
  return ROOM_TIERS.find((tier) => tier.id === id);
}

export function roomPlayerIds(room: {
  hostUserId: string;
  opponentUserId: string | null;
  thirdUserId?: string | null;
  fourthUserId?: string | null;
}): string[] {
  return [room.hostUserId, room.opponentUserId, room.thirdUserId ?? null, room.fourthUserId ?? null]
    .filter((id): id is string => id !== null);
}

export function colorForUser(room: Parameters<typeof roomPlayerIds>[0], userId: string): LudoColor | null {
  const index = roomPlayerIds(room).indexOf(userId);
  return index < 0 ? null : LUDO_COLORS[index] ?? null;
}

export function userForColor(room: Parameters<typeof roomPlayerIds>[0], color: LudoColor): string | null {
  return roomPlayerIds(room)[LUDO_COLORS.indexOf(color)] ?? null;
}
