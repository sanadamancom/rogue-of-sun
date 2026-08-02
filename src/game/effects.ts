import { ActiveEffect, EffectId, GameState } from './types';

/**
 * Central per-species definition of a temporary status effect (Phase 12.1
 * common status-effect foundation). Single source of truth for
 * strength/duration so ItemDefinition, combat resolution (turn.ts), and
 * the HUD never repeat these numbers themselves — see the phase's
 * fixed_specification.active_effect_model.definitions requirement.
 */
export interface EffectDefinition {
  id: EffectId;
  /** Japanese label used by the HUD; the internal id is never shown as-is. */
  displayName: string;
  /** Flat bonus this effect grants while active (attack_up: +5 physical attack). */
  strength: number;
  /** Duration in successful player turns, counting from the turn after it's granted/refreshed. */
  duration: number;
}

// Phase 12.1 registers only 'attack_up'. Future effects (poison, defense
// up, etc. — explicitly out of scope this phase) are expected to extend
// this table rather than add parallel ad-hoc fields elsewhere.
export const EFFECT_DEFINITIONS: Record<EffectId, EffectDefinition> = {
  attack_up: {
    id: 'attack_up',
    displayName: '攻撃力上昇',
    strength: 5,
    duration: 20,
  },
};

/**
 * The player's current active effects, or [] if the field is absent
 * (existing GameState fixtures across the test suite predate this phase
 * and never set it — see types.ts's GameState.activeEffects doc comment).
 * Pure/side-effect-free; never mutates state.
 */
export function getActiveEffects(state: GameState): ActiveEffect[] {
  return state.activeEffects ?? [];
}

/** The active instance of `id`, or undefined if not currently active. */
export function getActiveEffect(state: GameState, id: EffectId): ActiveEffect | undefined {
  return getActiveEffects(state).find((effect) => effect.id === id);
}

/**
 * The effective bonus strength currently granted by `id` (0 if not
 * active). Combat resolution (turn.ts's applyPlayerAttackToEnemy) reads
 * this instead of ever touching Actor.attack directly, per
 * fixed_specification.attack_up_effect's "Actor.attack自体を書き換えない"
 * / "効果切れ時に補正値を差し引く方式にせず、攻撃時に有効効果から算出する".
 */
export function getEffectStrength(state: GameState, id: EffectId): number {
  return getActiveEffect(state, id)?.strength ?? 0;
}

/**
 * Whether `id` is currently at its maximum (freshly granted/refreshed)
 * remaining duration — used by banana's use_failure guard
 * (fixed_specification.banana.use_failure: "attack_upの残りターンがすで
 * に20の場合は使用失敗").
 */
export function isEffectAtMaxDuration(state: GameState, id: EffectId): boolean {
  const effect = getActiveEffect(state, id);
  if (!effect) return false;
  return effect.remainingTurns >= EFFECT_DEFINITIONS[id].duration;
}

/**
 * Grants `id` if not currently active, or refreshes its remaining
 * duration back to the definition's full duration if it is (never
 * stacking strength — fixed_specification.duplicate_and_refresh:
 * "強度を+10へ重複加算しない" / "複数のattack_upレコードを作らない").
 * Strength is always (re)written from the current definition. Callers
 * (applyBananaUse) are responsible for having already checked
 * isEffectAtMaxDuration and rejected the use before calling this — this
 * function itself has no failure path.
 */
export function grantOrRefreshEffect(state: GameState, id: EffectId): 'granted' | 'refreshed' {
  const def = EFFECT_DEFINITIONS[id];
  if (!state.activeEffects) {
    state.activeEffects = [];
  }
  const existing = state.activeEffects.find((effect) => effect.id === id);
  if (existing) {
    existing.strength = def.strength;
    existing.remainingTurns = def.duration;
    return 'refreshed';
  }
  state.activeEffects.push({ id, strength: def.strength, remainingTurns: def.duration });
  return 'granted';
}

/**
 * Advances every active effect's remaining duration by exactly 1 (once
 * per successful player turn, per fixed_specification.duration_and_
 * turn_boundary.progression — never per-action-type-duplicated), removing
 * any that reach 0. Returns the ids that expired this call so the caller
 * (turn.ts's processTurn) can push a single 'effect_expired' event per
 * expiry. Never called on the same turn an effect was freshly granted or
 * refreshed (fixed_specification.banana.use_success's "バナナ使用ターン
 * 自体ではattack_upの残りターンを減らさない") — that skip is the caller's
 * responsibility, not this function's, since this function has no way to
 * know which turn it's being called for.
 */
export function advanceEffectDurations(state: GameState): EffectId[] {
  const effects = state.activeEffects ?? [];
  const expired: EffectId[] = [];
  for (const effect of effects) {
    effect.remainingTurns -= 1;
  }
  state.activeEffects = effects.filter((effect) => {
    if (effect.remainingTurns <= 0) {
      expired.push(effect.id);
      return false;
    }
    return true;
  });
  return expired;
}
