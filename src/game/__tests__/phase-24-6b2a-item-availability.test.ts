import { describe, expect, it } from 'vitest';
import {
  ITEM_AVAILABILITY,
  filterEligibleItemIds,
  isItemEligibleAtDepth,
} from '../item-availability';
import { ITEM_DEFINITIONS, getGroundItemPoolForFloor } from '../item-def';

describe('Phase 24.6c4b absolute-depth item availability', () => {
  it('registers every item exactly once', () => {
    expect(new Set(Object.keys(ITEM_AVAILABILITY))).toEqual(new Set(Object.keys(ITEM_DEFINITIONS)));
  });

  it('uses the canonical depth thresholds', () => {
    expect(ITEM_AVAILABILITY.spear.minimumDepth).toBe(5);
    for (const id of ['hammer', 'frost_enchantment', 'cloud_enchantment'] as const) {
      expect(ITEM_AVAILABILITY[id].minimumDepth).toBe(9);
    }
    expect(ITEM_AVAILABILITY.earth_enchantment.minimumDepth).toBe(18);
  });

  it('applies inclusive bounds and leg restrictions', () => {
    expect(isItemEligibleAtDepth('light_garb', 19, 'descent')).toBe(true);
    expect(isItemEligibleAtDepth('light_garb', 26, 'descent')).toBe(true);
    expect(isItemEligibleAtDepth('light_garb', 18, 'descent')).toBe(false);
    expect(isItemEligibleAtDepth('light_garb', 19, 'ascent')).toBe(false);
    expect(isItemEligibleAtDepth('black_armor', 25, 'descent')).toBe(true);
    expect(isItemEligibleAtDepth('black_armor', 26, 'descent')).toBe(false);
  });

  it('preserves filtering order without consuming RNG', () => {
    expect(filterEligibleItemIds(['earth_enchantment', 'apple', 'spear'], 5, 'descent')).toEqual(['apple', 'spear']);
  });

  it('keeps the five staged items unavailable throughout the current 3F run', () => {
    for (const floor of [1, 2, 3]) {
      const pool = getGroundItemPoolForFloor(floor, 'descent');
      for (const id of ['spear', 'hammer', 'frost_enchantment', 'cloud_enchantment', 'earth_enchantment'] as const) {
        expect(pool).not.toContain(id);
      }
    }
  });
});
