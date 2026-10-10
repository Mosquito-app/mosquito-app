// Copy of authoritative geometry, preview only.
export const pathCells: [number, number][] = [
  [6,1],[6,2],[6,3],[6,4],[6,5],[5,6],[4,6],[3,6],[2,6],[1,6],[0,6],[0,7],[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[6,9],[6,10],[6,11],[6,12],[6,13],[6,14],[7,14],[8,14],[8,13],[8,12],[8,11],[8,10],[8,9],[9,8],[10,8],[11,8],[12,8],[13,8],[14,8],[14,7],[14,6],[13,6],[12,6],[11,6],[10,6],[9,6],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],[7,0],[6,0],
];
type Color = 'red' | 'green';
const OFFSET: Record<Color, number> = { red: 0, green: 26 };
const BASE: Record<Color, [number, number][]> = { red: [[1,1],[1,4],[4,1],[4,4]], green: [[10,10],[10,13],[13,10],[13,13]] };
export function cellFor(color: Color, position: number, index: number): [number, number] {
  if (position < 0) return BASE[color][index];
  if (position <= 51) return pathCells[(position + OFFSET[color]) % 52];
  if (position <= 56) return color === 'red' ? [7, 1 + (position - 52)] : [7, 13 - (position - 52)];
  return [7, 7];
}
