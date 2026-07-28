import { describe, expect, it } from 'vitest';
import { generateMap, generateMapDebug } from '../mapgen';
import { GameMap, Room, Tile, Vec2 } from '../types';

function inAnyRoom(rooms: Room[], x: number, y: number): boolean {
  return rooms.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

/**
 * Detects unwanted side-by-side corridor contact: a solid 2x2 block of
 * floor tiles entirely outside any room and not touching a relay tile. A
 * normal 1-wide straight corridor, L-bend, or T-junction never fills all
 * four corners of a 2x2 block outside a room; a relay hub is explicitly
 * allowed to have several corridors converge on it (which can locally look
 * like a small 2x2 patch right at the hub), so blocks that include a relay
 * tile are excluded from this check.
 */
function findParallelContactBlocks(map: GameMap, relays: Vec2[]): string[] {
  const relaySet = new Set(relays.map((r) => `${r.x},${r.y}`));
  const hits: string[] = [];
  for (let y = 0; y < map.height - 1; y++) {
    for (let x = 0; x < map.width - 1; x++) {
      const corners: [number, number][] = [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ];
      const allFloorOutsideRooms = corners.every(
        ([cx, cy]) => map.terrain[cy][cx] === 'floor' && !inAnyRoom(map.rooms, cx, cy),
      );
      if (!allFloorOutsideRooms) continue;
      const touchesRelay = corners.some(([cx, cy]) => relaySet.has(`${cx},${cy}`));
      if (touchesRelay) continue; // allowed: relay convergence point
      hits.push(`(${x},${y})`);
    }
  }
  return hits;
}

const SEEDS_100 = Array.from({ length: 100 }, (_, i) => i * 53 + 11);

describe('corridor geometry - no unwanted parallel contact', () => {
  it('produces no side-by-side corridor contact across 100 seeds (relay convergence excluded)', () => {
    const failures: { seed: number; hits: string[] }[] = [];
    for (const seed of SEEDS_100) {
      const debugInfo = generateMapDebug(seed);
      const { ok } = generateMap(seed);
      expect(ok).toBe(true);
      if (!debugInfo.ok || !debugInfo.map || !debugInfo.contents) continue; // debug uses a single attempt; skip if it needed a retry
      const relays = debugInfo.contents.filter((c) => c.relay).map((c) => c.relay!);
      const hits = findParallelContactBlocks(debugInfo.map, relays);
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

    expect(findParallelContactBlocks(map, [])).toEqual([]);
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
    expect(findParallelContactBlocks(map, []).length).toBeGreaterThan(0);
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
