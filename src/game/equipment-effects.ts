import { EnemyType, EquipmentInstance, GameState, WeaponId, ElementId } from './types';
import { WEAPON_DEFINITIONS } from './weapon-def';
import { ARMOR_DEFINITIONS } from './armor-def';
import { ENEMY_DEFINITIONS, EnemyTrait } from './enemy-def';
import { isInRoomBounds } from './visibility';
import { getEquipmentInstanceById, normalizeEquipmentEffectState } from './equipment-instance';

/**
 * Phase 24.3 装備効果: shared, mostly-pure helpers each individual
 * weapon/armor effect's implementation lives behind, dispatched by
 * WeaponDefinition.effectId/ArmorDefinition.effectId rather than any
 * per-call-site definitionId switch (implementation_structure's
 * "definitionIdを各combat call siteで直接比較せず、equipment effect
 * moduleへ集約"). turn.ts's small number of hook points (attack-start
 * snapshot, SOL payment, hit resolution, defeat, damage-taken, world-
 * turn completion) call into this module instead of encoding any
 * effect's own condition inline.
 */

// --- shared conditions ----------------------------------------------

/** Whether `state.player.hp` is at or below 1/3 of `state.player.maxHp` (bushido_blade's attack-start condition), floor-divided. */
export function isPlayerLowLife(state: GameState): boolean {
  return state.player.hp <= Math.floor(state.player.maxHp / 3);
}

/** Whether the player's current position is inside this floor's designated dark room (map.darkRoomIndex) — dark_sword/black_queen/twilight/gram/gungnir/mjolnir's "暗い部屋" half of their attack-start condition. */
export function isPlayerInDarkRoom(state: GameState): boolean {
  const roomIndex = state.map.rooms.findIndex((r) => isInRoomBounds(r, state.player.pos));
  return roomIndex >= 0 && state.map.darkRoomIndex != null && state.map.darkRoomIndex === roomIndex;
}

/**
 * Whether the player is currently under a "night" combat/effect
 * condition — this codebase has no separate day/night clock (only a
 * single per-floor dark room; see dark-rooms.ts), so dark_garb's
 * "プレイヤーに関する昼夜判定を夜間として扱う" is implemented as forcing
 * this condition true while dark_garb is equipped, and every other
 * "夜間または暗い部屋" weapon condition (dark_sword/black_queen/twilight/
 * gram/gungnir/mjolnir) is otherwise satisfied by isPlayerInDarkRoom
 * alone. Documented as a deliberate scope decision in
 * docs/history/phase-24-3-equipment-catalog-effects.md — adding a real
 * day/night clock is out of scope this phase.
 */
export function isNightOrDarkRoom(state: GameState): boolean {
  return isPlayerInDarkRoom(state) || state.equippedArmorId === 'dark_garb';
}

/** Whether `state.solarEnergy` is at its effective max (solar_sword/white_queen/dawn/gram/gungnir/mjolnir's other attack-start condition). Uses getEffectiveMaxSolarEnergy so light_garb's +2 is honored. */
export function isSolarEnergyMax(state: GameState): boolean {
  return state.solarEnergy >= getEffectiveMaxSolarEnergy(state);
}

// --- weapon attack-start damage bonus ---------------------------------

/**
 * Phase 24.3 effect_timing.attack_start_snapshot: the flat bonus damage
 * an equipped weapon's own species effect contributes, evaluated once at
 * attack start (before any SOL is spent) — sol_max_bonus/night_dark_
 * bonus/low_life_bonus/dual_light_dark_bonus. Never touches elemental
 * bonus (flame/frost/earth — see getWeaponElementalBonus below),
 * magic_sword's SOL reduction, or any defeat-triggered effect. Returns 0
 * for every "none"-effect weapon and for solar_gun (never routed through
 * this melee-only path).
 */
export function getWeaponAttackStartBonus(state: GameState, weaponId: WeaponId | null): number {
  if (!weaponId) return 0;
  const effectId = WEAPON_DEFINITIONS[weaponId]?.effectId;
  switch (effectId) {
    case 'sol_max_bonus':
      return isSolarEnergyMax(state) ? 1 : 0;
    case 'night_dark_bonus':
      return isNightOrDarkRoom(state) ? 1 : 0;
    case 'low_life_bonus':
      return isPlayerLowLife(state) ? 1 : 0;
    case 'dual_light_dark_bonus': {
      let bonus = 0;
      if (isSolarEnergyMax(state)) bonus += 1;
      if (isNightOrDarkRoom(state)) bonus += 1;
      return bonus;
    }
    default:
      return 0;
  }
}

