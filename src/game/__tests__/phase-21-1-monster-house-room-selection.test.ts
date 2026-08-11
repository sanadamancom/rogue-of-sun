/**
 * Phase 21.1 implementation_gate tests: monster-house candidate-room
 * extraction and selection (monster-house.ts). Pure logic only — no
 * production wiring, GameState fields, save schema, or telemetry.
 */
import { describe, expect, it } from 'vitest';
import { GameMap, Room, Tile, Vec2 } from '../types';
import { extractMonsterHouseCandidateRooms, selectMonsterHouseRoom } from '../monster-house';
import { createRng, generateMap, choosePlacement, roomIndexContaining } from '../mapgen';
import { deriveFloorSeed } from '../floor';

function makeBlankTerrain(width: number, height: number): Tile[][] {
  const terrain: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    terrain.push(new Array(width).fill('wall'));
  }
  return terrain;
}

// Four rooms in a row: start room, two middle candidate rooms, exit room.
// Corridors are not needed for these tests since extraction/selection only
// consult map.rooms plus start/exit positions.
function makeFourRoomMap(): { map: GameMap; start: Vec2; exit: Vec2 } {
  const width = 40;
  const height = 10;
  const terrain = makeBlankTerrain(width, height);
  const rooms: Room[] = [
    { x: 1, y: 1, width: 5, height: 5 },
    { x: 10, y: 1, width: 5, height: 5 },
    { x: 19, y: 1, width: 5, height: 5 },
    { x: 28, y: 1, width: 5, height: 5 },
  ];
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        terrain[y][x] = 'floor';
      }
    }
  }
  const start: Vec2 = { x: 2, y: 2 };
  const exit: Vec2 = { x: 30, y: 3 };
  const map: GameMap = { width, height, terrain, rooms, exit };
  return { map, start, exit };
}

describe('extractMonsterHouseCandidateRooms', () => {
  it('excludes the start room and the exit room', () => {
    const { map, start, exit } = makeFourRoomMap();
    const candidates = extractMonsterHouseCandidateRooms(map, start, exit);
    const startIndex = roomIndexContaining(map.rooms, start);
    const exitIndex = roomIndexContaining(map.rooms, exit);
    expect(candidates).not.toContain(startIndex);
    expect(candidates).not.toContain(exitIndex);
  });

  it('returns every other room in ascending index order', () => {
    const { map, start, exit } = makeFourRoomMap();
    const candidates = extractMonsterHouseCandidateRooms(map, start, exit);
    expect(candidates).toEqual([1, 2]);
  });

  it('correctly classifies positions on room edges under half-open containment', () => {
    // Room 0 spans x:[1,6), y:[1,6). (1,1) is inside; (6,1) is not (start
    // edge of the next room's gap). Use the top-left corner (inclusive
    // edge) and confirm it resolves to room 0, not an off-by-one neighbor.
    const { map } = makeFourRoomMap();
    const topLeftOfRoom0: Vec2 = { x: 1, y: 1 };
    const bottomRightExclusiveOfRoom0: Vec2 = { x: 6, y: 6 }; // just outside room 0
    expect(roomIndexContaining(map.rooms, topLeftOfRoom0)).toBe(0);
    expect(roomIndexContaining(map.rooms, bottomRightExclusiveOfRoom0)).toBe(-1);

    // Use these two points as start/exit to confirm extraction handles an
    // edge-exact start position correctly (room 0 excluded, others kept).
    const { map: map2 } = makeFourRoomMap();
    const candidates = extractMonsterHouseCandidateRooms(map2, topLeftOfRoom0, { x: 30, y: 3 });
    expect(candidates).not.toContain(0);
    expect(candidates).toEqual([1, 2, 3].filter((i) => i !== roomIndexContaining(map2.rooms, { x: 30, y: 3 })));
  });

  it('throws when the start position is not inside any room', () => {
    const { map, exit } = makeFourRoomMap();
    const outsideAnyRoom: Vec2 = { x: 8, y: 8 };
    expect(() => extractMonsterHouseCandidateRooms(map, outsideAnyRoom, exit)).toThrow();
  });

  it('throws when the exit position is not inside any room', () => {
    const { map, start } = makeFourRoomMap();
    const outsideAnyRoom: Vec2 = { x: 8, y: 8 };
    expect(() => extractMonsterHouseCandidateRooms(map, start, outsideAnyRoom)).toThrow();
  });

  it('does not mutate its inputs', () => {
    const { map, start, exit } = makeFourRoomMap();
    const roomsBefore = JSON.parse(JSON.stringify(map.rooms));
    const startBefore = { ...start };
    const exitBefore = { ...exit };
    extractMonsterHouseCandidateRooms(map, start, exit);
    expect(map.rooms).toEqual(roomsBefore);
    expect(start).toEqual(startBefore);
    expect(exit).toEqual(exitBefore);
  });

  it('does not consume RNG (no rng parameter exists and result is stable across repeated calls)', () => {
    const { map, start, exit } = makeFourRoomMap();
    const first = extractMonsterHouseCandidateRooms(map, start, exit);
    const second = extractMonsterHouseCandidateRooms(map, start, exit);
    expect(first).toEqual(second);
  });
});

