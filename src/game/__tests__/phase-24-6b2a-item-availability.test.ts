import { describe, expect, it } from 'vitest';
import {
  ITEM_AVAILABILITY,
  getItemAvailability,
  isRunDepthEligible,
  isItemEligibleAtProgress,
  filterEligibleItemIds,
} from '../item-availability';
import { ITEM_DEFINITIONS } from '../item-def';
import { getGroundItemPoolForFloor } from '../item-def';
import type { ItemId, RunDepthTier } from '../types';

/**
 * Phase 24.6b2a2: permanent regression coverage for item-availability.ts's
 * registry and progress-threshold behavior. Replaces the one-time
 * temporary scripts used to verify this during 24.6b2a/24.6b2a1 (deleted
 * per their own /tmp/ convention) — see
 * docs/history/phase-24-6b2a2-availability-regression-coverage.md for
 * the full before/after comparison. Nothing here mocks or mutates
 * ITEM_AVAILABILITY; it exercises the real, shipped registry values.
 */

const TWO_THIRDS_ITEMS = ['spear', 'hammer', 'frost_enchantment', 'cloud_enchantment'] as const;

describe('Phase 24.6b2a2: ITEM_AVAILABILITY registry completeness', () => {
  it('has exactly the same 78 ItemIds as ITEM_DEFINITIONS, no missing/extra/duplicate', () => {
    const definitionIds = Object.keys(ITEM_DEFINITIONS);
    const availabilityIds = Object.keys(ITEM_AVAILABILITY);
    expect(definitionIds).toHaveLength(78);
    expect(availabilityIds).toHaveLength(78);
    // no duplicates (Object.keys on a JS object literal can never contain
    // a duplicate key at runtime, but this also documents the invariant)
    expect(new Set(availabilityIds).size).toBe(78);
    // no missing: every ITEM_DEFINITIONS id has an ITEM_AVAILABILITY entry
    for (const id of definitionIds) {
      expect(availabilityIds).toContain(id);
    }
    // no extra: every ITEM_AVAILABILITY id is a real ITEM_DEFINITIONS id
    for (const id of availabilityIds) {
      expect(definitionIds).toContain(id);
    }
  });

  it('every entry has minimumRunDepth: short', () => {
    for (const [id, availability] of Object.entries(ITEM_AVAILABILITY)) {
      expect(availability.minimumRunDepth, `${id} should be minimumRunDepth 'short'`).toBe('short');
    }
  });

  it('unlockProgress is 2/3 for spear/hammer/frost_enchantment/cloud_enchantment, 1 for earth_enchantment, 0 for every other item', () => {
    for (const [id, availability] of Object.entries(ITEM_AVAILABILITY)) {
      if ((TWO_THIRDS_ITEMS as readonly string[]).includes(id)) {
        expect(availability.unlockProgress, `${id} should be 2/3`).toBeCloseTo(2 / 3);
      } else if (id === 'earth_enchantment') {
        expect(availability.unlockProgress).toBe(1);
      } else {
        expect(availability.unlockProgress, `${id} should be 0`).toBe(0);
      }
    }
  });

  it('every unlockProgress is finite and within [0, 1]', () => {
    for (const [id, availability] of Object.entries(ITEM_AVAILABILITY)) {
      expect(Number.isFinite(availability.unlockProgress), `${id} unlockProgress must be finite`).toBe(true);
      expect(availability.unlockProgress, `${id} unlockProgress must be >= 0`).toBeGreaterThanOrEqual(0);
      expect(availability.unlockProgress, `${id} unlockProgress must be <= 1`).toBeLessThanOrEqual(1);
    }
  });

  it('economyClass counts: power 71, sustain 6, structural 1, not_applicable 0', () => {
    const counts: Record<string, number> = { power: 0, sustain: 0, structural: 0, not_applicable: 0 };
    for (const availability of Object.values(ITEM_AVAILABILITY)) {
      counts[availability.economyClass] = (counts[availability.economyClass] ?? 0) + 1;
    }
    expect(counts.power).toBe(71);
    expect(counts.sustain).toBe(6);
    expect(counts.structural).toBe(1);
    expect(counts.not_applicable).toBe(0);
    expect(counts.power + counts.sustain + counts.structural + counts.not_applicable).toBe(78);
  });

  it('getItemAvailability returns the exact same entry as direct ITEM_AVAILABILITY lookup', () => {
    for (const id of Object.keys(ITEM_AVAILABILITY) as ItemId[]) {
      expect(getItemAvailability(id)).toBe(ITEM_AVAILABILITY[id]);
    }
  });
});

