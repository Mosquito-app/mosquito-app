import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import {
  ArrowDownLeft, ArrowLeft, ArrowRight, BadgeCheck, ChevronDown, CircleHelp, Clock3,
  Coins, Gamepad2, LogOut, RefreshCw, ShieldCheck, Sparkles, Wallet,
} from 'lucide-react';
import {
  getGetCurrentUserQueryKey, getGetLobbyQueryKey, getGetRoomQueryKey, getGetWalletQueryKey,
  useCancelRoom, useGetCurrentUser, useGetLobby, useGetRoom, useGetWallet, useInitializeDeposit,
  useJoinRoom, useLogin, useLogout, useMoveToken, useRegister, useRollDice, useVerifyDeposit,
} from '@workspace/api-client-react';
import type { Room, WalletTransaction } from '@workspace/api-client-react';

const queryClient = new QueryClient();
const money = (value: number) => `₦${value.toLocaleString('en-NG')}`;
const dateLabel = (value: string) => new Intl.DateTimeFormat('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand-lockup" data-testid="link-home">
    <span className="brand-mark"><Gamepad2 size={19} strokeWidth={2.5} /></span>
    {!compact && <span className="brand-word">LUDO<span>ROOM</span></span>}
  </Link>;
}

function Shell({ children, user, onLogout }: { children: ReactNode; user?: { username: string }; onLogout?: () => void }) {
  return <div className="app-shell noise">
    <aside className="side-rail">
      <Brand />
      <div className="rail-label">THE TABLE</div>
      <Link href="/" className="rail-link active" data-testid="link-lobby"><Gamepad2 size={18} /> <span>Lobby</span><i /></Link>
      <div className="rail-spacer" />
      <div className="rail-foot">
        <div className="sandbox-mini"><span className="pulse-dot" /> SANDBOX MODE</div>
        <div className="rail-user">
          <div className="avatar">{user?.username?.slice(0, 1).toUpperCase() || 'L'}</div>
          <div className="rail-user-meta"><strong>{user?.username || 'Guest player'}</strong><small>Local account</small></div>
          {onLogout && <button className="icon-btn rail-logout" onClick={onLogout} aria-label="Sign out" data-testid="button-logout"><LogOut size={16} /></button>}
        </div>
        <p>Built for the next move.</p>
      </div>
    </aside>
    <main className="main-stage">
      <header className="topbar">
        <div className="mobile-brand"><Brand /></div>
        <div className="crumb"><span>PLAY</span><span className="crumb-slash">/</span><b>LOBBY</b></div>
        <div className="topbar-right"><span className="sandbox-pill"><ShieldCheck size={14} /> TEST PLAY ONLY</span><span className="topbar-time">LAGOS · WAT</span></div>
      </header>
      {children}
    </main>
  </div>;
}

function InlineError({ children }: { children: ReactNode }) {
  return <div className="inline-error" role="alert" data-testid="status-error">{children}</div>;
}
function LoadingBlock({ label = 'Loading your table' }: { label?: string }) {
  return <div className="loading-block" data-testid="status-loading"><span className="skeleton-line wide" /><span className="skeleton-line" /><span className="loading-label">{label}…</span></div>;
}

function AuthFrame({ children, heading, copy, mode }: { children: ReactNode; heading: string; copy: string; mode: 'login' | 'register' }) {
  return <div className="auth-page noise">
    <header className="auth-head"><Brand /><span className="sandbox-pill"><ShieldCheck size={14} /> SANDBOX ONLY</span></header>
    <div className="auth-layout">
      <section className="auth-aside">
        <div className="auth-eyebrow"><span className="eyebrow-dash" /> THE GAME IS ON</div>
        <h1>Every move<br />has a <em>moment.</em></h1>
        <p>Two players. One board. Just you, your tactics, and a little luck.</p>
        <div className="auth-board">
          <div className="auth-board-center"><span>LR</span></div>
          <i className="auth-token token-coral" /><i className="auth-token token-green" /><i className="auth-token token-yellow" />
          <div className="auth-board-caption">A GOOD GAME STARTS HERE</div>
        </div>
      </section>
      <section className="auth-card page-in">
        <div className="auth-card-kicker">LOCAL PLAYER ACCOUNT</div>
        <h2>{heading}</h2><p className="auth-card-copy">{copy}</p>
        {children}
        <div className="auth-switch">{mode === 'login' ? <>New to the table? <Link href="/register" data-testid="link-register">Create an account <ArrowRight size={14} /></Link></> : <>Already have a seat? <Link href="/login" data-testid="link-login">Sign in <ArrowRight size={14} /></Link></>}</div>
        <div className="auth-note"><ShieldCheck size={15} /> Local account. Sandbox balance. No live money.</div>
      </section>
    </div>
    <footer className="auth-footer"><span>LUDOROOM · A GAME OF GOOD JUDGMENT</span><span>PAYSTACK TEST MODE ONLY</span></footer>
  </div>;
}

