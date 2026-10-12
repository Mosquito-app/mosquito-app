import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LogOut, ScrollText, Info, X, Plus } from 'lucide-react';
import type { Room } from '@workspace/api-client-react';
import type { Color } from '../ludo-board';
import { cellFor, pathCells } from './logic';
import './ludo-reference.css';

/*
 * PRESENTATION-ONLY MAPPING
 * Engine geometry: red = top-left seat, logical green = bottom-right seat (unchanged, authoritative).
 * Display: every logical cell (r,c) is drawn at display (R,C) = (14-c, r), i.e. the whole board is rotated
 * 90deg counter-clockwise. Inverse used when iterating the display grid: (r,c) = (C, 14-R).
 * Result: red bottom-left, logical green drawn YELLOW at top-right, decorative logical yellow drawn GREEN
 * top-left, decorative blue bottom-right. Colour names are swapped green<->yellow for display only.
 */
type Pick = 'd0' | 'd1' | 'both';
const DISPLAY: Record<string, string> = { red: 'red', green: 'yellow', yellow: 'green', blue: 'blue' };
const DISPLAY_HEX: Record<string, string> = {
  red: '#cc2626',
  yellow: '#ebce10',
  green: '#19894e',
  blue: '#0a4182',
};
const SEAT_LABEL: Record<Color, string> = { red: 'Red', green: 'Yellow', yellow: 'Green', blue: 'Blue' };

export type RoomView = Room;

const naira = (n: number) => `\u20A6${n.toLocaleString('en-NG')}`;
const clockText = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const TOKEN_COLORS: Color[] = ['red', 'green', 'yellow', 'blue'];
type TokenRows = Record<Color, number[]>;
const positionsFor = (room: RoomView): TokenRows => ({
  red: [...room.board.redTokens],
  green: [...room.board.greenTokens],
  yellow: [...(room.board.yellowTokens ?? [-1, -1, -1, -1])],
  blue: [...(room.board.blueTokens ?? [-1, -1, -1, -1])],
});
const copyPositions = (positions: TokenRows): TokenRows => ({
  red: [...positions.red], green: [...positions.green],
  yellow: [...positions.yellow], blue: [...positions.blue],
});

const RECTS = [{ r: 0, c: 0, color: 'red' }, { r: 0, c: 9, color: 'yellow' }, { r: 9, c: 9, color: 'green' }, { r: 9, c: 0, color: 'blue' }];
const STARTS: Record<string, string> = { '6-1': 'red', '1-8': 'yellow', '8-13': 'green', '13-6': 'blue' };
const SAFE = ['2-6', '6-12', '12-8', '8-2'];
const PADS: Record<string, string> = {};
[[1, 1], [1, 4], [4, 1], [4, 4]].forEach(([r, c]) => { PADS[`${r}-${c}`] = 'red'; });
[[10, 10], [10, 13], [13, 10], [13, 13]].forEach(([r, c]) => { PADS[`${r}-${c}`] = 'green'; });
[[1, 10], [1, 13], [4, 10], [4, 13]].forEach(([r, c]) => { PADS[`${r}-${c}`] = 'yellow'; });
[[10, 1], [10, 4], [13, 1], [13, 4]].forEach(([r, c]) => { PADS[`${r}-${c}`] = 'blue'; });

const PIPS: Record<number, number[]> = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function Die({ value, rolling }: { value: number | null; rolling?: boolean }) {
  return <span
    className={`lr-die ${value ? '' : 'empty'} ${rolling ? 'tumble' : ''}`}
    style={{ backgroundColor: '#fff', borderColor: '#111' }}
    aria-hidden="true"
  >
    {Array.from({ length: 9 }, (_, i) => <i key={i} className={value && PIPS[value].includes(i) ? 'pip' : ''} />)}
  </span>;
}

