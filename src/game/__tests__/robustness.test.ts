import { describe, expect, it } from 'vitest';
import { choosePlacement, createRng, generateMap } from '../mapgen';
import { GameMap, Vec2 } from '../types';

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

function runRobustnessCheck(seedCount: number) {
  const failedSeeds: { seed: number; reason: string }[] = [];

  for (let seed = 1; seed <= seedCount; seed++) {
    const result = generateMap(seed);
    if (!result.ok || !result.map) {
      failedSeeds.push({ seed, reason: 'generation failed after all retries' });
      continue;
    }
    const map = result.map;

    if (map.rooms.length < 6 || map.rooms.length > 9) {
      failedSeeds.push({ seed, reason: `room count out of range: ${map.rooms.length}` });
      continue;
    }

    const start = map.rooms[0] && { x: map.rooms[0].x + Math.floor(map.rooms[0].width / 2), y: map.rooms[0].y + Math.floor(map.rooms[0].height / 2) };
    const reachable = floodFillFloors(map, start);
    const floors = allFloorTiles(map);
    if (reachable.size !== floors.length) {
      failedSeeds.push({ seed, reason: `not fully connected: reachable ${reachable.size} of ${floors.length}` });
      continue;
    }

    const forbiddenBlocks = findForbiddenFloorBlocks(map);
    if (forbiddenBlocks.length > 0) {
      failedSeeds.push({ seed, reason: `forbidden 2x2 floor blocks: ${forbiddenBlocks.length}` });
      continue;
    }

    const rng = createRng(seed ^ 0x51ed270b);
    const placement = choosePlacement(map, rng);
    if (map.terrain[placement.start.y][placement.start.x] !== 'floor') {
      failedSeeds.push({ seed, reason: 'start not on floor' });
      continue;
    }
    if (map.terrain[placement.exit.y][placement.exit.x] !== 'floor') {
      failedSeeds.push({ seed, reason: 'exit not on floor' });
      continue;
    }
    let enemyOnFloor = true;
    for (const enemy of placement.enemies) {
      if (map.terrain[enemy.y][enemy.x] !== 'floor') enemyOnFloor = false;
    }
    if (!enemyOnFloor) {
      failedSeeds.push({ seed, reason: 'enemy not on floor' });
      continue;
    }
    const samePos = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
    const overlap =
      samePos(placement.start, placement.exit) ||
      placement.enemies.some((e) => samePos(placement.start, e) || samePos(placement.exit, e)) ||
      samePos(placement.enemies[0], placement.enemies[1]);
    if (overlap) {
      failedSeeds.push({ seed, reason: 'placement overlap' });
      continue;
    }
  }

  return failedSeeds;
}

describe('robustness - 100 seed quick check', () => {
  it('has no failures across seeds 1-100', () => {
    const failed = runRobustnessCheck(100);
    expect(failed).toEqual([]);
  });
});

describe('robustness - 1000 seed full check', () => {
  it('has no failures across seeds 1-1000', () => {
    const failed = runRobustnessCheck(1000);
    expect(failed).toEqual([]);
  });
});
