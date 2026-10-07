import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, ArrowRight, BadgeCheck, Clock3, ShieldCheck } from 'lucide-react';
import {
  getGetCurrentUserQueryKey, getGetLobbyQueryKey, getGetRoomQueryKey, getGetWalletQueryKey,
  useCancelRoom, useGetCurrentUser, useGetRoom, useMoveToken, useRollDice,
} from '@workspace/api-client-react';
import type { Room } from '@workspace/api-client-react';
import { queryClient } from '@/lib/query-client';
import { AuthFrame, InlineError, LoadingBlock, Shell, money } from '@/components/common';
import { useRealtime } from '@/hooks/use-realtime';

const pathCells: [number, number][] = [
  [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
];
type Color = 'red' | 'green';
const OFFSET: Record<Color, number> = { red: 0, green: 26 };
const BASE: Record<Color, [number, number][]> = { red: [[1,1],[1,4],[4,1],[4,4]], green: [[10,10],[10,13],[13,10],[13,13]] };
const RECTS = [{ cls: 'home-red', r: 0, c: 0, color: 'red' }, { cls: 'home-yellow', r: 0, c: 9 }, { cls: 'home-green', r: 9, c: 9, color: 'green' }, { cls: 'home-blue', r: 9, c: 0 }];

export function cellFor(color: Color, position: number, index: number): [number, number] {
  if (position < 0) return BASE[color][index];
  if (position <= 51) return pathCells[(position + OFFSET[color]) % 52];
  if (position <= 56) return color === 'red' ? [7, 1 + (position - 52)] : [7, 13 - (position - 52)];
  return [7, 7];
}
export const canMoveToken = (position: number, die: number | null) => die !== null && (position === -1 ? die === 6 : position >= 0 && position < 57 && position + die <= 57);

function useCountdown(deadline: string | null | undefined, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!deadline || !active) return; setNow(Date.now()); const t = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(t); }, [deadline, active]);
  if (!deadline || !active) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}

function LudoBoard({ room, canMove, onMove }: { room: Room; canMove: boolean; onMove: (index: number) => void }) {
  const trackSet = new Map<string, number>(); pathCells.forEach(([r, c], i) => trackSet.set(`${r}-${c}`, i));
  const laneCells = new Map<string, Color>();
  for (let i = 1; i <= 5; i++) { laneCells.set(`7-${i}`, 'red'); laneCells.set(`7-${14 - i}`, 'green'); }
  const tokens = (['red', 'green'] as Color[]).flatMap(color => (color === 'red' ? room.board.redTokens : room.board.greenTokens).map((position, index) => ({ color, position, index, at: cellFor(color, position, index) })));
  const die = room.board.dice;
  const safe = [[6,1],[2,6],[1,8],[6,12],[8,13],[12,8],[13,6],[8,2]];
  return <div className="board-frame">
    <div className="board-grid" role="img" aria-label="Ludo match board, red and green player tokens">
      {Array.from({ length: 225 }, (_, i) => {
        const r = Math.floor(i / 15), c = i % 15, key = `${r}-${c}`;
        const home = RECTS.find(h => r >= h.r && r < h.r + 6 && c >= h.c && c < h.c + 6);
        const lane = laneCells.get(key);
        const isCenter = r >= 6 && r <= 8 && c >= 6 && c <= 8;
        const here = tokens.filter(t => t.at[0] === r && t.at[1] === c);
        return <div key={i} className={`board-cell ${home?.cls || ''} ${trackSet.has(key) ? 'track-cell' : ''} ${lane ? `lane-${lane}` : ''} ${safe.some(([a, b]) => a === r && b === c) ? 'safe-cell' : ''} ${isCenter ? 'center-cell' : ''}`}>
          {home && r === home.r + 2 && c === home.c + 2 && <span className={`home-center ${home.cls}`} />}
          {r === 7 && c === 7 && <span className="center-star">✦</span>}
          {here.map(t => { const mine = t.color === room.myColor; const legal = canMove && mine && canMoveToken(t.position, die);
            return <button key={`${t.color}-${t.index}`} aria-label={`${t.color} token ${t.index + 1}`} disabled={!legal} onClick={() => onMove(t.index)} className={`board-token ${t.color} ${legal ? 'token-ready' : ''}`} style={t.position === 57 ? { transform: `translate(${(t.index - 1.5) * 5}px, ${(t.color === 'red' ? -4 : 4)}px)` } : undefined} data-testid={`button-token-${t.color}-${t.index}`} />; })}
        </div>;
      })}
    </div>
    <div className="board-legend"><span><i className="legend-dot red" /> RED SEAT</span><span><i className="legend-dot green" /> GREEN SEAT</span><span><i className="legend-safe" /> SAFE SQUARE</span></div>
  </div>;
}

