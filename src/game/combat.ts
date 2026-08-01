/**
 * Central damage-calculation module (Phase 10.2 combat stat/scale
 * redesign). Both functions here are pure and state-free — they take
 * plain numbers and return a plain number, never touching HP, alive
 * flags, defeat/knockback handling, or events. Every call site (player
 * melee/solar-gun attacks in turn.ts's applyPlayerAttackToEnemy, and
 * every enemy-attack site: tryMeleeAttack, resolveSpiderEnemy,
 * resolveKrakenEnemy) routes its final-damage arithmetic through one of
 * these two functions instead of repeating `attack - defense` inline, so
 * a future change to the formula (e.g. elemental multipliers) only needs
 * to happen here.
 *
 * Two different minimum-damage floors are used, intentionally kept as
 * two separate functions rather than one parameterized signature so the
 * floor value is never an easy-to-miss call-site argument:
 *
 * - computeAttackDamage (player -> enemy, including the solar gun):
 *   floors at 1 on any connecting hit, per Phase 10.2's confirmed design
 *   ("有効な対象へ命中した場合の最小ダメージは1とする").
 * - computeIncomingDamage (enemy -> player): floors at 0, preserving the
 *   pre-existing, explicitly documented (since Phase 08.4's armor
 *   foundation) "shonen-mystery-dungeon-style" design where sufficient
 *   armor can reduce a weak enemy's hit to exactly zero. Phase 10.2's own
 *   design doc proposed a uniform max(1, ...) for this direction too, but
 *   that would silently remove an already-shipped, intentional zero-
 *   damage case (see docs/history/phase-10-2-combat-stat-scale-redesign.md
 *   for the investigation and the decision to preserve it instead, per
 *   that phase's own "現行挙動に完全無効攻撃が存在する場合は...その仕様を
 *   維持する" escape clause).
 */

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
 * Enemy-side outgoing damage: attack minus the defender's (the player's)
 * total defense, floored at 0 — see the module doc comment above for why
 * this floor differs from computeAttackDamage's.
 */
export function computeIncomingDamage(attackerAttack: number, defenderDefense: number): number {
  return Math.max(0, attackerAttack - defenderDefense);
}