/** Which ElementId (if any) `effectId` gives a +1 elemental bonus for (flamberge/ice_glaive/grand_lance). */
const ELEMENTAL_BONUS_BY_EFFECT: Partial<Record<string, ElementId>> = {
  flame_bonus: 'flame',
  frost_bonus: 'frost',
  earth_bonus: 'earth',
};

/**
 * Phase 24.3 effect_timing.elemental_bonus: +1 additional elemental
 * damage when the equipped weapon's species effect matches
 * `activatedElement` exactly (flamberge->flame, ice_glaive->frost,
 * grand_lance->earth) — applied once, on top of the existing affinity/
 * mind-bonus calculation, never replacing it. 0 for every other
 * combination (including a matching weapon with a *different* element
 * activated, or no element activated at all).
 */
export function getWeaponElementalBonus(weaponId: WeaponId | null, activatedElement: ElementId | null): number {
  if (!weaponId || !activatedElement) return 0;
  const effectId = WEAPON_DEFINITIONS[weaponId]?.effectId;
  if (!effectId) return 0;
  return ELEMENTAL_BONUS_BY_EFFECT[effectId] === activatedElement ? 1 : 0;
}

/** Which EnemyTrait (if any) `effectId` gives a +1 species-targeted bonus against (maul->construct, silver_flail->undead). */
const TRAIT_BONUS_BY_EFFECT: Partial<Record<string, EnemyTrait>> = {
  construct_bonus: 'construct',
  undead_bonus: 'undead',
};

/** Phase 24.3: +1 damage when the equipped weapon's species effect targets a trait `target.type`'s EnemyDefinition carries (maul vs construct, silver_flail vs undead). 0 otherwise. */
export function getWeaponTraitBonus(weaponId: WeaponId | null, targetType: EnemyType): number {
  if (!weaponId) return 0;
  const effectId = WEAPON_DEFINITIONS[weaponId]?.effectId;
  if (!effectId) return 0;
  const trait = TRAIT_BONUS_BY_EFFECT[effectId];
  if (!trait) return 0;
  const traits = ENEMY_DEFINITIONS[targetType].traits ?? [];
  return traits.includes(trait) ? 1 : 0;
}

/**
 * Phase 24.3 battle_axe (floor_species_bonus): +1 damage against any
 * EnemyType this exact weapon instance has already fully defeated this
 * floor (instance.effectState.defeatedEnemyTypes — see
 * recordWeaponDefeatEffects below for how it's populated). 0 for every
 * other weapon's effectId and for a battle_axe instance that hasn't
 * defeated this species yet this floor.
 */
export function getWeaponFloorSpeciesBonus(weaponId: WeaponId | null, instance: EquipmentInstance | undefined, targetType: EnemyType): number {
  if (!weaponId || !instance) return 0;
  if (WEAPON_DEFINITIONS[weaponId]?.effectId !== 'floor_species_bonus') return 0;
  const defeated = instance.effectState?.defeatedEnemyTypes ?? [];
  return defeated.includes(targetType) ? 1 : 0;
}

/**
 * Total flat weapon-effect damage bonus for one attack (attack-start +
 * trait + floor-species — everything evaluated *before* the hit is
 * resolved, i.e. everything except the post-hoc elemental bonus, which
 * needs the actually-activated element and is added separately by the
 * caller via getWeaponElementalBonus once that's known).
 */
export function getWeaponPreHitDamageBonus(
  state: GameState,
  weaponId: WeaponId | null,
  instance: EquipmentInstance | undefined,
  targetType: EnemyType,
): number {
  return (
    getWeaponAttackStartBonus(state, weaponId) +
    getWeaponTraitBonus(weaponId, targetType) +
    getWeaponFloorSpeciesBonus(weaponId, instance, targetType)
  );
}

// --- magic_sword: melee element SOL cost reduction ---------------------

