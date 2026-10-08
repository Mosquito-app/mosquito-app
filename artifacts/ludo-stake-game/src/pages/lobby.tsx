import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Coins, Gamepad2, Play, RefreshCw, ShieldCheck, Sparkles, Wallet } from 'lucide-react';
import {
  getGetLobbyQueryKey, getGetRoomQueryKey, getGetWalletQueryKey, useGetCurrentUser, useGetLobby,
  useGetWallet, useInitializeDeposit, useJoinRoom, useLogout, getGetCurrentUserQueryKey,
  useGetFootballLobby, useJoinFootballRoom, getGetFootballLobbyQueryKey, getGetFootballRoomQueryKey,
} from '@workspace/api-client-react';
import type { Room, FootballRoom, WalletTransaction } from '@workspace/api-client-react';
import { queryClient } from '@/lib/query-client';
import { AuthFrame, InlineError, LoadingBlock, Shell, dateLabel, money } from '@/components/common';
import { DepositReturn, rememberDeposit } from '@/components/deposit-return';
import { StatusPill, VerifyButton, WithdrawDialog } from '@/components/withdraw-dialog';
import { useRealtime } from '@/hooks/use-realtime';
import { ClubPicker } from '@/components/football-club-picker';
import { hasWebGL2, loadClub, saveClub, WEBGL_MSG } from '@/components/football-3d/clubs';
import type { FootballClubId } from '@/components/football-3d/types';

type Stake = 500 | 1000 | 2000;
const STAKES: Stake[] = [500, 1000, 2000];
const GAMES = [
  { name: 'Ludo Duel', active: true, note: 'Two players, one shared table' },
  { name: 'Whot', active: false, note: 'Card duel' },
  { name: 'Draft', active: false, note: 'Board classic' },
  { name: '11v11 Football Duel', active: true, note: 'Two 3-minute halves · Golden goal' },
  { name: '8-Ball Pool', active: false, note: 'Cue sports' },
];

function TransactionRow({ transaction }: { transaction: WalletTransaction }) {
  const positive = transaction.amountNaira >= 0;
  return <div className="transaction-row" data-testid={`row-transaction-${transaction.id}`}>
    <span className={`tx-icon ${positive ? 'tx-in' : 'tx-out'}`}>{positive ? <ArrowDownLeft size={16} /> : <Coins size={16} />}</span>
    <span className="tx-description"><b>{transaction.description || transaction.type.replace(/_/g, ' ')}</b><small>Mosquito Wallet · {dateLabel(transaction.createdAt)}</small></span>
    <span className={`tx-amount ${positive ? 'positive' : ''}`}>{positive ? '+' : '−'}{money(Math.abs(transaction.amountNaira))}</span>
  </div>;
}

