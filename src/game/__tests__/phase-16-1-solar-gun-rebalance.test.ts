import { describe, expect, it } from 'vitest';
import { WEAPON_DEFINITIONS } from '../weapon-def';

/**
 * Phase 16.1 early-resource-and-combat-pressure rebalance: solar_gun's
 * solarCost was 1 against a max SOL of 15 (Phase 15.1), letting a full
 * charge fire 15 times — effectively unlimited relative to a single
 * floor's combat. Raised to 3 so a full charge fires 5 times, matching
 * balance_targets' explicit "1ゲージで通常射撃5回前後" target. See
 * docs/history/phase-16-early-game-balance.md's Phase 16.1 section for
 * the investigation showing no enchantment discounts this cost (solar_gun
 * is not in turn.ts's ELEMENT_ENCHANT_ELIGIBLE_WEAPONS).
 */
describe('Phase 16.1: solar gun resource pressure', () => {
  const MAX_SOLAR_ENERGY = 15; // state.ts's INITIAL_MAX_SOLAR_ENERGY (Phase 15.1); not re-exported, so pinned here.

  it('solarCost is 3 (raised from 1)', () => {
    expect(WEAPON_DEFINITIONS.solar_gun.solarCost).toBe(3);
  });

  it('a full charge (15) fires exactly 5 times before running out', () => {
    const cost = WEAPON_DEFINITIONS.solar_gun.solarCost!;
    expect(Math.floor(MAX_SOLAR_ENERGY / cost)).toBe(5);
  });

  it('attack power and reach are unchanged by this rebalance', () => {
    expect(WEAPON_DEFINITIONS.solar_gun.attackPower).toBe(1);
    expect(WEAPON_DEFINITIONS.solar_gun.reach).toBe(5);
  });
});