/**
 * Phase 24.3 magic_sword (effect_timing.magic_sword): the equipped
 * weapon's SOL-cost reduction for a melee elemental attack whose
 * confirmed cost is >=2 — -1, floored at 1. Applies only to the melee
 * ELEMENT_ENCHANTMENT_SOL_COST deduction (turn.ts's
 * applyPlayerAttackToEnemy); never to the solar gun's own cost, item/
 * card SOL changes, or natural sunlight charge. 0 (no reduction) for
 * every other weapon.
 */
export function getMagicSwordSolCostReduction(weaponId: WeaponId | null, baseCost: number): number {
  if (!weaponId) return 0;
  if (WEAPON_DEFINITIONS[weaponId]?.effectId !== 'sol_cost_reduction') return 0;
  return baseCost >= 2 ? 1 : 0;
}

// --- corsesca: on-hit stun chance ---------------------------------------

/** Phase 24.3 corsesca (effect_timing.corsesca): whether the equipped weapon is corsesca (the only species with this effectId) — the caller (turn.ts) still owns the actual 10% RNG roll via the existing combat RNG stream, this only identifies eligibility. */
export function isCorsescaStunEligible(weaponId: WeaponId | null): boolean {
  return !!weaponId && WEAPON_DEFINITIONS[weaponId]?.effectId === 'stun_chance';
}

// --- blood weapons: on-defeat LIFE/SOL restore --------------------------

/** Which stat ('hp' | 'sol') a blood-effect weapon restores 1 point of on a capped, per-floor-limited full defeat. */
const BLOOD_DEFEAT_STAT_BY_EFFECT: Partial<Record<string, 'hp' | 'sol'>> = {
  blood_defeat_heal: 'hp',
  blood_defeat_sol: 'sol',
};

/** Max times a single blood-effect weapon individual may trigger its defeat effect per floor (effect_timing.defeat_effects's "blood系の上限は個体ごと・1フロア2回"). */
export const BLOOD_DEFEAT_EFFECT_FLOOR_CAP = 2;

/**
 * Phase 24.3 blood_sword/blood_spear/bloody_mace + battle_axe
 * (effect_timing.defeat_effects): called once, only from the single
 * "genuine full defeat" choke point (turn.ts's defeatEnemyIfNeeded
 * returning true — never for a skeleton headify/no-effect outcome, and
 * never for a spike_mail reflect kill, which routes through
 * defeatEnemyIfNeeded directly without this call per
 * effect_timing.spike_mail's "反射で敵を倒してもblood武器やbattle_axeの
 * 撃破効果は発動しない"). Mutates `state.player.hp`/`state.solarEnergy`
 * (clamped to their effective max) and `instance.effectState` in place;
 * returns which stat was restored (if any) for the caller to push an
 * event/message for, or null if nothing fired (wrong weapon, cap
 * reached, or not battle_axe).
 */
export function applyWeaponDefeatEffects(
  state: GameState,
  weaponId: WeaponId | null,
  instance: EquipmentInstance | undefined,
  defeatedType: EnemyType,
): { restoredStat: 'hp' | 'sol' } | null {
  if (!weaponId || !instance) return null;
  const effectId = WEAPON_DEFINITIONS[weaponId]?.effectId;
  instance.effectState = normalizeEquipmentEffectState(instance.effectState);

  if (effectId === 'floor_species_bonus') {
    if (!instance.effectState.defeatedEnemyTypes.includes(defeatedType)) {
      instance.effectState.defeatedEnemyTypes = [...instance.effectState.defeatedEnemyTypes, defeatedType];
    }
    return null;
  }

  const stat = BLOOD_DEFEAT_STAT_BY_EFFECT[effectId ?? ''];
  if (!stat) return null;
  if (instance.effectState.floorTriggerUses >= BLOOD_DEFEAT_EFFECT_FLOOR_CAP) return null;

  instance.effectState.floorTriggerUses += 1;
  if (stat === 'hp') {
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 1);
  } else {
    state.solarEnergy = Math.min(getEffectiveMaxSolarEnergy(state), state.solarEnergy + 1);
  }
  return { restoredStat: stat };
}

// --- armor: effective stat helpers --------------------------------------

