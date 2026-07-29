import { directionBetweenAdjacent, isAdjacent, isOrthogonallyAdjacent } from './direction';
import { canMove, destinationOf, isWalkable } from './map';
import { ENEMY_DEFINITIONS } from './enemy-def';
import { canPlaceWebNow, expireWebs, placeWeb } from './web';
import { GameEvent } from './events';
import {
  Actor,
  Direction8,
  DIRECTION_VECTORS,
  EnemyActor,
  EnemyType,
  GameState,
  PlayerAction,
  Vec2,
} from './types';

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
  /**
   * Typed events produced while resolving this turn, in the exact order
   * the underlying actions occurred (player action first, then each
   * living enemy's action in state.enemies array order). Empty for
   * unconsumed/blocked inputs and for actions with nothing worth
   * announcing (e.g. a normal move or wait). See src/game/events.ts and
   * src/game/message-log.ts for the event shapes and their formatting.
   */
  events: GameEvent[];
}

function applyPlayerAction(
  state: GameState,
  action: PlayerAction,
  events: GameEvent[],
): { consumed: boolean; attacked: boolean; defeated: boolean } {
  if (action.type === 'wait') {
    return { consumed: true, attacked: false, defeated: false };
  }

  const { player, enemies, map } = state;

  // Slowed (enemy-behavior-02, spider web): any 'move' input — whether it
  // would have resolved as an attack, a normal step, or been blocked by a
  // wall — instead fails outright (no position change) while still
  // consuming this world turn, then clears the slow. This intercepts
  // before both the attack-target lookup and the normal move/blocked-move
  // logic below.
  if (player.slowed) {
    player.slowed = false;
    events.push({ type: 'slowed_move_cancelled' });
    return { consumed: true, attacked: false, defeated: false };
  }

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
    events.push({ type: 'player_attack', enemyType: target.type, damage: player.attack });
    if (defeated) {
      target.alive = false;
      events.push({ type: 'enemy_defeated', enemyType: target.type });
    }
    return { consumed: true, attacked: true, defeated };
  }

  // Otherwise, attempt a normal move.
  if (canMove(map, player.pos, action.direction)) {
    player.facing = action.direction;
    player.pos = destination;
    // Stepping onto a web tile slows the player (does not trigger merely
    // from a web being newly placed on the player's current tile, since
    // that never goes through this move branch). Not stacked/refreshed if
    // already slowed (can't happen here since a slowed player's move was
    // already intercepted above, but kept as a plain assignment — not an
    // increment — for clarity and safety either way).
    if (state.webs.some((web) => web.pos.x === destination.x && web.pos.y === destination.y)) {
      player.slowed = true;
      events.push({ type: 'player_webbed' });
    }
    return { consumed: true, attacked: false, defeated: false };
  }

  // Blocked movement (wall or out of bounds): does not consume a turn.
  return { consumed: false, attacked: false, defeated: false };
}

/**
 * Resolves an attack against the player if `enemy` is adjacent to them
 * (8-direction adjacency), updating facing and player HP/alive. Returns
 * whether an attack happened. Shared by every 8-direction melee
 * behaviorType (generic_melee, slow_melee, fast_melee, recovery_melee) so
 * the attack resolution itself lives in one place.
 */
function tryMeleeAttack(state: GameState, enemy: EnemyActor, events: GameEvent[]): boolean {
  const { player } = state;
  if (!isAdjacent(enemy.pos, player.pos)) return false;
  const dir = directionBetweenAdjacent(enemy.pos, player.pos);
  if (dir) enemy.facing = dir;
  player.hp = Math.max(0, player.hp - enemy.attack);
  events.push({ type: 'enemy_attack', enemyType: enemy.type, damage: enemy.attack });
  if (player.hp === 0) player.alive = false;
  return true;
}

/**
 * Attempts one 8-direction chase step toward the player for `enemy`,
 * against the current occupancy of the board (won't step onto the
 * player's tile or another living enemy's current tile; already-moved
 * enemies' updated positions count, dead enemies never block). Returns
 * whether a step was actually taken. Shared by every 8-direction melee
 * behaviorType.
 */
