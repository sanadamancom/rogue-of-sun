import { describe, expect, it } from 'vitest';
import { GameMap, Room, Tile, Vec2 } from '../types';
import { choosePlacement, createRng, generateMap, roomIndexContaining } from '../mapgen';
import {
  buildMonsterHouseFloorState,
  computeMonsterHouseEntryCells,
  extractMonsterHouseCandidateRooms,
} from '../monster-house';
import {
  buildSealedRoomFloorState,
  extractSealedRoomCandidateRooms,
  SEALED_ROOM_MINIMUM_INTERIOR_SIZE,
  SEALED_ROOM_OCCURRENCE_PROBABILITY,
} from '../sealed-room';

function makeLeafMap(): { map: GameMap; start: Vec2; exit: Vec2 } {
  const width = 30;
  const height = 20;
  const terrain: Tile[][] = Array.from({ length: height }, () => new Array<Tile>(width).fill('wall'));
  const rooms: Room[] = [
    { x: 10, y: 10, width: 5, height: 5 },
    { x: 1, y: 10, width: 5, height: 5 },
    { x: 19, y: 10, width: 5, height: 5 },
    { x: 10, y: 1, width: 5, height: 5 },
  ];
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) terrain[y][x] = 'floor';
    }
  }
  for (let x = 6; x <= 9; x++) terrain[12][x] = 'floor';
  for (let x = 15; x <= 18; x++) terrain[12][x] = 'floor';
  for (let y = 6; y <= 9; y++) terrain[y][12] = 'floor';
  const start = { x: 2, y: 12 };
  const exit = { x: 20, y: 12 };
  return { map: { width, height, terrain, rooms, exit }, start, exit };
}

function countingRng(values: number[]) {
  let calls = 0;
  return { rng: () => values[calls++], calls: () => calls };
}

describe('extractSealedRoomCandidateRooms', () => {
  it('applies start, exit, additional-exclusion, size, and leaf filters', () => {
    const { map, start, exit } = makeLeafMap();
    expect(computeMonsterHouseEntryCells(map, 0)).toHaveLength(3);
    expect(extractSealedRoomCandidateRooms(map, start, exit, [])).toEqual([3]);
    expect(extractSealedRoomCandidateRooms(map, start, exit, [3])).toEqual([]);

    map.rooms[3].width = SEALED_ROOM_MINIMUM_INTERIOR_SIZE - 1;
    expect(extractSealedRoomCandidateRooms(map, start, exit, [])).toEqual([]);
    map.rooms[3].width = SEALED_ROOM_MINIMUM_INTERIOR_SIZE;
    map.rooms[3].height = SEALED_ROOM_MINIMUM_INTERIOR_SIZE - 1;
    expect(extractSealedRoomCandidateRooms(map, start, exit, [])).toEqual([]);
  });

  it('throws when start or exit is outside every room', () => {
    const { map, start, exit } = makeLeafMap();
    expect(() => extractSealedRoomCandidateRooms(map, { x: 29, y: 19 }, exit, [])).toThrow();
    expect(() => extractSealedRoomCandidateRooms(map, start, { x: 29, y: 19 }, [])).toThrow();
  });

  it('does not mutate its inputs', () => {
    const { map, start, exit } = makeLeafMap();
    const before = JSON.stringify({ map, start, exit });
    const excluded = [0];
    extractSealedRoomCandidateRooms(map, start, exit, excluded);
    expect(JSON.stringify({ map, start, exit })).toBe(before);
    expect(excluded).toEqual([0]);
  });
});

describe('buildSealedRoomFloorState RNG contract', () => {
  it('consumes 0/0/0/1/2 calls and short-circuits map inspection', () => {
    const { map, start, exit } = makeLeafMap();
    const outside = { x: 29, y: 19 };

    let counted = countingRng([0, 0]);
    expect(buildSealedRoomFloorState(map, 18, 'descent', outside, outside, false, [], counted.rng)).toBeNull();
    expect(counted.calls()).toBe(0);

    counted = countingRng([0, 0]);
    expect(buildSealedRoomFloorState(map, 19, 'descent', outside, outside, true, [], counted.rng)).toBeNull();
    expect(counted.calls()).toBe(0);

    counted = countingRng([0, 0]);
    expect(buildSealedRoomFloorState(map, 19, 'descent', start, exit, false, [3], counted.rng)).toBeNull();
    expect(counted.calls()).toBe(0);

    counted = countingRng([SEALED_ROOM_OCCURRENCE_PROBABILITY, 0]);
    expect(buildSealedRoomFloorState(map, 19, 'descent', start, exit, false, [], counted.rng)).toBeNull();
    expect(counted.calls()).toBe(1);

    counted = countingRng([0, 0]);
    expect(buildSealedRoomFloorState(map, 19, 'descent', start, exit, false, [], counted.rng)).toEqual({ roomIndex: 3 });
    expect(counted.calls()).toBe(2);
  });
});

describe('generated-map structural invariant', () => {
  it('holds across at least 200 seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const result = generateMap(seed);
      if (!result.ok || !result.map) continue;
      const map = result.map;
      const placement = choosePlacement(map, createRng(seed ^ 0x51ed270b));
      const candidates = extractSealedRoomCandidateRooms(map, placement.start, placement.exit, []);
      expect(new Set(candidates).size).toBe(candidates.length);
      const startRoom = roomIndexContaining(map.rooms, placement.start);
      const exitRoom = roomIndexContaining(map.rooms, placement.exit);
      for (const index of candidates) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(map.rooms.length);
        expect(index).not.toBe(startRoom);
        expect(index).not.toBe(exitRoom);
        expect(map.rooms[index].width).toBeGreaterThanOrEqual(SEALED_ROOM_MINIMUM_INTERIOR_SIZE);
        expect(map.rooms[index].height).toBeGreaterThanOrEqual(SEALED_ROOM_MINIMUM_INTERIOR_SIZE);
        expect(computeMonsterHouseEntryCells(map, index)).toHaveLength(1);
      }
    }
  });
});

describe('monster-house exclusion parameter regression', () => {
  it('preserves defaults and removes only explicitly excluded candidates', () => {
    const { map, start, exit } = makeLeafMap();
    const original = extractMonsterHouseCandidateRooms(map, start, exit);
    expect(extractMonsterHouseCandidateRooms(map, start, exit, [])).toEqual(original);
    expect(extractMonsterHouseCandidateRooms(map, start, exit, [original[0]])).toEqual(original.slice(1));

    const values = () => countingRng([0, 0.75]).rng;
    expect(buildMonsterHouseFloorState(map, 2, 'descent', start, exit, values()))
      .toEqual(buildMonsterHouseFloorState(map, 2, 'descent', start, exit, values(), []));
  });
});
