import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowRight, BadgeCheck, Clock3 } from 'lucide-react';
import {
  getGetCurrentUserQueryKey, getGetLobbyQueryKey, getGetRoomQueryKey, getGetWalletQueryKey,
  useCancelRoom, useGetCurrentUser, useGetRoom, useGetWallet, useMoveToken, useRollDice,
} from '@workspace/api-client-react';
import type { Room } from '@workspace/api-client-react';
import { queryClient } from '@/lib/query-client';
import { AuthFrame, LoadingBlock, Shell, money } from '@/components/common';
import { useRealtime } from '@/hooks/use-realtime';
import { cellFor, canMoveToken, destination } from '@/components/ludo-board';
import { ReferenceView } from '@/components/ludo-reference/ReferenceView';

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
  const wallet = useGetWallet({ query: { queryKey: getGetWalletQueryKey(), enabled: !!user, retry: false } });
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
  const legalFor = (p: Pick | null) => new Set(canMove ? mine.map((pos, i) => (destination(pos, valuesFor(p), dice) !== null ? i : -1)).filter(i => i >= 0) : []);
  const legalTokens = legalFor(sel);
  const anyLegal = (['d0', 'd1', 'both'] as Pick[]).some(p => valid(p) && legalFor(p).size > 0);
  const dieAvail = (i: number) => remaining.includes(i as 0 | 1);
  const msg = room.board.turnMessage;
  const notice = msg === 'third_double' ? 'Third double in a row. The turn is forfeited before any movement.' : msg === 'capture_bonus' ? (isDone ? 'Capture +10. Match completed.' : room.board.hasRolled ? 'Capture +10. Remaining dice first; bonus roll next.' : 'Capture +10. Bonus roll ready.') : msg === 'double_bonus' ? 'Double rolled. Roll again after your dice are used.' : msg === 'no_moves' ? 'No legal move for that roll. Turn passed.' : msg === 'timeout' ? 'The turn clock ran out. Turn passed.' : '';
  const onMove = (index: number) => { if (!sel) return; setActionError(''); move.mutate({ roomId, data: { tokenIndex: index, diceIndices: indicesFor(sel) } }, { onSuccess: patch, onError: fail }); };
  const connLabel = conn === 'live' ? 'Live' : conn === 'connecting' ? 'Connecting' : 'Reconnecting, polling 10s';
  const canPick = { d0: canMove && valid('d0'), d1: canMove && valid('d1'), both: canMove && valid('both') };
  const turnText = isDone ? (room.board.winnerUserId === user.id ? 'You took the table.' : 'Match complete.') : isWaiting ? 'Waiting for a challenger.' : isMyTurn ? (room.board.hasRolled ? (anyLegal ? 'Pick a die in the centre, then tap a glowing token.' : 'No legal move. Waiting on the server.') : 'Your turn. Roll both dice.') : `Waiting on ${opponent || 'opponent'} to play.`;
  const captureText = room.board.captureBonusPending && msg !== 'capture_bonus' ? 'Capture +10 earned. Bonus roll coming after your dice.' : '';
  const winnerName = room.board.winnerUserId === room.hostUserId ? room.hostUsername : room.opponentUsername;
  const resultText = room.status === 'completed' ? `Winner: ${winnerName}` : '';
  const walletState = wallet.isLoading ? 'loading' : wallet.isError || !wallet.data ? 'error' : 'ok';
  const extra = <>
    {isWaiting && isHost && <div className="waiting-controls"><div><span className="pulse-dot" /> ROOM OPEN · SHARE THE STAKE WITH A FRIEND</div><button className="quiet-btn" disabled={cancel.isPending} onClick={() => cancel.mutate({ roomId }, { onSuccess: next => { patch(next); setLocation('/'); }, onError: () => setActionError('Could not cancel this room. Try again.') })} data-testid="button-cancel-room">{cancel.isPending ? 'Closing table…' : 'Cancel table'}</button></div>}
    {isWaiting && !isHost && <div className="waiting-banner"><Clock3 size={17} /> Waiting for the match to start.</div>}
    {isDone && <div className="completed-banner"><BadgeCheck size={18} /> Match closed. Settlement shows in your Mosquito Wallet.</div>}
  </>;
  return <ReferenceView
    room={room} meName={user.username} oppName={opponent || ''} isMyTurn={isMyTurn} isActive={!!isActive} isWaiting={isWaiting} isDone={isDone}
    matchSeconds={matchSeconds} turnSeconds={seconds}
    walletText={money(wallet.data?.balanceNaira ?? 0)} walletState={walletState} onWallet={() => setLocation('/')} onRetryWallet={() => void wallet.refetch()} onExit={() => setLocation('/')}
    conn={conn} connLabel={connLabel}
    legalTokens={legalTokens} onMove={onMove} selecting={canMove && legalTokens.size > 0}
    dice={dice} rolling={roll.isPending} sel={sel} canPick={canPick} onPick={setPick}
    onRoll={() => { setActionError(''); roll.mutate({ roomId }, { onSuccess: next => { patch(next); }, onError: fail }); }}
    rollDisabled={!clockAllowsPlay || !isMyTurn || room.board.hasRolled || roll.isPending}
    rollReady={clockAllowsPlay && isMyTurn && !room.board.hasRolled}
    turnText={turnText} notice={notice} noticeBad={msg === 'third_double' || msg === 'timeout'} captureText={captureText} actionError={actionError} resultText={resultText} extra={extra}
  />;
}
