import { DIRECTION_VECTORS, Direction8, GameMap, Vec2 } from './types';

export function isInBounds(map: GameMap, pos: Vec2): boolean {
  return pos.x >= 0 && pos.y >= 0 && pos.x < map.width && pos.y < map.height;
}

export function isWalkable(map: GameMap, pos: Vec2): boolean {
  if (!isInBounds(map, pos)) return false;
  return map.terrain[pos.y][pos.x] === 'floor';
}

/**
 * True unless `to` is diagonally adjacent to `from` (abs(dx)=1 and
 * abs(dy)=1) and at least one of the two orthogonal "corner" tiles
 * between them — (from.x+dx, from.y) and (from.x, from.y+dy) — is not
 * walkable. Cardinal (non-diagonal) pairs are always open; this rule
 * only ever restricts the diagonal case. Shared by canMove (diagonal
 * movement) and, as of Phase 15.6, adjacent melee-attack legality (see
 * turn.ts's resolveFacingAttack and tryMeleeAttack) — both movement and
 * attacks use this exact same corner definition, so a "diagonal step
 * illegal to walk" and "diagonal attack illegal to land" always agree.
 */
export function isDiagonalCornerOpen(map: GameMap, from: Vec2, to: Vec2): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1) return true;
  const sideA: Vec2 = { x: from.x + dx, y: from.y };
  const sideB: Vec2 = { x: from.x, y: from.y + dy };
  return isWalkable(map, sideA) && isWalkable(map, sideB);
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

  return isDiagonalCornerOpen(map, from, dest);
}

export function destinationOf(from: Vec2, direction: Direction8): Vec2 {
  const delta = DIRECTION_VECTORS[direction];
  return { x: from.x + delta.x, y: from.y + delta.y };
}