describe('Phase 24.6b2a2: RunDepthTier ordering', () => {
  it('short <= standard <= deep, and never the reverse', () => {
    expect(isRunDepthEligible('short', 'short')).toBe(true);
    expect(isRunDepthEligible('standard', 'short')).toBe(true);
    expect(isRunDepthEligible('standard', 'standard')).toBe(true);
    expect(isRunDepthEligible('deep', 'short')).toBe(true);
    expect(isRunDepthEligible('deep', 'standard')).toBe(true);
    expect(isRunDepthEligible('deep', 'deep')).toBe(true);
    expect(isRunDepthEligible('short', 'standard')).toBe(false);
    expect(isRunDepthEligible('short', 'deep')).toBe(false);
    expect(isRunDepthEligible('standard', 'deep')).toBe(false);
  });

  it('with the current registry (every item short/0-or-override), tier alone never changes the eligible candidate set at a fixed progress', () => {
    const allIds = Object.keys(ITEM_DEFINITIONS) as ItemId[];
    const tiers: RunDepthTier[] = ['short', 'standard', 'deep'];
    for (const progress of [0, 0.5, 2 / 3, 1]) {
      const sets = tiers.map((tier) => filterEligibleItemIds(allIds, tier, progress));
      expect(sets[1]).toEqual(sets[0]);
      expect(sets[2]).toEqual(sets[0]);
    }
  });
});

describe('Phase 24.6b2a2: progress 2/3 boundary (spear/hammer/frost_enchantment/cloud_enchantment)', () => {
  const justBefore = 2 / 3 - 1e-9;
  const at = 2 / 3;

  it('are ineligible just before progress 2/3', () => {
    for (const id of TWO_THIRDS_ITEMS) {
      expect(isItemEligibleAtProgress(id, 'short', justBefore), `${id} should be ineligible just before 2/3`).toBe(false);
    }
  });

  it('become eligible exactly at progress 2/3', () => {
    for (const id of TWO_THIRDS_ITEMS) {
      expect(isItemEligibleAtProgress(id, 'short', at), `${id} should be eligible at 2/3`).toBe(true);
    }
  });

  it('earth_enchantment is still ineligible at progress 2/3', () => {
    expect(isItemEligibleAtProgress('earth_enchantment', 'short', at)).toBe(false);
  });
});

describe('Phase 24.6b2a2: progress 1 boundary (earth_enchantment)', () => {
  const justBefore = 1 - 1e-9;

  it('is ineligible just before progress 1', () => {
    expect(isItemEligibleAtProgress('earth_enchantment', 'short', justBefore)).toBe(false);
  });

  it('becomes eligible exactly at progress 1', () => {
    expect(isItemEligibleAtProgress('earth_enchantment', 'short', 1)).toBe(true);
  });
});

describe('Phase 24.6b2a2: same-progress candidate-set equality across totalFloors (2/3, 20/30, 66/99)', () => {
  it('getGroundItemPoolForFloor returns the identical candidate set at the same progress regardless of totalFloors', () => {
    const pool3 = getGroundItemPoolForFloor(2, 3, 'short'); // progress 2/3
    const pool30 = getGroundItemPoolForFloor(20, 30, 'short'); // progress 2/3
    const pool99 = getGroundItemPoolForFloor(66, 99, 'short'); // progress 2/3
    expect(pool30).toEqual(pool3);
    expect(pool99).toEqual(pool3);
  });
});

