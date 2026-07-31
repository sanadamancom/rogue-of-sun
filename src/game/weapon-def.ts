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
  /** Tiles a surviving, non-immune enemy is pushed back on a hit, in the attack direction. 0 for weapons without knockback (sword, spear). */
  knockbackDistance: number;
  /**
   * Whether this weapon enters a 1-turn recoil after every attack via X
   * (hit, kill, failed-knockback, or whiff), during which X only
   * "re-cocks" it instead of attacking again. False for weapons without
   * a recoil mechanic (sword, spear).
   */
  hasRecoil: boolean;
}

// Single source of truth for every registered weapon's combat stats.
// Phase 08.3 registered only 'sword'; Phase 08.5 added 'spear'; Phase
// 08.7 adds 'hammer'.
export const WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
  sword: {
    id: 'sword',
    attackPower: 2,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
  },
  spear: {
    id: 'spear',
    attackPower: 1,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
  },
  hammer: {
    id: 'hammer',
    attackPower: 3,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
  },
};

/** Fixed iteration order for weapons (Phase 08.3: sword; Phase 08.5 adds spear; Phase 08.7 adds hammer). */
export const WEAPON_IDS_IN_ORDER: WeaponId[] = ['sword', 'spear', 'hammer'];
