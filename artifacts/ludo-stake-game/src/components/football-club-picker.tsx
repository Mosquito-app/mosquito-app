import { CLUBS } from './football-3d/clubs';
import type { FootballClubId } from './football-3d/types';

export function ClubPicker({ value, onChange, testPrefix }: { value: FootballClubId; onChange: (id: FootballClubId) => void; testPrefix: string }) {
  return <div className="fb-clubs" role="radiogroup" aria-label="Choose your club" data-testid={`${testPrefix}-clubs`}>
    {CLUBS.map(c => {
      const k = c.home; const on = c.id === value;
      return <button type="button" key={c.id} role="radio" aria-checked={on} className={`fb-club-card ${on ? 'on' : ''}`} onClick={() => onChange(c.id)} data-testid={`card-${testPrefix}-club-${c.id}`}>
        <span className="fb-kit" aria-hidden="true">
          <i className="k-shirt" style={{ background: k.pattern === 'stripes' ? `repeating-linear-gradient(90deg, ${k.a} 0 6px, ${k.b} 6px 12px)` : k.a }} />
          <i className="k-shorts" style={{ background: k.shorts }} />
          <i className="k-socks" style={{ background: k.socks }} />
        </span>
        <b>{c.label}</b>
      </button>;
    })}
  </div>;
}
