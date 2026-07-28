import { describe, expect, it } from 'vitest';
import { deriveFloorSeed, TOTAL_FLOORS } from '../floor';

describe('floor seed derivation', () => {
  it('is deterministic for the same run seed and floor', () => {
    expect(deriveFloorSeed(2024, 1)).toBe(deriveFloorSeed(2024, 1));
    expect(deriveFloorSeed(2024, 2)).toBe(deriveFloorSeed(2024, 2));
  });

  it('produces distinct seeds for different floors of the same run', () => {
    const seeds = new Set<number>();
    for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
      seeds.add(deriveFloorSeed(777, floor));
    }
    expect(seeds.size).toBe(TOTAL_FLOORS);
  });

  it('is order-independent: requesting floors out of order gives the same results', () => {
    const inOrder = [1, 2, 3].map((f) => deriveFloorSeed(555, f));
    const outOfOrder = [3, 1, 2].map((f) => deriveFloorSeed(555, f));
    expect(outOfOrder[1]).toBe(inOrder[0]); // floor 1
    expect(outOfOrder[2]).toBe(inOrder[1]); // floor 2
    expect(outOfOrder[0]).toBe(inOrder[2]); // floor 3
  });

  it('produces a different sequence of floor seeds for a different run seed', () => {
    const a = [1, 2, 3].map((f) => deriveFloorSeed(1, f));
    const b = [1, 2, 3].map((f) => deriveFloorSeed(2, f));
    expect(a).not.toEqual(b);
  });

  it('does not depend on Math.random or Date.now (repeated module-level calls stay stable)', () => {
    const first = deriveFloorSeed(42, 1);
    // Simulate time passing / unrelated random calls elsewhere; result must
    // still be identical since the function only reads its own arguments.
    for (let i = 0; i < 5; i++) Math.random();
    const second = deriveFloorSeed(42, 1);
    expect(second).toBe(first);
  });
});
