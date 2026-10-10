type Room = { myColor: 'red' | 'green'; board: { redTokens: number[]; greenTokens: number[] } };

export const pathCells: [number, number][] = [
  [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
];
export type Color = 'red' | 'green';
const OFFSET: Record<Color, number> = { red: 0, green: 26 };
const BASE: Record<Color, [number, number][]> = { red: [[1,1],[1,4],[4,1],[4,4]], green: [[10,10],[10,13],[13,10],[13,13]] };
const RECTS = [{ cls: 'lb-home-red', r: 0, c: 0, color: 'red' }, { cls: 'lb-home-yellow', r: 0, c: 9 }, { cls: 'lb-home-green', r: 9, c: 9, color: 'green' }, { cls: 'lb-home-blue', r: 9, c: 0 }];
const STARTS: Record<string, string> = { '6-1': 'red', '1-8': 'yellow', '8-13': 'green', '13-6': 'blue' };
const SAFE = ['2-6', '6-12', '12-8', '8-2'];

export function cellFor(color: Color, position: number, index: number): [number, number] {
  if (position < 0) return BASE[color][index];
  if (position <= 51) return pathCells[(position + OFFSET[color]) % 52];
  if (position <= 56) return color === 'red' ? [7, 1 + (position - 52)] : [7, 13 - (position - 52)];
  return [7, 7];
}
export const canMoveToken = (position: number, die: number | null) => die !== null && position >= 0 && position < 57 && position + die <= 57;

/** Destination for selected die values, or null if illegal. Entry needs a full 6-6 or 6-1 roll; a single selected 6 enters at 0. */
export function destination(position: number, values: number[], fullRoll?: number[] | null): number | null {
  if (!values.length || position >= 57) return null;
  if (position === -1) {
    if (!fullRoll || fullRoll.length !== 2) return null;
    const [x, y] = fullRoll;
    if (!((x === 6 && y === 6) || (x === 6 && y === 1) || (x === 1 && y === 6))) return null;
    const i = values.indexOf(6);
    if (i < 0) return null;
    const rest = values.filter((_, k) => k !== i);
    const d = rest.length ? rest[0] : 0;
    return d <= 57 ? d : null;
  }
  const d = position + values.reduce((a, b) => a + b, 0);
  return d <= 57 ? d : null;
}

const PIPS: Record<number, number[]> = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export function DiceFace({ value, used, selected, rolling }: { value: number | null; used?: boolean; selected?: boolean; rolling?: boolean }) {
  return <span className={`lb-die ${used ? 'used' : ''} ${selected ? 'selected' : ''} ${rolling ? 'lb-die-tumble' : value ? 'lb-die-roll' : 'empty'}`} aria-hidden="true">
    {Array.from({ length: 9 }, (_, i) => <i key={i} className={value && PIPS[value].includes(i) ? 'pip' : ''} />)}
  </span>;
}

export function LudoBoard({ room, legalTokens, onMove, selecting }: { room: Room; legalTokens: Set<number>; onMove: (index: number) => void; selecting: boolean }) {
  const trackSet = new Set(pathCells.map(([r, c]) => `${r}-${c}`));
  const lanes = new Map<string, string>();
  for (let i = 1; i <= 5; i++) { lanes.set(`7-${i}`, 'red'); lanes.set(`7-${14 - i}`, 'green'); lanes.set(`${i}-7`, 'yellow'); lanes.set(`${14 - i}-7`, 'blue'); }
  const pads = new Set<string>(); (Object.keys(BASE) as Color[]).forEach(c => BASE[c].forEach(([r, k]) => pads.add(`${r}-${k}`)));
  [[1,10],[1,13],[4,10],[4,13],[10,1],[10,4],[13,1],[13,4]].forEach(([r, k]) => pads.add(`${r}-${k}`));
  const tokens = (['red', 'green'] as Color[]).flatMap(color => (color === 'red' ? room.board.redTokens : room.board.greenTokens).map((position, index) => ({ color, position, index, at: cellFor(color, position, index) })));
  return <div className="lb-frame">
    <div className="lb-grid" role="group" aria-label="Ludo board, red and green seats active, yellow and blue decorative">
      {RECTS.map(home => <div key={home.cls} className="lb-home-inset" aria-hidden="true" style={{
        left: `${(home.c + 1) * 100 / 15}%`, top: `${(home.r + 1) * 100 / 15}%`,
      }} />)}
      {Array.from({ length: 225 }, (_, i) => {
        const r = Math.floor(i / 15), c = i % 15, key = `${r}-${c}`;
        const home = RECTS.find(h => r >= h.r && r < h.r + 6 && c >= h.c && c < h.c + 6);
        const lane = lanes.get(key);
        const start = STARTS[key];
        const here = tokens.filter(t => t.at[0] === r && t.at[1] === c);
        const cls = ['lb-cell', home?.cls, trackSet.has(key) && 'lb-track', lane && `lb-lane lb-lane-${lane}`, start && `lb-start lb-start-${start}`, SAFE.includes(key) && 'lb-safe', r >= 6 && r <= 8 && c >= 6 && c <= 8 && 'lb-center'].filter(Boolean).join(' ');
        return <div key={i} className={cls}>
          {pads.has(key) && <span className="lb-pad" />}
          {r === 7 && c === 7 && <svg className="lb-star" viewBox="0 0 3 3" aria-hidden="true">
            <polygon points="0,0 0,3 1.5,1.5" fill="#b3122a" /><polygon points="0,0 3,0 1.5,1.5" fill="#f6c915" />
            <polygon points="3,0 3,3 1.5,1.5" fill="#0f9a55" /><polygon points="0,3 3,3 1.5,1.5" fill="#1c4fb8" />
            <path d="M0 0L3 3M3 0L0 3M0 0H3V3H0Z" stroke="#111" strokeWidth=".05" fill="none" />
            <polygon points="1.5,1.2 1.6,1.42 1.82,1.42 1.64,1.56 1.71,1.78 1.5,1.64 1.29,1.78 1.36,1.56 1.18,1.42 1.4,1.42" fill="#fff6d0" stroke="#111" strokeWidth=".02" />
          </svg>}
          {here.map((t, n) => { const mine = t.color === room.myColor; const legal = mine && legalTokens.has(t.index);
            return <button key={`${t.color}-${t.index}`} aria-label={`${t.color} token ${t.index + 1}${mine ? ' (yours)' : ''}${legal ? ', can move' : ''}`} disabled={!legal} onClick={() => onMove(t.index)}
              className={`lb-token ${t.color} ${mine ? 'mine' : 'theirs'} ${legal ? 'ready' : ''} ${t.position === 57 ? 'done' : ''}`}
              style={{ transform: here.length > 1 ? `translate(${(n - (here.length - 1) / 2) * 22}%, ${(n % 2) * 8 - 4}%) scale(${here.length > 2 ? .72 : .85})` : undefined }}
              data-testid={`button-token-${t.color}-${t.index}`}><span /></button>; })}
        </div>;
      })}
    </div>
    <div className="lb-legend"><span><i className="red" /> Red seat{room.myColor === 'red' ? ' (you)' : ''}</span><span><i className="green" /> Green seat{room.myColor === 'green' ? ' (you)' : ''}</span><span><i className="deco" /> Yellow and blue homes are decoration</span>{selecting && <span className="hint">Glowing caps can move</span>}</div>
  </div>;
}