function tryChaseStep(state: GameState, enemy: EnemyActor): boolean {
  const { player, map, enemies } = state;

  const isOccupied = (pos: Vec2): boolean => {
    if (pos.x === player.pos.x && pos.y === player.pos.y) return true;
    return enemies.some(
      (other) => other !== enemy && other.alive && other.pos.x === pos.x && other.pos.y === pos.y,
    );
  };

  const dx = Math.sign(player.pos.x - enemy.pos.x);
  const dy = Math.sign(player.pos.y - enemy.pos.y);
  const candidateDirs = pickChaseDirections(dx, dy);
  for (const dir of candidateDirs) {
    if (!canMove(map, enemy.pos, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    if (isOccupied(dest)) continue;
    enemy.facing = dir;
    enemy.pos = dest;
    return true;
  }
  return false;
}

/**
 * Resolves one bok's action (attack or chase-move-or-wait) against the
 * current occupancy of the board. Unchanged behavior from Phase 04:
 * 8-direction adjacency and chase, now expressed via the shared
 * tryMeleeAttack/tryChaseStep helpers above instead of inline logic.
 */
function resolveBokEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy); // moves if possible; no-op (wait in place) otherwise
  return { acted: true, attacked: false };
}

/**
 * Resolves one golem's action ('slow_melee'). Golem acts every other enemy
 * turn: its phase is `(state.turn - enemy.spawnTurn) % 2`, so the very
 * first enemy turn after it's created (phase 0) is always an acting turn,
 * and every other turn thereafter alternates. On an off turn it does
 * nothing at all — no movement, and critically no attack even if already
 * adjacent to the player. On an acting turn it behaves exactly like bok
 * (attack if adjacent, otherwise one chase step).
 */
function resolveGolemEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  const phase = (state.turn - (enemy.spawnTurn ?? 0)) % 2;
  if (phase !== 0) {
    // Resting turn: deliberately does not attack even if adjacent.
    events.push({ type: 'enemy_recovering', enemyType: enemy.type });
    return { acted: false, attacked: false };
  }
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

/**
 * Resolves one sword's action ('fast_melee'). If already adjacent to the
 * player at the start of its turn, it attacks immediately without moving.
 * Otherwise it attempts up to 2 chase steps in the same enemy turn,
 * re-evaluating the board after each step: if it becomes adjacent after
 * the first step, it attacks and stops (no second step); if it only
 * becomes adjacent after the second step, it does not attack that turn.
 * At most one attack per enemy turn either way.
 */
function resolveSwordEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true };
  }

  const movedFirstStep = tryChaseStep(state, enemy);
  if (!movedFirstStep) {
    return { acted: true, attacked: false }; // no legal step at all; wait in place
  }
  if (tryMeleeAttack(state, enemy, events)) {
    return { acted: true, attacked: true }; // became adjacent after step 1: attack, no step 2
  }

  // Step 2; never attacks this turn even if now adjacent. Only when this
  // second step actually happens does the movement count as the sword's
  // signature 2-tile approach worth announcing; a single successful step
  // (or none at all) is a normal move and stays silent.
  const movedSecondStep = tryChaseStep(state, enemy);
  if (movedSecondStep) {
    events.push({ type: 'sword_dash', enemyType: enemy.type });
  }
  return { acted: true, attacked: false };
}

/**
 * Resolves one axe's action ('recovery_melee'). If `enemy.recovering` is
 * set (from having attacked on its previous turn), this turn is a forced
 * wait — no movement, no attack — and the flag is cleared so the turn
 * after that is normal again. Otherwise it behaves like bok (attack if
 * adjacent, otherwise one chase step), and an attack sets `recovering` for
 * next turn. Moving without attacking never triggers recovery.
 */
function resolveAxeEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (enemy.recovering) {
    enemy.recovering = false;
    events.push({ type: 'enemy_recovering', enemyType: enemy.type });
    return { acted: false, attacked: false };
  }
  if (tryMeleeAttack(state, enemy, events)) {
    enemy.recovering = true;
    return { acted: true, attacked: true };
  }
  tryChaseStep(state, enemy);
  return { acted: true, attacked: false };
}

// Fixed cardinal check order used both for the spider's move candidates and
// as the deterministic tie-break order when multiple candidates yield the
// same resulting distance to the player. Matches the N/S/E/W ordering used
// throughout ALL_DIRECTIONS.
const SPIDER_DIRECTIONS: Direction8[] = ['N', 'S', 'E', 'W'];

// Fixed diagonal check order for corner-crossing A candidate evaluation and
// tie-breaking, matching the NE/NW/SE/SW ordering used in ALL_DIRECTIONS.
const CORNER_CROSS_DIRECTIONS: Direction8[] = ['NE', 'NW', 'SE', 'SW'];

const manhattanDistance = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * True if `enemy` may use corner-crossing A to step diagonally from
 * `enemy.pos` in `dir` right now: the diagonal destination is in-bounds
 * floor with no living actor on it, and — the defining condition — *both*
 * orthogonal tiles between the current position and the diagonal
 * destination are walls (not walkable). This is the exact opposite of
 * normal diagonal-move corner-cutting (map.ts's canMove requires both
 * sides walkable); corner-crossing A requires both sides to be solid.
 */
