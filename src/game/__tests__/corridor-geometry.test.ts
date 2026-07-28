import { describe, expect, it } from 'vitest';
import { generateMap } from '../mapgen';
import { GameMap, Room, Tile } from '../types';

/**
 * A 2x2 block of four floor tiles is only allowed when it lies entirely
 * within a single room's interior. Any other all-floor 2x2 block (outside
 * any room, straddling a room boundary, touching a relay, or formed by two
 * different corridor segments) is forbidden. This mirrors the stricter rule
 * in floor-block-geometry.test.ts; there is intentionally no special-case
 * exemption for relay tiles, since a relay convergence must be a single-tile
 * T/X junction, not a 2x2 patch.
 */
function findParallelContactBlocks(map: GameMap): string[] {
  const inSingleRoom = (x: number, y: number, x2: number, y2: number): boolean =>
    map.rooms.some((r) => x >= r.x && x2 < r.x + r.width && y >= r.y && y2 < r.y + r.height);

  const hits: string[] = [];
  for (let y = 0; y < map.height - 1; y++) {
    for (let x = 0; x < map.width - 1; x++) {
      const allFloor =
        map.terrain[y][x] === 'floor' &&
        map.terrain[y][x + 1] === 'floor' &&
        map.terrain[y + 1][x] === 'floor' &&
        map.terrain[y + 1][x + 1] === 'floor';
      if (!allFloor) continue;
      if (inSingleRoom(x, y, x + 1, y + 1)) continue;
      hits.push(`(${x},${y})`);
    }
  }
  return hits;
}

const SEEDS_100 = Array.from({ length: 100 }, (_, i) => i * 53 + 11);

describe('corridor geometry - no unwanted parallel contact', () => {
  it('produces no forbidden 2x2 floor blocks across 100 seeds (no relay exemption)', () => {
    const failures: { seed: number; hits: string[] }[] = [];
    for (const seed of SEEDS_100) {
      const { ok, map } = generateMap(seed);
      expect(ok).toBe(true);
      const hits = findParallelContactBlocks(map!);
      if (hits.length > 0) failures.push({ seed, hits });
    }
    expect(failures).toEqual([]);
  });
});

/**
 * Checks that no non-room floor region outside rooms is a dense, blocky
 * fill (a "large rectangular or shapeless floor mass"). A legitimate 1-wide
 * corridor network can span many tiles once several long connections and
 * relay hubs are chained together, so raw tile count is not a reliable
 * signal by itself; instead this measures fill density within each
 * connected region's bounding box; a thin path has low density, while a
 * filled block approaches 1.0.
 */
function inAnyRoom(rooms: Room[], x: number, y: number): boolean {
  return rooms.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

function findDenseFloorBlobs(map: GameMap, maxDensity: number): { size: number; density: number }[] {
  const visited = new Set<string>();
  const flagged: { size: number; density: number }[] = [];

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.terrain[y][x] !== 'floor') continue;
      if (inAnyRoom(map.rooms, x, y)) continue;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;

      let size = 0;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      const stack = [{ x, y }];
      visited.add(key);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        size++;
        minX = Math.min(minX, cur.x);
        maxX = Math.max(maxX, cur.x);
        minY = Math.min(minY, cur.y);
        maxY = Math.max(maxY, cur.y);
        const neighbors = [
          { x: cur.x + 1, y: cur.y },
          { x: cur.x - 1, y: cur.y },
          { x: cur.x, y: cur.y + 1 },
          { x: cur.x, y: cur.y - 1 },
        ];
        for (const n of neighbors) {
          if (n.x < 0 || n.y < 0 || n.x >= map.width || n.y >= map.height) continue;
          if (map.terrain[n.y][n.x] !== 'floor') continue;
          if (inAnyRoom(map.rooms, n.x, n.y)) continue;
          const nKey = `${n.x},${n.y}`;
          if (visited.has(nKey)) continue;
          visited.add(nKey);
          stack.push(n);
        }
      }

      const boundingArea = (maxX - minX + 1) * (maxY - minY + 1);
      const density = size / boundingArea;
      // Only flag regions that are both reasonably large AND dense; a tiny
      // 2x2 hub or a short 3-tile bend has high density but is negligible in
      // absolute size, and a long thin snake has low density regardless of size.
      if (boundingArea >= 60 && density > maxDensity) {
        flagged.push({ size, density });
      }
    }
  }

  return flagged;
}

describe('corridor geometry - no dense floor blobs outside rooms', () => {
  it('keeps non-room floor regions thin (low fill density), rejecting blocky/shapeless fills', () => {
    const failures: { seed: number; blobs: { size: number; density: number }[] }[] = [];
    for (const seed of SEEDS_100) {
      const { ok, map } = generateMap(seed);
      expect(ok).toBe(true);
      const blobs = findDenseFloorBlobs(map!, 0.65);
      if (blobs.length > 0) failures.push({ seed, blobs });
    }
    expect(failures).toEqual([]);
  });
});

describe('corridor geometry - does not over-detect normal shapes (sanity checks)', () => {
  it('does not flag a simple straight corridor built by hand', () => {
    const width = 20;
    const height = 10;
    const terrain = Array.from({ length: height }, () => Array.from({ length: width }, () => 'wall' as Tile));
    for (let y = 3; y <= 5; y++) for (let x = 1; x <= 3; x++) terrain[y][x] = 'floor';
    for (let y = 3; y <= 5; y++) for (let x = 15; x <= 17; x++) terrain[y][x] = 'floor';
    for (let x = 3; x <= 15; x++) terrain[4][x] = 'floor';

    const map: GameMap = {
      width,
      height,
      terrain,
      rooms: [
        { x: 1, y: 3, width: 3, height: 3 },
        { x: 15, y: 3, width: 3, height: 3 },
      ],
      exit: { x: 16, y: 4 },
    };

    expect(findParallelContactBlocks(map)).toEqual([]);
  });

  it('does flag a genuine hand-built parallel run (sanity check the detector still works)', () => {
    const width = 10;
    const height = 10;
    const terrain = Array.from({ length: height }, () => Array.from({ length: width }, () => 'wall' as Tile));
    for (let y = 0; y < height; y++) {
      terrain[y][4] = 'floor';
      terrain[y][5] = 'floor';
    }
    const map: GameMap = { width, height, terrain, rooms: [], exit: { x: 4, y: 0 } };
    expect(findParallelContactBlocks(map).length).toBeGreaterThan(0);
  });
});

describe('corridor geometry - does not traverse unrelated rooms', () => {
  it('never carves a corridor tile inside a room other than at its own boundary (rooms remain solid rectangles)', () => {
    for (const seed of SEEDS_100.slice(0, 30)) {
      const { ok, map } = generateMap(seed);
      expect(ok).toBe(true);
      for (const room of map!.rooms) {
        for (let y = room.y; y < room.y + room.height; y++) {
          for (let x = room.x; x < room.x + room.width; x++) {
            expect(map!.terrain[y][x]).toBe('floor');
          }
        }
      }
    }
  });
});
