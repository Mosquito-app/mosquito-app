import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Coins, Gamepad2, Play, RefreshCw, ShieldCheck, Sparkles, Wallet } from 'lucide-react';
import {
  getGetLobbyQueryKey, getGetRoomQueryKey, getGetWalletQueryKey, useGetCurrentUser, useGetLobby,
  useGetWallet, useInitializeDeposit, useJoinRoom, useLogout, getGetCurrentUserQueryKey,
  useGetFootballLobby, useJoinFootballRoom, getGetFootballLobbyQueryKey, getGetFootballRoomQueryKey,
} from '@workspace/api-client-react';
import type { Room, FootballRoom, WalletTransaction, WalletResponse, JoinRoomInputTierId } from '@workspace/api-client-react';
import { queryClient } from '@/lib/query-client';
import { AuthFrame, InlineError, LoadingBlock, Shell, dateLabel, money } from '@/components/common';
import { LudoRoomBrowser } from '@/components/ludo-room-browser';
import { DepositReturn, rememberDeposit } from '@/components/deposit-return';
import { StatusPill, VerifyButton, WithdrawDialog } from '@/components/withdraw-dialog';
import { useRealtime } from '@/hooks/use-realtime';
import { ClubPicker } from '@/components/football-club-picker';
import { hasWebGL2, loadClub, saveClub, WEBGL_MSG } from '@/components/football-3d/clubs';
import type { FootballClubId } from '@/components/football-3d/types';

type FootballStake = 500 | 1000 | 2000;
const FOOTBALL_STAKES: FootballStake[] = [500, 1000, 2000];
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

