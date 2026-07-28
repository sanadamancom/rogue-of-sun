import { ALL_DIRECTIONS, DIRECTION_VECTORS, Direction8, Vec2 } from './types';

/**
 * Returns the Direction8 pointing from `from` to `to` if they are
 * exactly one step apart (including diagonally adjacent), otherwise null.
 */
export function directionBetweenAdjacent(from: Vec2, to: Vec2): Direction8 | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (const dir of ALL_DIRECTIONS) {
    const v = DIRECTION_VECTORS[dir];
    if (v.x === dx && v.y === dy) return dir;
  }
  return null;
}

export function isAdjacent(a: Vec2, b: Vec2): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx <= 1 && dy <= 1 && (dx !== 0 || dy !== 0);
}

// Maps the internal 8-direction facing to a 4-direction facing, used when
// only 4-direction sprites are available for rendering.
export type Direction4 = 'N' | 'S' | 'E' | 'W';

const DIAGONAL_TO_CARDINAL: Record<Direction8, Direction4> = {
  N: 'N',
  S: 'S',
  E: 'E',
  W: 'W',
  NE: 'E',
  NW: 'W',
  SE: 'E',
  SW: 'W',
};

export function toDirection4(dir: Direction8): Direction4 {
  return DIAGONAL_TO_CARDINAL[dir];
}
