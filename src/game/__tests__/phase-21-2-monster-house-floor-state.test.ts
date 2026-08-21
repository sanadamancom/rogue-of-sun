/**
 * Phase 21.2 implementation_gate tests: monster-house eligibility,
 * occurrence roll, deterministic floor-state construction, and its
 * production wiring at buildFloorState (state.ts). production save/load
 * does not exist in this codebase (see phase-21-2 history doc), so no
 * persistence round-trip tests exist here beyond confirming the value is
 * plain JSON-serializable data.
 */
import { describe, expect, it } from 'vitest';
import { GameMap, Room, Tile, Vec2 } from '../types';
import {
  buildMonsterHouseFloorState,
  createMonsterHouseRng,
  extractMonsterHouseCandidateRooms,
  isMonsterHouseEligibleFloor,
  MONSTER_HOUSE_OCCURRENCE_PROBABILITY,
} from '../monster-house';
import { createRng, generateMap, choosePlacement, roomIndexContaining } from '../mapgen';
import { deriveFloorSeed } from '../floor';
import { createInitialState } from '../state';

function makeBlankTerrain(width: number, height: number): Tile[][] {
  const terrain: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    terrain.push(new Array(width).fill('wall'));
  }
  return terrain;
}

// Same 4-room-in-a-row fixture as phase-21-1's tests: start room, two
// middle candidate rooms, exit room.
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

// A map with only a start room and an exit room, so the candidate set is
// always empty — used to exercise the "eligible floor, no candidates"
// zero-RNG-consumption branch.
function makeTwoRoomMapNoCandidates(): { map: GameMap; start: Vec2; exit: Vec2 } {
  const width = 20;
  const height = 10;
  const terrain = makeBlankTerrain(width, height);
  const rooms: Room[] = [
    { x: 1, y: 1, width: 5, height: 5 },
    { x: 12, y: 1, width: 5, height: 5 },
  ];
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        terrain[y][x] = 'floor';
      }
    }
  }
  const start: Vec2 = { x: 2, y: 2 };
  const exit: Vec2 = { x: 14, y: 2 };
  const map: GameMap = { width, height, terrain, rooms, exit };
  return { map, start, exit };
}

describe('isMonsterHouseEligibleFloor', () => {
  it('uses the inclusive descent depth range 2 through 26', () => {
    expect(isMonsterHouseEligibleFloor(1, 'descent')).toBe(false);
    expect(isMonsterHouseEligibleFloor(2, 'descent')).toBe(true);
    expect(isMonsterHouseEligibleFloor(26, 'descent')).toBe(true);
    expect(isMonsterHouseEligibleFloor(27, 'descent')).toBe(false);
  });

  it('never permits a monster house during ascent', () => {
    expect(isMonsterHouseEligibleFloor(1, 'ascent')).toBe(false);
    expect(isMonsterHouseEligibleFloor(2, 'ascent')).toBe(false);
    expect(isMonsterHouseEligibleFloor(26, 'ascent')).toBe(false);
    expect(isMonsterHouseEligibleFloor(27, 'ascent')).toBe(false);
  });
});

describe('buildMonsterHouseFloorState: eligibility branch', () => {
  it('returns null and consumes 0 rng calls for an ineligible floor', () => {
    const { map, start, exit } = makeFourRoomMap();
    let calls = 0;
    const rng = () => {
      calls++;
      return 0; // would succeed the occurrence roll if consulted
    };
    const result = buildMonsterHouseFloorState(map, 1, 'descent', start, exit, rng);
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });

  it('returns null and consumes 0 rng calls for an ascent floor at an otherwise eligible depth', () => {
    const { map, start, exit } = makeFourRoomMap();
    let calls = 0;
    const rng = () => {
      calls++;
      return 0;
    };
    const result = buildMonsterHouseFloorState(map, 2, 'ascent', start, exit, rng);
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });
});

