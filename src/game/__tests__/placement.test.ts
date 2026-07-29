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
      expect(placement.enemies).toHaveLength(2);

      const same = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        a.x === b.x && a.y === b.y;

      for (const enemy of placement.enemies) {
        expect(map!.terrain[enemy.y][enemy.x]).toBe('floor');
        expect(same(placement.start, enemy)).toBe(false);
        expect(same(placement.exit, enemy)).toBe(false);
        const dx = Math.abs(enemy.x - placement.start.x);
        const dy = Math.abs(enemy.y - placement.start.y);
        const adjacent = dx <= 1 && dy <= 1;
        expect(adjacent).toBe(false);
      }
      expect(same(placement.enemies[0], placement.enemies[1])).toBe(false);
    }
  });

  it('produces the same enemy placement for the same rng sequence (determinism)', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const { map } = generateMap(seed);
      const rngA = createRng(seed ^ 0x51ed270b);
      const a = choosePlacement(map!, rngA);
      const rngB = createRng(seed ^ 0x51ed270b);
      const b = choosePlacement(map!, rngB);
      expect(a.enemies).toEqual(b.enemies);
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
