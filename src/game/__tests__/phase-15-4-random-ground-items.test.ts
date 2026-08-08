import { describe, expect, it } from 'vitest';
import {
  drawGroundItemCount,
  drawGroundItemSelection,
  ENCHANTMENT_ITEM_IDS,
  getGroundItemPoolForFloor,
  GROUND_ITEM_COUNT_WEIGHTS,
  ITEM_DEFINITIONS,
} from '../item-def';
import { createRng } from '../mapgen';
import { createInitialState, advanceToNextFloor } from '../state';
import { ItemId } from '../types';

describe('Phase 15.4b: ground item count distribution', () => {
  it('GROUND_ITEM_COUNT_WEIGHTS sums to exactly 100 and covers counts 2-6', () => {
    expect(GROUND_ITEM_COUNT_WEIGHTS.map((w) => w.count)).toEqual([2, 3, 4, 5, 6]);
    expect(GROUND_ITEM_COUNT_WEIGHTS.reduce((s, w) => s + w.weight, 0)).toBe(100);
  });

  it('drawGroundItemCount always returns an integer in [2,6]', () => {
    for (let i = 0; i < 1000; i++) {
      const rng = createRng(i);
      const count = drawGroundItemCount(rng);
      expect(Number.isInteger(count)).toBe(true);
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(6);
    }
  });

  it('consumes exactly one rng() call per draw', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    drawGroundItemCount(rng);
    expect(calls).toBe(1);
  });

  it('boundary rolls map to the documented weight bands (0..9=2, 10..34=3, 35..64=4, 65..89=5, 90..99=6)', () => {
    const rollToCount = (roll: number) => drawGroundItemCount(() => roll / 100);
    expect(rollToCount(0)).toBe(2);
    expect(rollToCount(9)).toBe(2);
    expect(rollToCount(10)).toBe(3);
    expect(rollToCount(34)).toBe(3);
    expect(rollToCount(35)).toBe(4);
    expect(rollToCount(64)).toBe(4);
    expect(rollToCount(65)).toBe(5);
    expect(rollToCount(89)).toBe(5);
    expect(rollToCount(90)).toBe(6);
    expect(rollToCount(99)).toBe(6);
  });

  it('the distribution empirically matches the 10/25/30/25/10 weights and an expected value of 4.0 over many draws', () => {
    const counts: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const N = 20000;
    const rng = createRng(1);
    for (let i = 0; i < N; i++) {
      counts[drawGroundItemCount(rng)]++;
    }
    const expectedValue = Object.entries(counts).reduce((s, [count, n]) => s + Number(count) * n, 0) / N;
    expect(expectedValue).toBeGreaterThan(3.9);
    expect(expectedValue).toBeLessThan(4.1);
    // Loose proportional sanity checks (not exact, since this is a random sample).
    expect(counts[2] / N).toBeGreaterThan(0.07);
    expect(counts[2] / N).toBeLessThan(0.13);
    expect(counts[4] / N).toBeGreaterThan(0.27);
    expect(counts[4] / N).toBeLessThan(0.33);
  });
});

