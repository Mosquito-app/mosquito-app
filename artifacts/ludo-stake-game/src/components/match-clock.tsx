import type { Room } from '@workspace/api-client-react';

export function MatchClock({ room, seconds }: { room: Room; seconds: number | null }) {
  const overtime = room.status === 'active' && room.board.isOvertime;
  const ended = room.status === 'completed' || room.status === 'cancelled';
  const clock = room.status === 'waiting' ? '14:00' : ended ? 'MATCH ENDED' :
    overtime ? '0:00' : seconds === null ? 'STARTING…' :
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const winner = room.board.winnerUserId === room.hostUserId ? room.hostUsername : room.opponentUsername;
  return <div className={`lb-match-clock ${overtime ? 'overtime' : seconds !== null && seconds <= 60 && !ended ? 'urgent' : ''}`} data-testid="panel-match-clock">
    <div className="lb-match-clock-header">
      <div><span>SHARED MATCH CLOCK · 14 MINUTES</span><strong data-testid="text-match-countdown" aria-label={`Match time ${clock}`}>{clock}</strong></div>
      <p>{room.status === 'waiting' ? 'Starts when both players are seated.' :
        ended ? 'Match closed. No further moves allowed.' :
          'Tokens home first. Total step progress breaks the tie.'}</p>
    </div>
    {room.status !== 'waiting' && <div className="lb-match-scores" data-testid="text-match-scores">
      <span>Red · Home <b>{room.scores.red.tokensHome}/4</b> · Steps <b>{room.scores.red.totalProgress}</b></span>
      <span>Green · Home <b>{room.scores.green.tokensHome}/4</b> · Steps <b>{room.scores.green.totalProgress}</b></span>
    </div>}
    {overtime && <div className="lb-overtime-banner" role="status" data-testid="banner-overtime">
      OVERTIME / DRAW BREAK <small>Exact tie at 14:00. The first movement that breaks the tie wins immediately.</small>
    </div>}
    {room.status === 'active' && seconds === 0 && !overtime && <p role="status">Time is up. The server is confirming the result…</p>}
    {room.status === 'completed' && <p className="lb-match-result" role="status" data-testid="text-match-result">
      Winner: {winner}. {room.board.endReason === 'overtime' ? 'Sudden-death tie broken.' :
        room.board.endReason === 'timeout' ? 'Ahead on ranking at 14:00.' : 'All four tokens home.'} 90% prize / 10% commission settled.
    </p>}
  </div>;
}