/** Phase 24.3 samurai_armor/black_armor (armor_stats): the equipped armor's flat bonus to the player's effective attack power, added on top of getEffectiveAttackPower's existing weapon-bonus sum — never mutating any base Player field. */
export function getArmorEffectiveAttackBonus(state: GameState): number {
  const armorId = state.equippedArmorId;
  if (!armorId) return 0;
  const effectId = ARMOR_DEFINITIONS[armorId]?.effectId;
  if (effectId === 'effective_attack_bonus') return 1; // samurai_armor
  if (effectId === 'black_armor_curse') return 2; // black_armor
  return 0;
}

/** Phase 24.3 ninja_suit (armor_stats): the equipped armor's flat bonus to the player's effective speed (ability.ts's getPlayerSpeed calls this) — never mutating the base speed ability value. */
export function getArmorEffectiveSpeedBonus(state: GameState): number {
  return state.equippedArmorId && ARMOR_DEFINITIONS[state.equippedArmorId]?.effectId === 'effective_speed_bonus' ? 10 : 0;
}

/** Phase 24.3 light_garb (armor_stats): the equipped armor's flat bonus to the player's effective max SOL — never mutating the base state.maxSolarEnergy field. Every maxSolarEnergy comparison/clamp site in turn.ts reads this instead of the base field directly. */
export function getArmorEffectiveMaxSolBonus(state: GameState): number {
  return state.equippedArmorId && ARMOR_DEFINITIONS[state.equippedArmorId]?.effectId === 'max_sol_bonus' ? 2 : 0;
}

/** The player's effective max SOL: base state.maxSolarEnergy plus light_garb's bonus (0 if not equipped). Single source of truth for every SOL-max comparison/clamp in turn.ts. */
export function getEffectiveMaxSolarEnergy(state: GameState): number {
  return state.maxSolarEnergy + getArmorEffectiveMaxSolBonus(state);
}

// --- armor: elemental damage reduction -----------------------------------

/** Which ElementId(s) `effectId` reduces incoming elemental bonus damage for (mail_of_sol->sol, mail_of_dark->dark [never a real ElementId here — dark has no enchantment element; kept as a documented no-op], dragon_scale->flame/frost/cloud/earth). */
function armorElementReduction(effectId: string | undefined, element: ElementId): number {
  if (effectId === 'sol_element_reduction' && element === 'sol') return 1;
  if (effectId === 'four_element_reduction' && element !== 'sol') return 1;
  return 0;
}

/**
 * Phase 24.3 mail_of_sol/dragon_scale (armor_elements): reduces the
 * *elemental* portion of incoming enemy damage by 1 (floor 0) for a
 * matching element — never the physical base damage, and applied once,
 * after the existing affinity calculation (this function only computes
 * the reduction amount; the caller subtracts it from the already-
 * computed elemental damage). mail_of_dark's DARK-element reduction has
 * no analogue in ElementId (there is no "dark" enchantment element in
 * this codebase — mail_of_dark's effectId exists for cataloging
 * completeness but never actually reduces melee/solar-gun elemental
 * damage this phase; see docs/history/phase-24-3-equipment-catalog-
 * effects.md for the scope note). Returns 0 for every non-matching
 * armor/element pair.
 */
export function getArmorElementalDamageReduction(state: GameState, element: ElementId): number {
  if (!state.equippedArmorId) return 0;
  const effectId = ARMOR_DEFINITIONS[state.equippedArmorId]?.effectId;
  return armorElementReduction(effectId, element);
}

// --- armor: poison immunity ----------------------------------------------

/** Phase 24.3 poison_guard (armor_elements/poison_guard): whether the player is currently immune to any new poison application (equipping never cures existing poison — see turn.ts's poison-apply call sites, every one of which now checks this before applying a fresh poison effect). */
export function isPlayerPoisonImmune(state: GameState): boolean {
  return state.equippedArmorId === 'poison_guard';
}

// --- armor: aggro range reduction -----------------------------------------

/** Phase 24.3 skull_suit (skull_suit): the flat reduction to AGGRO_RANGE's initial-detection distance while equipped, floored so the caller can apply `Math.max(2, baseRange - this)`. 0 if not equipped. */
export function getArmorAggroRangeReduction(state: GameState): number {
  return state.equippedArmorId === 'skull_suit' ? 2 : 0;
}