/* Original landmark illustrations (display corners). Not board pieces. */
function Landmark({ kind }: { kind: 'arch' | 'rock' | 'theatre' | 'dome' }) {
  const sky = { arch: ['#8fd3f4', '#e9f7ff'], rock: ['#f6a65a', '#fbe3a8'], theatre: ['#6fb6e8', '#fbe9d0'], dome: ['#f3a27a', '#ffe3b8'] }[kind];
  const id = `sky-${kind}`;
  return <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="lr-art" aria-hidden="true">
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sky[0]} /><stop offset="1" stopColor={sky[1]} /></linearGradient></defs>
    <rect width="100" height="100" fill={`url(#${id})`} />
    {kind === 'arch' && <g>
      <rect y="78" width="100" height="22" fill="#5c9a4a" />
      <rect x="14" y="30" width="16" height="50" fill="#fbfbf6" /><rect x="70" y="30" width="16" height="50" fill="#fbfbf6" />
      <path d="M14 36 Q50 -2 86 36 L86 48 Q50 14 14 48Z" fill="#fff" stroke="#d7d7cc" strokeWidth="1" />
      <rect x="30" y="52" width="40" height="28" fill="#cfe8f5" opacity=".6" />
      <rect x="47" y="14" width="1.4" height="14" fill="#555" /><rect x="48.4" y="14" width="6" height="2.6" fill="#1e9a55" /><rect x="52" y="14" width="2.4" height="2.6" fill="#fff" />
    </g>}
    {kind === 'rock' && <g>
      <circle cx="78" cy="24" r="9" fill="#fff3c4" opacity=".9" />
      <rect y="80" width="100" height="20" fill="#7a5a2e" />
      <path d="M8 82 Q14 40 36 24 Q52 12 62 30 Q74 40 92 82Z" fill="#6a4a32" />
      <path d="M36 24 Q52 12 62 30 Q54 34 48 60 Q42 40 36 24Z" fill="#8a6446" opacity=".7" />
      <path d="M0 88 Q25 78 50 88 T100 86 V100 H0Z" fill="#4e7a36" />
    </g>}
    {kind === 'theatre' && <g>
      <rect y="80" width="100" height="20" fill="#3f8f9c" />
      <path d="M0 90 Q25 84 50 90 T100 88" stroke="#bfe9ee" strokeWidth="1.5" fill="none" />
      <ellipse cx="50" cy="52" rx="38" ry="12" fill="#e6e0d2" /><rect x="14" y="52" width="72" height="26" fill="#d7d0bf" />
      {Array.from({ length: 11 }, (_, i) => <rect key={i} x={16 + i * 6.4} y="56" width="2.4" height="20" fill="#b9b19c" />)}
      <ellipse cx="50" cy="40" rx="20" ry="9" fill="#efe9db" /><ellipse cx="50" cy="34" rx="9" ry="5" fill="#c9c2ae" />
    </g>}
    {kind === 'dome' && <g>
      <rect y="82" width="100" height="18" fill="#3a7fb5" />
      <path d="M0 90 Q25 85 50 90 T100 88" stroke="#bfe0f5" strokeWidth="1.5" fill="none" />
      <rect x="22" y="56" width="56" height="26" fill="#f5efe0" />
      <path d="M28 56 Q50 14 72 56Z" fill="#f2c53a" stroke="#c99a1b" strokeWidth="1" />
      {[12, 84].map(x => <g key={x}><rect x={x} y="30" width="5" height="52" fill="#fbf6e8" /><path d={`M${x - 1} 30 L${x + 2.5} 20 L${x + 6} 30Z`} fill="#f2c53a" /></g>)}
      <rect x="44" y="64" width="12" height="18" rx="6" fill="#7a5a3a" />
    </g>}
  </svg>;
}
const ART: Record<string, 'arch' | 'rock' | 'theatre' | 'dome'> = { green: 'arch', yellow: 'rock', red: 'theatre', blue: 'dome' };
// display corners: top-left green, top-right yellow, bottom-left red, bottom-right blue
const CORNERS = [{ R: 0, C: 0, color: 'green' }, { R: 0, C: 9, color: 'yellow' }, { R: 9, C: 0, color: 'red' }, { R: 9, C: 9, color: 'blue' }];

export interface BoardProps {
  room: RoomView; legalTokens: Set<number>; onMove: (i: number) => void; selecting: boolean;
  dice: number[] | null; rolling: boolean; sel: Pick | null; canPick: Record<Pick, boolean>; onPick: (p: Pick) => void;
  onAnimationChange?: (active: boolean) => void;
}

