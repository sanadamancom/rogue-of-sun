/**
 * Combat RNG (Phase 10.3 accuracy/evasion foundation): a separate,
 * explicit-state PRNG stream from mapgen.ts's map-generation RNGs. Uses
 * the identical mulberry32 algorithm (see mapgen.ts's createRng) for
 * consistency, but exposes the internal state as a plain number instead
 * of a closure, so it can live directly on GameState (a plain data
 * object) and survive floor transitions the same way inventory/solarEnergy
 * do — see state.ts's CarryOverStats.combatRngState.
 *
 * Never shares a seed or a call sequence with any map-generation RNG
 * stream, so adding combat rolls can never perturb map/placement/species/
 * item/sunlight determinism — see docs/history/phase-10-3-accuracy-and-
 * evasion.md for the investigation confirming this.
 */

/** Advances the stream by exactly one step, returning both the [0,1) value and the next state. Pure — never mutates its input. */
export function mulberry32Step(state: number): { value: number; nextState: number } {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextState: a };
}

/**
 * Draws one integer roll in [0, 99] from the stream, returning both the
 * roll and the next state to store back onto GameState.combatRngState.
 * Exactly one call per resolved (non-whiff, non-out-of-range,
 * non-resource-blocked) attack — see turn.ts's rollAttackHit.
 */
export function rollPercent(state: number): { roll: number; nextState: number } {
  const { value, nextState } = mulberry32Step(state);
  return { roll: Math.floor(value * 100), nextState };
}
