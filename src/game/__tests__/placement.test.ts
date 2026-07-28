import { describe, expect, it } from 'vitest';
import { choosePlacement, createRng, generateMap } from '../mapgen';

const SEEDS = Array.from({ length: 100 }, (_, i) => i * 31 + 3);

describe('placement', () => {
  it('places start, exit, and enemy on floor tiles, without overlap, across many seeds', () => {
    for (const seed of SEEDS) {
      const { map } = generateMap(seed);
      const rng = createRng(seed ^ 0x51ed270b);
      const placement = choosePlacement(map!, rng);

      expect(map!.terrain[placement.start.y][placement.start.x]).toBe('floor');
      expect(map!.terrain[placement.exit.y][placement.exit.x]).toBe('floor');
      expect(map!.terrain[placement.enemy.y][placement.enemy.x]).toBe('floor');

      const same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        a.x === b.x && a.y === b.y;
      expect(same(placement.start, placement.exit)).toBe(false);
      expect(same(placement.start, placement.enemy)).toBe(false);
      expect(same(placement.exit, placement.enemy)).toBe(false);

      const dx = Math.abs(placement.enemy.x - placement.start.x);
      const dy = Math.abs(placement.enemy.y - placement.start.y);
      const adjacent = dx <= 1 && dy <= 1;
      expect(adjacent).toBe(false);
    }
  });

  it('places the exit in a different room than the start', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const { map } = generateMap(seed);
      const rng = createRng(seed ^ 0x51ed270b);
      const placement = choosePlacement(map!, rng);

      const roomOf = (p: { x: number; y: number }) =>
        map!.rooms.findIndex(
          (r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height,
        );

      expect(roomOf(placement.start)).toBe(0);
      expect(roomOf(placement.exit)).not.toBe(0);
      expect(roomOf(placement.exit)).toBeGreaterThanOrEqual(0);
    }
  });
});