function LoginPage() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    login.mutate({ data: { email: email.trim(), password } }, {
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/'); },
      onError: () => setError('That sign-in did not work. Check your details and try again.'),
    });
  };
  return <AuthFrame mode="login" heading="Welcome back." copy="Take your seat. Your next match is waiting.">
    <form className="auth-form" onSubmit={submit}>
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-email" /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" data-testid="input-password" /></label>
      {error && <InlineError>{error}</InlineError>}
      <button className="primary-btn full" type="submit" disabled={login.isPending} data-testid="button-login">{login.isPending ? 'Finding your seat…' : 'Sign in'} <ArrowRight size={17} /></button>
    </form>
  </AuthFrame>;
}

function RegisterPage() {
  const [, setLocation] = useLocation();
  const register = useRegister();
  const [username, setUsername] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault(); setError('');
    register.mutate({ data: { username: username.trim(), email: email.trim(), password } }, {
      onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/'); },
      onError: () => setError('Could not create that account. Check the details or try another email.'),
    });
  };
  return <AuthFrame mode="register" heading="Pull up a chair." copy="Create a local account and get straight to the board.">
    <form className="auth-form" onSubmit={submit}>
      <label>Player name<input autoComplete="nickname" required minLength={3} maxLength={24} value={username} onChange={e => setUsername(e.target.value)} placeholder="How players will know you" data-testid="input-username" /></label>
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-email" /></label>
      <label>Password<input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" data-testid="input-password" /></label>
      {error && <InlineError>{error}</InlineError>}
      <button className="primary-btn full" type="submit" disabled={register.isPending} data-testid="button-register">{register.isPending ? 'Setting up your seat…' : 'Create account'} <ArrowRight size={17} /></button>
    </form>
  </AuthFrame>;
}