export function ReferenceBoard({ room, legalTokens, onMove, dice, rolling, sel, canPick, onPick, onAnimationChange }: BoardProps) {
  const initialPositions = positionsFor(room);
  const [displayPositions, setDisplayPositions] = useState<TokenRows>(initialPositions);
  const displayedRef = useRef(displayPositions);
  const roomIdRef = useRef(room.id);
  const timersRef = useRef<number[]>([]);
  useEffect(() => {
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
    const target = positionsFor(room);
    if (roomIdRef.current !== room.id) {
      roomIdRef.current = room.id;
      displayedRef.current = target;
      setDisplayPositions(target);
      onAnimationChange?.(false);
      return;
    }

    const immediate = copyPositions(displayedRef.current);
    const movements: Array<{ color: Color; index: number; steps: number[] }> = [];
    for (const color of TOKEN_COLORS) {
      for (let index = 0; index < target[color].length; index++) {
        const from = immediate[color][index] ?? -1;
        const to = target[color][index] ?? -1;
        if (to > from) {
          const capturedHome = room.board.lastMove?.kind === 'capture_home' &&
            room.board.lastMove.color === color && room.board.lastMove.tokenIndex === index && to === 57;
          if (capturedHome) {
            immediate[color][index] = to;
            continue;
          }
          const start = from < 0 ? 0 : from;
          immediate[color][index] = start;
          const steps = Array.from({ length: Math.max(0, to - start) }, (_, step) => start + step + 1);
          if (steps.length) movements.push({ color, index, steps });
        } else {
          // Captures return the rival token to base; other non-forward changes are
          // state corrections and should not animate as a forward track movement.
          immediate[color][index] = to;
        }
      }
    }
    displayedRef.current = immediate;
    setDisplayPositions(immediate);

    const totalSteps = movements.reduce((sum, movement) => sum + movement.steps.length, 0);
    onAnimationChange?.(totalSteps > 0);
    if (totalSteps === 0) return;

    const reducedMotion = typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stepDelay = reducedMotion ? 0 : 95;
    let stepsLeft = totalSteps;
    for (const movement of movements) {
      movement.steps.forEach((position, stepIndex) => {
        const timer = window.setTimeout(() => {
          const next = copyPositions(displayedRef.current);
          next[movement.color][movement.index] = position;
          displayedRef.current = next;
          setDisplayPositions(next);
          stepsLeft--;
          if (stepsLeft === 0) onAnimationChange?.(false);
        }, stepDelay * (stepIndex + 1));
        timersRef.current.push(timer);
      });
    }
    return () => {
      timersRef.current.forEach(window.clearTimeout);
      timersRef.current = [];
    };
  }, [room.id, room.board.redTokens, room.board.greenTokens, room.board.yellowTokens, room.board.blueTokens, onAnimationChange]);

  const trackSet = new Set(pathCells.map(([r, c]) => `${r}-${c}`));
  const lanes = new Map<string, string>();
  for (let i = 1; i <= 5; i++) { lanes.set(`7-${i}`, 'red'); lanes.set(`7-${14 - i}`, 'green'); lanes.set(`${i}-7`, 'yellow'); lanes.set(`${14 - i}-7`, 'blue'); }
  const tokenRows = roomIdRef.current === room.id ? displayPositions : initialPositions;
  const tokens = TOKEN_COLORS.flatMap(color => tokenRows[color].map((position, index) => ({ color, position, index, at: cellFor(color, position, index) })));
  const cells = [];
  for (let R = 0; R < 15; R++) for (let C = 0; C < 15; C++) {
    const r = C, c = 14 - R, key = `${r}-${c}`;
    const home = RECTS.find(h => r >= h.r && r < h.r + 6 && c >= h.c && c < h.c + 6);
    const lane = lanes.get(key); const start = STARTS[key];
    const here = tokens.filter(t => t.at[0] === r && t.at[1] === c);
    const cls = ['lr-cell', home && 'lr-home', trackSet.has(key) && 'lr-track', lane && 'lr-lane', start && 'lr-start', SAFE.includes(key) && 'lr-safe'].filter(Boolean).join(' ');
    const squareColor = home ? DISPLAY[home.color] : lane ? DISPLAY[lane] : start ? DISPLAY[start] : undefined;
    cells.push(<div key={key} className={cls} style={squareColor ? { backgroundColor: DISPLAY_HEX[squareColor] } : undefined}>
      {PADS[key] && <span className="lr-pad" />}
      {here.map((t, n) => { const mine = t.color === room.myColor; const legal = mine && legalTokens.has(t.index); const shown = DISPLAY[t.color];
        return <button key={`${t.color}-${t.index}`} type="button" aria-label={`${SEAT_LABEL[t.color]} token ${t.index + 1}${mine ? ' (yours)' : ''}${legal ? ', can move' : ''}`} disabled={!legal} onClick={() => onMove(t.index)}
          className={`lr-token ${shown} ${mine ? 'mine' : 'theirs'} ${legal ? 'ready' : ''}`}
          style={{ transform: here.length > 1 ? `translate(${(n - (here.length - 1) / 2) * 24}%, ${(n % 2) * 8 - 4}%) scale(${here.length > 2 ? .7 : .84})` : undefined }}
          data-testid={`button-token-${t.color}-${t.index}`}><span /></button>; })}
    </div>);
  }
  const dieBtn = (i: 0 | 1) => { const p: Pick = i === 0 ? 'd0' : 'd1'; const used = !!dice && !room.board.remainingDice.includes(i);
    return <button key={i} type="button" className={`lr-cdie ${sel === p ? 'active' : ''} ${used ? 'used' : ''}`} disabled={!canPick[p]} aria-pressed={sel === p} aria-label={dice ? `Die ${i + 1}: ${dice[i]}${used ? ', used' : ''}` : `Die ${i + 1}, not rolled`} onClick={() => onPick(p)} data-testid={`button-die-${i}`}>
      <Die value={dice ? dice[i] : null} rolling={rolling} /><span className="sr-only" data-testid={`text-dice-value-${i}`}>{dice ? dice[i] : '-'}</span></button>; };
  return <div className="lr-frame">
    <div className="lr-grid" role="group" aria-label={`Four-color Ludo board. ${room.players.length} players joined.`}>
      {CORNERS.map(k => <div key={k.color} className={`lr-inset lr-i-${k.color}`} aria-hidden="true" style={{ left: `${(k.C + 1) * 100 / 15}%`, top: `${(k.R + 1) * 100 / 15}%` }}><Landmark kind={ART[k.color]} /></div>)}
      {cells}
      <svg className="lr-star" viewBox="0 0 3 3" aria-hidden="true">
        <polygon points="0,0 0,3 1.5,1.5" fill="#19894e" /><polygon points="0,0 3,0 1.5,1.5" fill="#ebce10" />
        <polygon points="3,0 3,3 1.5,1.5" fill="#0a4182" /><polygon points="0,3 3,3 1.5,1.5" fill="#cc2626" />
        <path d="M0 0L3 3M3 0L0 3M0 0H3V3H0Z" stroke="#171411" strokeWidth=".04" fill="none" />
      </svg>
      <div className="lr-center-dice">{dieBtn(0)}{dieBtn(1)}</div>
    </div>
  </div>;
}