describe('Phase 15.4b: staged ground item pool', () => {
  it('floor 1 pool has exactly 12 ids', () => {
    expect(getGroundItemPoolForFloor(1)).toHaveLength(12);
  });

  it('floor 2 pool has exactly 16 ids', () => {
    expect(getGroundItemPoolForFloor(2)).toHaveLength(16);
  });

  it('floor 3 pool has exactly 17 ids (every registered item)', () => {
    const pool = getGroundItemPoolForFloor(3);
    expect(pool).toHaveLength(17);
    expect(new Set(pool).size).toBe(17); // no duplicate ids within the pool itself
    expect(Object.keys(ITEM_DEFINITIONS)).toHaveLength(17);
  });

  it('floor 1 pool contains exactly the specified ids', () => {
    expect(new Set(getGroundItemPoolForFloor(1))).toEqual(
      new Set([
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
      ]),
    );
  });

  it('floor 2 pool adds exactly spear, hammer, frost_enchantment, cloud_enchantment', () => {
    const floor1 = new Set(getGroundItemPoolForFloor(1));
    const floor2 = new Set(getGroundItemPoolForFloor(2));
    const added = [...floor2].filter((id) => !floor1.has(id));
    expect(new Set(added)).toEqual(new Set(['spear', 'hammer', 'frost_enchantment', 'cloud_enchantment']));
  });

  it('floor 3 pool adds exactly earth_enchantment', () => {
    const floor2 = new Set(getGroundItemPoolForFloor(2));
    const floor3 = new Set(getGroundItemPoolForFloor(3));
    const added = [...floor3].filter((id) => !floor2.has(id));
    expect(added).toEqual(['earth_enchantment']);
  });

  it('cumulative inclusion: floor 1 pool is a subset of floor 2, which is a subset of floor 3', () => {
    const floor1 = getGroundItemPoolForFloor(1);
    const floor2 = new Set(getGroundItemPoolForFloor(2));
    const floor3 = new Set(getGroundItemPoolForFloor(3));
    for (const id of floor1) expect(floor2.has(id)).toBe(true);
    for (const id of getGroundItemPoolForFloor(2)) expect(floor3.has(id)).toBe(true);
  });

  it('floor numbers below 1 fall back to the floor-1 pool; floor numbers above 3 keep the full floor-3 pool', () => {
    expect(getGroundItemPoolForFloor(0)).toEqual(getGroundItemPoolForFloor(1));
    expect(getGroundItemPoolForFloor(4)).toEqual(getGroundItemPoolForFloor(3));
  });
});

describe('Phase 15.4b: ground item selection (duplicates and enchantment exclusion)', () => {
  it('consumes exactly one rng() call per requested item, regardless of duplicates', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    drawGroundItemSelection(6, getGroundItemPoolForFloor(1), rng);
    expect(calls).toBe(6);
  });

  it('never draws the same enchantment id twice within one selection', () => {
    const pool = getGroundItemPoolForFloor(1);
    for (let seed = 0; seed < 200; seed++) {
      const rng = createRng(seed);
      const selection = drawGroundItemSelection(6, pool, rng);
      for (const enchantmentId of ENCHANTMENT_ITEM_IDS) {
        const count = selection.filter((id) => id === enchantmentId).length;
        expect(count).toBeLessThanOrEqual(1);
      }
    }
  });

  it('allows ordinary (non-enchantment) items, including weapons and armor, to repeat within one selection', () => {
    // With a pool of 11 floor-1 ids and only 6 draws, duplicates are not
    // guaranteed on any single seed — instead, verify across many seeds
    // that at least one ordinary id is drawn more than once somewhere.
    const pool = getGroundItemPoolForFloor(1);
    let sawDuplicateOrdinary = false;
    for (let seed = 0; seed < 300 && !sawDuplicateOrdinary; seed++) {
      const rng = createRng(seed);
      const selection = drawGroundItemSelection(6, pool, rng);
      const ordinarySelection = selection.filter((id) => !ENCHANTMENT_ITEM_IDS.includes(id));
      const seen = new Set<ItemId>();
      for (const id of ordinarySelection) {
        if (seen.has(id)) {
          sawDuplicateOrdinary = true;
          break;
        }
        seen.add(id);
      }
    }
    expect(sawDuplicateOrdinary).toBe(true);
  });

  it('does not starve later draws when every enchantment candidate has already been drawn', () => {
    // A pool containing only enchantment ids plus a single ordinary id:
    // once every enchantment id is drawn (and removed), the remaining
    // draws must still succeed using the ordinary id repeatedly.
    const tinyPool: ItemId[] = ['apple', 'sol_enchantment', 'flame_enchantment'];
    const rng = createRng(42);
    const selection = drawGroundItemSelection(6, tinyPool, rng);
    expect(selection).toHaveLength(6);
    expect(selection.filter((id) => id === 'sol_enchantment').length).toBeLessThanOrEqual(1);
    expect(selection.filter((id) => id === 'flame_enchantment').length).toBeLessThanOrEqual(1);
  });

  it('every id drawn is always a member of the input pool', () => {
    const pool = getGroundItemPoolForFloor(2);
    for (let seed = 0; seed < 50; seed++) {
      const rng = createRng(seed);
      const selection = drawGroundItemSelection(6, pool, rng);
      for (const id of selection) {
        expect(pool).toContain(id);
      }
    }
  });
});