describe('selectMonsterHouseRoom', () => {
  it('returns null and consumes no RNG for an empty candidate array', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    const result = selectMonsterHouseRoom([], rng);
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it('returns the sole candidate and consumes exactly one RNG call for a single-element array', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    const result = selectMonsterHouseRoom([7], rng);
    expect(result).toBe(7);
    expect(calls).toBe(1);
  });

  it('selects the expected candidate for stubbed RNG values across a multi-element array', () => {
    const candidates = [3, 5, 9, 12];
    expect(selectMonsterHouseRoom(candidates, () => 0)).toBe(3);
    expect(selectMonsterHouseRoom(candidates, () => 0.99999)).toBe(12);
    expect(selectMonsterHouseRoom(candidates, () => 0.5)).toBe(9);
  });

  it('picks the first candidate for rng value 0', () => {
    const candidates = [10, 20, 30];
    expect(selectMonsterHouseRoom(candidates, () => 0)).toBe(10);
  });

  it('picks the last candidate for the largest sub-1 rng value', () => {
    const candidates = [10, 20, 30];
    expect(selectMonsterHouseRoom(candidates, () => 0.999999)).toBe(30);
  });

  it('consumes RNG exactly once regardless of candidate count', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.3;
    };
    selectMonsterHouseRoom([1, 2, 3, 4, 5], rng);
    expect(calls).toBe(1);
  });

  it('does not mutate the candidate array', () => {
    const candidates = [4, 1, 9, 2];
    const before = [...candidates];
    selectMonsterHouseRoom(candidates, () => 0.42);
    expect(candidates).toEqual(before);
  });

  it('returns identical results for identical candidate arrays and identical RNG sequences', () => {
    const candidates = [2, 4, 6, 8];
    const seedValue = 0.37;
    const first = selectMonsterHouseRoom(candidates, () => seedValue);
    const second = selectMonsterHouseRoom(candidates, () => seedValue);
    expect(first).toBe(second);
  });

  it('always returns a value contained in the candidate set', () => {
    const candidates = [11, 22, 33, 44, 55];
    for (let i = 0; i < 20; i++) {
      const rngValue = i / 20;
      const result = selectMonsterHouseRoom(candidates, () => rngValue);
      expect(candidates).toContain(result);
    }
  });
});

describe('extractMonsterHouseCandidateRooms + selectMonsterHouseRoom on generated maps', () => {
  const seeds = [1, 2, 3, 42, 12345, 999999];

  it('excludes the start room and the exit room across representative seeds', () => {
    for (const seed of seeds) {
      const genResult = generateMap(seed);
      expect(genResult.ok).toBe(true);
      if (!genResult.ok) continue;
      if (!genResult.map) continue;
      const map = genResult.map;
      const floorSeed = deriveFloorSeed(seed, 1);
      const placementRng = createRng(floorSeed);
      const placement = choosePlacement(map, placementRng);

      const candidates = extractMonsterHouseCandidateRooms(map, placement.start, placement.exit);
      const startIndex = roomIndexContaining(map.rooms, placement.start);
      const exitIndex = roomIndexContaining(map.rooms, placement.exit);
      expect(candidates).not.toContain(startIndex);
      expect(candidates).not.toContain(exitIndex);
    }
  });

  it('selection result is always contained in the candidate set across representative seeds', () => {
    for (const seed of seeds) {
      const genResult = generateMap(seed);
      expect(genResult.ok).toBe(true);
      if (!genResult.ok) continue;
      if (!genResult.map) continue;
      const map = genResult.map;
      const floorSeed = deriveFloorSeed(seed, 1);
      const placementRng = createRng(floorSeed);
      const placement = choosePlacement(map, placementRng);

      const candidates = extractMonsterHouseCandidateRooms(map, placement.start, placement.exit);
      // Use a separate, locally-scoped RNG stream distinct from any
      // production stream — Phase 21.1 does not derive one from floorSeed.
      const selectionRng = createRng(seed * 7 + 3);
      const selected = selectMonsterHouseRoom(candidates, selectionRng);
      if (candidates.length === 0) {
        expect(selected).toBeNull();
      } else {
        expect(candidates).toContain(selected);
      }
    }
  });

  it('is deterministic: same seed and same rng sequence produce the same selection', () => {
    for (const seed of seeds) {
      const genResult = generateMap(seed);
      expect(genResult.ok).toBe(true);
      if (!genResult.ok) continue;
      if (!genResult.map) continue;
      const map = genResult.map;
      const floorSeed = deriveFloorSeed(seed, 1);
      const placementRng = createRng(floorSeed);
      const placement = choosePlacement(map, placementRng);
      const candidates = extractMonsterHouseCandidateRooms(map, placement.start, placement.exit);

      const first = selectMonsterHouseRoom(candidates, createRng(seed * 7 + 3));
      const second = selectMonsterHouseRoom(candidates, createRng(seed * 7 + 3));
      expect(first).toBe(second);
    }
  });
});