export default function LobbyPage() {
  const [, setLocation] = useLocation();
  const current = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false } });
  const user = current.data?.user;
  const conn = useRealtime(!!user);
  const wallet = useGetWallet({ query: { queryKey: getGetWalletQueryKey(), enabled: !!user, refetchInterval: 10000 } });
  const lobby = useGetLobby({ query: { queryKey: getGetLobbyQueryKey(), enabled: !!user, refetchInterval: 10000 } });
  const footballLobby = useGetFootballLobby({ query: { queryKey: getGetFootballLobbyQueryKey(), enabled: !!user, refetchInterval: 3000 } });
  const joinFootball = useJoinFootballRoom();
  const [mode, setMode] = useState<'ludo' | 'football'>('ludo');
  const join = useJoinRoom(); const logout = useLogout(); const initialize = useInitializeDeposit();
  const [stake, setStake] = useState<Stake>(500);
  const [club, setClub] = useState<FootballClubId>(loadClub);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('2000');
  const [depositError, setDepositError] = useState('');
  const [roomError, setRoomError] = useState('');
  const myRoomId = lobby.data?.myRoomId ?? null;
  const footballRoom = footballLobby.data?.myRoom;
  const currentRoomId = mode === 'football' ? footballRoom?.id : myRoomId;
  const openRooms = mode === 'football' ? footballLobby.data?.rooms : lobby.data?.rooms;
  const finding = mode === 'football' ? joinFootball.isPending : join.isPending;
  const roomsLoading = mode === 'football' ? footballLobby.isLoading : lobby.isLoading;
  const counts = lobby.data?.stakeCounts || [];
  const waiting = (value: number) => mode === 'football' ? footballLobby.data?.rooms.filter(r => r.stakeNaira === value).length ?? 0 : counts.find(item => item.stakeNaira === value)?.waitingPlayers || 0;
  const w = wallet.data;
  const entered = (room: Room) => {
    queryClient.setQueryData(getGetRoomQueryKey(room.id), room);
    void queryClient.invalidateQueries({ queryKey: getGetLobbyQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    setLocation(`/game/${room.id}`);
  };
  const enteredFootball = (room: FootballRoom) => {
    queryClient.setQueryData(getGetFootballRoomQueryKey(room.id), room);
    void queryClient.invalidateQueries({ queryKey: getGetFootballLobbyQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    setLocation(`/football/${room.id}`);
  };
  const play = (value: Stake, roomId?: string) => {
    setRoomError('');
    if (mode === 'football') {
      if (!hasWebGL2()) { setRoomError(WEBGL_MSG); return; }
      joinFootball.mutate({ data: { stakeNaira: value, ...(roomId ? { roomId } : {}), club } }, {
        onSuccess: enteredFootball,
        onError: () => setRoomError('Could not join football. Both players need enough available test funds; the room may already be taken.'),
      });
    } else join.mutate({ data: { stakeNaira: value, ...(roomId ? { roomId } : {}) } }, {
      onSuccess: entered, onError: () => setRoomError('Could not reserve that sandbox stake. Check your available balance, or resume your open table.'),
    });
  };
  const deposit = (event: FormEvent) => {
    event.preventDefault(); setDepositError('');
    const amount = Number(depositAmount);
    if (!Number.isFinite(amount) || amount < 500 || amount > 500000) return setDepositError('Choose an amount between ₦500 and ₦500,000.');
    initialize.mutate({ data: { amountNaira: amount } }, { onSuccess: result => { rememberDeposit(result.reference); window.location.assign(result.authorizationUrl); }, onError: () => setDepositError('Could not start a Paystack test checkout. Please try again.') });
  };
  if (current.isLoading) return <Shell><div className="page-content"><LoadingBlock label="Checking your session" /></div></Shell>;
  if (!user) return <AuthFrame mode="login" heading="The table is open." copy="Sign in or create a local player account to see the lobby."><div className="guest-cta"><Link className="primary-btn full" href="/login" data-testid="link-signin">Sign in to play <ArrowRight size={17} /></Link><Link className="text-link" href="/register" data-testid="link-create-account">Create a player account</Link></div></AuthFrame>;
  return <Shell user={user} onLogout={() => logout.mutate(undefined, { onSettled: () => { queryClient.clear(); setLocation('/login'); } })}>
    <DepositReturn />
    <div className="page-content page-in">
      <div className="welcome-line"><div><div className="section-overline"><span className="live-dot" /> MOSQUITO APP · {conn === 'live' ? 'LIVE' : conn === 'connecting' ? 'CONNECTING' : 'RECONNECTING'}</div><h1>Good evening, <em>{user.username}</em><span className="period">.</span></h1></div></div>
      {lobby.isError && <div className="error-banner"><InlineError>Lobby updates paused. <button onClick={() => void lobby.refetch()} data-testid="button-retry-lobby">Retry</button></InlineError></div>}
      <section className="balance-panel wallet-clean">
        <div className="balance-top"><div><div className="panel-kicker">MOSQUITO WALLET · SANDBOX</div><div className="balance-label">Total balance</div></div><span className="wallet-stamp"><Wallet size={17} /></span></div>
        {wallet.isLoading ? <div className="balance-value skeleton-line wide" /> : wallet.isError ? <div className="balance-value">— <button className="quiet-btn" onClick={() => void wallet.refetch()} data-testid="button-retry-wallet">Retry</button></div> : <div className="balance-value" data-testid="text-wallet-total">{money(w?.totalBalanceNaira ?? user.balanceNaira)}</div>}
        <div className="wallet-split">
          <div><span>AVAILABLE</span><strong data-testid="text-wallet-balance">{money(w?.balanceNaira ?? 0)}</strong></div>
          <div><span>IN MATCHES</span><strong data-testid="text-escrow-balance">{money(w?.escrowedNaira ?? 0)}</strong></div>
          <div><span>WITHDRAWAL HELD</span><strong data-testid="text-withdrawal-held">{money(w?.withdrawalHeldNaira ?? 0)}</strong></div>
        </div>
        <div className="wallet-actions">
          <button className="primary-btn" onClick={() => setDepositOpen(v => !v)} aria-expanded={depositOpen} data-testid="button-deposit-open"><ArrowDownLeft size={16} /> Deposit</button>
          <button className="dark-btn wallet-wd" onClick={() => setWithdrawOpen(true)} data-testid="button-withdraw-open"><ArrowUpRight size={16} /> Withdraw</button>
          <span className="sandbox-caption"><ShieldCheck size={14} /> Test balance only. Not real bank money.</span>
        </div>
        {depositOpen && <form className="deposit-form wallet-deposit" onSubmit={deposit}>
          <div className="wallet-deposit-heading">Mosquito Wallet · Test deposit</div>
          <label className="amount-field"><span>₦</span><input aria-label="Test deposit amount in naira" type="number" min="500" max="500000" step="100" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} data-testid="input-deposit-amount" /></label>
          <button type="submit" className="dark-btn" disabled={initialize.isPending} data-testid="button-deposit">{initialize.isPending ? 'Opening checkout…' : 'Continue to Paystack test'} <ArrowRight size={16} /></button>
          {depositError && <InlineError>{depositError}</InlineError>}
        </form>}
      </section>

      {myRoomId && <div className="resume-banner" data-testid="banner-resume"><div><span className="pulse-dot" /> You have an open table.</div><Link href={`/game/${myRoomId}`} className="primary-btn" data-testid="link-resume-room"><Play size={15} /> Resume table</Link></div>}
      {footballRoom && <div className="resume-banner" data-testid="banner-resume-football"><div><span className="pulse-dot" /> Your 11v11 football room is {footballRoom.status}.</div><Link href={`/football/${footballRoom.id}`} className="primary-btn" data-testid="link-resume-football"><Play size={15} /> Resume football</Link></div>}

      <div className="room-pulse" data-testid="strip-room-pulse">
        <span><b>{openRooms?.length ?? 0}</b> open {mode === 'football' ? 'football rooms' : 'tables'}</span>
        <span><b>{STAKES.reduce((n, v) => n + waiting(v), 0)}</b> players waiting</span>
        <span className={currentRoomId ? 'live' : ''}>{currentRoomId ? 'Your table is active' : 'No active table'}</span>
      </div>
      <section className="games-section">
        <div className="section-head"><div><div className="section-overline">GAMES</div><h2>Choose a game.</h2></div></div>
        <div className="game-cards">{GAMES.map(game => <button type="button" key={game.name} className={`game-card ${game.active ? 'active' : 'soon'} ${game.active && ((mode === 'ludo') === (game.name === 'Ludo Duel')) ? 'chosen' : ''}`} disabled={!game.active} aria-pressed={game.active && ((mode === 'ludo') === (game.name === 'Ludo Duel'))} onClick={() => { setMode(game.name === 'Ludo Duel' ? 'ludo' : 'football'); setRoomError(''); }} data-testid={`card-game-${game.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
          <Gamepad2 size={20} /><b>{game.name}</b><small>{game.note}</small><span className="game-badge">{game.active ? 'Active' : 'Coming Soon'}</span>
        </button>)}</div>
      </section>

      <div className="content-grid">
        <section className="play-section">
          <div className="section-head"><div><div className="section-overline">{mode === 'football' ? '11V11 FOOTBALL DUEL' : 'LUDO DUEL'}</div><h2>Pick your stakes.</h2></div></div>
          <p className="section-intro">{mode === 'football' ? 'Two 3-minute halves, no added time, no halftime break. Two full teams. A tied match goes to golden goal. Stakes lock when both players join. ' : 'Each player stakes the amount. '}Winner takes 90% of the pot; 10% is the table commission.</p>
          <div className="stake-list">{STAKES.map(value => <button key={value} className={`stake-option ${stake === value ? 'selected' : ''}`} onClick={() => setStake(value)} data-testid={`button-stake-${value}`}>
            <span className="stake-radio">{stake === value && <i />}</span><span className="stake-price">{money(value)}</span><span className="stake-foot">Pot {money(value * 2)} · Prize {money(value * 1.8)} · {waiting(value)} waiting</span><ArrowRight className="stake-arrow" size={17} /></button>)}</div>
          {mode === 'football' && <div className="fb-club-row"><small>YOUR CLUB (PRIMARY KIT COLOURS)</small><ClubPicker value={club} onChange={v => { setClub(v); saveClub(v); }} testPrefix="football" /></div>}
          {roomError && <InlineError>{roomError}</InlineError>}
          <button className="primary-btn match-btn" onClick={() => play(stake)} disabled={finding || !!currentRoomId} data-testid="button-find-match">{finding ? 'Finding an opponent…' : currentRoomId ? 'Resume your match first' : mode === 'football' ? 'Play 11v11 Football' : 'Find a match'} <ArrowRight size={18} /></button>
          <div className="stake-explain"><ShieldCheck size={15} /><span>{mode === 'football' ? 'Waiting is free. Both stakes enter escrow together at kickoff. Test funds only.' : 'Stake is reserved from your available sandbox balance. Test funds only.'}</span></div>
          {mode === 'football' && footballLobby.isError && <InlineError>Football lobby unavailable. <button onClick={() => void footballLobby.refetch()}>Retry</button></InlineError>}
          <div className="open-rooms">
            <div className="open-head"><div><div className="section-overline">WAITING {mode === 'football' ? 'FOOTBALL ROOMS' : 'TABLES'}</div><h3>Join someone in.</h3></div><span className="room-count">{openRooms?.length ?? 0} OPEN</span></div>
            {roomsLoading ? <div className="room-skeleton"><span /><span /></div> : openRooms?.length ? <div className="room-list">{openRooms.map(room => { const mine = room.id === currentRoomId || room.hostUsername === user.username; return <div className="room-row" key={room.id} data-testid={`row-room-${room.id}`}><span className="room-seat"><span className="seat-dot" />{room.hostUsername}{mine && ' (you)'}</span><span className="room-wager">{money(room.stakeNaira)} <small>STAKE</small></span>{mine ? <Link href={`/${mode === 'football' ? 'football' : 'game'}/${room.id}`} className="join-btn" data-testid={`link-open-${room.id}`}>Open</Link> : <button className="join-btn" onClick={() => play(room.stakeNaira as Stake, room.id)} disabled={finding || !!currentRoomId} data-testid={`button-join-${room.id}`}>Join <ArrowRight size={14} /></button>}</div>; })}</div> : <div className="empty-rooms"><div className="empty-symbol"><Gamepad2 size={20} /></div><div><b>No waiting matches yet.</b><span>Start a match and a friend can join from this lobby.</span></div></div>}
          </div>
        </section>
        <section className="activity-section">
          <div className="section-head"><div><div className="section-overline">MOSQUITO WALLET LEDGER</div><h2>Recent activity.</h2></div><button className="refresh-button" onClick={() => void wallet.refetch()} aria-label="Refresh Mosquito Wallet" data-testid="button-refresh-wallet"><RefreshCw size={15} /></button></div>
          {w?.withdrawals?.length ? <div className="wd-list">{w.withdrawals.slice(0, 4).map(x => <div className="wd-row" key={x.id} data-testid={`row-withdrawal-${x.id}`}><span><b>{money(x.amountNaira)}</b><small>{dateLabel(x.createdAt)} · {x.reference}</small></span><StatusPill status={x.status} />{x.status === 'pending' && <VerifyButton id={x.id} />}</div>)}</div> : null}
          {wallet.isLoading ? <LoadingBlock label="Loading activity" /> : wallet.isError ? <div className="empty-activity"><InlineError>Wallet activity unavailable. <button onClick={() => void wallet.refetch()}>Retry</button></InlineError></div> : w?.transactions?.length ? <div className="transaction-list">{w.transactions.slice(0, 8).map(tx => <TransactionRow key={tx.id} transaction={tx} />)}</div> : <div className="empty-activity"><Sparkles size={18} /><b>A clean slate.</b><span>Your sandbox activity will show here.</span></div>}
          <div className="pay-note"><div className="pay-note-mark">₦</div><div><b>Test balances, always.</b><span>Deposits and withdrawals run through Paystack test mode. No real bank money.</span></div></div>
        </section>
      </div>
    </div>
    {withdrawOpen && <WithdrawDialog available={w?.balanceNaira ?? 0} onClose={() => setWithdrawOpen(false)} />}
  </Shell>;
}
