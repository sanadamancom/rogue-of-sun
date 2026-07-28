import { choosePlacement, createRng, generateMap, MAP_GEN_PARAMS } from './mapgen';
import { createInitialActor } from './turn';
import { GameState } from './types';

/** Generates a random seed without relying on Math.random's implicit global state at call sites. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * Builds a fresh GameState for the given seed. Retries via generateMap's
 * own deterministic retry loop; if generation still fails, throws, since
 * there is no sensible playable fallback for a failed floor.
 */
export function createInitialState(seed: number): GameState {
  const result = generateMap(seed);
  if (!result.ok || !result.map) {
    throw new Error(`Map generation failed for seed ${seed} after ${MAP_GEN_PARAMS.maxGenerationAttempts} attempts`);
  }

  const map = result.map;
  const placementRng = createRng(seed ^ 0x51ed270b);
  const placement = choosePlacement(map, placementRng);

  return {
    map,
    player: createInitialActor(placement.start, 3, 1),
    enemy: createInitialActor(placement.enemy, 2, 1),
    turn: 0,
    phase: 'playing',
    seed,
    exit: placement.exit,
  };
}
