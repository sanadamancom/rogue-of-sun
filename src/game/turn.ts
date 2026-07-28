import { directionBetweenAdjacent, isAdjacent } from './direction';
import { canMove, destinationOf } from './map';
import { Actor, GameState, PlayerAction, Vec2 } from './types';

export interface TurnResult {
  /** Whether the input actually consumed a turn (false for blocked moves). */
  consumed: boolean;
  /** Whether the player attacked this turn. */
  playerAttacked: boolean;
  /** Whether the enemy was defeated this turn. */
  enemyDefeated: boolean;
  /** Whether the enemy acted this turn (false if defeated or already dead). */
  enemyActed: boolean;
  /** Whether the enemy attacked the player this turn. */
  enemyAttacked: boolean;
  /** Whether the player died this turn. */
  playerDefeated: boolean;
}

function applyPlayerAction(state: GameState, action: PlayerAction): { consumed: boolean; attacked: boolean; defeated: boolean } {
  if (action.type === 'wait') {
    return { consumed: true, attacked: false, defeated: false };
  }

  const { player, enemy, map } = state;
  const destination: Vec2 = destinationOf(player.pos, action.direction);

  // Attacking: moving toward the enemy's current tile resolves as an attack
  // instead of a move, and the player does not step onto that tile.
  if (enemy.alive && enemy.pos.x === destination.x && enemy.pos.y === destination.y) {
    player.facing = action.direction;
    enemy.hp = Math.max(0, enemy.hp - player.attack);
    const defeated = enemy.hp === 0;
    if (defeated) {
      enemy.alive = false;
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

function resolveEnemyAction(state: GameState): { acted: boolean; attacked: boolean } {
  const { player, enemy, map } = state;
  if (!enemy.alive) return { acted: false, attacked: false };

  if (isAdjacent(enemy.pos, player.pos)) {
    const dir = directionBetweenAdjacent(enemy.pos, player.pos);
    if (dir) enemy.facing = dir;
    player.hp = Math.max(0, player.hp - enemy.attack);
    if (player.hp === 0) player.alive = false;
    return { acted: true, attacked: true };
  }

  // Simple chase: pick the direction that reduces distance to the player.
  const dx = Math.sign(player.pos.x - enemy.pos.x);
  const dy = Math.sign(player.pos.y - enemy.pos.y);

  const candidateDirs = pickChaseDirections(dx, dy);
  for (const dir of candidateDirs) {
    if (canMove(map, enemy.pos, dir)) {
      enemy.facing = dir;
      enemy.pos = destinationOf(enemy.pos, dir);
      return { acted: true, attacked: false };
    }
  }

  // No valid step available; wait in place.
  return { acted: true, attacked: false };
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
 * 1) resolve player action, 2) confirm result (defeat), 3) resolve enemy
 * action if it survived, 4) check player defeat, 5) increment turn count.
 *
 * Invalid/unused inputs and blocked moves do not consume a turn.
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
    };
  }

  let enemyActed = false;
  let enemyAttacked = false;

  // A defeated enemy does not act this turn.
  if (!defeated) {
    const result = resolveEnemyAction(state);
    enemyActed = result.acted;
    enemyAttacked = result.attacked;
  }

  const playerDefeated = !state.player.alive;
  const reachedExit = state.player.pos.x === state.exit.x && state.player.pos.y === state.exit.y;

  state.turn += 1;

  if (playerDefeated) {
    state.phase = 'gameover';
  } else if (reachedExit) {
    state.phase = 'floor_reached';
  } else if (defeated) {
    state.phase = 'victory';
  }

  return {
    consumed: true,
    playerAttacked: attacked,
    enemyDefeated: defeated,
    enemyActed,
    enemyAttacked,
    playerDefeated,
  };
}

export function createInitialActor(pos: Vec2, hp: number, attack: number): Actor {
  return { pos, hp, maxHp: hp, attack, facing: 'S', alive: true };
}