function VerifyDepositReturn() {
  const [, setLocation] = useLocation();
  const verify = useVerifyDeposit();
  const [message, setMessage] = useState('');
  const reference = useMemo(() => new URLSearchParams(window.location.search).get('reference') || new URLSearchParams(window.location.search).get('trxref') || '', []);
  useEffect(() => {
    if (reference.length < 8) return;
    verify.mutate({ data: { reference } }, {
      onSuccess: result => {
        void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        setMessage(result.status === 'success' ? `Test deposit confirmed: ${money(result.amountNaira)} added to your sandbox balance.` : `Test deposit status: ${result.status}. Your balance has not been changed.`);
        setLocation('/');
      },
      onError: () => { setMessage('We could not verify that test deposit. Your balance has not been changed.'); setLocation('/'); },
    });
  // Intentionally verify a returned checkout reference once for this view.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="verify-note" data-testid="status-deposit">{verify.isPending ? 'Verifying test checkout securely…' : message}</div>;
}

function StakeButton({ value, count, selected, onClick }: { value: number; count: number; selected: boolean; onClick: () => void }) {
  return <button className={`stake-option ${selected ? 'selected' : ''}`} onClick={onClick} data-testid={`button-stake-${value}`}>
    <span className="stake-radio">{selected && <i />}</span><span className="stake-price">{money(value)}</span><span className="stake-foot">{count} {count === 1 ? 'player' : 'players'} waiting</span><ArrowRight className="stake-arrow" size={17} />
  </button>;
}

function TransactionRow({ transaction }: { transaction: WalletTransaction }) {
  const isDeposit = transaction.type === 'deposit';
  const title = transaction.description || transaction.type.replace('_', ' ');
  return <div className="transaction-row" data-testid={`row-transaction-${transaction.id}`}>
    <span className={`tx-icon ${isDeposit ? 'tx-in' : 'tx-out'}`}>{isDeposit ? <ArrowDownLeft size={16} /> : <Coins size={16} />}</span>
    <span className="tx-description"><b>{title}</b><small>{dateLabel(transaction.createdAt)}</small></span>
    <span className={`tx-amount ${isDeposit ? 'positive' : ''}`}>{isDeposit ? '+' : '−'}{money(transaction.amountNaira)}</span>
  </div>;
}

function LobbyPage() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const user = current.data?.user;
  const wallet = useGetWallet({ query: { queryKey: getGetWalletQueryKey(), enabled: !!user, refetchInterval: 20000 } });
  const lobby = useGetLobby({ query: { queryKey: getGetLobbyQueryKey(), enabled: !!user, refetchInterval: 5000 } });
  const join = useJoinRoom(); const logout = useLogout(); const initialize = useInitializeDeposit();
  const [stake, setStake] = useState<500 | 1000>(500);
  const [depositAmount, setDepositAmount] = useState('2000');
  const [depositError, setDepositError] = useState('');
  const [roomError, setRoomError] = useState('');
  const [showSandboxInfo, setShowSandboxInfo] = useState(false);
  const counts = lobby.data?.stakeCounts || [];
  const waitingCount = (value: number) => counts.find(item => item.stakeNaira === value)?.waitingPlayers || 0;
  const launch = () => {
    setRoomError('');
    join.mutate({ data: { stakeNaira: stake } }, { onSuccess: room => {
      void queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
      setLocation(`/game/${room.id}`);
    }, onError: () => setRoomError('Could not reserve that sandbox stake. Check your balance and try again.') });
  };
  const deposit = (event: FormEvent) => {
    event.preventDefault(); setDepositError('');
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount < 500 || amount > 500000) { setDepositError('Choose an amount between ₦500 and ₦500,000.'); return; }
    initialize.mutate({ data: { amountNaira: amount } }, { onSuccess: result => { window.location.assign(result.authorizationUrl); }, onError: () => setDepositError('Could not start a Paystack test checkout. Please try again.') });
  };
  if (current.isLoading) return <Shell><div className="page-content"><LoadingBlock label="Checking your session" /></div></Shell>;
  if (!user) return <AuthFrame mode="login" heading="The table is open." copy="Sign in or create a local player account to see the lobby."><div className="guest-cta"><Link className="primary-btn full" href="/login" data-testid="link-signin">Sign in to play <ArrowRight size={17} /></Link><Link className="text-link" href="/register" data-testid="link-create-account">Create a player account</Link></div>{current.isError && <p className="auth-inline-hint">Your session may have expired. Sign in to continue.</p>}</AuthFrame>;
  return <Shell user={user} onLogout={() => logout.mutate(undefined, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() }); setLocation('/login'); } })}>
    <VerifyDepositReturn />
    <div className="page-content page-in">
      <div className="welcome-line"><div><div className="section-overline"><span className="live-dot" /> TABLE IS OPEN</div><h1>Good evening, <em>{user.username}</em><span className="period">.</span></h1><p className="welcome-sub">Your move begins at the table.</p></div>
        <div className="mini-date"><span>PLAYER SINCE</span><strong>LOCAL ACCOUNT</strong></div></div>
      {lobby.isError && <div className="error-banner"><InlineError>Lobby updates paused. <button onClick={() => void lobby.refetch()} data-testid="button-retry-lobby">Retry</button></InlineError></div>}
      <div className="dashboard-grid">
        <section className="balance-panel">
          <div className="balance-top"><div><div className="panel-kicker">YOUR SANDBOX WALLET</div><div className="balance-label">Available balance</div></div><span className="wallet-stamp"><Wallet size={17} /></span></div>
          {wallet.isLoading ? <div className="balance-value skeleton-line wide" /> : wallet.isError ? <div className="balance-value">—</div> : <div className="balance-value" data-testid="text-wallet-balance">{money(wallet.data?.balanceNaira ?? user.balanceNaira)}</div>}
          <div className="balance-bottom"><div className="escrow-data"><span>RESERVED IN MATCHES</span><strong data-testid="text-escrow-balance">{money(wallet.data?.escrowedNaira || 0)}</strong></div><span className="sandbox-caption"><ShieldCheck size={14} /> Test balance only</span></div>
        </section>
        <section className="deposit-panel">
          <div className="deposit-head"><div><div className="panel-kicker">TOP UP · TEST ONLY</div><h2>Add sandbox funds</h2></div><div className="paystack-mark"><span className="paystack-symbol">P</span><span>PAYSTACK<br /><small>TEST MODE</small></span></div></div>
          <p>Checkout is simulated with Paystack test mode. No live money moves.</p>
          <form className="deposit-form" onSubmit={deposit}>
            <label className="amount-field"><span>₦</span><input aria-label="Test deposit amount in naira" type="number" min="500" max="500000" step="100" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} data-testid="input-deposit-amount" /></label>
            <button type="submit" className="dark-btn" disabled={initialize.isPending} data-testid="button-deposit">{initialize.isPending ? 'Opening checkout…' : 'Test deposit'} <ArrowRight size={16} /></button>
          </form>
          <div className="deposit-foot"><span>MIN ₦500</span><span>MAX ₦500,000</span><span>SECURE HOSTED CHECKOUT</span></div>
          {depositError && <InlineError>{depositError}</InlineError>}
        </section>
      </div>
      <div className="content-grid">
        <section className="play-section">
          <div className="section-head"><div><div className="section-overline">01 — FIND YOUR MATCH</div><h2>Pick your stakes.</h2></div><span className="fixed-tag">FIXED STAKES <ChevronDown size={14} /></span></div>
          <p className="section-intro">Choose a sandbox stake. We reserve it while you play.</p>
          <div className="stake-list"><StakeButton value={500} count={waitingCount(500)} selected={stake === 500} onClick={() => setStake(500)} /><StakeButton value={1000} count={waitingCount(1000)} selected={stake === 1000} onClick={() => setStake(1000)} /></div>
          {roomError && <InlineError>{roomError}</InlineError>}
          <button className="primary-btn match-btn" onClick={launch} disabled={join.isPending} data-testid="button-find-match">{join.isPending ? 'Finding a table…' : 'Find a match'} <ArrowRight size={18} /></button>
          <div className="stake-explain"><ShieldCheck size={15} /><span>Stake is reserved from your sandbox balance. This is not live money and no real payouts are made.</span></div>
          <div className="open-rooms">
            <div className="open-head"><div><div className="section-overline">WAITING TABLES</div><h3>Join someone in.</h3></div><span className="room-count">{lobby.data?.rooms.length ?? 0} OPEN</span></div>
            {lobby.isLoading ? <div className="room-skeleton"><span /><span /></div> : lobby.data?.rooms.length ? <div className="room-list">{lobby.data.rooms.map(room => <div className="room-row" key={room.id} data-testid={`row-room-${room.id}`}><span className="room-seat"><span className="seat-dot" />{room.hostUsername}</span><span className="room-wager">{money(room.stakeNaira)} <small>STAKE</small></span><button className="join-btn" onClick={() => { setRoomError(''); join.mutate({ data: { stakeNaira: room.stakeNaira } }, { onSuccess: joined => { void queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey() }); void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() }); setLocation(`/game/${joined.id}`); }, onError: () => setRoomError('Could not join. The table may have filled or your balance may be low.') }); }} disabled={join.isPending} data-testid={`button-join-${room.id}`}>Join <ArrowRight size={14} /></button></div>)}</div> : <div className="empty-rooms"><div className="empty-symbol"><Gamepad2 size={20} /></div><div><b>No waiting tables yet.</b><span>Start a match and someone can take the other seat.</span></div></div>}
          </div>
        </section>
        <section className="activity-section">
          <div className="section-head"><div><div className="section-overline">02 — YOUR LEDGER</div><h2>Recent activity.</h2></div><button className="refresh-button" onClick={() => void wallet.refetch()} aria-label="Refresh wallet" data-testid="button-refresh-wallet"><RefreshCw size={15} /></button></div>
          <div className="activity-summary"><span><Clock3 size={14} /> LAST TRANSACTIONS</span><span>₦ SANDBOX</span></div>
          {wallet.isLoading ? <LoadingBlock label="Loading activity" /> : wallet.isError ? <div className="empty-activity"><InlineError>Wallet activity unavailable. <button onClick={() => void wallet.refetch()} data-testid="button-retry-wallet">Retry</button></InlineError></div> : wallet.data?.transactions?.length ? <div className="transaction-list">{wallet.data.transactions.slice(0, 6).map(tx => <TransactionRow key={tx.id} transaction={tx} />)}</div> : <div className="empty-activity"><Sparkles size={18} /><b>A clean slate.</b><span>Your sandbox activity will show here.</span></div>}
          <div className="pay-note"><div className="pay-note-mark">₦</div><div><b>Test balances, always.</b><span>Every deposit and stake is sandbox-only. There are no live payouts.</span></div></div>
          <button className="help-link" onClick={() => setShowSandboxInfo(value => !value)} aria-expanded={showSandboxInfo} data-testid="button-sandbox-info"><CircleHelp size={15} /> What does sandbox mean?</button>
          {showSandboxInfo && <div className="sandbox-detail" data-testid="text-sandbox-info"><b>This is a test table.</b><span>Balances, deposits and match stakes are simulated. Paystack opens in test mode and no live money or real payouts are involved.</span></div>}
        </section>
      </div>
      <footer className="page-footer"><span>PLAY THE BOARD, NOT THE BALANCE.</span><span>LUDOROOM / NAIJA TABLE No. 01</span></footer>
    </div>
  </Shell>;
}

