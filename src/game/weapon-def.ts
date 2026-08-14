import { EquipmentRank, WeaponId } from './types';

/** Which of the 3 melee weapon lines (sword/spear/hammer) a species belongs to. solar_gun belongs to none (undefined) — see WeaponDefinition.family. */
export type WeaponFamily = 'sword' | 'spear' | 'hammer';

/**
 * A single weapon species' fixed combat data (Phase 08.3 weapon/equipment
 * foundation; Phase 08.5 adds `reach`).
 *
 * `attackPower` is an *additive bonus over bare hands* (Phase 10.2 combat
 * stat/scale redesign) — combat.ts's computeAttackDamage computes
 * `player.attack + weapon.attackPower - enemy.defense`, so bare hands is
 * equivalent to a weapon with attackPower 0 (see turn.ts's
 * getPlayerWeaponBonus). Phase 15.1 core combat rebalance lowers
 * player.attack from 10 to 2 and re-derives each weapon's attackPower so
 * the resulting *total* matches the Phase 15 balance draft's low-integer
 * scale (sword 4, spear 3, hammer 5, solar gun 3 at base) — see
 * docs/history/phase-15-1-core-combat-rebalance.md for the full
 * derivation and the old/new comparison table.
 *
 * `reach` is the maximum tile distance (in a single straight or diagonal
 * direction line, one direction-vector step at a time) at which this
 * weapon can hit an enemy: 1 means only the 8 adjacent tiles (unarmed and
 * sword both use this); 2 means it can also hit an enemy exactly 2 tiles
 * away along the same direction, provided the intervening tile is
 * passable and empty (see turn.ts's resolveReachAttack for the full
 * obstruction/diagonal rules). No durability, upgrade level, or
 * random-affix fields exist yet; future weapons are expected to extend
 * this table rather than add parallel ad-hoc fields elsewhere.
 */
export interface WeaponDefinition {
  id: WeaponId;
  attackPower: number;
  reach: number;
  /** Tiles a surviving, non-immune enemy is pushed back on a hit, in the attack direction. 0 for weapons without knockback (sword, spear). */
  knockbackDistance: number;
  /**
   * Whether this weapon enters a 1-turn recoil after every attack via X
   * (hit, kill, failed-knockback, or whiff), during which X only
   * "re-cocks" it instead of attacking again. False for weapons without
   * a recoil mechanic (sword, spear).
   */
  hasRecoil: boolean;
  /**
   * Solar energy consumed per X-action attack (Phase 09.2). Only present
   * for the ranged solar gun — undefined/0 for every melee weapon. When
   * set, turn.ts's resolveFacingAttack routes the attack through the
   * separate ranged-ray resolution (resolveSolarGunAttack) instead of the
   * adjacent/reach-2 melee path, and `reach` is interpreted as the
   * gun's maximum ray distance in tiles rather than a melee reach step
   * count.
   */
  solarCost?: number;
  /**
   * Integer-percent bonus/penalty to the wielder's hit chance (Phase
   * 10.3 accuracy/evasion foundation) — see combat.ts's computeHitChance.
   * 0 for bare hands. Never applied to enemy attacks (enemies have no
   * weapon concept).
   */
  hitModifier: number;
  /**
   * Phase 24.1 equipment rank data foundation: this species' default rank,
   * copied onto every newly-minted EquipmentInstance of this species (see
   * equipment-instance.ts's mintEquipmentInstance). Every weapon
   * registered before Phase 24.3's expanded roster is 'C' — see
   * EquipmentRank's own doc comment in types.ts for the full scope note.
   */
  rank: EquipmentRank;
  /**
   * Phase 24.3 全装備カタログ: which melee weapon line this species
   * belongs to (undefined for solar_gun, which has no family/lineage and
   * is never solar-forge eligible — see solar-forge.ts's
   * isForgeEligibleWeaponId). solar-forge.ts's lineage-based C/B/A tier
   * resolution requires both materials to share the same family and the
   * same rank; the S->R tier's 2 fixed pairs are still keyed by exact
   * definitionId (order-independent) rather than family.
   */
  family?: WeaponFamily;
  /**
   * Phase 24.3 太陽鍛冶レシピ: the species this individual becomes when
   * used as the *first-selected* solar-forge material against any other
   * same-family, same-rank material (rogue-of-sun-development-plan_.md's
   * forge_lineage decision: "第1素材の系譜を完成品へ引き継ぐ" — the
   * second material only needs to match family+rank, its own specific
   * species is otherwise irrelevant to the output). Undefined for every
   * S-rank species (S->R instead uses solar-forge-recipes.ts's fixed,
   * order-independent pairs) and for R/solar_gun (terminal/ineligible).
   */
  forgeNextId?: WeaponId;
  /**
   * Phase 24.3 装備効果: the equipment-effect-module key this species'
   * individual combat effect is dispatched under (equipment-effects.ts).
   * Undefined for the 6 "none"-effect C-rank species (sword, short_sword,
   * spear, glaive, hammer, basic_hammer) and for solar_gun (Phase 23.1
   * unchanged).
   */
  effectId?: string;
}