function WalletActivity({ data, isLoading, isError, onRefresh }: {
  data?: WalletResponse;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => void;
}) {
  const w = data;
  return <section className="activity-section">
    <div className="section-head"><div><div className="section-overline">MOSQUITO WALLET LEDGER</div><h2>Recent activity.</h2></div><button className="refresh-button" onClick={onRefresh} aria-label="Refresh Mosquito Wallet" data-testid="button-refresh-wallet"><RefreshCw size={15} /></button></div>
    {w?.withdrawals?.length ? <div className="wd-list">{w.withdrawals.slice(0, 4).map(x => <div className="wd-row" key={x.id} data-testid={`row-withdrawal-${x.id}`}><span><b>{money(x.amountNaira)}</b><small>{dateLabel(x.createdAt)} · {x.reference}</small></span><StatusPill status={x.status} />{x.status === 'pending' && <VerifyButton id={x.id} />}</div>)}</div> : null}
    {isLoading ? <LoadingBlock label="Loading activity" /> : isError ? <div className="empty-activity"><InlineError>Wallet activity unavailable. <button onClick={onRefresh}>Retry</button></InlineError></div> : w?.transactions?.length ? <div className="transaction-list">{w.transactions.slice(0, 8).map(tx => <TransactionRow key={tx.id} transaction={tx} />)}</div> : <div className="empty-activity"><Sparkles size={18} /><b>A clean slate.</b><span>Your sandbox activity will show here.</span></div>}
    <div className="pay-note"><div className="pay-note-mark">₦</div><div><b>Test balances, always.</b><span>Deposits and withdrawals run through Paystack test mode. No real bank money.</span></div></div>
  </section>;
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
  const [mode, setMode] = useState<'home' | 'ludo' | 'football'>('home');
  const join = useJoinRoom(); const logout = useLogout(); const initialize = useInitializeDeposit();
  const [club, setClub] = useState<FootballClubId>(loadClub);
  const [confirming, setConfirming] = useState<{ tierId: JoinRoomInputTierId; roomId?: string } | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('2000');
  const [depositError, setDepositError] = useState('');
  const [roomError, setRoomError] = useState('');
  const myRoomId = lobby.data?.myRoomId ?? null;
  const footballRoom = footballLobby.data?.myRoom;
  const currentRoomId = mode === 'football' ? footballRoom?.id ?? null : mode === 'ludo' ? myRoomId : myRoomId ?? footballRoom?.id ?? null;
  const finding = mode === 'football' ? joinFootball.isPending : join.isPending;
  const roomsLoading = mode === 'football' ? footballLobby.isLoading : lobby.isLoading;
  const w = wallet.data;
  const selectedTier = confirming ? lobby.data?.tiers.find(tier => tier.id === confirming.tierId) : undefined;
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
  const requestLudoJoin = (tierId: JoinRoomInputTierId, roomId?: string) => {
    setRoomError('');
    setConfirming({ tierId, ...(roomId ? { roomId } : {}) });
  };
  const playFootball = (value: FootballStake, roomId?: string) => {
    setRoomError('');
    if (!hasWebGL2()) { setRoomError(WEBGL_MSG); return; }
    joinFootball.mutate({ data: { stakeNaira: value, ...(roomId ? { roomId } : {}), club } }, {
      onSuccess: enteredFootball,
      onError: () => setRoomError('Could not join football. Both players need enough available test funds; the room may already be taken.'),
    });
  };
  const confirmLudoJoin = () => {
    if (!confirming || !selectedTier || (w?.balanceNaira ?? 0) < selectedTier.stakeNaira) return;
    setRoomError('');
    join.mutate({ data: { tierId: confirming.tierId, ...(confirming.roomId ? { roomId: confirming.roomId } : {}) } }, {
      onSuccess: room => { setConfirming(null); entered(room); },
      onError: () => setRoomError('Could not reserve that sandbox stake. Check your available balance, or the room may have filled.'),
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
  return <Shell user={user} roomPicker={mode === 'ludo'} onLogout={() => logout.mutate(undefined, { onSettled: () => { queryClient.clear(); setLocation('/login'); } })}>
    <DepositReturn />
    {mode === 'ludo' ? (
      <div className="page-content page-in ludo-room-page">
        <LudoRoomBrowser
          username={user.username}
          availableBalance={w?.balanceNaira ?? user.balanceNaira}
          tiers={lobby.data?.tiers ?? []}
          rooms={lobby.data?.rooms ?? []}
          isLoading={lobby.isLoading}
          isError={lobby.isError}
          roomError={roomError}
          isJoining={finding}
          currentRoomId={myRoomId}
          resumeRoomHref={myRoomId ? `/game/${myRoomId}` : undefined}
          onBack={() => { setMode('home'); setRoomError(''); }}
          onAddFunds={() => { setMode('home'); setDepositOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          onRetry={() => void lobby.refetch()}
          onJoin={requestLudoJoin}
        />
      </div>
    ) : (
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

        {mode === 'home' ? (
          <>
            <div className="room-pulse" data-testid="strip-room-pulse">
              <span><b>{lobby.data?.rooms.length ?? 0}</b> open tables</span>
              <span><b>{lobby.data?.rooms.reduce((n, room) => n + room.playerCount, 0) ?? 0}</b> players in open rooms</span>
              <span className={currentRoomId ? 'live' : ''}>{currentRoomId ? 'You have an active room' : 'Ready for a match'}</span>
            </div>
            <section className="games-section">
              <div className="section-head"><div><div className="section-overline">GAMES</div><h2>Choose a game.</h2></div></div>
              <div className="game-cards">{GAMES.map(game => {
                return <button type="button" key={game.name} className={`game-card ${game.active ? 'active' : 'soon'}`} disabled={!game.active} aria-pressed={false} onClick={() => { setMode(game.name === 'Ludo Duel' ? 'ludo' : 'football'); setRoomError(''); }} data-testid={`card-game-${game.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                  <Gamepad2 size={20} /><b>{game.name}</b><small>{game.note}</small><span className="game-badge">{game.active ? 'Active' : 'Coming Soon'}</span>
                </button>;
              })}</div>
            </section>
            <WalletActivity data={w} isLoading={wallet.isLoading} isError={wallet.isError} onRefresh={() => { void wallet.refetch(); }} />
          </>
        ) : (
          <>
            <button type="button" className="back-to-games" onClick={() => { setMode('home'); setRoomError(''); }} data-testid="button-back-to-games"><ArrowDownLeft size={15} /> Back to games</button>
            <div className="content-grid">
              <section className="play-section">
                <div className="section-head"><div><div className="section-overline">11V11 FOOTBALL DUEL</div><h2>Pick your stakes.</h2></div></div>
                <p className="section-intro">Two 3-minute halves, no added time, no halftime break. Two full teams. A tied match goes to golden goal. Stakes lock when both players join. Winner takes 90% of the pot; 10% is the table commission.</p>
                <div className="stake-list">{FOOTBALL_STAKES.map(value => <button key={value} className="stake-option" onClick={() => playFootball(value)} disabled={finding || !!currentRoomId} data-testid={`button-stake-${value}`}>
                  <span className="stake-radio"><i /></span><span className="stake-price">{money(value)}</span><span className="stake-foot">Stake each · Pot {money(value * 2)} · Prize {money(value * 1.8)}</span><ArrowRight className="stake-arrow" size={17} /></button>)}</div>
                <div className="fb-club-row"><small>YOUR CLUB (PRIMARY KIT COLOURS)</small><ClubPicker value={club} onChange={v => { setClub(v); saveClub(v); }} testPrefix="football" /></div>
                {roomError && <InlineError>{roomError}</InlineError>}
                <div className="stake-explain"><ShieldCheck size={15} /><span>Waiting is free. Both stakes enter escrow together at kickoff. Test funds only.</span></div>
                {footballLobby.isError && <InlineError>Football lobby unavailable. <button onClick={() => void footballLobby.refetch()}>Retry</button></InlineError>}
                <div className="open-rooms">
                  <div className="open-head"><div><div className="section-overline">WAITING FOOTBALL ROOMS</div><h3>Join someone in.</h3></div><span className="room-count">{footballLobby.data?.rooms.length ?? 0} OPEN</span></div>
                  {roomsLoading ? <div className="room-skeleton"><span /><span /></div> : footballLobby.data?.rooms.length
                    ? <div className="room-list">{footballLobby.data.rooms.map(room => <div className="room-row" key={room.id} data-testid={`row-room-${room.id}`}><span className="room-seat"><span className="seat-dot" />{room.hostUsername}</span><span className="room-wager">{money(room.stakeNaira)} <small>STAKE</small></span><button className="join-btn" onClick={() => playFootball(room.stakeNaira as FootballStake, room.id)} disabled={finding || !!currentRoomId} data-testid={`button-join-${room.id}`}>Join <ArrowRight size={14} /></button></div>)}</div>
                    : <div className="empty-rooms"><div className="empty-symbol"><Gamepad2 size={20} /></div><div><b>No waiting football rooms yet.</b><span>Choose a stake to open a room.</span></div></div>}
                </div>
              </section>
              <WalletActivity data={w} isLoading={wallet.isLoading} isError={wallet.isError} onRefresh={() => { void wallet.refetch(); }} />
            </div>
          </>
        )}
      </div>
    )}
    {withdrawOpen && <WithdrawDialog available={w?.balanceNaira ?? 0} onClose={() => setWithdrawOpen(false)} />}
    {confirming && selectedTier && <div className="join-confirm-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setConfirming(null); }}>
      <section className="join-confirm-card" role="dialog" aria-modal="true" aria-labelledby="join-confirm-title" data-testid="dialog-entry-confirmation">
        <button type="button" className="join-confirm-close" aria-label="Close entry confirmation" onClick={() => setConfirming(null)}>×</button>
        <div className="section-overline">MOSQUITO WALLET · ENTRY</div>
        <h2 id="join-confirm-title">Join {selectedTier.name}?</h2>
        <p>Your entry is reserved from your available wallet balance as soon as you join the room.</p>
        <dl className="join-confirm-details">
          <div><dt>Entry fee</dt><dd>{selectedTier.stakeNaira === 0 ? 'Free' : money(selectedTier.stakeNaira)}</dd></div>
          <div><dt>Room size</dt><dd>{selectedTier.maxPlayers === 2 ? '2 players' : '2–4 players'}</dd></div>
          <div><dt>Pot at 2 players</dt><dd>{money(selectedTier.minPotNaira)}</dd></div>
          {selectedTier.maxPlayers > 2 && <div><dt>Pot at 4 players</dt><dd>{money(selectedTier.maxPotNaira)}</dd></div>}
          <div><dt>Available balance</dt><dd>{wallet.isLoading ? 'Loading…' : money(w?.balanceNaira ?? 0)}</dd></div>
        </dl>
        {selectedTier.stakeNaira > (w?.balanceNaira ?? 0) && <div className="join-confirm-shortfall" role="alert">
          Your available balance is below this entry fee. Add test funds before joining.
        </div>}
        {roomError && <InlineError>{roomError}</InlineError>}
        <div className="join-confirm-actions">
          {selectedTier.stakeNaira > (w?.balanceNaira ?? 0)
            ? <button type="button" className="primary-btn" onClick={() => { setConfirming(null); setMode('home'); setDepositOpen(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Add funds <ArrowRight size={16} /></button>
            : <button type="button" className="primary-btn" onClick={confirmLudoJoin} disabled={join.isPending || wallet.isLoading || !!currentRoomId} data-testid="button-confirm-entry">
              {join.isPending ? 'Reserving entry…' : selectedTier.stakeNaira === 0 ? 'Join free room' : 'Confirm and reserve'} <ArrowRight size={16} />
            </button>}
          <button type="button" className="quiet-btn" onClick={() => setConfirming(null)}>Not now</button>
        </div>
        <small className="join-confirm-note">Sandbox balance only. The 90% / 10% settlement is applied when the match ends.</small>
      </section>
    </div>}
  </Shell>;
}