const pathCells: [number, number][] = [
  [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
];
function LudoBoard({ room, canMove, onMove }: { room: Room; canMove: boolean; onMove: (index: number) => void }) {
  const cells = new Map<string, string>();
  pathCells.forEach(([r,c], index) => cells.set(`${r}-${c}`, `track-${index}`));
  const homeRects = [{ cls: 'home-red', r: 0, c: 0 }, { cls: 'home-green', r: 0, c: 9 }, { cls: 'home-yellow', r: 9, c: 9 }, { cls: 'home-blue', r: 9, c: 0 }];
  const tokens = [
    ...room.board.redTokens.map((position, index) => ({ color: 'red', position, index })),
    ...room.board.greenTokens.map((position, index) => ({ color: 'green', position, index })),
  ];
  const myColor = room.myColor;
  return <div className="board-frame">
    <div className="board-grid" role="img" aria-label="Ludo match board, red and green player tokens">
      {Array.from({ length: 225 }, (_, index) => {
        const r = Math.floor(index / 15), c = index % 15; const key = `${r}-${c}`;
        const home = homeRects.find(item => r >= item.r && r < item.r + 6 && c >= item.c && c < item.c + 6);
        const track = cells.get(key);
        const isCenter = r >= 6 && r <= 8 && c >= 6 && c <= 8;
        const safe = [[6,1],[2,6],[1,8],[6,12],[8,13],[12,8],[13,6],[8,2]].some(([rr,cc]) => rr === r && cc === c);
        const tokensHere = tokens.filter(t => t.position >= 0 && pathCells[t.position % pathCells.length]?.[0] === r && pathCells[t.position % pathCells.length]?.[1] === c);
        const homeSlots = home?.cls === 'home-red' ? [[1,1],[1,4],[4,1],[4,4]] : home?.cls === 'home-green' ? [[1,10],[1,13],[4,10],[4,13]] : [];
        const homeTokensHere = homeSlots.flatMap(([rr,cc], slot) => {
          if (r !== rr || c !== cc) return [];
          const token = tokens.find(item => item.color === (home?.cls === 'home-red' ? 'red' : 'green') && item.index === slot && item.position < 0);
          return token ? [token] : [];
        });
        return <div key={index} className={`board-cell ${home?.cls || ''} ${track ? 'track-cell' : ''} ${safe ? 'safe-cell' : ''} ${isCenter ? 'center-cell' : ''}`}>
          {home && r === home.r + 2 && c === home.c + 2 && <span className={`home-center ${home.cls}`} />}
          {isCenter && <span className="center-star">✦</span>}
          {[...tokensHere, ...homeTokensHere].map(token => <button key={`${token.color}-${token.index}`} aria-label={`Move ${token.color} token ${token.index + 1}`} disabled={!canMove || token.color !== myColor} onClick={() => onMove(token.index)} className={`board-token ${token.color} ${canMove && token.color === myColor ? 'token-ready' : ''}`} data-testid={`button-token-${token.color}-${token.index}`} />)}
        </div>;
      })}
    </div>
    <div className="board-legend"><span><i className="legend-dot red" /> RED SEAT</span><span><i className="legend-dot green" /> GREEN SEAT</span><span><i className="legend-safe" /> SAFE SQUARE</span></div>
  </div>;
}

function GamePage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const roomQuery = useGetRoom(roomId, { query: { queryKey: getGetRoomQueryKey(roomId), refetchInterval: 2500, enabled: !!roomId } });
  const room = roomQuery.data; const user = current.data?.user;
  const roll = useRollDice(); const move = useMoveToken(); const cancel = useCancelRoom();
  const wallet = useGetWallet({ query: { queryKey: getGetWalletQueryKey(), enabled: !!user, refetchInterval: 15000 } });
  const [actionError, setActionError] = useState('');
  const isMyTurn = !!(room && user && room.board.turnUserId === user.id);
  const refreshRoom = () => { void queryClient.invalidateQueries({ queryKey: getGetRoomQueryKey(roomId) }); void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() }); };
  const action = (kind: 'roll' | 'move', tokenIndex?: number) => {
    setActionError('');
    const onSuccess = () => refreshRoom();
    const onError = () => setActionError('That move could not be completed. The board is refreshing.');
    if (kind === 'roll') roll.mutate({ roomId }, { onSuccess, onError });
    else move.mutate({ roomId, data: { tokenIndex: tokenIndex ?? 0 } }, { onSuccess, onError });
  };
  if (!user && current.isLoading) return <Shell><div className="page-content"><LoadingBlock label="Checking player seat" /></div></Shell>;
  if (!user) return <AuthFrame mode="login" heading="Your seat is reserved." copy="Sign in to return to this match."><Link className="primary-btn full" href="/login" data-testid="link-game-login">Sign in <ArrowRight size={17} /></Link></AuthFrame>;
  if (roomQuery.isLoading) return <Shell user={user}><div className="page-content"><LoadingBlock label="Setting the board" /></div></Shell>;
  if (roomQuery.isError || !room) return <Shell user={user}><div className="page-content"><div className="room-error"><div className="section-overline">TABLE NOT FOUND</div><h1>This board went quiet.</h1><p>It may have closed, or the match link may be out of date.</p><button className="primary-btn" onClick={() => setLocation('/')} data-testid="button-back-lobby">Back to lobby <ArrowRight size={16} /></button></div></div></Shell>;
  const opponent = room.hostUserId === user.id ? room.opponentUsername : room.hostUsername;
  const activeColor = room.myColor;
  const currentPlayerColor = isMyTurn ? activeColor : (activeColor === 'red' ? 'green' : 'red');
  const isWaiting = room.status === 'waiting';
  const isCompleted = room.status === 'completed' || room.status === 'cancelled';
  const isWaitingHost = isWaiting && room.hostUserId === user.id;
  const tokenArray = room.myColor === 'red' ? room.board.redTokens : room.board.greenTokens;
  const canMove = isMyTurn && room.board.hasRolled && !isCompleted;
  return <Shell user={user}>
    <div className="game-page page-in">
      <div className="game-nav"><button className="back-link" onClick={() => setLocation('/')} data-testid="button-return-lobby"><ArrowLeft size={16} /> Lobby</button><div className="match-code">ROOM <b>{room.id.slice(0, 8).toUpperCase()}</b></div><span className="sandbox-pill"><ShieldCheck size={14} /> SANDBOX</span></div>
      <div className="game-title-row"><div><div className="section-overline">TWO-PLAYER MATCH · {room.status.toUpperCase()}</div><h1>Make your <em>move.</em></h1></div><div className="stake-reserved"><span><span className="pulse-dot" /> STAKE RESERVED</span><b>{money(room.stakeNaira)}</b><small>Sandbox funds only</small></div></div>
      <div className="match-layout">
        <section className="board-column">
          <div className="player-strip">
            <div className={`player-chip ${isMyTurn ? 'turn-active' : ''}`}><span className={`player-avatar ${room.myColor}`}>{user.username.slice(0,1).toUpperCase()}</span><div><b>{user.username} <small>YOU</small></b><span>{room.myColor.toUpperCase()} SEAT</span></div>{isMyTurn && <span className="turn-marker">YOUR TURN</span>}</div>
            <div className="versus-mark">VS</div>
            <div className={`player-chip opponent ${!isMyTurn && !isWaiting ? 'turn-active' : ''}`}><span className={`player-avatar ${room.myColor === 'red' ? 'green' : 'red'}`}>{opponent?.slice(0,1).toUpperCase() || '·'}</span><div><b>{opponent || 'Waiting for player'}</b><span>{room.myColor === 'red' ? 'GREEN' : 'RED'} SEAT</span></div>{!isMyTurn && !isWaiting && <span className="turn-marker">THEIR TURN</span>}</div>
          </div>
          <LudoBoard room={room} canMove={canMove} onMove={index => action('move', index)} />
          {actionError && <InlineError>{actionError}</InlineError>}
          <div className="game-controls">
            <div className="dice-area"><div className={`dice-face ${room.board.dice ? 'die-roll' : ''}`} data-testid="text-dice-value">{room.board.dice || <span className="dice-dots">···</span>}</div><span className="dice-caption">{room.board.dice ? 'LAST ROLL' : 'YOUR DIE'}</span></div>
            <div className="control-copy"><b>{isCompleted ? (room.board.winnerUserId === user.id ? 'You took the table.' : 'Match complete.') : isWaiting ? 'Waiting for a challenger.' : isMyTurn ? (room.board.hasRolled ? 'Choose a token to move.' : 'Your turn. Roll the die.') : 'Opponent is thinking.'}</b><span>{isWaiting ? 'Your sandbox stake stays reserved while the room waits.' : isMyTurn && room.board.hasRolled ? 'Select one of your lit tokens on the board.' : 'The board updates as the match plays out.'}</span></div>
            <button className={`roll-btn ${isMyTurn && !room.board.hasRolled && !isCompleted ? 'roll-ready' : ''}`} disabled={!isMyTurn || room.board.hasRolled || isWaiting || isCompleted || roll.isPending} onClick={() => action('roll')} data-testid="button-roll-dice">{roll.isPending ? 'Rolling…' : 'Roll die'} <ArrowRight size={16} /></button>
          </div>
          {canMove && !tokenArray.some(position => position >= 0) && <div className="move-hint">No movable tokens are visible for this roll. The match state will refresh automatically.</div>}
          {isWaitingHost && <div className="waiting-controls"><div><span className="pulse-dot" /> ROOM OPEN</div><button className="quiet-btn" disabled={cancel.isPending} onClick={() => cancel.mutate({ roomId }, { onSuccess: () => { refreshRoom(); setLocation('/'); }, onError: () => setActionError('Could not cancel this room. Try again.') })} data-testid="button-cancel-room">{cancel.isPending ? 'Closing table…' : 'Cancel table'}</button></div>}
          {isWaiting && !isWaitingHost && <div className="waiting-banner"><Clock3 size={17} /> Waiting for {room.hostUsername} to start the match.</div>}
          {isCompleted && <div className="completed-banner"><BadgeCheck size={18} /> Match closed. Reserved sandbox stake status is reflected in your wallet.</div>}
        </section>
        <aside className="match-sidebar">
          <div className="sidebar-card match-status-card"><div className="section-overline">MATCH STATUS</div><h3>{isWaiting ? 'Seat open.' : isCompleted ? 'Match finished.' : 'In play.'}</h3><p>{isWaiting ? 'Another player can join from the lobby at the same fixed stake.' : isCompleted ? 'This was a sandbox match. No live payout was made.' : 'One turn at a time. Keep your eyes on the board.'}</p><div className="status-line"><span>Room</span><b>{room.id.slice(0, 12)}</b></div><div className="status-line"><span>Fixed stake</span><b>{money(room.stakeNaira)}</b></div><div className="status-line"><span>Reserved</span><b>{money(wallet.data?.escrowedNaira ?? room.stakeNaira)}</b></div><div className="status-foot"><ShieldCheck size={14} /> NOT LIVE MONEY</div></div>
          <div className="sidebar-card how-card"><div className="section-overline">QUICK REMINDER</div><h3>Play it smart.</h3><ol><li><span>01</span>Roll only when it is your turn.</li><li><span>02</span>Pick one of your active tokens.</li><li><span>03</span>Six gets a token moving.</li></ol></div>
          <div className="sidebar-help"><span className="help-icon"><CircleHelp size={15} /></span><div><b>Sandbox match</b><p>Stakes are reserved test credits. No real funds or payouts.</p></div></div>
        </aside>
      </div>
      <footer className="page-footer"><span>BOARD STATE REFRESHES AUTOMATICALLY</span><span>TEST MATCH · ROOM {room.id.slice(0, 6).toUpperCase()}</span></footer>
    </div>
  </Shell>;
}

function Router() {
  return <RoutedErrorBoundary><Switch>
    <Route path="/" component={LobbyPage} />
    <Route path="/login" component={LoginPage} />
    <Route path="/register" component={RegisterPage} />
    <Route path="/game/:roomId" component={GamePage} />
    <Route component={NotFound} />
  </Switch></RoutedErrorBoundary>;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;