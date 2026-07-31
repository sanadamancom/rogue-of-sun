import { WeaponId } from './types';

/**
 * A single weapon species' fixed combat data (Phase 08.3 weapon/equipment
 * foundation; Phase 08.5 adds `reach`). `attackPower` replaces the
 * player's unarmed attack power while this weapon is equipped — it is
 * never added to it (see turn.ts's getEffectiveAttackPower). `reach` is
 * the maximum tile distance (in a single straight or diagonal direction
 * line, one direction-vector step at a time) at which this weapon can hit
 * an enemy: 1 means only the 8 adjacent tiles (unarmed and sword both use
 * this); 2 means it can also hit an enemy exactly 2 tiles away along the
 * same direction, provided the intervening tile is passable and empty
 * (see turn.ts's resolveReachAttack for the full obstruction/diagonal
 * rules). No durability, upgrade level, or random-affix fields exist yet;
 * future weapons (hammer, sun gun) are expected to extend this table
 * rather than add parallel ad-hoc fields elsewhere.
 */
export interface WeaponDefinition {
  id: WeaponId;
  attackPower: number;
  reach: number;
}

// Single source of truth for every registered weapon's combat stats.
// Phase 08.3 registered only 'sword'; Phase 08.5 adds 'spear'.
export const WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
  sword: {
    id: 'sword',
    attackPower: 2,
    reach: 1,
  },
  spear: {
    id: 'spear',
    attackPower: 1,
    reach: 2,
  },
};

/** Fixed iteration order for weapons (Phase 08.3: sword; Phase 08.5 adds spear). */
export const WEAPON_IDS_IN_ORDER: WeaponId[] = ['sword', 'spear'];
