import { createRng } from './mapgen';

/** Total number of floors in a single run. */
export const TOTAL_FLOORS = 3;

// Golden-ratio-derived odd constant, used only to spread floor numbers
// across the 32-bit space before mixing with the run seed.
const FLOOR_MIX = 0x9e3779b9;

/**
 * Derives a floor's map-generation seed from the run seed and floor number.
 *
 * Pure function: no shared PRNG state is consumed across calls, so floors
 * can be derived in any order and always produce the same result for the
 * same (runSeed, floor) pair. Never reads Date.now or Math.random.
 */
export function deriveFloorSeed(runSeed: number, floor: number): number {
  const mixed = ((runSeed >>> 0) ^ Math.imul(floor, FLOOR_MIX)) >>> 0;
  const rng = createRng(mixed);
  return Math.floor(rng() * 0x100000000) >>> 0;
}