describe('buildMonsterHouseFloorState: no-candidates branch', () => {
  it('returns null and consumes 0 rng calls on an eligible floor with no candidate rooms', () => {
    const { map, start, exit } = makeTwoRoomMapNoCandidates();
    // Sanity check: this fixture really has zero candidates.
    expect(extractMonsterHouseCandidateRooms(map, start, exit)).toEqual([]);

    let calls = 0;
    const rng = () => {
      calls++;
      return 0;
    };
    const result = buildMonsterHouseFloorState(map, 2, 'descent', start, exit, rng);
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });
});

describe('buildMonsterHouseFloorState: occurrence roll branch', () => {
  it('returns null and consumes exactly 1 rng call when the occurrence roll fails', () => {
    const { map, start, exit } = makeFourRoomMap();
    const values = [MONSTER_HOUSE_OCCURRENCE_PROBABILITY]; // >= probability: fails
    let index = 0;
    const rng = () => values[index++];
    const result = buildMonsterHouseFloorState(map, 2, 'descent', start, exit, rng);
    expect(result).toBeNull();
    expect(index).toBe(1);
  });

  it('returns a hidden monster house state and consumes exactly 2 rng calls when the roll succeeds', () => {
    const { map, start, exit } = makeFourRoomMap();
    const values = [0, 0.5]; // 0 < probability: succeeds; 0.5 picks a candidate
    let index = 0;
    const rng = () => values[index++];
    const result = buildMonsterHouseFloorState(map, 2, 'descent', start, exit, rng);
    expect(result).not.toBeNull();
    expect(result?.status).toBe('hidden');
    expect(index).toBe(2);
  });

  it('the just-below-probability roll succeeds (roll < probability)', () => {
    const { map, start, exit } = makeFourRoomMap();
    const justBelow = MONSTER_HOUSE_OCCURRENCE_PROBABILITY - 1e-9;
    const values = [justBelow, 0.1];
    let index = 0;
    const rng = () => values[index++];
    const result = buildMonsterHouseFloorState(map, 2, 'descent', start, exit, rng);
    expect(result).not.toBeNull();
  });

  it('the exact-probability roll fails (roll >= probability convention)', () => {
    const { map, start, exit } = makeFourRoomMap();
    const values = [MONSTER_HOUSE_OCCURRENCE_PROBABILITY];
    let index = 0;
    const rng = () => values[index++];
    const result = buildMonsterHouseFloorState(map, 2, 'descent', start, exit, rng);
    expect(result).toBeNull();
  });

  it('selected roomIndex is never the start or exit room', () => {
    const { map, start, exit } = makeFourRoomMap();
    const startIndex = roomIndexContaining(map.rooms, start);
    const exitIndex = roomIndexContaining(map.rooms, exit);
    const values = [0, 0.99999];
    let index = 0;
    const rng = () => values[index++];
    const result = buildMonsterHouseFloorState(map, 2, 'descent', start, exit, rng);
    expect(result).not.toBeNull();
    expect(result?.roomIndex).not.toBe(startIndex);
    expect(result?.roomIndex).not.toBe(exitIndex);
  });

  it('selected roomIndex is always within the candidate set', () => {
    const { map, start, exit } = makeFourRoomMap();
    const candidates = extractMonsterHouseCandidateRooms(map, start, exit);
    for (let i = 0; i < 20; i++) {
      const rollValue = 0;
      const pickValue = i / 20;
      const values = [rollValue, pickValue];
      let index = 0;
      const rng = () => values[index++];
      const result = buildMonsterHouseFloorState(map, 2, 'descent', start, exit, rng);
      expect(result).not.toBeNull();
      expect(candidates).toContain(result?.roomIndex);
    }
  });

  it('does not mutate map, start, or exit', () => {
    const { map, start, exit } = makeFourRoomMap();
    const roomsBefore = JSON.parse(JSON.stringify(map.rooms));
    const startBefore = { ...start };
    const exitBefore = { ...exit };
    buildMonsterHouseFloorState(map, 2, 'descent', start, exit, () => 0.01);
    expect(map.rooms).toEqual(roomsBefore);
    expect(start).toEqual(startBefore);
    expect(exit).toEqual(exitBefore);
  });
});

