import { describe, expect, it } from 'vitest';
import { choosePlacement, createRng, generateMap } from '../mapgen';

const SAMPLE_SEEDS = [1, 42, 999, 12345, 2024, 555, 777888, 4242];

describe('determinism', () => {
  it('produces identical tiles, rooms, and exit for the same seed', () => {
    for (const seed of SAMPLE_SEEDS) {
      const a = generateMap(seed);
      const b = generateMap(seed);
      expect(a.ok).toBe(true);
      expect(b.ok).toBe(true);
      expect(a.map!.terrain).toEqual(b.map!.terrain);
      expect(a.map!.rooms).toEqual(b.map!.rooms);
      expect(a.map!.exit).toEqual(b.map!.exit);
    }
  });

  it('produces identical player/exit/enemy placement for the same seed', () => {
    for (const seed of SAMPLE_SEEDS) {
      const { map: mapA } = generateMap(seed);
      const { map: mapB } = generateMap(seed);
      const placementA = choosePlacement(mapA!, createRng(seed ^ 0x51ed270b));
      const placementB = choosePlacement(mapB!, createRng(seed ^ 0x51ed270b));
      expect(placementA).toEqual(placementB);
    }
  });

  it('does not always produce the same shape across different seeds', () => {
    const results = SAMPLE_SEEDS.map((s) => generateMap(s));
    results.forEach((r) => expect(r.ok).toBe(true));
    const terrains = results.map((r) => JSON.stringify(r.map!.terrain));
    expect(new Set(terrains).size).toBeGreaterThan(1);
  });
});
