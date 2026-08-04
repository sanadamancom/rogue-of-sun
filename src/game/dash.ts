import { canMove, destinationOf, isWalkable } from './map';
import { roomIndexContaining } from './mapgen';
import { Direction8, GameState, Vec2 } from './types';

const ORTHOGONAL_DIRECTIONS: Direction8[] = ['N', 'S', 'E', 'W'];

/**
 * Whether an alive enemy occupies or is within melee-contact distance
 * (Chebyshev distance 1, i.e. any of the 8 surrounding tiles or the tile
 * itself) of `pos`. Deliberately weapon-agnostic (does not special-case
 * spear's 2-tile reach) — a reasonable, documented simplification for
 * dash's "should I even approach" check; the player's actual attack still
 * uses each weapon's real range regardless of dash. See history doc's
 * "実装上の主要判断" for this decision.
 */
function hasEnemyContactNear(state: GameState, pos: Vec2): boolean {
  return state.enemies.some((e) => e.alive && Math.max(Math.abs(e.pos.x - pos.x), Math.abs(e.pos.y - pos.y)) <= 1);
}

function hasStoppingGroundFeature(state: GameState, pos: Vec2): boolean {
  if (state.exit.x === pos.x && state.exit.y === pos.y) return true;
  if (state.groundItems.some((item) => item.pos.x === pos.x && item.pos.y === pos.y)) return true;
  // Only *known* (already-triggered/revealed) traps stop dash — an
  // undiscovered trap must not be detected by dash's stop logic (spec
  // 11.3's "停止判定が既存ゲーム情報を越えて未発見対象を察知しないよう
  // にする").
  if ((state.traps ?? []).some((t) => t.triggered && t.pos.x === pos.x && t.pos.y === pos.y)) return true;
  return false;
}

/** Number of orthogonally-walkable neighbors of `pos` (used to detect a corridor branch/intersection). */
function openOrthogonalNeighborCount(state: GameState, pos: Vec2): number {
  let count = 0;
  for (const dir of ORTHOGONAL_DIRECTIONS) {
    if (canMove(state.map, pos, dir)) count++;
  }
  return count;
}

/**
 * Whether `pos` is a corridor branch/intersection tile: itself not
 * inside any room (roomIndexContaining === -1, i.e. a corridor tile),
 * with more than 2 open orthogonal directions (a straight corridor tile
 * has exactly 2; a branch/junction has 3 or 4).
 */
function isCorridorBranch(state: GameState, pos: Vec2): boolean {
  if (roomIndexContaining(state.map.rooms, pos) !== -1) return false;
  return openOrthogonalNeighborCount(state, pos) > 2;
}

/**
 * Whether stepping from `from` to `to` crosses a room/corridor boundary
 * (one side is inside a room, the other is a corridor, or the two sides
 * are in different rooms).
 */
function crossesRoomCorridorBoundary(state: GameState, from: Vec2, to: Vec2): boolean {
  const fromRoom = roomIndexContaining(state.map.rooms, from);
  const toRoom = roomIndexContaining(state.map.rooms, to);
  return fromRoom !== toRoom;
}

/**
 * Whether dash may take its next single-tile step in `direction` at all
 * (Phase 14.5 spec 11.3's "行動前に停止する" conditions: walls/bounds/
 * corner-cutting, and approaching melee contact/attack range). Reuses
 * the existing canMove wall/bounds/diagonal-corner-cut rule as-is (spec's
 * "既存の角抜け禁止判定を必ず通す"). Returns false to mean "stop now,
 * do not take this step".
 */
export function canTakeDashStep(state: GameState, direction: Direction8): boolean {
  if (!canMove(state.map, state.player.pos, direction)) return false;
  const dest = destinationOf(state.player.pos, direction);
  if (hasEnemyContactNear(state, dest)) return false;
  return true;
}

/**
 * Whether dash should stop *after* taking a step that lands on `newPos`
 * (spec 11.3: items/exit/known-traps, corridor branches, and room/
 * corridor boundaries — the step itself is taken as an ordinary move
 * first, matching how ground-item auto-pickup already works on any
 * move, and dash simply does not queue a further step).
 */
export function shouldStopDashAfterStep(state: GameState, previousPos: Vec2, newPos: Vec2): boolean {
  if (hasStoppingGroundFeature(state, newPos)) return true;
  if (isCorridorBranch(state, newPos)) return true;
  if (crossesRoomCorridorBoundary(state, previousPos, newPos)) return true;
  return false;
}

/** Re-exported for convenience so callers checking basic walkability don't need a separate import. */
export { isWalkable };
