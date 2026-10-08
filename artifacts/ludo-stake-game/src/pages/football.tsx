import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { ArrowLeft, ArrowRight, Copy, ShieldCheck } from 'lucide-react';
import {
  getGetCurrentUserQueryKey, getGetFootballLobbyQueryKey, getGetFootballRoomQueryKey, getGetWalletQueryKey,
  useCancelFootballRoom, useGetCurrentUser, useGetFootballRoom, useJoinFootballRoom,
} from '@workspace/api-client-react';
import type { FootballRoom } from '@workspace/api-client-react';
import { queryClient } from '@/lib/query-client';
import { AuthFrame, InlineError, LoadingBlock, Shell, money } from '@/components/common';
import { FootballPitch, viewFlipped } from '@/components/football-pitch';
import { useFootballRealtime } from '@/hooks/use-football-realtime';
import '@/football.css';

const fmt = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const RADIUS = 46;

export default function FootballPage() {
  const [, params] = useRoute('/football/:roomId');
  const roomId = params?.roomId ?? '';
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const user = current.data?.user;
  const roomQuery = useGetFootballRoom(roomId, { query: { queryKey: getGetFootballRoomQueryKey(roomId), enabled: !!roomId && !!user, refetchInterval: 2000 } });
  const lastStatus = useRef('');
  const refreshRelated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetFootballLobbyQueryKey() });
  }, []);
  const onSnap = useCallback((r: FootballRoom) => {
    queryClient.setQueryData(getGetFootballRoomQueryKey(roomId), r);
  }, [roomId]);
  const rt = useFootballRealtime(!!user && !!roomId && !!roomQuery.data?.viewerTeam, roomId, () => { void roomQuery.refetch(); }, onSnap);
  const cancel = useCancelFootballRoom();
  const join = useJoinFootballRoom();
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  const q = roomQuery.data; const w = rt.snapshot?.id === roomId ? rt.snapshot : null;
  const room: FootballRoom | undefined = w && (!q || w.state.sequence >= q.state.sequence) ? w : q;

  useEffect(() => {
    if (!room) return;
    if (lastStatus.current && lastStatus.current !== room.status) refreshRelated();
    lastStatus.current = room.status;
  }, [room, refreshRelated]);

  const live = !!room && room.status === 'active' && !!room.viewerTeam && rt.conn === 'live' && room.state.phase !== 'waiting' && room.state.phase !== 'finished';

  // movement: joystick + keyboard
  const joy = useRef({ x: 0, y: 0 }); const keys = useRef(new Set<string>());
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const flip = room ? viewFlipped(room.state, room.viewerTeam) : false;
  const flipRef = useRef(flip); flipRef.current = flip;
  const setMoveRef = useRef(rt.setMove); setMoveRef.current = rt.setMove;
  const liveRef = useRef(live); liveRef.current = live;
  const pushMove = useCallback(() => {
    let x = joy.current.x; let y = joy.current.y;
    const k = keys.current;
    if (k.size) { x += (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0); y += (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0); }
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    const f = flipRef.current ? -1 : 1; // screen is rotated when attacking south
    setMoveRef.current(liveRef.current ? x * f : 0, liveRef.current ? y * f : 0);
  }, []);
  useEffect(() => { if (!live) { joy.current = { x: 0, y: 0 }; keys.current.clear(); setKnob({ x: 0, y: 0 }); pushMove(); } }, [live, pushMove]);
  // Remap a held joystick/key when the teams switch ends at halftime.
  useEffect(() => { pushMove(); }, [flip, pushMove]);

  const stickRef = useRef<HTMLDivElement>(null); const stickPtr = useRef<number | null>(null);
  const moveStick = (e: RPointerEvent) => {
    const r = stickRef.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2); let dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy); if (m > RADIUS) { dx = dx / m * RADIUS; dy = dy / m * RADIUS; }
    setKnob({ x: dx, y: dy });
    joy.current = Math.hypot(dx, dy) < 6 ? { x: 0, y: 0 } : { x: dx / RADIUS, y: dy / RADIUS };
    pushMove();
  };
  const endStick = (e: RPointerEvent) => {
    if (stickPtr.current !== e.pointerId) return;
    stickPtr.current = null; joy.current = { x: 0, y: 0 }; setKnob({ x: 0, y: 0 }); pushMove();
  };

  const act = useCallback((a: 'pass' | 'shoot' | 'tackle' | 'switch') => { if (liveRef.current) rt.sendAction(a); }, [rt]);
  const actRef = useRef(act); actRef.current = act;
  const roomRef = useRef(room); roomRef.current = room;
  const smartSlide = useCallback(() => {
    const r = roomRef.current; if (!r || !r.viewerTeam) return 'switch' as const;
    const s = r.state; const ownerId = s.ball.ownerId; const owner = s.players.find(p => p.id === ownerId);
    const ctrlId = r.viewerTeam === 'home' ? s.controlledHome : s.controlledAway;
    const me = s.players.find(p => p.id === ctrlId);
    if (owner && me && owner.team !== r.viewerTeam && Math.hypot(owner.x - me.x, owner.y - me.y) < 4.5) return 'tackle' as const;
    return 'switch' as const;
  }, []);
  const slideTimer = useRef(0); const slideLong = useRef(false);
  const slideDown = (e: RPointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); slideLong.current = false; slideTimer.current = window.setTimeout(() => { slideLong.current = true; actRef.current('switch'); }, 450); };
  const slideUp = () => { if (!slideTimer.current) return; window.clearTimeout(slideTimer.current); slideTimer.current = 0; if (!slideLong.current) actRef.current(smartSlide()); };

  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); keys.current.add(k); pushMove(); }
      else if (e.repeat) return;
      else if (k === 'j') actRef.current('pass'); else if (k === 'k') actRef.current('shoot');
      else if (k === 'l') actRef.current('tackle'); else if (k === ' ') { e.preventDefault(); actRef.current('switch'); }
    };
    const up = (e: KeyboardEvent) => { keys.current.delete(e.key.toLowerCase()); pushMove(); };
    const clear = () => { keys.current.clear(); joy.current = { x: 0, y: 0 }; setKnob({ x: 0, y: 0 }); pushMove(); };
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up); window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear); clear(); };
  }, [pushMove]);

  if (!user && current.isLoading) return <Shell><div className="page-content"><LoadingBlock label="Checking player seat" /></div></Shell>;
  if (!user) return <AuthFrame mode="login" heading="Your seat is reserved." copy="Sign in to return to this match."><Link className="primary-btn full" href="/login" data-testid="link-football-login">Sign in <ArrowRight size={17} /></Link></AuthFrame>;
  if (!room && roomQuery.isLoading) return <Shell user={user}><div className="page-content"><LoadingBlock label="Marking the pitch" /></div></Shell>;
  if (!room) return <Shell user={user}><div className="page-content"><div className="fb-wait"><h1>This pitch went quiet.</h1><p>It may have closed, or the link is out of date.</p><div className="fb-row"><button className="quiet-btn" onClick={() => void roomQuery.refetch()} data-testid="button-retry-football">Retry</button><button className="primary-btn" onClick={() => setLocation('/')} data-testid="button-football-lobby">Back to lobby <ArrowRight size={16} /></button></div></div></div></Shell>;

  const s = room.state; const isHost = room.hostUserId === user.id;
  const homeName = room.hostUsername; const awayName = room.opponentUsername || 'Waiting';
  const dirLabel = s.homeDirection === -1 ? 'north' : 'south';
  const myDir = room.viewerTeam ? (room.viewerTeam === 'home' ? dirLabel : dirLabel === 'north' ? 'south' : 'north') : null;
  const paused = s.pauseUntil > 0 && Date.parse(s.serverTimeAt) < s.pauseUntil && s.phase !== 'finished' && s.phase !== 'waiting';
  const halfLabel = s.phase === 'first_half' ? '1ST HALF' : s.phase === 'second_half' ? '2ND HALF' : s.phase === 'overtime' ? 'GOLDEN GOAL' : s.phase === 'finished' ? 'FULL TIME' : 'PRE-MATCH';
  const halfRemaining = s.phase === 'first_half' ? Math.max(0, 180000 - s.elapsedMs) : s.phase === 'second_half' ? Math.max(0, 360000 - s.elapsedMs) : s.remainingMs;
  const done = room.status === 'completed' || room.status === 'cancelled';
  const won = room.winnerUserId === user.id;
  const connLabel = rt.conn === 'live' ? 'LIVE' : rt.conn === 'connecting' ? 'CONNECTING' : 'RECONNECTING · POLLING 2s';
  const url = `${window.location.origin}${import.meta.env.BASE_URL}football/${room.id}`.replace(/([^:])\/\//g, '$1/');
  const kickoffNote = room.status === 'active' && paused ? s.lastEvent : '';

  return <Shell user={user}>
    <div className="fb-page">
      <div className="fb-nav">
        <button className="back-link" onClick={() => setLocation('/')} data-testid="button-football-return"><ArrowLeft size={16} /> Lobby</button>
        <span className={`sandbox-pill conn-${rt.conn}`} data-testid="status-football-connection"><span className="pulse-dot" /> {connLabel}</span>
      </div>
      {room.status === 'waiting' ? <div className="fb-wait" data-testid="panel-football-waiting">
        <div className="section-overline">11 v 11 DUEL · WAITING</div>
        <h1>Waiting for a challenger.</h1>
        <p className="fb-help">Share this link. Your opponent joins with a matching sandbox stake, and the whole team, 11 a side, is on the pitch.</p>
        <div className="fb-link" data-testid="text-football-invite">{url}</div>
        <div className="fb-row">
          {!room.viewerTeam && <button className="primary-btn" disabled={join.isPending} data-testid="button-join-football-invite" onClick={() => {
            setErr('');
            join.mutate({ data: { stakeNaira: room.stakeNaira as 500 | 1000 | 2000, roomId } }, {
              onSuccess: next => { queryClient.setQueryData(getGetFootballRoomQueryKey(next.id), next); refreshRelated(); setLocation(`/football/${next.id}`); },
              onError: () => setErr('This room may be taken, or a player needs more test funds in Mosquito Wallet.'),
            });
          }}>{join.isPending ? 'Joining…' : `Join · ${money(room.stakeNaira)} test stake`}</button>}
          <button className="quiet-btn" onClick={() => { void navigator.clipboard?.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }} data-testid="button-copy-invite"><Copy size={13} /> {copied ? 'Copied' : 'Copy invite'}</button>
          {isHost && <button className="quiet-btn" disabled={cancel.isPending} data-testid="button-cancel-football" onClick={() => { setErr(''); cancel.mutate({ roomId }, { onSuccess: next => { queryClient.setQueryData(getGetFootballRoomQueryKey(roomId), next); refreshRelated(); setLocation('/'); }, onError: () => setErr('Could not cancel this match. Try again.') }); }}>{cancel.isPending ? 'Closing…' : 'Cancel match'}</button>}
        </div>
        {err && <InlineError>{err}</InlineError>}
      </div> : <>
        <div className="fb-score" data-testid="panel-football-score">
          <div className="fb-team"><small>HOME{room.viewerTeam === 'home' ? ' · YOU' : ''}</small><b>{homeName}</b></div>
          <div className="fb-mid"><div className="fb-goals" data-testid="text-football-score">{s.scoreHome}<i>:</i>{s.scoreAway}</div><div className="fb-clock" data-testid="text-football-clock">{halfLabel}{s.phase === 'overtime' ? '' : ` · ${fmt(halfRemaining)}`}</div></div>
          <div className="fb-team right"><small>AWAY{room.viewerTeam === 'away' ? ' · YOU' : ''}</small><b>{awayName}</b></div>
        </div>
        {s.phase === 'overtime' && <div className="fb-banner gold" data-testid="text-football-golden">GOLDEN GOAL. Tied after 6 minutes. The next goal wins.</div>}
        {kickoffNote && <div className="fb-banner" data-testid="text-football-kickoff">{kickoffNote}</div>}
        {s.lastEvent && !done && !kickoffNote && <div className="fb-banner" data-testid="text-football-event">{s.lastEvent}</div>}
        <FootballPitch state={s} team={room.viewerTeam} />
        {done && <div className="fb-banner result" data-testid="text-football-result">{room.status === 'cancelled' ? 'Waiting room cancelled. No stakes were debited.' : room.winnerUserId ? (won ? `You won. ${money(room.prizeNaira)} credited to your Mosquito Wallet test balance.` : 'Match ended. Opponent takes the prize.') : 'Match closed.'}</div>}
        <div className="fb-info">
          <span data-testid="text-football-side">{room.viewerTeam ? `YOU ARE ${room.viewerTeam.toUpperCase()} · ATTACKING ${myDir!.toUpperCase()} (SHOWN UP)` : 'SPECTATING'}</span>
          <span>STAKE {money(room.stakeNaira)}</span><span data-testid="text-football-prize">PRIZE {money(room.prizeNaira)}</span><span>COMMISSION {money(room.commissionNaira)}</span>
        </div>
        {rt.error && <InlineError>{rt.error}</InlineError>}
        {err && <InlineError>{err}</InlineError>}
        <div className={`fb-controls ${live ? '' : 'off'}`} data-testid="panel-football-controls">
          <div ref={stickRef} className="fb-stick" data-testid="control-joystick"
            onPointerDown={e => { if (stickPtr.current !== null) return; stickPtr.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); moveStick(e); }}
            onPointerMove={e => { if (stickPtr.current === e.pointerId) moveStick(e); }}
            onPointerUp={endStick} onPointerCancel={endStick} onLostPointerCapture={endStick}>
            <div className="fb-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
          </div>
          <div className="fb-actions">
            <button className="fb-btn" disabled={!live} onPointerDown={e => { e.preventDefault(); act('pass'); }} data-testid="button-football-pass">Pass<small>J</small></button>
            <button className="fb-btn shoot" disabled={!live} onPointerDown={e => { e.preventDefault(); act('shoot'); }} data-testid="button-football-shoot">Shoot<small>K</small></button>
            <button className="fb-btn slide" disabled={!live} onPointerDown={slideDown} onPointerUp={slideUp} onPointerCancel={() => { window.clearTimeout(slideTimer.current); slideTimer.current = 0; }} data-testid="button-football-slide">Slide / Switch<small>L TACKLE · SPACE SWITCH</small></button>
          </div>
        </div>
        <p className="fb-help">Tap Slide / Switch to tackle a nearby enemy carrier, otherwise it switches your player. Hold it to always switch. Keys: WASD or arrows move, J pass, K shoot, L tackle, Space switch. Two halves of 3 minutes; a tie goes to golden goal. <ShieldCheck size={11} style={{ verticalAlign: '-1px' }} /> Sandbox funds only, test play.</p>
      </>}
    </div>
  </Shell>;
}