describe('Phase 15.4b: already-unlocked enchantments are excluded from re-selection', () => {
  it('once sol is unlocked on floor 1, sol_enchantment never reappears in the floor 2 pool draw', () => {
    for (let seed = 0; seed < 40; seed++) {
      let state = createInitialState(seed);
      // Simulate having picked up sol_enchantment on floor 1 (as the
      // real pickup path in turn.ts would do), regardless of whether it
      // was actually drawn onto this particular floor.
      state.solUnlocked = true;
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state);
      expect(state.groundItems.some((i) => i.itemId === 'sol_enchantment')).toBe(false);
    }
  });

  it('once every element is unlocked, none of the five enchantment ids reappear on a later floor', () => {
    for (let seed = 0; seed < 40; seed++) {
      let state = createInitialState(seed);
      state.solUnlocked = true;
      state.unlockedEnchantments = { sol: true, flame: true, frost: true, cloud: true, earth: true };
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state);
      for (const id of ENCHANTMENT_ITEM_IDS) {
        expect(state.groundItems.some((i) => i.itemId === id)).toBe(false);
      }
    }
  });

  it('a brand new run (no carry) never treats anything as already unlocked', () => {
    // Sanity: floor 1 of a fresh run can still draw any of its pool's
    // enchantment ids (sol_enchantment/flame_enchantment) at least once
    // across many seeds.
    let sawSol = false;
    let sawFlame = false;
    for (let seed = 0; seed < 60 && !(sawSol && sawFlame); seed++) {
      const state = createInitialState(seed);
      if (state.groundItems.some((i) => i.itemId === 'sol_enchantment')) sawSol = true;
      if (state.groundItems.some((i) => i.itemId === 'flame_enchantment')) sawFlame = true;
    }
    expect(sawSol).toBe(true);
    expect(sawFlame).toBe(true);
  });
});

describe('Phase 15.4b: generation-level invariants across many seeds', () => {
  it('every floor of every seed produces between 2 and 6 groundItems', () => {
    for (let seed = 0; seed < 150; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        expect(state.groundItems.length).toBeGreaterThanOrEqual(2);
        expect(state.groundItems.length).toBeLessThanOrEqual(6);
        if (floor < 3) {
          state.enemies.forEach((e) => (e.alive = false));
          state.player.pos = { ...state.exit };
          state = advanceToNextFloor(state);
        }
      }
    }
  });

  it('groundItems never share a tile with each other, start, exit, or any enemy, across many seeds', () => {
    for (let seed = 0; seed < 150; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        const positions = state.groundItems.map((i) => `${i.pos.x},${i.pos.y}`);
        expect(new Set(positions).size).toBe(positions.length);
        for (const item of state.groundItems) {
          expect(item.pos).not.toEqual(state.player.pos);
          expect(item.pos).not.toEqual(state.exit);
          for (const enemy of state.enemies) {
            expect(item.pos).not.toEqual(enemy.pos);
          }
        }
        if (floor < 3) {
          state.enemies.forEach((e) => (e.alive = false));
          state.player.pos = { ...state.exit };
          state = advanceToNextFloor(state);
        }
      }
    }
  });

  it('generation never throws (candidate shortage) across a wide seed range', () => {
    expect(() => {
      for (let seed = 0; seed < 300; seed++) {
        let state = createInitialState(seed);
        for (let floor = 1; floor < 3; floor++) {
          state.enemies.forEach((e) => (e.alive = false));
          state.player.pos = { ...state.exit };
          state = advanceToNextFloor(state);
        }
      }
    }).not.toThrow();
  });

  it('the same seed reproduces identical groundItems (count, ids, and coordinates)', () => {
    for (const seed of [1, 7, 42, 999, 123456]) {
      const a = createInitialState(seed);
      const b = createInitialState(seed);
      expect(a.groundItems).toEqual(b.groundItems);
    }
  });

  it('different seeds do not all collapse to the same groundItems (generation is not hard-coded/frozen)', () => {
    const results = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const state = createInitialState(seed);
      results.add(JSON.stringify(state.groundItems));
    }
    expect(results.size).toBeGreaterThan(1);
  });
});
