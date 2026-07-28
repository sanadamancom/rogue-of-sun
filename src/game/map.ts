import { DIRECTION_VECTORS, Direction8, GameMap, Tile, Vec2 } from './types';

// Fixed rectangular map for Phase 01.
// '.' = floor, '#' = wall
const MAP_LAYOUT: string[] = [
  '##########',
  '#........#',
  '#..####..#',
  '#..#..#..#',
  '#..#..#..#',
  '#..####..#',
  '#........#',
  '##########',
];

export function createFixedMap(): GameMap {
  const height = MAP_LAYOUT.length;
  const width = MAP_LAYOUT[0].length;
  const terrain: Tile[][] = MAP_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain };
}

export function isInBounds(map: GameMap, pos: Vec2): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < map.width && pos.y < map.height;
}

export function isWalkable(map: GameMap, pos: Vec2): boolean {
  if (!isInBounds(map, pos)) return false;
  return map.terrain[pos.y][pos.x] === 'floor';
}

/**
 * Determines whether moving from `from` in `direction` is a legal step:
 * destination must be in bounds and walkable, and diagonal moves may not
 * cut through a wall corner (both orthogonal neighbors must be walkable).
 */
export function canMove(map: GameMap, from: Vec2, direction: Direction8): boolean {
  const delta = DIRECTION_VECTORS[direction];
  const dest: Vec2 = { x: from.x + delta.x, y: from.y + delta.y };

  if (!isWalkable(map, dest)) return false;

  const isDiagonal = delta.x !== 0 && delta.y !== 0;
  if (isDiagonal) {
    const sideA: Vec2 = { x: from.x + delta.x, y: from.y };
    const sideB: Vec2 = { x: from.x, y: from.y + delta.y };
    if (!isWalkable(map, sideA) || !isWalkable(map, sideB)) return false;
  }

  return true;
}

export function destinationOf(from: Vec2, direction: Direction8): Vec2 {
  const delta = DIRECTION_VECTORS[direction];
  return { x: from.x + delta.x, y: from.y + delta.y };
}
