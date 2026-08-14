import { ArmorId, EquipmentRank } from './types';

/**
 * A single armor species' fixed defensive data (Phase 08.4 armor/defense
 * foundation). `armorValue` is subtracted from an incoming attack's power
 * (see turn.ts's getIncomingDamage: `max(0, attackPower - armorValue)`),
 * never added to the player's own stats. No durability, upgrade level, or
 * random-affix fields exist yet; a future second armor piece is expected
 * to extend this table rather than add parallel ad-hoc fields elsewhere.
 *
 * Phase 15.1 core combat rebalance lowers armorValue from 10 to 2 (the
 * Phase 15 balance draft's クロスアーマー) and changes how it's applied on
 * the incoming-damage side — see turn.ts's getEffectivePlayerDefense
 * (armorValue is still added on top of the player's own base `defense`,
 * currently always 0) and combat.ts's computeIncomingDamage (now a
 * proportional reduction rather than flat subtraction).
 */
export interface ArmorDefinition {
  id: ArmorId;
  armorValue: number;
  /** Phase 24.1 equipment rank data foundation — see WeaponDefinition.rank's identical doc comment in weapon-def.ts. */
  rank: EquipmentRank;
  /**
   * Phase 24.3 装備効果: the equipment-effect-module key this species'
   * individual defensive effect is dispatched under
   * (equipment-effects.ts). Undefined for the 2 "none"-effect C-rank
   * species (armor, chain_mail).
   */
  effectId?: string;
}

// Single source of truth for every registered armor's defensive stats.
// Phase 08.4 registers only 'armor'; Phase 24.3 全装備カタログ adds the
// remaining 14 species (see rogue-of-sun-zokutai-armor-selection-draft.md
// and the equipment_catalog.armor table).
export const ARMOR_DEFINITIONS: Record<ArmorId, ArmorDefinition> = {
  armor: {
    id: 'armor',
    armorValue: 2,
    rank: 'C',
  },
  chain_mail: {
    id: 'chain_mail',
    armorValue: 4,
    rank: 'C',
  },
  plate_mail: {
    id: 'plate_mail',
    armorValue: 7,
    rank: 'B',
  },
  samurai_armor: {
    id: 'samurai_armor',
    armorValue: 5,
    rank: 'A',
    effectId: 'effective_attack_bonus',
  },
  mail_of_sol: {
    id: 'mail_of_sol',
    armorValue: 3,
    rank: 'B',
    effectId: 'sol_element_reduction',
  },
  mail_of_dark: {
    id: 'mail_of_dark',
    armorValue: 4,
    rank: 'B',
    effectId: 'dark_element_reduction',
  },
  dragon_scale: {
    id: 'dragon_scale',
    armorValue: 3,
    rank: 'A',
    effectId: 'four_element_reduction',
  },
  magic_robe: {
    id: 'magic_robe',
    armorValue: 3,
    rank: 'B',
    effectId: 'sol_spend_refund',
  },
  skull_suit: {
    id: 'skull_suit',
    armorValue: 2,
    rank: 'A',
    effectId: 'aggro_range_reduction',
  },
  poison_guard: {
    id: 'poison_guard',
    armorValue: 2,
    rank: 'B',
    effectId: 'poison_immunity',
  },
  ninja_suit: {
    id: 'ninja_suit',
    armorValue: 2,
    rank: 'A',
    effectId: 'effective_speed_bonus',
  },
  light_garb: {
    id: 'light_garb',
    armorValue: 3,
    rank: 'S',
    effectId: 'max_sol_bonus',
  },
  dark_garb: {
    id: 'dark_garb',
    armorValue: 2,
    rank: 'S',
    effectId: 'force_night',
  },
  spike_mail: {
    id: 'spike_mail',
    armorValue: 10,
    rank: 'S',
    effectId: 'spike_reflect',
  },
  black_armor: {
    id: 'black_armor',
    armorValue: 12,
    rank: 'R',
    effectId: 'black_armor_curse',
  },
};

/** Fixed iteration order for armor pieces (Phase 08.4: just armor; Phase 24.3 adds the remaining 14). */
export const ARMOR_IDS_IN_ORDER: ArmorId[] = [
  'armor',
  'chain_mail',
  'plate_mail',
  'samurai_armor',
  'mail_of_sol',
  'mail_of_dark',
  'dragon_scale',
  'magic_robe',
  'skull_suit',
  'poison_guard',
  'ninja_suit',
  'light_garb',
  'dark_garb',
  'spike_mail',
  'black_armor',
];