describe('createMonsterHouseRng', () => {
  it('produces a stream distinct from every other floorSeed-derived stream (different first value than a plain createRng(floorSeed))', () => {
    const floorSeed = 12345;
    const monsterHouseRng = createMonsterHouseRng(floorSeed, createRng);
    const plainRng = createRng(floorSeed);
    expect(monsterHouseRng()).not.toBe(plainRng());
  });

  it('is deterministic: same floorSeed produces the same sequence', () => {
    const floorSeed = 777;
    const rngA = createMonsterHouseRng(floorSeed, createRng);
    const rngB = createMonsterHouseRng(floorSeed, createRng);
    expect(rngA()).toBe(rngB());
    expect(rngA()).toBe(rngB());
  });
});

describe('buildMonsterHouseFloorState: determinism on generated maps', () => {
  const seeds = [1, 2, 3, 42, 12345, 999999];

  it('same run seed + floor + map produces the same monster house result', () => {
    for (const seed of seeds) {
      for (const floor of [2, 3]) {
        const genResult = generateMap(deriveFloorSeed(seed, floor));
        expect(genResult.ok).toBe(true);
        if (!genResult.map) continue;
        const map = genResult.map;
        const floorSeed = deriveFloorSeed(seed, floor);
        const placement = choosePlacement(map, createRng(floorSeed ^ 0x51ed270b));

        const first = buildMonsterHouseFloorState(map, floor, 'descent', placement.start, placement.exit, createMonsterHouseRng(floorSeed, createRng));
        const second = buildMonsterHouseFloorState(map, floor, 'descent', placement.start, placement.exit, createMonsterHouseRng(floorSeed, createRng));
        expect(first).toEqual(second);
      }
    }
  });

  it('floor 1 never has a monster house across representative seeds', () => {
    for (const seed of seeds) {
      const floorSeed = deriveFloorSeed(seed, 1);
      const genResult = generateMap(floorSeed);
      expect(genResult.ok).toBe(true);
      if (!genResult.map) continue;
      const map = genResult.map;
      const placement = choosePlacement(map, createRng(floorSeed ^ 0x51ed270b));
      const result = buildMonsterHouseFloorState(map, 1, 'descent', placement.start, placement.exit, createMonsterHouseRng(floorSeed, createRng));
      expect(result).toBeNull();
    }
  });
});

describe('buildFloorState production wiring (state.ts createInitialState)', () => {
  it('every generated floor has map.monsterHouse defined as either null or a valid hidden state', () => {
    for (const runSeed of [1, 2, 3, 42, 12345]) {
      const state = createInitialState(runSeed);
      const mh = state.map.monsterHouse;
      if (mh === null || mh === undefined) continue;
      expect(mh.status).toBe('hidden');
      expect(mh.roomIndex).toBeGreaterThanOrEqual(0);
      expect(mh.roomIndex).toBeLessThan(state.map.rooms.length);
      const startIndex = roomIndexContaining(state.map.rooms, state.player.pos);
      expect(mh.roomIndex).not.toBe(startIndex);
      const exitIndex = roomIndexContaining(state.map.rooms, state.map.exit);
      expect(mh.roomIndex).not.toBe(exitIndex);
    }
  });

  it('floor 1 (the initial floor) never has a monster house via createInitialState', () => {
    for (const runSeed of [1, 2, 3, 42, 12345]) {
      const state = createInitialState(runSeed);
      expect(state.floor).toBe(1);
      expect(state.map.monsterHouse ?? null).toBeNull();
    }
  });

  it('map.monsterHouse value is plain JSON-serializable data (null or {roomIndex, status})', () => {
    for (const runSeed of [10, 20, 30, 40, 50, 60, 70, 80]) {
      const state = createInitialState(runSeed);
      const mh = state.map.monsterHouse;
      const roundTripped = JSON.parse(JSON.stringify(mh ?? null));
      expect(roundTripped).toEqual(mh ?? null);
    }
  });
});
