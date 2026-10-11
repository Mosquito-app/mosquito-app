import './_group.css';
import { Bell } from 'lucide-react';

const tiers = [
  { name: 'Oga Chairman', players: 2, entry: '₦50,000', pot: '₦100,000', seats: [''] },
  { name: 'Big Doings', players: 2, entry: '₦25,000', pot: '₦50,000', seats: ['A'] },
  { name: 'Senior Man', players: 2, entry: '₦5,000', pot: '₦10,000', seats: [] },
  { name: 'Sharp Guy', players: 2, entry: '₦2,000', pot: '₦4,000', seats: ['K'] },
  { name: 'Quick Clash', players: 2, entry: '₦1,000', pot: '₦2,000', seats: [] },
  { name: 'Street King', players: 4, entry: '₦2,000', pot: '₦4,000–₦8,000', seats: ['A', 'K', 'M'] },
  { name: 'Board Master', players: 4, entry: '₦1,000', pot: '₦2,000–₦4,000', seats: [''] },
  { name: 'Area Hustler', players: 4, entry: '₦500', pot: '₦1,000–₦2,000', seats: ['A', 'K'] },
  { name: 'Practice Ground', players: 4, entry: '₦0', pot: '₦0 pot', seats: [] },
];

export default function ReferenceRooms() {
  return (
    <div className="room-mockup room-mock-reference">
      <header className="room-mock-header">
        <div className="room-mock-avatar">M</div>
        <div className="room-mock-brand"><strong>Mosquito</strong><span>APP</span></div>
        <div className="room-mock-wallet">
          <div className="room-mock-balance">₦0</div>
          <button className="room-mock-plus" type="button" aria-label="Add funds">+</button>
        </div>
      </header>
      <main className="room-mock-content">
        <button className="room-mock-back" type="button" aria-label="Back to lobby">‹</button>
        <h1 className="sr-only">Choose a Ludo room</h1>
        <div className="room-mock-card-list">
          {tiers.map(tier => (
            <article className="room-mock-card" key={tier.name}>
              <h2>{tier.name}</h2>
              <div className="room-mock-seats">
                <span>{tier.players} Players</span>
                <div className="room-mock-seat-icons" aria-label={`${tier.seats.length} players currently waiting`}>
                  {Array.from({ length: tier.players }, (_, index) => (
                    <span className="room-mock-seat" key={index}>{tier.seats[index] || ''}</span>
                  ))}
                </div>
              </div>
              <p className="room-mock-fee"><span className="room-mock-coin">₦</span>{tier.entry}</p>
              <p className="room-mock-pot">{tier.pot}</p>
              <div className="room-mock-actions">
                <button className="room-mock-join" type="button">Join Room</button>
                <span className="room-mock-bell" aria-hidden="true"><Bell size={23} fill="currentColor" /></span>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
