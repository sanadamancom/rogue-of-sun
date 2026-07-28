import { describe, expect, it } from 'vitest';
import { MAP_GEN_PARAMS, generateMap, roomCenter } from '../mapgen';
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

// A modest set of representative seeds, kept small so the suite stays fast.
const SEEDS = Array.from({ length: 100 }, (_, i) => i * 97 + 1);

describe('generateMap - rooms', () => {
  it('keeps every room within map bounds', () => {
    const { map } = generateMap(42);
    for (const room of map!.rooms) {
      expect(room.x).toBeGreaterThanOrEqual(0);
      expect(room.y).toBeGreaterThanOrEqual(0);
      expect(room.x + room.width).toBeLessThanOrEqual(map!.width);
      expect(room.y + room.height).toBeLessThanOrEqual(map!.height);
    }
  });

  it('never overlaps rooms', () => {
    const { map } = generateMap(42);
    const rooms = map!.rooms;
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        const overlap =
          a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it('generates a room count within the configured range', () => {
    const { map } = generateMap(42);
    expect(map!.rooms.length).toBeGreaterThanOrEqual(MAP_GEN_PARAMS.targetRoomCount.min);
    expect(map!.rooms.length).toBeLessThanOrEqual(MAP_GEN_PARAMS.targetRoomCount.max);
  });
});

describe('generateMap - connectivity', () => {
  it('connects all floor tiles from a room center across many seeds', () => {
    for (const seed of SEEDS) {
      const result = generateMap(seed);
      expect(result.ok).toBe(true);
      const map = result.map!;
      const start = roomCenter(map.rooms[0]);
      const reachable = floodFillFloors(map, start);
      const allFloors = allFloorTiles(map);
      expect(reachable.size).toBe(allFloors.length);
    }
  });

  it('every room is connected via corridors (room centers all reachable)', () => {
    const { map } = generateMap(7);
    const start = roomCenter(map!.rooms[0]);
    const reachable = floodFillFloors(map!, start);
    for (const room of map!.rooms) {
      const center = roomCenter(room);
      expect(reachable.has(`${center.x},${center.y}`)).toBe(true);
    }
  });

  it('the exit tile is reachable', () => {
    const { map } = generateMap(99);
    const start = roomCenter(map!.rooms[0]);
    const reachable = floodFillFloors(map!, start);
    expect(reachable.has(`${map!.exit.x},${map!.exit.y}`)).toBe(true);
  });
});
