import { describe, expect, it } from 'vitest';
import { choosePlacement, createRng, generateMap } from '../mapgen';
import { deriveFloorSeed, TOTAL_FLOORS } from '../floor';
import { GameMap, Vec2 } from '../types';

// Reuses the same Phase 02 shape-validation logic as
// `robustness.test.ts` (flood-fill connectivity, forbidden 2x2 floor
// blocks, and placement checks), applied here to the 300 floor seeds
// (100 run seeds x 3 floors) actually reachable through the run/floor
// system, instead of only checking generation success + determinism.

function floodFillFloors(map: GameMap, start: Vec2): Set<string> {
  const key = (p: Vec2) => `${p.x},${p.y}`;
  const visited = new Set<string>([key(start)]);
  const stack: Vec2[] = [start];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    const neighbors = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ];
    for (const n of neighbors) {
      if (n.x < 0 || n.y < 0 || n.x >= map.width || n.y >= map.height) continue;
      if (map.terrain[n.y][n.x] !== 'floor') continue;
      const k = key(n);
      if (!visited.has(k)) {
        visited.add(k);
        stack.push(n);
      }
    }
  }
  return visited;
}

function allFloorTiles(map: GameMap): Vec2[] {
  const floors: Vec2[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.terrain[y][x] === 'floor') floors.push({ x, y });
    }
  }
  return floors;
}

function findForbiddenFloorBlocks(map: GameMap): string[] {
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
      hits.push(`${x},${y}`);
    }
  }
  return hits;
}

interface FloorFailure {
  runSeed: number;
  floor: number;
  floorSeed: number;
  reason: string;
}

function checkFloor(runSeed: number, floor: number): FloorFailure | null {
  const floorSeed = deriveFloorSeed(runSeed, floor);
  const fail = (reason: string): FloorFailure => ({ runSeed, floor, floorSeed, reason });

  const result = generateMap(floorSeed);
  if (!result.ok || !result.map) return fail('generation failed after all retries');
  const map = result.map;

  if (map.rooms.length < 6 || map.rooms.length > 9) {
    return fail(`room count out of range: ${map.rooms.length}`);
  }

  const rng = createRng(floorSeed ^ 0x51ed270b);
  const placement = choosePlacement(map, rng);

  // Reachability is checked from the floor's actual player start tile
  // (not just an arbitrary room center), since that's the tile the run
  // system places the player on.
  const reachable = floodFillFloors(map, placement.start);
  const floors = allFloorTiles(map);
  if (reachable.size !== floors.length) {
    return fail(`not fully connected: reachable ${reachable.size} of ${floors.length}`);
  }

  const startKey = `${placement.start.x},${placement.start.y}`;
  const exitKey = `${placement.exit.x},${placement.exit.y}`;
  if (!reachable.has(exitKey)) {
    return fail(`exit not reachable from start (start ${startKey}, exit ${exitKey})`);
  }

  const forbiddenBlocks = findForbiddenFloorBlocks(map);
  if (forbiddenBlocks.length > 0) {
    return fail(`forbidden 2x2 floor blocks: ${forbiddenBlocks.length}`);
  }

  if (map.terrain[placement.start.y][placement.start.x] !== 'floor') return fail('start not on floor');
  if (map.terrain[placement.exit.y][placement.exit.x] !== 'floor') return fail('exit not on floor');
  if (map.terrain[placement.enemy.y][placement.enemy.x] !== 'floor') return fail('enemy not on floor');

  const samePos = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
  if (
    samePos(placement.start, placement.exit) ||
    samePos(placement.start, placement.enemy) ||
    samePos(placement.exit, placement.enemy)
  ) {
    return fail('placement overlap');
  }

  return null;
}

describe('multi-floor robustness (run seeds 1-100, 300 floors)', () => {
  it('passes full Phase 02 shape validation on every floor: generation, connectivity, start->exit reachability, forbidden 2x2 blocks, and placement', () => {
    const failures: FloorFailure[] = [];
    let successes = 0;

    for (let runSeed = 1; runSeed <= 100; runSeed++) {
      for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        const failure = checkFloor(runSeed, floor);
        if (failure) {
          failures.push(failure);
        } else {
          successes++;
        }
      }
    }

    expect(failures).toEqual([]);
    expect(successes).toBe(100 * TOTAL_FLOORS);
  });

  it('is fully deterministic: regenerating the same 100 run seeds twice yields identical results', () => {
    const first: string[] = [];
    const second: string[] = [];

    for (let runSeed = 1; runSeed <= 100; runSeed++) {
      for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        const floorSeed = deriveFloorSeed(runSeed, floor);
        const result = generateMap(floorSeed);
        first.push(JSON.stringify(result.map?.terrain ?? null));
      }
    }
    for (let runSeed = 1; runSeed <= 100; runSeed++) {
      for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        const floorSeed = deriveFloorSeed(runSeed, floor);
        const result = generateMap(floorSeed);
        second.push(JSON.stringify(result.map?.terrain ?? null));
      }
    }

    let mismatches = 0;
    for (let i = 0; i < first.length; i++) {
      if (first[i] !== second[i]) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});
