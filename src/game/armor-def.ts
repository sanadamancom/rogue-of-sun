import { ArmorId } from './types';

/**
 * A single armor species' fixed defensive data (Phase 08.4 armor/defense
 * foundation). `armorValue` is subtracted from an incoming attack's power
 * (see turn.ts's getIncomingDamage: `max(0, attackPower - armorValue)`),
 * never added to the player's own stats. No durability, upgrade level, or
 * random-affix fields exist yet; a future second armor piece is expected
 * to extend this table rather than add parallel ad-hoc fields elsewhere.
 *
 * Phase 10.2 combat stat/scale redesign: armorValue is scaled 10x (1->10)
 * alongside every other combat stat, preserving its exact old effect —
 * see turn.ts's getEffectivePlayerDefense (armorValue is added on top of
 * the player's own base `defense`, currently always 0).
 */
export interface ArmorDefinition {
  id: ArmorId;
  armorValue: number;
}

// Single source of truth for every registered armor's defensive stats.
// Phase 08.4 registers only 'armor'.
export const ARMOR_DEFINITIONS: Record<ArmorId, ArmorDefinition> = {
  armor: {
    id: 'armor',
    armorValue: 10,
  },
};

/** Fixed iteration order for armor pieces (Phase 08.4: just armor). */
export const ARMOR_IDS_IN_ORDER: ArmorId[] = ['armor'];