function Modal({ title, onClose, children, testid }: { title: string; onClose: () => void; children: ReactNode; testid: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="lr-modal-back" onClick={onClose}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="lr-modal" data-testid={testid} onClick={e => e.stopPropagation()}>
    <div className="lr-modal-head"><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close" data-testid={`${testid}-close`}><X size={18} /></button></div>{children}</div></div>;
}

function Brand() {
  return <div className="lr-brand" aria-label="Mosquito App">
    <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true"><ellipse cx="20" cy="22" rx="4.5" ry="9" fill="#2b1608" /><ellipse cx="13" cy="15" rx="9" ry="4" transform="rotate(-30 13 15)" fill="#fff7de" stroke="#2b1608" strokeWidth="1.5" /><ellipse cx="27" cy="15" rx="9" ry="4" transform="rotate(30 27 15)" fill="#fff7de" stroke="#2b1608" strokeWidth="1.5" /><path d="M20 30 L20 38" stroke="#2b1608" strokeWidth="2" /><circle cx="20" cy="11" r="3.4" fill="#d8202a" /></svg>
    <span>Mosquito<small>APP</small></span>
  </div>;
}

export interface ViewProps {
  room: RoomView; meName: string; oppName: string; isMyTurn: boolean; isActive: boolean; isWaiting: boolean; isDone: boolean;
  matchSeconds: number | null; turnSeconds: number | null;
  walletText: string; walletState: 'ok' | 'loading' | 'error'; onWallet: () => void; onRetryWallet: () => void; onExit: () => void;
  previewOnly?: boolean;
  conn: 'live' | 'connecting' | string; connLabel: string;
  legalTokens: Set<number>; onMove: (i: number) => void; selecting: boolean;
  dice: number[] | null; rolling: boolean; sel: Pick | null; canPick: Record<Pick, boolean>; onPick: (p: Pick) => void;
  onAnimationChange?: (active: boolean) => void;
  onRoll: () => void; rollDisabled: boolean; rollReady: boolean;
  turnText: string; notice: string; noticeBad: boolean; captureText: string; actionError: string; resultText: string;
  extra?: ReactNode;
}

export function ReferenceView(p: ViewProps) {
  const [dlg, setDlg] = useState<null | 'rules' | 'info'>(null);
  const { room } = p;
  const overtime = p.isActive && room.board.isOvertime;
  const clock = room.status === 'waiting' ? '8:00' : p.isDone ? 'ENDED' : overtime ? '0:00' : p.matchSeconds === null ? '--:--' : clockText(p.matchSeconds);
  const turnLabel = p.isDone ? p.resultText || 'Match complete' : p.isWaiting ? 'Waiting for a challenger' : p.isMyTurn ? 'Your turn' : `${p.oppName || 'Opponent'}'s turn`;
  const showTurn = p.isActive && p.turnSeconds !== null;
  const strip = (name: string, color: Color, me: boolean, active: boolean, forfeited = false) => {
    const sc = room.scores[color];
    return <div className={`lr-player ${me ? 'me' : 'opp'} ${active ? 'on' : ''} ${forfeited ? 'forfeited' : ''}`}>
      <span className={`lr-avatar ${DISPLAY[color]}`} aria-hidden="true">{(name || '?').slice(0, 1).toUpperCase()}</span>
      <div className="lr-pname"><b>{name || 'Waiting'}{me && <small> you</small>}</b>
        {forfeited && <small className="lr-forfeited-label">FORFEITED</small>}
        <span className="lr-pips" aria-label={`${SEAT_LABEL[color]} seat, ${sc.tokensHome} of 4 home`}>{[0, 1, 2, 3].map(i => <i key={i} className={`${DISPLAY[color]} ${i < sc.tokensHome ? 'on' : ''}`} />)}<em>{SEAT_LABEL[color]}</em></span></div>
    </div>;
  };
  const seats = Array.from({ length: room.maxPlayers }, (_, index) => room.players[index] ?? null);
  const bothSum = room.board.dice ? room.board.dice[0] + room.board.dice[1] : 0;
  return <div className="lr-page" data-testid="page-ludo-reference">
    <header className="lr-header">
      <Brand />
      {p.previewOnly && <span className="lr-preview-badge" role="note" aria-label="Design preview only. Player, balance, and match values are samples; no real account or funds are connected.">SAMPLE PREVIEW</span>}
      <button type="button" className="lr-wallet" onClick={p.walletState === 'error' ? p.onRetryWallet : p.onWallet} aria-label={p.walletState === 'error' ? 'Wallet balance unavailable. Retry' : `Open wallet. Balance ${p.walletText}`} data-testid="button-game-wallet">
        <b data-testid="text-game-balance">{p.walletState === 'loading' ? '...' : p.walletState === 'error' ? 'Retry' : p.walletText}</b><span className="lr-plus"><Plus size={16} /></span></button>
    </header>
    <main className="lr-stage">
      <div className="lr-top">
        <div className={`lr-clock ${overtime ? 'overtime' : p.matchSeconds !== null && p.matchSeconds <= 60 && p.isActive ? 'urgent' : ''}`} data-testid="panel-match-clock">
          <span className="sr-only">Shared match clock</span><strong data-testid="text-match-countdown" aria-label={`Match time ${clock}`}>{clock}</strong>
        </div>
        <button type="button" className="lr-exit" onClick={p.onExit} aria-label="Back to lobby. The match keeps running." title="Back to lobby (match keeps running)" data-testid="button-return-lobby"><LogOut size={18} /></button>
      </div>
      {overtime && <div className="lr-overtime" role="status" data-testid="banner-overtime">OVERTIME / DRAW BREAK <small>Exact tie. The first movement that breaks it wins.</small></div>}
      <div className={`lr-turn ${p.isMyTurn && p.isActive ? 'mine' : ''} ${showTurn && p.turnSeconds! <= 8 ? 'urgent' : ''}`} role="status" {...(showTurn ? { 'data-testid': 'text-turn-countdown' } : {})}>
        {showTurn && <i style={{ transform: `scaleX(${Math.min(1, p.turnSeconds! / 30)})` }} />}
        <span>{turnLabel}</span>{showTurn && <b>{p.turnSeconds}s</b>}
      </div>
      <div className="lr-roster" aria-label="Room players">
        {seats.map((player, index) => {
          const color = (['red', 'green', 'yellow', 'blue'] as Color[])[index];
          return <div key={player?.userId ?? `empty-${color}`} className="lr-roster-seat">
            {strip(player?.username ?? 'Open seat', color, color === room.myColor, !!player && room.board.turnUserId === player.userId, !!player && !!room.board.forfeitedUserIds?.includes(player.userId))}
          </div>;
        })}
      </div>
      <ReferenceBoard room={room} legalTokens={p.legalTokens} onMove={p.onMove} selecting={p.selecting} dice={p.dice} rolling={p.rolling} sel={p.sel} canPick={p.canPick} onPick={p.onPick} onAnimationChange={p.onAnimationChange} />
      <div className="lr-actions">
        <button type="button" className={`lr-roll ${p.rollReady ? 'ready' : ''}`} disabled={p.rollDisabled} onClick={p.onRoll} data-testid="button-roll-dice">{p.rolling ? 'Rolling' : 'Roll'}</button>
        {p.dice && room.board.remainingDice.length === 2 && <button type="button" className={`lr-combine ${p.sel === 'both' ? 'active' : ''}`} disabled={!p.canPick.both} aria-pressed={p.sel === 'both'} onClick={() => p.onPick('both')} data-testid="button-dice-combine">Both = {bothSum}</button>}
      </div>
      <p className="lr-hint" data-testid="text-turn-hint">{p.turnText}</p>
      {p.captureText && <div className="lr-notice" role="status" data-testid="text-capture-bonus">{p.captureText}</div>}
      {p.notice && <div className={`lr-notice ${p.noticeBad ? 'bad' : ''}`} role="status" data-testid="text-turn-notice">{p.notice}</div>}
      {p.actionError && <div className="lr-notice bad" role="alert">{p.actionError}</div>}
      {p.extra}
    </main>
    <nav className="lr-bar" aria-label="Match controls">
      <button type="button" onClick={() => setDlg('rules')} data-testid="button-rules"><span className="lr-bico rules"><ScrollText size={26} /></span>Rules</button>
      <span className={`lr-conn conn-${p.conn}`} data-testid="status-connection"><i />{p.connLabel}</span>
      <button type="button" onClick={() => setDlg('info')} data-testid="button-match-info"><span className="lr-bico info"><Info size={26} /></span>Match info</button>
    </nav>
    {dlg === 'rules' && <Modal title="Rules" onClose={() => setDlg(null)} testid="dialog-rules"><ol className="lr-rules">
      <li>Two dice are rolled by the server each turn. Pick die 1, die 2 or both as a sum, then tap a glowing token.</li>
       <li>A token can leave base only by using a rolled 6. If both dice are selected, the other die advances it from its starting tile.</li>
        <li>Split the dice between two tokens by choosing one die at a time. A 6 with any other number is not a bonus roll; use the remaining die, then the turn passes.</li>
        <li>Only an exact double 6 grants a bonus roll. It can happen up to three consecutive times; after the third, the turn passes and all moves remain.</li>
        <li>Landing on a rival token on an unprotected square sends it back to base and immediately counts your capturing token as home. Captures give no extra roll or movement.</li>
      <li>Finishing needs an exact count to 57.</li>
      <li>Each turn has a 30 second clock. The match clock is shared; most tokens home wins, then total steps. An exact tie goes to overtime.</li></ol></Modal>}
    {dlg === 'info' && <Modal title="Match info" onClose={() => setDlg(null)} testid="dialog-match-info"><dl className="lr-info">
      <div><dt>Room</dt><dd>{room.id.slice(0, 8).toUpperCase()}</dd></div>
      <div><dt>Connection</dt><dd>{p.connLabel}</dd></div>
       {room.players.map(player => <div key={player.userId}><dt>{SEAT_LABEL[player.color]} · {player.username}</dt><dd data-testid={`text-score-${player.color}`}>{room.scores[player.color].tokensHome}/4 home / {room.scores[player.color].totalProgress} steps</dd></div>)}
      <div><dt>Stake each</dt><dd>{naira(room.stakeNaira)}</dd></div>
      <div><dt>Pot</dt><dd data-testid="text-pot">{naira(room.potNaira)}</dd></div>
      <div><dt>Winner prize (90%)</dt><dd data-testid="text-prize">{naira(room.prizeNaira)}</dd></div>
      <div><dt>Commission (10%)</dt><dd data-testid="text-commission">{naira(room.commissionNaira)}</dd></div></dl>
      <p className="lr-fine">Moves and match results are validated by the server.</p></Modal>}
  </div>;
}