// Single source of truth for every registered weapon's combat stats.
// Phase 08.3 registered only 'sword'; Phase 08.5 added 'spear'; Phase
// 08.7 adds 'hammer'. Phase 10.2 redefines attackPower as a bonus over
// bare hands rather than a replacement value — see the doc comment above.
// Phase 10.3 adds hitModifier.
export const WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
  sword: {
    id: 'sword',
    attackPower: 2,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'C',
    family: 'sword',
    forgeNextId: 'flamberge',
  },
  short_sword: {
    id: 'short_sword',
    attackPower: 2,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'C',
    family: 'sword',
    forgeNextId: 'magic_sword',
  },
  flamberge: {
    id: 'flamberge',
    attackPower: 2,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'B',
    family: 'sword',
    forgeNextId: 'bushido_blade',
    effectId: 'flame_bonus',
  },
  magic_sword: {
    id: 'magic_sword',
    attackPower: 2,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'B',
    family: 'sword',
    forgeNextId: 'blood_sword',
    effectId: 'sol_cost_reduction',
  },
  bushido_blade: {
    id: 'bushido_blade',
    attackPower: 3,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'A',
    family: 'sword',
    forgeNextId: 'solar_sword',
    effectId: 'low_life_bonus',
  },
  blood_sword: {
    id: 'blood_sword',
    attackPower: 3,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'A',
    family: 'sword',
    forgeNextId: 'dark_sword',
    effectId: 'blood_defeat_heal',
  },
  solar_sword: {
    id: 'solar_sword',
    attackPower: 4,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'S',
    family: 'sword',
    effectId: 'sol_max_bonus',
  },
  dark_sword: {
    id: 'dark_sword',
    attackPower: 4,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'S',
    family: 'sword',
    effectId: 'night_dark_bonus',
  },
  gram: {
    id: 'gram',
    attackPower: 5,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'R',
    family: 'sword',
    effectId: 'dual_light_dark_bonus',
  },
  spear: {
    id: 'spear',
    attackPower: 1,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'C',
    family: 'spear',
    forgeNextId: 'corsesca',
  },
  glaive: {
    id: 'glaive',
    attackPower: 1,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'C',
    family: 'spear',
    forgeNextId: 'ice_glaive',
  },
  corsesca: {
    id: 'corsesca',
    attackPower: 1,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'B',
    family: 'spear',
    forgeNextId: 'grand_lance',
    effectId: 'stun_chance',
  },
  ice_glaive: {
    id: 'ice_glaive',
    attackPower: 1,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'B',
    family: 'spear',
    forgeNextId: 'blood_spear',
    effectId: 'frost_bonus',
  },
  grand_lance: {
    id: 'grand_lance',
    attackPower: 2,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'A',
    family: 'spear',
    forgeNextId: 'white_queen',
    effectId: 'earth_bonus',
  },
  blood_spear: {
    id: 'blood_spear',
    attackPower: 2,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'A',
    family: 'spear',
    forgeNextId: 'black_queen',
    effectId: 'blood_defeat_sol',
  },
  white_queen: {
    id: 'white_queen',
    attackPower: 3,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'S',
    family: 'spear',
    effectId: 'sol_max_bonus',
  },
  black_queen: {
    id: 'black_queen',
    attackPower: 3,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'S',
    family: 'spear',
    effectId: 'night_dark_bonus',
  },
  gungnir: {
    id: 'gungnir',
    attackPower: 4,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
    rank: 'R',
    family: 'spear',
    effectId: 'dual_light_dark_bonus',
  },
  hammer: {
    id: 'hammer',
    attackPower: 3,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
    rank: 'C',
    family: 'hammer',
    forgeNextId: 'maul',
  },
  basic_hammer: {
    id: 'basic_hammer',
    attackPower: 3,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
    rank: 'C',
    family: 'hammer',
    forgeNextId: 'silver_flail',
  },
  maul: {
    id: 'maul',
    attackPower: 3,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
    rank: 'B',
    family: 'hammer',
    forgeNextId: 'battle_axe',
    effectId: 'construct_bonus',
  },
  silver_flail: {
    id: 'silver_flail',
    attackPower: 3,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
    rank: 'B',
    family: 'hammer',
    forgeNextId: 'bloody_mace',
    effectId: 'undead_bonus',
  },
  battle_axe: {
    id: 'battle_axe',
    attackPower: 4,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
    rank: 'A',
    family: 'hammer',
    forgeNextId: 'dawn',
    effectId: 'floor_species_bonus',
  },
  bloody_mace: {
    id: 'bloody_mace',
    attackPower: 4,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
    rank: 'A',
    family: 'hammer',
    forgeNextId: 'twilight',
    effectId: 'blood_defeat_heal',
  },
  dawn: {
    id: 'dawn',
    attackPower: 4,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
    rank: 'S',
    family: 'hammer',
    effectId: 'sol_max_bonus',
  },
  twilight: {
    id: 'twilight',
    attackPower: 4,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
    rank: 'S',
    family: 'hammer',
    effectId: 'night_dark_bonus',
  },
  mjolnir: {
    id: 'mjolnir',
    attackPower: 5,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
    rank: 'R',
    family: 'hammer',
    effectId: 'dual_light_dark_bonus',
  },
  solar_gun: {
    id: 'solar_gun',
    attackPower: 1,
    // Interpreted as max ray distance (tiles), not melee reach steps —
    // see WeaponDefinition.solarCost doc comment.
    reach: 5,
    knockbackDistance: 0,
    hasRecoil: false,
    // Phase 16.1 early-resource-and-combat-pressure rebalance: 1->3 (see
    // docs/history/phase-16-early-game-balance.md's Phase 16.1 section).
    // At maxSolarEnergy 15 (Phase 15.1), a cost of 1 let a full charge
    // fire 15 times — effectively unlimited relative to a single floor's
    // combat. 3 brings that down to 5 shots per full charge, matching
    // balance_targets' "1ゲージで通常射撃5回前後" target exactly.
    // Investigated whether any enchantment discounts this further before
    // changing it (implementation_priority's "エンチャントの消費軽減効
    // 果を新消費量に合わせる"): ELEMENT_ENCHANT_ELIGIBLE_WEAPONS
    // (turn.ts) is ['sword', 'spear', 'hammer'] only — solar_gun is not
    // in that list, so no unlocked element enchantment ever changes
    // resolveSolarGunAttack's cost calculation (it always spends exactly
    // weaponDef.solarCost, full stop). There is no separate
    // "solar_gun discount" mechanic anywhere in this codebase for this
    // change to adjust — sol_enchantment only unlocks the sol element
    // for melee weapons, which shares the same solarEnergy pool but
    // never touches this constant. attackPower and reach are unchanged.
    solarCost: 3,
    hitModifier: 5,
    rank: 'C',
  },
};

/**
 * Fixed iteration order for weapons (Phase 08.3: sword; Phase 08.5 adds
 * spear; Phase 08.7 adds hammer; Phase 09.2 adds solar_gun; Phase 24.3
 * adds the remaining 23 melee species, grouped by family then by rank
 * chain, matching the equipment_catalog table's own listed order).
 */
export const WEAPON_IDS_IN_ORDER: WeaponId[] = [
  'sword',
  'short_sword',
  'flamberge',
  'magic_sword',
  'bushido_blade',
  'blood_sword',
  'solar_sword',
  'dark_sword',
  'gram',
  'spear',
  'glaive',
  'corsesca',
  'ice_glaive',
  'grand_lance',
  'blood_spear',
  'white_queen',
  'black_queen',
  'gungnir',
  'hammer',
  'basic_hammer',
  'maul',
  'silver_flail',
  'battle_axe',
  'bloody_mace',
  'dawn',
  'twilight',
  'mjolnir',
  'solar_gun',
];
