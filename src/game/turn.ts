import { directionBetweenAdjacent, isAdjacent } from './direction';
import { canMove, destinationOf } from './map';
import { Actor, GameState, PlayerAction, Vec2 } from './types';

/** Consumed player actions required for one natural HP tick (Phase 04 initial setting). */
export const REGEN_TURNS_PER_HP = 5;

export interface TurnResult {
  /** Whether the input actually consumed a turn (false for blocked moves). */
  consumed: boolean;
  /** Whether the player attacked this turn. */
  playerAttacked: boolean;
  /** Whether the player defeated any enemy this turn. */
  enemyDefeated: boolean;
  /** Whether at least one enemy acted this turn. */
  enemyActed: boolean;
  /** Whether at least one enemy attacked the player this turn. */
  enemyAttacked: boolean;
  /** Whether the player died this turn. */
  playerDefeated: boolean;
  /** Whether the player's natural HP regeneration triggered this turn. */
  playerRegenerated: boolean;
}

function applyPlayerAction(
  state: GameState,
  action: PlayerAction,
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  if (action.type === 'wait') {
    return { consumed: true, attacked: false, defeated: false };
  }

  const { player, enemies, map } = state;
  const destination: Vec2 = destinationOf(player.pos, action.direction);

  // Attacking: moving toward a living enemy's current tile resolves as an
  // attack instead of a move, and the player does not step onto that tile.
  // At most one enemy can occupy any tile, so this matches at most one.
  const target = enemies.find(
    (enemy) => enemy.alive && enemy.pos.x === destination.x && enemy.pos.y === destination.y,
  );
  if (target) {
    player.facing = action.direction;
    target.hp = Math.max(0, target.hp - player.attack);
    const defeated = target.hp === 0;
    if (defeated) {
      target.alive = false;
    }
    return { consumed: true, attacked: true, defeated };
  }

  // Otherwise, attempt a normal move.
  if (canMove(map, player.pos, action.direction)) {
    player.facing = action.direction;
    player.pos = destination;
    return { consumed: true, attacked: false, defeated: false };
  }

  // Blocked movement (wall or out of bounds): does not consume a turn.
  return { consumed: false, attacked: false, defeated: false };
}

/**
 * Resolves one enemy's action (attack or chase-move-or-wait) against the
 * current occupancy of the board: it will not step onto the player's tile
 * or onto another living enemy's current tile (already-moved enemies'
 * updated positions count; dead enemies never block).
 */