function canCornerCross(state: GameState, enemy: EnemyActor, dir: Direction8): boolean {
  const delta = DIRECTION_VECTORS[dir];
  const from = enemy.pos;
  const dest: Vec2 = { x: from.x + delta.x, y: from.y + delta.y };

  if (!isWalkable(state.map, dest)) return false;
  if (dest.x === state.player.pos.x && dest.y === state.player.pos.y) return false;
  const occupiedByEnemy = state.enemies.some(
    (other) => other !== enemy && other.alive && other.pos.x === dest.x && other.pos.y === dest.y,
  );
  if (occupiedByEnemy) return false;

  const sideA: Vec2 = { x: from.x + delta.x, y: from.y };
  const sideB: Vec2 = { x: from.x, y: from.y + delta.y };
  // Both orthogonal sides must be solid (not walkable) — a wall corner.
  if (isWalkable(state.map, sideA) || isWalkable(state.map, sideB)) return false;

  return true;
}

/**
 * Attempts corner-crossing A for `enemy`: among the diagonal directions
 * where canCornerCross holds, picks the one whose destination minimizes
 * Manhattan distance to the player (ties broken by CORNER_CROSS_DIRECTIONS
 * order), but only actually moves if that destination is strictly closer
 * than the enemy's current position — a corner-cross that doesn't improve
 * distance to the player is never used (falls through to normal chase
 * instead). Returns whether it moved.
 */
function tryCornerCross(state: GameState, enemy: EnemyActor): boolean {
  const currentDist = manhattanDistance(enemy.pos, state.player.pos);
  let bestDir: Direction8 | null = null;
  let bestDist = Infinity;

  for (const dir of CORNER_CROSS_DIRECTIONS) {
    if (!canCornerCross(state, enemy, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    const dist = manhattanDistance(dest, state.player.pos);
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
    }
  }

  if (bestDir && bestDist < currentDist) {
    enemy.facing = bestDir;
    enemy.pos = destinationOf(enemy.pos, bestDir);
    return true;
  }
  return false;
}

/**
 * Spider's normal 4-direction-only chase step (unchanged from before
 * enemy-behavior-02): among legal cardinal move candidates, picks the one
 * minimizing Manhattan distance to the player after the move; ties are
 * broken by SPIDER_DIRECTIONS order (no RNG). Returns whether it moved.
 */
function trySpiderChaseStep(state: GameState, enemy: EnemyActor): boolean {
  const { player, map, enemies } = state;

  const isOccupied = (pos: Vec2): boolean => {
    if (pos.x === player.pos.x && pos.y === player.pos.y) return true;
    return enemies.some(
      (other) => other !== enemy && other.alive && other.pos.x === pos.x && other.pos.y === pos.y,
    );
  };

  let bestDir: Direction8 | null = null;
  let bestDest: Vec2 | null = null;
  let bestDist = Infinity;

  for (const dir of SPIDER_DIRECTIONS) {
    if (!canMove(map, enemy.pos, dir)) continue;
    const dest = destinationOf(enemy.pos, dir);
    if (isOccupied(dest)) continue;
    const dist = manhattanDistance(dest, player.pos);
    if (dist < bestDist) {
      bestDist = dist;
      bestDir = dir;
      bestDest = dest;
    }
  }

  if (bestDir && bestDest) {
    enemy.facing = bestDir;
    enemy.pos = bestDest;
    return true;
  }
  return false;
}

/** Decrements webCooldown by 1 if it's currently above 0; a no-op otherwise. Never used on the same turn a web was just placed (placeWeb sets a fresh value). */
function decrementWebCooldown(enemy: EnemyActor): void {
  const current = enemy.webCooldown ?? 0;
  if (current > 0) enemy.webCooldown = current - 1;
}

/**
 * Resolves one spider's action (enemy-behavior-02), in fixed priority
 * order:
 * 1. Orthogonal-adjacency melee attack (diagonal adjacency never attacks).
 * 2. Web placement, if this spider's webCooldown is 0 and
 *    canPlaceWebNow holds (in range/line-of-sight of the player's current
 *    tile, that tile isn't already webbed). Placing consumes the whole
 *    turn — no movement or attack alongside it.
 * 3. Corner-crossing A, if it yields a strictly closer diagonal step.
 * 4. Normal cardinal (4-direction) chase.
 * 5. Wait in place if none of the above apply.
 *
 * Every branch except an actual web placement decrements this spider's own
 * webCooldown by 1 (if above 0) at the end, so "the next 3 of this
 * spider's own turns" — regardless of what action they end up taking —
 * are what its cooldown counts down across; other enemies acting never
 * affects it.
 */
function resolveSpiderEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  if (isOrthogonallyAdjacent(enemy.pos, state.player.pos)) {
    const dir = directionBetweenAdjacent(enemy.pos, state.player.pos);
    if (dir) enemy.facing = dir;
    state.player.hp = Math.max(0, state.player.hp - enemy.attack);
    events.push({ type: 'enemy_attack', enemyType: enemy.type, damage: enemy.attack });
    if (state.player.hp === 0) state.player.alive = false;
    decrementWebCooldown(enemy);
    return { acted: true, attacked: true };
  }

  const eligibleToPlaceWeb = (enemy.webCooldown ?? 0) <= 0;
  if (eligibleToPlaceWeb && canPlaceWebNow(state, enemy)) {
    placeWeb(state, enemy);
    events.push({ type: 'web_placed', enemyType: enemy.type });
    return { acted: true, attacked: false };
  }

  if (tryCornerCross(state, enemy)) {
    decrementWebCooldown(enemy);
    return { acted: true, attacked: false };
  }

  trySpiderChaseStep(state, enemy); // moves if possible; no-op (wait in place) otherwise
  decrementWebCooldown(enemy);
  return { acted: true, attacked: false };
}

