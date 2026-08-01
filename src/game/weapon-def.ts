import { WeaponId } from './types';

/**
 * A single weapon species' fixed combat data (Phase 08.3 weapon/equipment
 * foundation; Phase 08.5 adds `reach`).
 *
 * Phase 10.2 combat stat/scale redesign changed how `attackPower` is
 * used: it used to *replace* the player's unarmed attack power outright
 * while equipped (never added on top of it). It is now an *additive
 * bonus over bare hands* — combat.ts's computeAttackDamage computes
 * `player.attack + weapon.attackPower - enemy.defense`, so bare hands is
 * equivalent to a weapon with attackPower 0 (see turn.ts's
 * getPlayerWeaponBonus). Each weapon's value was chosen so that, with
 * the Phase 10.2 player.attack base of 10, the resulting *total* exactly
 * reproduces the old (pre-10.2) total scaled by 10 — e.g. sword's old
 * total was 2, so its new bonus is 20 - 10 = 10. See
 * docs/history/phase-10-2-combat-stat-scale-redesign.md for the full
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
}

// Single source of truth for every registered weapon's combat stats.
// Phase 08.3 registered only 'sword'; Phase 08.5 added 'spear'; Phase
// 08.7 adds 'hammer'. Phase 10.2 redefines attackPower as a bonus over
// bare hands rather than a replacement value — see the doc comment above.
// Phase 10.3 adds hitModifier.
export const WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
  sword: {
    id: 'sword',
    attackPower: 10,
    reach: 1,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
  },
  spear: {
    id: 'spear',
    attackPower: 0,
    reach: 2,
    knockbackDistance: 0,
    hasRecoil: false,
    hitModifier: 5,
  },
  hammer: {
    id: 'hammer',
    attackPower: 20,
    reach: 1,
    knockbackDistance: 1,
    hasRecoil: true,
    hitModifier: -5,
  },
  solar_gun: {
    id: 'solar_gun',
    attackPower: 0,
    // Interpreted as max ray distance (tiles), not melee reach steps —
    // see WeaponDefinition.solarCost doc comment.
    reach: 5,
    knockbackDistance: 0,
    hasRecoil: false,
    solarCost: 1,
    hitModifier: 5,
  },
};

/** Fixed iteration order for weapons (Phase 08.3: sword; Phase 08.5 adds spear; Phase 08.7 adds hammer; Phase 09.2 adds solar_gun). */
export const WEAPON_IDS_IN_ORDER: WeaponId[] = ['sword', 'spear', 'hammer', 'solar_gun'];
