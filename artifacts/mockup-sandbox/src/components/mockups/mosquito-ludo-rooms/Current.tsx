import './_group.css';

const tiers = [
  { name: 'Oga Chairman', players: 2, entry: '₦50,000', pot: '₦100,000', rooms: 'No open rooms yet' },
  { name: 'Big Doings', players: 2, entry: '₦25,000', pot: '₦50,000', rooms: '1 open room' },
  { name: 'Senior Man', players: 2, entry: '₦5,000', pot: '₦10,000', rooms: 'No open rooms yet' },
  { name: 'Sharp Guy', players: 2, entry: '₦2,000', pot: '₦4,000', rooms: '2 open rooms' },
  { name: 'Quick Clash', players: 2, entry: '₦1,000', pot: '₦2,000', rooms: 'No open rooms yet' },
  { name: 'Street King', players: 4, entry: '₦2,000', pot: '₦4,000–₦8,000', rooms: '1 open room' },
  { name: 'Board Master', players: 4, entry: '₦1,000', pot: '₦2,000–₦4,000', rooms: 'No open rooms yet' },
  { name: 'Area Hustler', players: 4, entry: '₦500', pot: '₦1,000–₦2,000', rooms: 'No open rooms yet' },
  { name: 'Practice Ground', players: 4, entry: 'Free entry', pot: '₦0 pot', rooms: 'No open rooms yet' },
];

export default function Current() {
  return (
    <main className="room-mockup room-mock-current">
      <div className="current-heading">
        <small>LUDO DUEL · CURRENT ROOM PICKER</small>
        <h1>Choose a room tier.</h1>
      </div>
      <div className="tier-grid">
        {tiers.map(tier => (
          <button className="tier-card" key={tier.name} type="button">
            <span className="tier-name">{tier.name}</span>
            <span className="tier-seats">{tier.players} players</span>
            <strong>{tier.entry} entry</strong>
            <span className="tier-pot">Pot {tier.pot}</span>
            <small>{tier.rooms} · starts at 2</small>
          </button>
        ))}
      </div>
    </main>
  );
}