/**
 * Dispatches an enemy's action by its species' behaviorType (see
 * enemy-def.ts) rather than switching on species id directly, so adding a
 * finished signature AI later only requires adding a new BehaviorType case
 * here plus updating that species' definition entry.
 *
 * - 'spider_cardinal': spider's 4-direction-only chase/attack, plus web
 *   placement and corner-crossing A (enemy-behavior-02).
 * - 'slow_melee': golem's every-other-turn chase/attack (enemy-behavior-01).
 * - 'fast_melee': sword's up-to-2-steps-per-turn chase/attack
 *   (enemy-behavior-01).
 * - 'recovery_melee': axe's attack-then-forced-wait chase/attack
 *   (enemy-behavior-01).
 * - 'generic_melee' and 'placeholder': bok's 8-direction chase/attack
 *   ('placeholder' species have no finished signature AI yet and are
 *   routed here as a playable placeholder rather than an inert prop).
 * - 'stationary': never moves or attacks (kraken).
 */
function resolveOneEnemy(
  state: GameState,
  enemy: EnemyActor,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  const behaviorType = ENEMY_DEFINITIONS[enemy.type].behaviorType;
  switch (behaviorType) {
    case 'spider_cardinal':
      return resolveSpiderEnemy(state, enemy, events);
    case 'slow_melee':
      return resolveGolemEnemy(state, enemy, events);
    case 'fast_melee':
      return resolveSwordEnemy(state, enemy, events);
    case 'recovery_melee':
      return resolveAxeEnemy(state, enemy, events);
    case 'stationary':
      return { acted: false, attacked: false };
    case 'generic_melee':
    case 'placeholder':
    default:
      return resolveBokEnemy(state, enemy, events);
  }
}

/**
 * Runs each living enemy's action once, in fixed array order. Stops
 * immediately once the player is defeated, so no later enemy acts against
 * an already-defeated player.
 */
function resolveEnemiesAction(
  state: GameState,
  events: GameEvent[],
): { acted: boolean; attacked: boolean } {
  let acted = false;
  let attacked = false;

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const result = resolveOneEnemy(state, enemy, events);
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
      events: [],
    };
  }

  const events: GameEvent[] = [];
  const { consumed, attacked, defeated } = applyPlayerAction(state, action, events);

  if (!consumed) {
    return {
      consumed: false,
      playerAttacked: false,
      enemyDefeated: false,
      enemyActed: false,
      enemyAttacked: false,
      playerDefeated: false,
      playerRegenerated: false,
      events: [],
    };
  }

  const { acted: enemyActed, attacked: enemyAttacked } = resolveEnemiesAction(state, events);

  const playerDefeated = !state.player.alive;
  if (playerDefeated) {
    events.push({ type: 'player_defeated' });
  }

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
  // Web lifetime update comes last in the per-turn sequence (player
  // action -> enemy actions -> death/regen/floor checks -> turn increment
  // -> web lifetime), and uses the just-incremented turn count so a web
  // placed on turn T survives turns T..T+5 (6 total, including the
  // placement turn) and is removed starting turn T+6.
  expireWebs(state);

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
    events,
  };
}

export function createInitialActor(pos: Vec2, hp: number, attack: number): Actor {
  return { pos, hp, maxHp: hp, attack, facing: 'S', alive: true };
}

export function createInitialEnemy(
  type: EnemyType,
  pos: Vec2,
  hp: number,
  attack: number,
  spawnTurn: number = 0,
  id: number = 0,
): EnemyActor {
  return {
    ...createInitialActor(pos, hp, attack),
    type,
    spawnTurn,
    recovering: false,
    id,
    webCooldown: 0,
  };
}
