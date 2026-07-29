import { choosePlacement, createRng, generateMap, MAP_GEN_PARAMS } from './mapgen';
import { createInitialActor } from './turn';
import { deriveFloorSeed, TOTAL_FLOORS } from './floor';
import { Actor, GameState } from './types';

/** Generates a random run seed without relying on Math.random's implicit global state at call sites. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

interface CarryOverStats {
  hp: number;
  maxHp: number;
  attack: number;
  regenProgress: number;
}

/**
 * Builds the GameState for a single floor of a run. Retries via
 * generateMap's own deterministic retry loop; if generation still fails,
 * throws, since there is no sensible playable fallback for a failed floor.
 */
function buildFloorState(runSeed: number, floor: number, turn: number, carry?: CarryOverStats): GameState {
  const floorSeed = deriveFloorSeed(runSeed, floor);
  const result = generateMap(floorSeed);
  if (!result.ok || !result.map) {
    throw new Error(
      `Map generation failed for floor seed ${floorSeed} (run ${runSeed}, floor ${floor}) after ${MAP_GEN_PARAMS.maxGenerationAttempts} attempts`,
    );
  }

  const map = result.map;
  const placementRng = createRng(floorSeed ^ 0x51ed270b);
  const placement = choosePlacement(map, placementRng);

  const player: Actor = carry
    ? createInitialActor(placement.start, carry.maxHp, carry.attack)
    : createInitialActor(placement.start, 3, 1);
  if (carry) {
    // maxHp/attack already set via createInitialActor above; only current
    // HP needs to be overridden to the carried-over value (never healed).
    player.hp = carry.hp;
  }

  const enemies = placement.enemies.map((pos) => createInitialActor(pos, 2, 1));

  return {
    map,
    player,
    enemies,
    turn,
    phase: 'playing',
    seed: floorSeed,
    runSeed,
    floor,
    totalFloors: TOTAL_FLOORS,
    exit: placement.exit,
    regenProgress: carry ? carry.regenProgress : 0,
  };
}

/** Builds a fresh GameState for floor 1 of the given run seed. */
export function createInitialState(runSeed: number): GameState {
  return buildFloorState(runSeed, 1, 0);
}

/**
 * Advances to the next floor of the same run, carrying over the player's
 * current HP, max HP, attack, and regen progress, and resetting all
 * per-floor state (map, position, enemies, exit).
 */
export function advanceToNextFloor(state: GameState): GameState {
  const carry: CarryOverStats = {
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    attack: state.player.attack,
    regenProgress: state.regenProgress,
  };
  return buildFloorState(state.runSeed, state.floor + 1, state.turn, carry);
}
