import { isWalkable } from './map';
import { EnemyActor, GameState, Vec2, WebTile } from './types';

/** Web lifetime in world turns, counting the placement turn itself as turn 1 of the 6 (enemy-behavior-02 confirmed_design). */
export const WEB_DURATION_WORLD_TURNS = 6;

/** Web placement cooldown in units of the placing spider's own enemy turns. */
export const WEB_COOLDOWN_ENEMY_ACTIONS = 3;

/** Max webs a single spider may have active at once; placing a 3rd evicts that spider's oldest first. */
export const WEB_MAX_ACTIVE_PER_SPIDER = 2;

/** Max Chebyshev range (in tiles) at which a spider may target the player's tile for a new web. */
export const WEB_MAX_RANGE = 4;

export function findWebAt(state: GameState, pos: Vec2): WebTile | undefined {
  return state.webs.find((web) => web.pos.x === pos.x && web.pos.y === pos.y);
}

/**
 * True if `to` is reachable from `from` along a straight orthogonal or
 * exact-diagonal line (abs(dx) === abs(dy)), within `maxRange` tiles
 * (Chebyshev distance, which equals the straight-line tile distance for
 * both orthogonal and exact-diagonal lines), with no wall or living enemy
 * occupying any of the *intermediate* tiles. `from` and `to` themselves are
 * excluded from the obstruction check (a spider standing at `from` and a
 * player standing at `to` never block their own line). Webs never block
 * (they are fixtures, not actors), matching the confirmed design.
 */
export function hasClearLineOfSight(
  state: GameState,
  from: Vec2,
  to: Vec2,
  maxRange: number,
  ignoreEnemy: EnemyActor,
): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return true;

  const isOrthogonal = dx === 0 || dy === 0;
  const isExactDiagonal = Math.abs(dx) === Math.abs(dy);
  if (!isOrthogonal && !isExactDiagonal) return false;

  const distance = Math.max(Math.abs(dx), Math.abs(dy));
  if (distance > maxRange) return false;

  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);

  for (let i = 1; i < distance; i++) {
    const tile: Vec2 = { x: from.x + stepX * i, y: from.y + stepY * i };
    if (!isWalkable(state.map, tile)) return false;
    const blockedByEnemy = state.enemies.some(
      (other) => other !== ignoreEnemy && other.alive && other.pos.x === tile.x && other.pos.y === tile.y,
    );
    if (blockedByEnemy) return false;
  }

  return true;
}

/**
 * True if `spider` may place a new web on the player's current tile right
 * now: in range/line-of-sight (hasClearLineOfSight), the target tile is
 * walkable floor, and no web already occupies that tile (a duplicate-tile
 * attempt is treated as "this action is unavailable", per confirmed
 * design, not as consuming the spider's turn by itself — the caller falls
 * through to the next action-priority step instead).
 */
export function canPlaceWebNow(state: GameState, spider: EnemyActor): boolean {
  const targetTile = state.player.pos;
  if (!isWalkable(state.map, targetTile)) return false;
  if (findWebAt(state, targetTile)) return false;
  return hasClearLineOfSight(state, spider.pos, targetTile, WEB_MAX_RANGE, spider);
}

/**
 * Places a new web on the player's current tile, owned by `spider`. If this
 * spider already owns WEB_MAX_ACTIVE_PER_SPIDER webs, its single oldest
 * (lowest id) owned web is removed first — deterministic regardless of
 * enemies array order, since id is assigned from the monotonically
 * increasing GameState.nextWebId counter at creation time. Sets the
 * spider's webCooldown to WEB_COOLDOWN_ENEMY_ACTIONS. Caller is responsible
 * for having already confirmed canPlaceWebNow.
 */
export function placeWeb(state: GameState, spider: EnemyActor): void {
  const ownerId = spider.id ?? 0;
  const owned = state.webs.filter((web) => web.ownerEnemyId === ownerId);
  if (owned.length >= WEB_MAX_ACTIVE_PER_SPIDER) {
    let oldest = owned[0];
    for (const web of owned) {
      if (web.id < oldest.id) oldest = web;
    }
    state.webs = state.webs.filter((web) => web.id !== oldest.id);
  }

  const web: WebTile = {
    id: state.nextWebId,
    pos: { ...state.player.pos },
    ownerEnemyId: ownerId,
    placedTurn: state.turn,
  };
  state.nextWebId += 1;
  state.webs.push(web);
  spider.webCooldown = WEB_COOLDOWN_ENEMY_ACTIONS;
}

/**
 * Removes every web whose lifetime has elapsed as of the current
 * (post-increment) state.turn. Called once per processTurn, after the
 * world turn count has advanced, so a web placed on turn T survives turns
 * T..T+5 (6 world turns total, including the placement turn) and is
 * removed starting from turn T+6.
 */
export function expireWebs(state: GameState): void {
  state.webs = state.webs.filter((web) => state.turn < web.placedTurn + WEB_DURATION_WORLD_TURNS);
}
