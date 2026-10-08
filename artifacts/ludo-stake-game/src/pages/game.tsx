import { useEffect, useMemo, useState } from 'react';
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
import { DiceFace, LudoBoard, cellFor, canMoveToken, destination } from '@/components/ludo-board';
import type { Color } from '@/components/ludo-board';
import '@/game-board.css';
import { MatchClock } from '@/components/match-clock';

export { cellFor, canMoveToken };


function useCountdown(deadline: string | null | undefined, active: boolean, serverTimeAt?: string) {
  const [now, setNow] = useState(() => Date.now());
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!deadline || !active) return;
    const sampledNow = Date.now();
    setOffset(serverTimeAt ? Date.parse(serverTimeAt) - sampledNow : 0);
    setNow(sampledNow);
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [deadline, active, serverTimeAt]);
  if (!deadline || !active) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now - offset) / 1000));
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
  const seconds = useCountdown(room?.board.turnDeadlineAt, !!isActive, room?.serverTimeAt);
  const matchSeconds = useCountdown(room?.board.matchDeadlineAt, !!isActive, room?.serverTimeAt);
  const patch = (next: Room) => {
    queryClient.setQueryData(getGetRoomQueryKey(roomId), next);
    void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
  };
  const fail = () => { setActionError('That move could not be completed. The board is refreshing.'); void queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) }); };
  type Pick = 'd0' | 'd1' | 'both';
  const [pick, setPick] = useState<Pick | null>(null);
  const remKey = room ? `${room.board.dice?.join(',')}|${room.board.remainingDice.join(',')}` : '';
  useEffect(() => { setPick(null); }, [remKey]);
  const remaining = useMemo(() => room?.board.remainingDice ?? [], [room?.board.remainingDice]);
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
  const dice = room.board.dice;
  const clockAllowsPlay = !!isActive && (room.board.isOvertime || matchSeconds !== 0) && seconds !== 0;
  const canMove = clockAllowsPlay && !move.isPending && isMyTurn && room.board.hasRolled && !!dice && remaining.length > 0;
  const defaultPick: Pick | null = remaining.length === 2 ? 'both' : remaining.length === 1 ? (remaining[0] === 0 ? 'd0' : 'd1') : null;
  const valid = (p: Pick | null) => p === 'both' ? remaining.length === 2 : p === 'd0' ? remaining.includes(0) : p === 'd1' ? remaining.includes(1) : false;
  const sel: Pick | null = valid(pick) ? pick : defaultPick;
  const indicesFor = (p: Pick | null): (0 | 1)[] => p === 'both' ? [0, 1] : p === 'd0' ? [0] : p === 'd1' ? [1] : [];
  const valuesFor = (p: Pick | null) => dice ? indicesFor(p).map(i => dice[i]) : [];
  const legalFor = (p: Pick | null) => new Set(canMove ? mine.map((pos, i) => (destination(pos, valuesFor(p)) !== null ? i : -1)).filter(i => i >= 0) : []);
  const legalTokens = legalFor(sel);
  const anyLegal = (['d0', 'd1', 'both'] as Pick[]).some(p => valid(p) && legalFor(p).size > 0);
  const dieAvail = (i: number) => remaining.includes(i as 0 | 1);
  const msg = room.board.turnMessage;
  const notice = msg === 'third_double' ? 'Third double in a row. The turn is forfeited before any movement.' : msg === 'double_bonus' ? 'Double rolled. Roll again after your dice are used.' : msg === 'no_moves' ? 'No legal move for that roll. Turn passed.' : msg === 'timeout' ? 'The turn clock ran out. Turn passed.' : '';
  const onMove = (index: number) => { if (!sel) return; setActionError(''); move.mutate({ roomId, data: { tokenIndex: index, diceIndices: indicesFor(sel) } }, { onSuccess: patch, onError: fail }); };
  const optBtn = (p: Pick, label: string, faces: number[], sum?: number) => <button key={p} type="button" className={`lb-opt ${sel === p ? 'active' : ''}`} disabled={!canMove || !valid(p)} aria-pressed={sel === p} onClick={() => setPick(p)} data-testid={p === 'both' ? 'button-dice-combine' : `button-die-${p === 'd0' ? 0 : 1}`}>
    {faces.map((v, k) => <DiceFace key={k} value={v} used={false} />)}<span>{label}{sum !== undefined && <span className="sum"> {sum}</span>}<small>{!valid(p) ? 'USED' : sel === p ? 'SELECTED' : 'AVAILABLE'}</small></span></button>;
  const connLabel = conn === 'live' ? 'LIVE' : conn === 'connecting' ? 'CONNECTING' : 'RECONNECTING · POLLING 10s';
  return <Shell user={user}>
    <div className="game-page page-in">
      <div className="game-nav"><button className="back-link" onClick={() => setLocation('/')} data-testid="button-return-lobby"><ArrowLeft size={16} /> Lobby</button><div className="match-code">ROOM <b>{room.id.slice(0, 8).toUpperCase()}</b></div><span className={`sandbox-pill conn-${conn}`} data-testid="status-connection"><span className="pulse-dot" /> {connLabel}</span></div>
      <div className="game-title-row"><div><div className="section-overline">TWO-PLAYER MATCH · {room.status.toUpperCase()}</div><h1>Make your <em>move.</em></h1></div>
        <div className="stake-reserved"><span><span className="pulse-dot" /> STAKE EACH</span><b>{money(room.stakeNaira)}</b><small>Sandbox funds only</small></div></div>
      <MatchClock room={room} seconds={matchSeconds} />
      <div className="match-layout">
        <section className="board-column">
          <div className="player-strip">
            <div className={`player-chip ${isActive && isMyTurn ? 'turn-active' : ''}`}><span className={`player-avatar ${room.myColor}`}>{user.username.slice(0, 1).toUpperCase()}</span><div><b>{user.username} <small>YOU</small></b><span>{room.myColor.toUpperCase()} SEAT</span></div>{isActive && isMyTurn && <span className="turn-marker">YOUR TURN</span>}</div>
            <div className="versus-mark">VS</div>
            <div className={`player-chip opponent ${isActive && !isMyTurn ? 'turn-active' : ''}`}><span className={`player-avatar ${theirColor}`}>{opponent?.slice(0, 1).toUpperCase() || '·'}</span><div><b>{opponent || 'Waiting for player'}</b><span>{theirColor.toUpperCase()} SEAT</span></div>{isActive && !isMyTurn && <span className="turn-marker">THEIR TURN</span>}</div>
          </div>
          {isActive && seconds !== null && <div className={`turn-timer ${seconds <= 8 ? 'urgent' : ''}`} data-testid="text-turn-countdown"><span>{isMyTurn ? 'YOUR CLOCK' : 'THEIR CLOCK'}</span><b>{seconds}s</b><i style={{ transform: `scaleX(${Math.min(1, seconds / 30)})` }} /></div>}
          <LudoBoard room={room} legalTokens={legalTokens} selecting={canMove && legalTokens.size > 0} onMove={onMove} />
          {actionError && <InlineError>{actionError}</InlineError>}
          <div className="game-controls">
            <div className="lb-dice-panel" data-testid="panel-dice">
            <p className={`lb-turn ${isMyTurn ? '' : 'wait'}`}>{isDone ? (room.board.winnerUserId === user.id ? 'You took the table.' : 'Match complete.') : isWaiting ? 'Waiting for a challenger.' : isMyTurn ? (room.board.hasRolled ? (anyLegal ? 'Pick a die, or both as a sum, then tap a glowing cap.' : 'No legal move. Waiting on the server.') : 'Your turn. Roll both dice.') : `Waiting on ${opponent || 'opponent'} to play.`}</p>
            <div className="lb-dice-row">
              {[0, 1].map(i => <span key={i} className="lb-opt" style={{ cursor: 'default' }} data-testid={`text-die-${i}`}><DiceFace value={dice ? dice[i] : null} used={!!dice && !dieAvail(i)} selected={false} /><span>Die {i + 1}: <b data-testid={`text-dice-value-${i}`}>{dice ? dice[i] : '-'}</b><small>{!dice ? 'NOT ROLLED' : dieAvail(i) ? 'AVAILABLE' : 'USED'}</small></span></span>)}
              {dice && <>
                {optBtn('d0', 'Move die 1', [dice[0]])}
                {optBtn('d1', 'Move die 2', [dice[1]])}
                {optBtn('both', 'Both, sum', [dice[0], dice[1]], dice[0] + dice[1])}
              </>}
              <button className={`roll-btn ${clockAllowsPlay && isMyTurn && !room.board.hasRolled ? 'roll-ready' : ''}`} disabled={!clockAllowsPlay || !isMyTurn || room.board.hasRolled || roll.isPending} onClick={() => { setActionError(''); roll.mutate({ roomId }, { onSuccess: patch, onError: fail }); }} data-testid="button-roll-dice">{roll.isPending ? 'Rolling...' : 'Roll dice'} <ArrowRight size={16} /></button>
            </div>
            {isActive && <div className="lb-doubles" data-testid="text-doubles">DOUBLES IN A ROW <b className={room.board.consecutiveDoubles > 0 ? 'on' : ''} /><b className={room.board.consecutiveDoubles > 1 ? 'on' : ''} /> {room.board.consecutiveDoubles}/2</div>}
            {notice && <div className={`lb-notice ${msg === 'third_double' || msg === 'timeout' ? 'bad' : ''}`} role="status" data-testid="text-turn-notice">{notice}</div>}
            <p className="lb-help"><b>Rules.</b> Pick die 1 or die 2 to move one token, or move both as a sum. Leave home only with a 6; that 6 is spent on entry and a second chosen die then moves the token on. A 1 + 5 sum cannot exit. Split dice between two tokens by choosing one die at a time. A double gives a bonus roll once both dice are used; a third double in a row forfeits the turn.</p>
            </div>
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
