import { createRng } from './mapgen';
import { RunConfig } from './types';

/**
 * Total number of floors in a single run. Phase 24.6b1: production
 * generation/progression/victory logic no longer reads this directly
 * (see DEFAULT_RUN_CONFIG below and state.ts's buildFloorState) — kept
 * as a back-compat export only for any external/test code still
 * importing it by name; its value (3) must stay in sync with
 * DEFAULT_RUN_CONFIG.totalFloors below.
 */
export const TOTAL_FLOORS = 3;

/**
 * Phase 24.6b1: the RunConfig every run uses unless a caller explicitly
 * supplies its own (createInitialState's optional second argument). Its
 * totalFloors matches TOTAL_FLOORS exactly, so every default-config run
 * behaves byte-for-byte identically to every pre-24.6b1 run. runDepthTier
 * defaults to 'short' per this phase's task contract — not yet read by
 * any generation logic (see types.ts's RunDepthTier doc comment).
 */
export const DEFAULT_RUN_CONFIG: Readonly<RunConfig> = Object.freeze({
  totalFloors: TOTAL_FLOORS,
  runDepthTier: 'short',
});

/**
 * Phase 24.6b1: validates and clones a caller-supplied RunConfig into a
 * frozen, run-lifetime-constant object — never the same reference as the
 * caller's, so later external mutation of their original object can
 * never retroactively change a state already created from it (task's
 * "後からmutationされない" contract). Throws RangeError before any state
 * is constructed if totalFloors isn't a finite integer >= 1 — this is
 * the only validation point; nothing downstream re-checks totalFloors'
 * validity.
 */
export function normalizeRunConfig(config: RunConfig): Readonly<RunConfig> {
  if (!Number.isFinite(config.totalFloors) || !Number.isInteger(config.totalFloors) || config.totalFloors < 1) {
    throw new RangeError(`RunConfig.totalFloors must be a finite integer >= 1, got ${config.totalFloors}`);
  }
  return Object.freeze({ totalFloors: config.totalFloors, runDepthTier: config.runDepthTier });
}

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
export function deriveFloorSeed(runSeed: number, floor: number, leg: 'descent' | 'ascent' = 'descent'): number {
  // The zero descent salt preserves the original byte-for-byte contract.
  const legSalt = leg === 'ascent' ? 0xa53c9e17 : 0;
  const mixed = ((runSeed >>> 0) ^ Math.imul(floor, FLOOR_MIX) ^ legSalt) >>> 0;
  const rng = createRng(mixed);
  return Math.floor(rng() * 0x100000000) >>> 0;
}
