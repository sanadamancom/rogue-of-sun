/**
 * Central damage-calculation module (Phase 10.2 combat stat/scale
 * redesign; Phase 15.1 rebalance changes the enemy->player formula and
 * floor — see below). Both functions here are pure and state-free — they
 * take plain numbers and return a plain number, never touching HP, alive
 * flags, defeat/knockback handling, or events. Every call site (player
 * melee/solar-gun attacks in turn.ts's applyPlayerAttackToEnemy, and
 * every enemy-attack site: tryMeleeAttack, resolveSpiderEnemy,
 * resolveKrakenEnemy) routes its final-damage arithmetic through one of
 * these two functions instead of repeating the formula inline, so a
 * future change to the formula only needs to happen here.
 *
 * - computeAttackDamage (player -> enemy, including the solar gun):
 *   flat subtraction, floors at 1 on any connecting hit
 *   ("有効な対象へ命中した場合の最小ダメージは1とする").
 * - computeIncomingDamage (enemy -> player): Phase 15.1 replaces the
 *   previous flat-subtraction/floor-0 formula with a proportional
 *   (percentage) reduction — `max(1, round(attackerAttack *
 *   2^(-defenderDefense/10)))` — so defense 10 roughly halves incoming
 *   damage rather than fully canceling a weak hit, and every connecting
 *   enemy attack now deals at least 1 damage (matching
 *   computeAttackDamage's floor). This intentionally removes the
 *   previously-documented "shonen-mystery-dungeon-style" complete-
 *   nullification case from Phase 08.4/10.2 — see
 *   docs/history/phase-15-1-core-combat-rebalance.md for the rationale.
 */

import type { ElementalAffinity } from './types';

/**
 * Player-side (and solar-gun) outgoing damage: base attack plus the
 * equipped weapon's bonus (0 for bare hands or a weapon with no bonus),
 * minus the target's defense, floored at 1 so a connecting hit is never
 * a no-op.
 */
export function computeAttackDamage(baseAttack: number, weaponBonus: number, defenderDefense: number): number {
  return Math.max(1, baseAttack + weaponBonus - defenderDefense);
}

/**
 * Enemy-side outgoing damage (Phase 15.1 rebalance): a proportional
 * (percentage) reduction based on the defender's (the player's) total
 * effective defense, floored at 1 — see the module doc comment above.
 * `effectiveDefense` is `max(0, armorDefense + armorEnhancement)`,
 * computed by the caller (turn.ts's getEffectivePlayerDefense) before
 * being passed in here as `defenderDefense`.
 */
export function computeIncomingDamage(attackerAttack: number, defenderDefense: number): number {
  const effectiveDefense = Math.max(0, defenderDefense);
  return Math.max(1, Math.round(attackerAttack * Math.pow(2, -effectiveDefense / 10)));
}

/**
 * Hit chance floor/ceiling (Phase 10.3 accuracy/evasion foundation), in
 * integer percent. No matchup can ever fall outside this range — see
 * computeHitChance.
 */
export const MIN_HIT_CHANCE = 10;
export const MAX_HIT_CHANCE = 95;

/**
 * Integer-percent hit chance for one attack (Phase 10.3): attacker
 * accuracy plus the weapon's hit modifier (0 for an unarmed attacker),
 * minus the defender's evasion, clamped to [MIN_HIT_CHANCE,
 * MAX_HIT_CHANCE]. Pure — never rolls, never touches state. See
 * turn.ts's resolveAttackHit for how the roll itself (rng.ts's
 * rollPercent) is combined with this.
 */
export function computeHitChance(attackerAccuracy: number, weaponHitModifier: number, defenderEvasion: number): number {
  const raw = attackerAccuracy + weaponHitModifier - defenderEvasion;
  return Math.min(MAX_HIT_CHANCE, Math.max(MIN_HIT_CHANCE, raw));
}

/**
 * Whether a drawn `roll` (integer [0, 99], from rng.ts's rollPercent)
 * counts as a hit against `hitChance` (integer percent, from
 * computeHitChance): `roll < hitChance`. This means a hitChance of 95
 * hits on exactly 95 of the 100 possible roll values (0-94), and a
 * hitChance of 10 (Phase 15.1's MIN_HIT_CHANCE) hits on exactly 10 of
 * them (0-9) — matching Phase 10.3's confirmed_design boundary
 * requirements precisely, with no off-by-one ambiguity at either end.
 */
export function resolvesAsHit(roll: number, hitChance: number): boolean {
  return roll < hitChance;
}

/**
 * Integer-percent multiplier for each ElementalAffinity (Phase 14.1
 * five-element enchantment foundation) — the single source of truth for
 * these three percentages, so no call site repeats them inline.
 */
export const ELEMENTAL_AFFINITY_PERCENT: Record<ElementalAffinity, number> = {
  weak: 150,
  neutral: 100,
  resist: 50,
};

/**
 * Pure, common elemental-damage calculation (Phase 14.1): floor(
 * baseElementalDamage * affinityPercent / 100). Deliberately state-free
 * — no GameState, EnemyActor, RNG, or events — mirroring
 * computeAttackDamage/computeIncomingDamage above. Physical defense is
 * never applied here; only the caller (turn.ts's
 * applyPlayerAttackToEnemy) combines this with the separately-computed
 * physical damage. Shared by every element (currently only sol calls
 * this in play; future elements reuse the same function per Phase
 * 14.1's confirmed_element_model).
 */
export function computeElementalDamage(baseElementalDamage: number, affinity: ElementalAffinity): number {
  return Math.floor((baseElementalDamage * ELEMENTAL_AFFINITY_PERCENT[affinity]) / 100);
}
