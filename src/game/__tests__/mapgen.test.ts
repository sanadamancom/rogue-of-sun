import { describe, expect, it } from 'vitest';
import { generateMap } from '../mapgen';

describe('generateMap - deterministic generation', () => {
  it('produces identical maps for the same seed', () => {
    const a = generateMap(12345);
    const b = generateMap(12345);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.map!.terrain).toEqual(b.map!.terrain);
    expect(a.map!.rooms).toEqual(b.map!.rooms);
    expect(a.map!.exit).toEqual(b.map!.exit);
  });

  it('produces a different map for a different seed (at least one differs among several)', () => {
    const seeds = [1, 2, 3, 4, 5];
    const results = seeds.map((s) => generateMap(s));
    results.forEach((r) => expect(r.ok).toBe(true));
    const terrains = results.map((r) => JSON.stringify(r.map!.terrain));
    const unique = new Set(terrains);
    expect(unique.size).toBeGreaterThan(1);
  });
});
