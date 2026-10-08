import type { FootballClubId } from './types';

export type Pattern = 'solid' | 'stripes' | 'hoops' | 'halves';
export interface Kit { a: string; b: string; pattern: Pattern; shorts: string; socks: string; num: string }
export interface Club { id: FootballClubId; label: string; home: Kit; away: Kit }

/** Stylized representative colours only. Not licensed club assets; no crests or sponsors. */
export const CLUBS: Club[] = [
  { id: 'man_city', label: 'Man City', home: { a: '#6cabdd', b: '#6cabdd', pattern: 'solid', shorts: '#f4f6f8', socks: '#6cabdd', num: '#f4f6f8' }, away: { a: '#2a1f4d', b: '#c7a64a', pattern: 'solid', shorts: '#2a1f4d', socks: '#2a1f4d', num: '#e7c86a' } },
  { id: 'liverpool', label: 'Liverpool', home: { a: '#c8102e', b: '#c8102e', pattern: 'solid', shorts: '#c8102e', socks: '#c8102e', num: '#f6efe0' }, away: { a: '#e9e3cf', b: '#1b6e68', pattern: 'solid', shorts: '#1b6e68', socks: '#e9e3cf', num: '#1b6e68' } },
  { id: 'man_utd', label: 'Man Utd', home: { a: '#da291c', b: '#da291c', pattern: 'solid', shorts: '#f4f4f4', socks: '#15110f', num: '#f6efe0' }, away: { a: '#1b2a4a', b: '#f0c929', pattern: 'solid', shorts: '#1b2a4a', socks: '#1b2a4a', num: '#f0c929' } },
  { id: 'barcelona', label: 'Barcelona', home: { a: '#a50044', b: '#004d98', pattern: 'stripes', shorts: '#14275a', socks: '#a50044', num: '#f2c230' }, away: { a: '#f2c230', b: '#f2c230', pattern: 'solid', shorts: '#14275a', socks: '#f2c230', num: '#14275a' } },
  { id: 'real_madrid', label: 'Real Madrid', home: { a: '#f4f2ea', b: '#f4f2ea', pattern: 'solid', shorts: '#f4f2ea', socks: '#f4f2ea', num: '#3b3a52' }, away: { a: '#4b2a7b', b: '#d1b25a', pattern: 'solid', shorts: '#4b2a7b', socks: '#4b2a7b', num: '#e0c36c' } },
  { id: 'chelsea', label: 'Chelsea', home: { a: '#034694', b: '#034694', pattern: 'solid', shorts: '#034694', socks: '#f4f4f4', num: '#f6efe0' }, away: { a: '#f4d34a', b: '#f4d34a', pattern: 'solid', shorts: '#1a2342', socks: '#f4d34a', num: '#1a2342' } },
];
export const clubById = (id?: string) => CLUBS.find(c => c.id === id) ?? CLUBS[0];
export const clubLabel = (id?: string) => clubById(id).label;

const KEY = 'mosquito.football.club';
export function loadClub(): FootballClubId {
  try { const v = localStorage.getItem(KEY); if (v && CLUBS.some(c => c.id === v)) return v as FootballClubId; } catch { /* ignore */ }
  return 'man_city';
}
export function saveClub(id: FootballClubId) { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }

/** Explicit WebGL2 capability probe, used before allowing a football stake. */
export function hasWebGL2(): boolean {
  try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); return !!gl; } catch { return false; }
}
export const WEBGL_MSG = 'Football Duel needs WebGL2 for its 3D pitch, and this browser or device does not provide it. Update your browser, enable hardware acceleration, or try Chrome, Safari 15+ or Firefox on another device. No stake was taken.';
