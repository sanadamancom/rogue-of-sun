import { GameState } from './types';

/**
 * Phase 11.3 hunger system constants, fixed by the measured-play-data
 * decision in docs/history/phase-11-3-hunger-food-starvation.md. All
 * values are named constants defined exactly once here; nothing else
 * duplicates them.
 */
export const HUNGER_MAX = 100;
export const HUNGER_DECREASE_AMOUNT = 1;
export const HUNGER_DECREASE_INTERVAL = 4;
export const CHOCOLATE_HUNGER_RECOVERY = 30;
export const STARVATION_DAMAGE = 1;
export const STARVATION_INTERVAL = 5;
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
