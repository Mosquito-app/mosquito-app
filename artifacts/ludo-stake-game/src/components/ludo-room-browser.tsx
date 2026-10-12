import { Bell, Bot, ChevronLeft, Coins, Plus, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import type { JoinRoomInputTierId, LobbyRoom, RoomTier } from '@workspace/api-client-react';
import { Brand, InlineError, LoadingBlock, money } from '@/components/common';

type LudoRoomBrowserProps = {
  username: string;
  availableBalance: number;
  tiers: RoomTier[];
  rooms: LobbyRoom[];
  isLoading: boolean;
  isError: boolean;
  roomError: string;
  isJoining: boolean;
  currentRoomId: string | null;
  resumeRoomHref?: string;
  onBack: () => void;
  onAddFunds: () => void;
  onRetry: () => void;
  onJoin: (tierId: JoinRoomInputTierId, roomId?: string) => void;
  onPlayAi: () => void;
};

export function LudoRoomBrowser({
  username,
  availableBalance,
  tiers,
  rooms,
  isLoading,
  isError,
  roomError,
  isJoining,
  currentRoomId,
  resumeRoomHref,
  onBack,
  onAddFunds,
  onRetry,
  onJoin,
  onPlayAi,
}: LudoRoomBrowserProps) {
  return (
    <div className="ludo-room-browser">
      <header className="ludo-room-header">
        <div className="ludo-room-user-avatar" aria-hidden="true">{username.slice(0, 1).toUpperCase()}</div>
        <Brand />
        <div className="ludo-room-wallet">
          <span className="ludo-room-balance" data-testid="text-room-wallet-balance">{money(availableBalance)}</span>
          <button type="button" className="ludo-room-add" aria-label="Add money to Mosquito Wallet" onClick={onAddFunds}>
            <Plus size={22} />
          </button>
        </div>
      </header>

      <main className="ludo-room-main">
        <div className="ludo-room-back-row">
          <button type="button" className="ludo-room-back" onClick={onBack} aria-label="Back to game lobby" data-testid="button-back-to-lobby">
            <ChevronLeft size={26} />
          </button>
          <span className="ludo-room-page-label">LUDO DUEL · ROOM LOBBY</span>
        </div>
        <h1 className="ludo-room-visually-hidden">Choose a Ludo room</h1>

        {currentRoomId && (
          <div className="ludo-room-resume" data-testid="banner-resume">
            <span><i /> You already have an open table.</span>
            {resumeRoomHref && <Link href={resumeRoomHref}>Resume table <ChevronLeft size={15} /></Link>}
          </div>
        )}

        {roomError && <div className="ludo-room-error"><InlineError>{roomError}</InlineError></div>}
        {isError && (
          <div className="ludo-room-error">
            <InlineError>Room tiers are unavailable right now. <button type="button" onClick={onRetry}>Retry</button></InlineError>
          </div>
        )}

        <section className="ludo-ai-practice" aria-labelledby="ludo-ai-title">
          <div className="ludo-ai-copy">
            <span className="ludo-ai-icon" aria-hidden="true"><Bot size={18} /></span>
            <span><strong id="ludo-ai-title">Play with AI</strong><small>Free practice · no wallet stake</small></span>
          </div>
          <button
            type="button"
            className="ludo-ai-button"
            onClick={onPlayAi}
            disabled={isJoining || !!currentRoomId}
            data-testid="button-play-with-ai"
          >
            {isJoining ? 'Starting…' : 'Start practice'}
          </button>
        </section>

        {isLoading && tiers.length === 0 ? (
          <div className="ludo-room-loading">
            <LoadingBlock label="Loading room tiers" />
            <LoadingBlock label="Checking waiting tables" />
          </div>
        ) : (
          <div className="ludo-room-card-list" data-testid="grid-room-tiers">
            {tiers.map(tier => {
              const waitingRoom = rooms.find(room =>
                room.tierId === tier.id && room.playerCount < tier.maxPlayers && room.joinWindowOpen,
              );
              const occupied = waitingRoom?.players ?? [];

              return (
                <article className="ludo-room-tier-card" key={tier.id} data-testid={`card-tier-${tier.id}`}>
                  <h2>{tier.name}</h2>
                  <div className="ludo-room-seats" aria-label={`${tier.maxPlayers} player room`}>
                    <span>{tier.maxPlayers} Players</span>
                    <div className="ludo-room-seat-slots">
                      {Array.from({ length: tier.maxPlayers }, (_, index) => {
                        const player = occupied[index];
                        return (
                          <span
                            key={index}
                            className={`ludo-room-seat ${player ? `occupied seat-${player.color}` : ''}`}
                            title={player ? player.username : 'Open seat'}
                            aria-label={player ? `Seat taken by ${player.username}` : 'Open seat'}
                          >
                            {player?.username.slice(0, 1).toUpperCase() ?? ''}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                  <div className="ludo-room-fee">
                    <Coins size={21} aria-hidden="true" />
                    <strong>{money(tier.stakeNaira)}</strong>
                  </div>
                  <p className="ludo-room-pot">
                    Pot {tier.maxPlayers === 2
                      ? money(tier.minPotNaira)
                      : `${money(tier.minPotNaira)}–${money(tier.maxPotNaira)}`}
                  </p>
                  <div className="ludo-room-actions">
                    <button
                      type="button"
                      className="ludo-room-join"
                      onClick={() => onJoin(tier.id, waitingRoom?.id)}
                      disabled={isJoining || !!currentRoomId}
                      data-testid={`button-tier-${tier.id}`}
                    >
                      {isJoining ? 'Joining…' : 'Join Room'}
                    </button>
                    <span className="ludo-room-alert" title="Room alerts are not available yet" aria-hidden="true">
                      <Bell size={21} fill="currentColor" />
                    </span>
                  </div>
                  <span className="ludo-room-visually-hidden">
                    Entry is reserved when you join. Room starts at two players.
                  </span>
                </article>
              );
            })}
          </div>
        )}

        {!isLoading && !isError && tiers.length === 0 && (
          <div className="ludo-room-empty">
            <h2>No room tiers available.</h2>
            <button type="button" onClick={onRetry}>Refresh rooms</button>
          </div>
        )}

        <p className="ludo-room-note"><ShieldCheck size={14} /> Sandbox wallet only · stakes are reserved when you join</p>
      </main>
    </div>
  );
}
