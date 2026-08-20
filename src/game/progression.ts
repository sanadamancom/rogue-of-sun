import { GameState } from './types';

/**
 * Phase 13.1 experience/level/ability-point progression foundation.
 * Progression fields on GameState (level/experience/unspentAbilityPoints)
 * are optional, following the same pattern as hunger.ts's fields, so
 * existing GameState object literals across the test suite remain valid
 * without every one of them being updated. Defaults below are the
 * canonical "no progression yet" values (level 1, 0 experience, 0
 * unspent ability points).
 *
 * Phase 13.1 deliberately never reads or writes any combat stat (hp,
 * attack, defense, etc.) — see this phase's history doc for the full
 * out_of_scope list. This module only tracks/advances the progression
 * numbers themselves.
 */

export const LEVEL_CAP = 99;
export const ABILITY_POINTS_PER_LEVEL = 1;

const CUMULATIVE_EXPERIENCE_THROUGH_LEVEL_50 = [
  0,
  0, 10, 30, 60, 100, 150, 230, 350, 500, 700,
  950, 1_200, 1_500, 1_800, 2_300, 2_800, 3_500, 4_200, 5_000, 6_000,
  7_000, 8_000, 10_000, 13_000, 16_000, 20_000, 25_000, 30_000, 36_000, 42_000,
  48_000, 54_000, 60_000, 70_000, 80_000, 90_000, 100_000, 115_000, 130_000, 145_000,
  160_000, 175_000, 200_000, 230_000, 260_000, 290_000, 320_000, 350_000, 380_000, 410_000,
] as const;

/** Canonical cumulative experience total for each level (array index = level). */
export const CUMULATIVE_EXPERIENCE_BY_LEVEL: readonly number[] = (() => {
  const cumulative: number[] = [...CUMULATIVE_EXPERIENCE_THROUGH_LEVEL_50];
  for (let level = 51; level <= LEVEL_CAP; level += 1) {
    cumulative[level] = cumulative[level - 1] + 30_000;
  }
  return cumulative;
})();

export const PROGRESSION_INITIAL_LEVEL = 1;
export const PROGRESSION_INITIAL_EXPERIENCE = 0;
export const PROGRESSION_INITIAL_UNSPENT_ABILITY_POINTS = 0;

/** Current level, defaulting to 1 when the field is absent. */
export function getLevel(state: GameState): number {
  return state.level ?? PROGRESSION_INITIAL_LEVEL;
}

/** Current in-level experience (carried-over toward the next level), defaulting to 0 when absent. */
export function getExperience(state: GameState): number {
  return state.experience ?? PROGRESSION_INITIAL_EXPERIENCE;
}

/** Current unused ability points, defaulting to 0 when absent. */
export function getUnspentAbilityPoints(state: GameState): number {
  return state.unspentAbilityPoints ?? PROGRESSION_INITIAL_UNSPENT_ABILITY_POINTS;
}

/**
 * Experience required to go from `level` to `level + 1`, derived from the
 * canonical cumulative experience table. The single source of this
 * calculation — HUD, level-up processing, and tests all reuse this
 * function rather than re-deriving/hardcoding the constant.
 */
export function getExperienceRequirement(level: number): number {
  return CUMULATIVE_EXPERIENCE_BY_LEVEL[level + 1] - CUMULATIVE_EXPERIENCE_BY_LEVEL[level];
}

/** One level-up that occurred during a single applyExperienceGain call. */
export interface LevelUpResult {
  level: number;
  abilityPointsGained: number;
  /** Total unspent ability points immediately after reaching this level (running total, not just this level-up's gain). */
  unspentAbilityPointsAfter: number;
}

/** Result of applying an experience gain to a GameState via applyExperienceGain. */
export interface ExperienceGainResult {
  experienceGained: number;
  previousLevel: number;
  newLevel: number;
  remainingExperience: number;
  abilityPointsGained: number;
  /** Each level actually gained this call, in ascending order (empty if none). */
  levelUps: LevelUpResult[];
}

/**
 * Applies `amount` experience to `state` (mutating state.level/experience/
 * unspentAbilityPoints in place), resolving any resulting level-up(s) —
 * possibly more than one from a single gain — while carrying over surplus
 * experience rather than discarding it. Stops advancing (and clears
 * experience to 0) once LEVEL_CAP is reached; a gain that would push past
 * the cap simply has no further effect on level/experience beyond
 * reaching it. Never touches any other GameState field (hp, attack,
 * defense, ...) — see this module's doc comment.
 */
export function applyExperienceGain(state: GameState, amount: number): ExperienceGainResult {
  const previousLevel = getLevel(state);
  let level = previousLevel;
  let experience = getExperience(state) + amount;
  let unspentAbilityPoints = getUnspentAbilityPoints(state);
  const levelUps: LevelUpResult[] = [];

  while (level < LEVEL_CAP && experience >= getExperienceRequirement(level)) {
    experience -= getExperienceRequirement(level);
    level += 1;
    const abilityPointsGained = level % 2 === 0 ? ABILITY_POINTS_PER_LEVEL : 0;
    unspentAbilityPoints += abilityPointsGained;
    levelUps.push({ level, abilityPointsGained, unspentAbilityPointsAfter: unspentAbilityPoints });
  }

  if (level >= LEVEL_CAP) {
    level = LEVEL_CAP;
    experience = 0;
  }

  state.level = level;
  state.experience = experience;
  state.unspentAbilityPoints = unspentAbilityPoints;

  return {
    experienceGained: amount,
    previousLevel,
    newLevel: level,
    remainingExperience: experience,
    abilityPointsGained: levelUps.reduce((total, levelUp) => total + levelUp.abilityPointsGained, 0),
    levelUps,
  };
}