describe('Phase 24.6b2a2: 10F/30F/99F unlock floors', () => {
  it('10F: the 4 progress-2/3 items unlock at floor 7, not floor 6; earth_enchantment unlocks at floor 10, not floor 9', () => {
    const floor6 = getGroundItemPoolForFloor(6, 10, 'short');
    const floor7 = getGroundItemPoolForFloor(7, 10, 'short');
    const floor9 = getGroundItemPoolForFloor(9, 10, 'short');
    const floor10 = getGroundItemPoolForFloor(10, 10, 'short');
    for (const id of TWO_THIRDS_ITEMS) {
      expect(floor6, `${id} should not be in floor6/10`).not.toContain(id);
      expect(floor7, `${id} should be in floor7/10`).toContain(id);
    }
    expect(floor9).not.toContain('earth_enchantment');
    expect(floor10).toContain('earth_enchantment');
  });

  it('30F: the 4 progress-2/3 items unlock at floor 20, not floor 19; earth_enchantment unlocks at floor 30, not floor 29', () => {
    const floor19 = getGroundItemPoolForFloor(19, 30, 'short');
    const floor20 = getGroundItemPoolForFloor(20, 30, 'short');
    const floor29 = getGroundItemPoolForFloor(29, 30, 'short');
    const floor30 = getGroundItemPoolForFloor(30, 30, 'short');
    for (const id of TWO_THIRDS_ITEMS) {
      expect(floor19).not.toContain(id);
      expect(floor20).toContain(id);
    }
    expect(floor29).not.toContain('earth_enchantment');
    expect(floor30).toContain('earth_enchantment');
  });

  it('99F: the 4 progress-2/3 items unlock at floor 66, not floor 65; earth_enchantment unlocks at floor 99, not floor 98', () => {
    const floor65 = getGroundItemPoolForFloor(65, 99, 'short');
    const floor66 = getGroundItemPoolForFloor(66, 99, 'short');
    const floor98 = getGroundItemPoolForFloor(98, 99, 'short');
    const floor99 = getGroundItemPoolForFloor(99, 99, 'short');
    for (const id of TWO_THIRDS_ITEMS) {
      expect(floor65).not.toContain(id);
      expect(floor66).toContain(id);
    }
    expect(floor98).not.toContain('earth_enchantment');
    expect(floor99).toContain('earth_enchantment');
  });
});

describe('Phase 24.6b2a2: 3F floor1/2/3 candidate arrays fixed (order + content)', () => {
  it('floor 1 of 3 is exactly this fixed 12-id array, in this exact order', () => {
    expect(getGroundItemPoolForFloor(1, 3, 'short')).toEqual([
      'apple',
      'sword',
      'armor',
      'sun_fruit',
      'solar_gun',
      'sol_enchantment',
      'chocolate',
      'banana',
      'flame_enchantment',
      'antidote',
      'panacea',
      'clairvoyance_fruit',
    ]);
  });

  it('floor 2 of 3 is exactly floor 1 plus spear/hammer/frost_enchantment/cloud_enchantment appended in this order', () => {
    expect(getGroundItemPoolForFloor(2, 3, 'short')).toEqual([
      'apple',
      'sword',
      'armor',
      'sun_fruit',
      'solar_gun',
      'sol_enchantment',
      'chocolate',
      'banana',
      'flame_enchantment',
      'antidote',
      'panacea',
      'clairvoyance_fruit',
      'spear',
      'hammer',
      'frost_enchantment',
      'cloud_enchantment',
    ]);
  });

  it('floor 3 of 3 is exactly floor 2 plus earth_enchantment appended', () => {
    const floor2 = getGroundItemPoolForFloor(2, 3, 'short');
    expect(getGroundItemPoolForFloor(3, 3, 'short')).toEqual([...floor2, 'earth_enchantment']);
  });
});
