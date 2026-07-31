import { WeaponId } from './types';

/**
 * A weapon's attack range shape. Phase 08.3 only ever uses 'adjacent'
 * (any of the 8 surrounding tiles, matching the existing unarmed melee
 * reach), but this is a distinct field — not hardcoded into combat logic —
 * so a future ranged weapon (e.g. the sun gun) can introduce a different
 * shape without restructuring this interface.
 */
export interface WeaponRange {
  shape: 'adjacent';
  maxDistance: 1;
}

/**
 * A single weapon species' fixed combat data (Phase 08.3 weapon/equipment
 * foundation). `attackPower` replaces the player's unarmed attack power
 * while this weapon is equipped — it is never added to it (see
 * turn.ts's getEffectiveAttackPower). No durability, upgrade level, or
 * random-affix fields exist yet; future weapons (spear, hammer, sun gun)
 * are expected to extend this table rather than add parallel ad-hoc
 * fields elsewhere.
 */
export interface WeaponDefinition {
  id: WeaponId;
  attackPower: number;
  range: WeaponRange;
}

// Single source of truth for every registered weapon's combat stats.
// Phase 08.3 registers only 'sword'.
export const WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
  sword: {
    id: 'sword',
    attackPower: 2,
    range: { shape: 'adjacent', maxDistance: 1 },
  },
};

/** Fixed iteration order for weapons (Phase 08.3: just sword). */
export const WEAPON_IDS_IN_ORDER: WeaponId[] = ['sword'];
