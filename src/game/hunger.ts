import { GameState } from './types';

/**
 * Phase 11.3 hunger system constants, fixed by the measured-play-data
 * decision in docs/history/phase-11-3-hunger-food-starvation.md. All
 * values are named constants defined exactly once here; nothing else
 * duplicates them.
 */
export const HUNGER_MAX = 100;
export const HUNGER_DECREASE_AMOUNT = 1;
// Phase 16.1 early-resource-and-combat-pressure rebalance: 4->5 (see
// docs/history/phase-16-early-game-balance.md's Phase 16.1 section). A
// small, deliberately modest loosening of the hunger decay rate — every
// consumed turn still costs the same fraction of HUNGER_MAX per turn
// spent (unwaited standing to heal 6 HP, for example, now burns 12
// hunger instead of 15 — see the same section for the full before/after
// table), rather than a large change that would make waiting free or
// remove hunger pressure entirely. HUNGER_DECREASE_AMOUNT (1),
// HUNGER_MAX (100), and every natural-HP-regeneration constant
// (REGEN_AMOUNT_PER_TICK/REGEN_TURNS_PER_HP in turn.ts) are unchanged —
// only this interval moved.
export const HUNGER_DECREASE_INTERVAL = 5;
export const CHOCOLATE_HUNGER_RECOVERY = 30;
export const STARVATION_DAMAGE = 1;
/** Phase 15.2 core combat/recovery rebalance: 5->1 (see docs/history/phase-15-2-recovery-satiety-status-rebalance.md) — every consumed turn at satiety 0 now deals starvation damage, rather than once every 5 turns. */
export const STARVATION_INTERVAL = 1;
/** Below-or-equal threshold for the one-time "low hunger" warning. */
export const HUNGER_LOW_THRESHOLD = 20;

/** Current hunger, defaulting to HUNGER_MAX when the field is absent (see GameState.hunger's doc comment). */
export function getHunger(state: GameState): number {
  return state.hunger ?? HUNGER_MAX;
}

/** Progress toward the next 1-point hunger decrease, defaulting to 0 when absent. */
export function getHungerDecreaseProgress(state: GameState): number {
  return state.hungerDecreaseProgress ?? 0;
}

/** Progress toward the next starvation damage tick, defaulting to 0 when absent. */
export function getStarvationProgress(state: GameState): number {
  return state.starvationProgress ?? 0;
}
