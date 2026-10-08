import type { FootballState, FootballPlayer, FootballBall } from '@workspace/api-client-react';

export type FootballClubId = FootballState['homeClub'];
export type AnimKind = FootballPlayer['animation'];
export type XPlayer = FootballPlayer;
export type XBall = FootballBall;
export type XPhase = FootballState['phase'];
export type XState = FootballState;
export const xs = (s: FootballState) => s;
export interface ControlBasis { rightX: number; rightY: number; forwardX: number; forwardY: number }
export type CameraMode = 'follow' | 'tv';