function resolveOneEnemy(state: GameState, enemy: Actor): { acted: boolean; attacked: boolean } {
  const { player, map, enemies } = state;

  if (isAdjacent(enemy.pos, player.pos)) {
    const dir = directionBetweenAdjacent(enemy.pos, player.pos);
    if (dir) enemy.facing = dir;
    player.hp = Math.max(0, player.hp - enemy.attack);
    if (player.hp === 0) player.alive = false;
    return { acted: true, attacked: true };
  }

  const isOccupied = (pos: Vec2): boolean => {
    if (pos.x === player.pos.x && pos.y === player.pos.y) return true;
    return enemies.some(
      (other) => other !== enemy && other.alive && other.pos.x === pos.x && other.pos.y === pos.y,
    );
  };

  // Simple chase: pick the direction that reduces distance to the player.
  const dx = Math.sign(player.pos.x - enemy.pos.x);
  const dy = Math.sign(player.pos.y - enemy.pos.y);

  const candidateDirs = pickChaseDirections(dx, dy);
  for (const dir of candidateDirs) {
    if (!canMove(map, enemy.pos, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    if (isOccupied(dest)) continue;
    enemy.facing = dir;
    enemy.pos = dest;
    return { acted: true, attacked: false };
  }

  // No valid step available; wait in place.
  return { acted: true, attacked: false };
}

/**
 * Runs each living enemy's action once, in fixed array order. Stops
 * immediately once the player is defeated, so no later enemy acts against
 * an already-defeated player.
 */
function resolveEnemiesAction(state: GameState): { acted: boolean; attacked: boolean } {
  let acted = false;
  let attacked = false;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const result = resolveOneEnemy(state, enemy);
    if (result.acted) acted = true;
    if (result.attacked) attacked = true;
    if (!state.player.alive) break;
  }

  return { acted, attacked };
}

function pickChaseDirections(dx: number, dy: number) {
  // Prefer the direct diagonal/cardinal toward the player, then fall back
  // to the pure horizontal/vertical component.
  const dirs: { x: number; y: number; name: import('./types').Direction8 }[] = [];
  const nameFor = (x: number, y: number): import('./types').Direction8 | null => {
    if (x === 0 && y === -1) return 'N';
    if (x === 0 && y === 1) return 'S';
    if (x === 1 && y === 0) return 'E';
    if (x === -1 && y === 0) return 'W';
    if (x === 1 && y === -1) return 'NE';
    if (x === -1 && y === -1) return 'NW';
    if (x === 1 && y === 1) return 'SE';
    if (x === -1 && y === 1) return 'SW';
    return null;
  };

  const primary = nameFor(dx, dy);
  if (primary) dirs.push({ x: dx, y: dy, name: primary });
  if (dx !== 0) {
    const n = nameFor(dx, 0);
    if (n) dirs.push({ x: dx, y: 0, name: n });
  }
  if (dy !== 0) {
    const n = nameFor(0, dy);
    if (n) dirs.push({ x: 0, y: dy, name: n });
  }
  return dirs.map((d) => d.name);
}

/**
 * Processes exactly one player input as a turn, per the sequence:
 * 1) resolve player action, 2) confirm result (defeat), 3) resolve each
 * living enemy's action in order (stopping early if the player dies),
 * 4) confirm player defeat, 5) process natural HP regeneration if the
 * player survived, 6) check floor progression, 7) increment turn count.
 *
 * Invalid/unused inputs and blocked moves do not consume a turn and do not
 * advance enemy actions or natural regeneration.
 */
export function processTurn(state: GameState, action: PlayerAction): TurnResult {
  if (state.phase !== 'playing') {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
    };
  }

  const { consumed, attacked, defeated } = applyPlayerAction(state, action);

  if (!consumed) {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
    };
  }

  const { acted: enemyActed, attacked: enemyAttacked } = resolveEnemiesAction(state);

  const playerDefeated = !state.player.alive;

  let playerRegenerated = false;
  if (state.player.alive) {
    if (state.player.hp < state.player.maxHp) {
      state.regenProgress += 1;
      if (state.regenProgress >= REGEN_TURNS_PER_HP) {
        state.player.hp = Math.min(state.player.maxHp, state.player.hp + 1);
        state.regenProgress = 0;
        playerRegenerated = true;
      }
    } else {
      state.regenProgress = 0;
    }
  }

  const reachedExit = state.player.pos.x === state.exit.x && state.player.pos.y === state.exit.y;
  // The staircase only unlocks once every enemy on this floor has been
  // defeated (this turn or earlier); reaching it while any enemy is alive
  // does not advance the floor.
  const stairsUnlocked = state.enemies.every((enemy) => !enemy.alive);

  state.turn += 1;

  if (playerDefeated) {
    state.phase = 'gameover';
  } else if (reachedExit && stairsUnlocked) {
    state.phase = state.floor >= state.totalFloors ? 'victory' : 'floor_cleared';
  }

  return {
    consumed: true,
    playerAttacked: attacked,
    enemyDefeated: defeated,
    enemyActed,
    enemyAttacked,
    playerDefeated,
    playerRegenerated,
  };
}

export function createInitialActor(pos: Vec2, hp: number, attack: number): Actor {
  return { pos, hp, maxHp: hp, attack, facing: 'S', alive: true };
}