// --- armor: magic_robe SOL-spend refund -----------------------------------

/** Max SOL magic_robe refunds per 5 cumulative SOL actually spent while equipped. */
export const MAGIC_ROBE_REFUND_PER_THRESHOLD = 1;
export const MAGIC_ROBE_REFUND_THRESHOLD = 5;

/**
 * Phase 24.3 magic_robe (magic_robe): call after any SOL the player
 * actually spends while magic_robe is equipped (turn.ts's melee element
 * cost / solar gun cost deduction sites) with the exact amount just
 * spent. Accumulates into the *equipped magic_robe instance's own*
 * effectState.solSpentRemainder, refunds 1 SOL per 5 cumulative spent
 * (supporting multiple refunds in one call for a single big spend),
 * clamped to the effective max, and returns the total refunded (0 if
 * magic_robe isn't equipped or nothing crossed a threshold yet). A
 * no-op (returns 0, no state mutation) while unequipped — spend while
 * unequipped is never tracked, and remainder is preserved (never reset)
 * across re-equips of the same instance per magic_robe's own "再装備後
 * は同じ個体のremainderを継続".
 */
export function applyMagicRobeSolSpendRefund(state: GameState, amountSpent: number): number {
  if (amountSpent <= 0) return 0;
  if (state.equippedArmorId !== 'magic_robe' || !state.equippedArmorInstanceId) return 0;
  const instance = getEquipmentInstanceById(state, state.equippedArmorInstanceId);
  if (!instance) return 0;
  instance.effectState = normalizeEquipmentEffectState(instance.effectState);
  instance.effectState.solSpentRemainder += amountSpent;
  let refunded = 0;
  while (instance.effectState.solSpentRemainder >= MAGIC_ROBE_REFUND_THRESHOLD) {
    instance.effectState.solSpentRemainder -= MAGIC_ROBE_REFUND_THRESHOLD;
    refunded += MAGIC_ROBE_REFUND_PER_THRESHOLD;
  }
  if (refunded > 0) {
    state.solarEnergy = Math.min(getEffectiveMaxSolarEnergy(state), state.solarEnergy + refunded);
  }
  return refunded;
}

// --- armor: spike_mail reflect ---------------------------------------------

/** Phase 24.3 spike_mail (spike_mail): whether the equipped armor reflects 1 damage back to an adjacent attacker on a positive-damage, surviving hit. The caller (turn.ts's enemy-attack-resolution site) still owns the adjacency/survival/damage-source checks; this only identifies eligibility. */
export function isSpikeMailEquipped(state: GameState): boolean {
  return state.equippedArmorId === 'spike_mail';
}

export const SPIKE_MAIL_REFLECT_DAMAGE = 1;

// --- armor: black_armor equipped-turn LIFE drain ---------------------------

export const BLACK_ARMOR_TURN_INTERVAL = 20;

/**
 * Phase 24.3 black_armor (black_armor): call once per completed world
 * turn (turn.ts's end-of-processTurn hook) while black_armor is
 * equipped. Increments the equipped instance's effectState.
 * equippedTurnCounter; every 20th completed turn while equipped, resets
 * the counter to 0 and drains 1 LIFE (may reach/cross 0, allowed to
 * trigger gameover per black_armor's own "LIFE-1は0まで減り得て
 * gameoverを発生させる" — the caller checks player.hp<=0 afterward as
 * usual). Consumes no RNG. A no-op while unequipped (counter itself
 * still isn't touched — "解除中は加算しないがcounterは保持").
 */
export function tickBlackArmorEquippedTurn(state: GameState): { drained: boolean } {
  if (state.equippedArmorId !== 'black_armor' || !state.equippedArmorInstanceId) return { drained: false };
  const instance = getEquipmentInstanceById(state, state.equippedArmorInstanceId);
  if (!instance) return { drained: false };
  instance.effectState = normalizeEquipmentEffectState(instance.effectState);
  instance.effectState.equippedTurnCounter += 1;
  if (instance.effectState.equippedTurnCounter >= BLACK_ARMOR_TURN_INTERVAL) {
    instance.effectState.equippedTurnCounter = 0;
    state.player.hp = Math.max(0, state.player.hp - 1);
    return { drained: true };
  }
  return { drained: false };
}