export default function GamePage() {
  const { roomId = '' } = useParams<{ roomId: string }>();
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const user = current.data?.user;
  const conn = useRealtime(!!user, roomId);
  const roomQuery = useGetRoom(roomId, { query: { queryKey: getGetRoomQueryKey(roomId), refetchInterval: 10000, enabled: !!roomId && !!user } });
  const room = roomQuery.data;
  const roll = useRollDice(); const move = useMoveToken(); const cancel = useCancelRoom();
  const [actionError, setActionError] = useState('');
  const isActive = room?.status === 'active';
  const seconds = useCountdown(room?.board.turnDeadlineAt, !!isActive);
  const patch = (next: Room) => {
    queryClient.setQueryData(getGetRoomQueryKey(roomId), next);
    void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
  };
  const fail = () => { setActionError('That move could not be completed. The board is refreshing.'); void queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) }); };
  if (!user && current.isLoading) return <Shell><div className="page-content"><LoadingBlock label="Checking player seat" /></div></Shell>;
  if (!user) return <AuthFrame mode="login" heading="Your seat is reserved." copy="Sign in to return to this match."><Link className="primary-btn full" href="/login" data-testid="link-game-login">Sign in <ArrowRight size={17} /></Link></AuthFrame>;
  if (roomQuery.isLoading) return <Shell user={user}><div className="page-content"><LoadingBlock label="Setting the board" /></div></Shell>;
  if (roomQuery.isError || !room) return <Shell user={user}><div className="page-content"><div className="room-error"><div className="section-overline">TABLE NOT FOUND</div><h1>This board went quiet.</h1><p>It may have closed, or the link is out of date.</p><div className="wd-actions"><button className="quiet-btn" onClick={() => void roomQuery.refetch()} data-testid="button-retry-room">Retry</button><button className="primary-btn" onClick={() => setLocation('/')} data-testid="button-back-lobby">Back to lobby <ArrowRight size={16} /></button></div></div></div></Shell>;
  const isHost = room.hostUserId === user.id;
  const opponent = isHost ? room.opponentUsername : room.hostUsername;
  const theirColor: Color = room.myColor === 'red' ? 'green' : 'red';
  const isMyTurn = room.board.turnUserId === user.id;
  const isWaiting = room.status === 'waiting';
  const isDone = room.status === 'completed' || room.status === 'cancelled';
  const mine = room.myColor === 'red' ? room.board.redTokens : room.board.greenTokens;
  const die = room.board.dice;
  const canMove = isActive && isMyTurn && room.board.hasRolled;
  const anyLegal = mine.some(p => canMoveToken(p, die));
  const connLabel = conn === 'live' ? 'LIVE' : conn === 'connecting' ? 'CONNECTING' : 'RECONNECTING · POLLING 10s';
  return <Shell user={user}>
    <div className="game-page page-in">
      <div className="game-nav"><button className="back-link" onClick={() => setLocation('/')} data-testid="button-return-lobby"><ArrowLeft size={16} /> Lobby</button><div className="match-code">ROOM <b>{room.id.slice(0, 8).toUpperCase()}</b></div><span className={`sandbox-pill conn-${conn}`} data-testid="status-connection"><span className="pulse-dot" /> {connLabel}</span></div>
      <div className="game-title-row"><div><div className="section-overline">TWO-PLAYER MATCH · {room.status.toUpperCase()}</div><h1>Make your <em>move.</em></h1></div>
        <div className="stake-reserved"><span><span className="pulse-dot" /> STAKE EACH</span><b>{money(room.stakeNaira)}</b><small>Sandbox funds only</small></div></div>
      <div className="match-layout">
        <section className="board-column">
          <div className="player-strip">
            <div className={`player-chip ${isActive && isMyTurn ? 'turn-active' : ''}`}><span className={`player-avatar ${room.myColor}`}>{user.username.slice(0, 1).toUpperCase()}</span><div><b>{user.username} <small>YOU</small></b><span>{room.myColor.toUpperCase()} SEAT</span></div>{isActive && isMyTurn && <span className="turn-marker">YOUR TURN</span>}</div>
            <div className="versus-mark">VS</div>
            <div className={`player-chip opponent ${isActive && !isMyTurn ? 'turn-active' : ''}`}><span className={`player-avatar ${theirColor}`}>{opponent?.slice(0, 1).toUpperCase() || '·'}</span><div><b>{opponent || 'Waiting for player'}</b><span>{theirColor.toUpperCase()} SEAT</span></div>{isActive && !isMyTurn && <span className="turn-marker">THEIR TURN</span>}</div>
          </div>
          {isActive && seconds !== null && <div className={`turn-timer ${seconds <= 8 ? 'urgent' : ''}`} data-testid="text-turn-countdown"><span>{isMyTurn ? 'YOUR CLOCK' : 'THEIR CLOCK'}</span><b>{seconds}s</b><i style={{ transform: `scaleX(${Math.min(1, seconds / 30)})` }} /></div>}
          <LudoBoard room={room} canMove={canMove} onMove={index => { setActionError(''); move.mutate({ roomId, data: { tokenIndex: index } }, { onSuccess: patch, onError: fail }); }} />
          {actionError && <InlineError>{actionError}</InlineError>}
          <div className="game-controls">
            <div className="dice-area"><div className={`dice-face ${die ? 'die-roll' : ''}`} data-testid="text-dice-value">{die || <span className="dice-dots">···</span>}</div><span className="dice-caption">{die ? 'LAST ROLL' : 'DIE'}</span></div>
            <div className="control-copy"><b>{isDone ? (room.board.winnerUserId === user.id ? 'You took the table.' : 'Match complete.') : isWaiting ? 'Waiting for a challenger.' : isMyTurn ? (room.board.hasRolled ? (anyLegal ? 'Choose a lit token.' : 'No legal move. Waiting on the server.') : 'Your turn. Roll the die.') : 'Opponent is thinking.'}</b><span>{isWaiting ? 'Your stake stays reserved while the room waits.' : 'The server keeps a 30 second turn clock.'}</span></div>
            <button className={`roll-btn ${isActive && isMyTurn && !room.board.hasRolled ? 'roll-ready' : ''}`} disabled={!isActive || !isMyTurn || room.board.hasRolled || roll.isPending} onClick={() => { setActionError(''); roll.mutate({ roomId }, { onSuccess: patch, onError: fail }); }} data-testid="button-roll-dice">{roll.isPending ? 'Rolling…' : 'Roll die'} <ArrowRight size={16} /></button>
          </div>
          {isWaiting && isHost && <div className="waiting-controls"><div><span className="pulse-dot" /> ROOM OPEN · SHARE THE STAKE WITH A FRIEND</div><button className="quiet-btn" disabled={cancel.isPending} onClick={() => cancel.mutate({ roomId }, { onSuccess: next => { patch(next); setLocation('/'); }, onError: () => setActionError('Could not cancel this room. Try again.') })} data-testid="button-cancel-room">{cancel.isPending ? 'Closing table…' : 'Cancel table'}</button></div>}
          {isWaiting && !isHost && <div className="waiting-banner"><Clock3 size={17} /> Waiting for the match to start.</div>}
          {isDone && <div className="completed-banner"><BadgeCheck size={18} /> Match closed. Settlement shows in your wallet.</div>}
        </section>
        <aside className="match-sidebar">
          <div className="sidebar-card match-status-card"><div className="section-overline">PRIZE SPLIT</div><h3>{isWaiting ? 'Seat open.' : isDone ? 'Match finished.' : 'In play.'}</h3>
            <div className="status-line"><span>Stake each</span><b>{money(room.stakeNaira)}</b></div>
            <div className="status-line"><span>Pot</span><b data-testid="text-pot">{money(room.potNaira)}</b></div>
            <div className="status-line"><span>Winner prize (90%)</span><b data-testid="text-prize">{money(room.prizeNaira)}</b></div>
            <div className="status-line"><span>Commission (10%)</span><b data-testid="text-commission">{money(room.commissionNaira)}</b></div>
            <div className="status-foot"><ShieldCheck size={14} /> TEST BALANCES ONLY</div></div>
          <div className="sidebar-card how-card"><div className="section-overline">RULES</div><h3>Play it smart.</h3><ol><li><span>01</span>A six brings a token out of base.</li><li><span>02</span>Finish needs an exact count to 57.</li><li><span>03</span>Miss the 30 second clock and the server moves on.</li></ol></div>
        </aside>
      </div>
    </div>
  </Shell>;
}
