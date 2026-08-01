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
  solar_gun: {
    id: 'solar_gun',
    attackPower: 1,
    // Interpreted as max ray distance (tiles), not melee reach steps —
    // see WeaponDefinition.solarCost doc comment.
    reach: 5,
    knockbackDistance: 0,
    hasRecoil: false,
    solarCost: 1,
  },
};

/** Fixed iteration order for weapons (Phase 08.3: sword; Phase 08.5 adds spear; Phase 08.7 adds hammer; Phase 09.2 adds solar_gun). */
export const WEAPON_IDS_IN_ORDER: WeaponId[] = ['sword', 'spear', 'hammer', 'solar_gun'];
