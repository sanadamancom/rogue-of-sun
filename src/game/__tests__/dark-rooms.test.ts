/**
 * Phase 17.2 implementation_gate tests: dark-room placement
 * (dark-rooms.ts) and its visibility.ts integration (dark-room radius-3
 * FOV vs ordinary room/corridor visibility).
 */
import { describe, expect, it } from 'vitest';
import { GameMap, Room, Tile, Vec2 } from '../types';
import { chooseDarkRoomIndex, deterministicRoomHash } from '../dark-rooms';
import { computeCorridorVisibility, computeCurrentVisibility, DARK_ROOM_VISIBILITY_RADIUS, roomVisibleTiles } from '../visibility';
import { generateMap } from '../mapgen';
import { deriveFloorSeed } from '../floor';
import { createRng } from '../mapgen';
import { choosePlacement } from '../mapgen';

function has(points: Vec2[], p: Vec2): boolean {
  return points.some((q) => q.x === p.x && q.y === p.y);
}

// Three rooms in a row, connected by 1-wide corridors, so roomIndexContaining
// unambiguously resolves start/mid/exit to distinct rooms.
const threeRoomRows = [
  '###############',
  '#...#.....#...#',
  '#...#.....#...#',
  '#...+.....+...#',
  '#...#.....#...#',
  '###############',
];
const roomA: Room = { x: 1, y: 1, width: 3, height: 3 };
const roomB: Room = { x: 5, y: 1, width: 5, height: 3 };
const roomC: Room = { x: 11, y: 1, width: 3, height: 3 };
function threeRoomMap(): GameMap {
  // '+' cells are corridor floor tiles connecting the rooms; parse them as floor.
  const terrain: Tile[][] = threeRoomRows.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width: terrain[0].length, height: terrain.length, terrain, rooms: [roomA, roomB, roomC], exit: { x: 12, y: 2 } };
}

describe('dark-room placement (implementation_gate.placement)', () => {
  it('is deterministic: same floorSeed/floor picks the same room every call', () => {
    const map = threeRoomMap();
    const a = chooseDarkRoomIndex(map, 12345, 2, { x: 2, y: 2 }, { x: 12, y: 2 });
    const b = chooseDarkRoomIndex(map, 12345, 2, { x: 2, y: 2 }, { x: 12, y: 2 });
    expect(a).toBe(b);
  });

  it('is not the same fixed room for every seed when more than one room is eligible', () => {
    // threeRoomMap's start/exit fixture only ever leaves roomB eligible
    // (roomA/roomC are always the start/exit rooms there); use a 4-room
    // fixture with no start/exit inside any of the middle two rooms so
    // both are eligible and the hash's seed-dependence is actually
    // exercised.
    const fourRoomRows = ['###################', '#...#.....#.....#.#', '#...+.....+.....+.#', '#...#.....#.....#.#', '###################'];
    const terrain: Tile[][] = fourRoomRows.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
    const rA: Room = { x: 1, y: 1, width: 3, height: 1 };
    const rB: Room = { x: 5, y: 1, width: 5, height: 1 };
    const rC: Room = { x: 11, y: 1, width: 5, height: 1 };
    const rD: Room = { x: 17, y: 1, width: 1, height: 1 };
    const map: GameMap = { width: terrain[0].length, height: terrain.length, terrain, rooms: [rA, rB, rC, rD], exit: { x: 17, y: 1 } };
    const results = new Set<number | null>();
    for (let seed = 0; seed < 50; seed++) {
      results.add(chooseDarkRoomIndex(map, seed, 1, { x: 2, y: 1 }, { x: 17, y: 1 }));
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('depends on floor number too (not just seed), when more than one room is eligible', () => {
    const fourRoomRows = ['###################', '#...#.....#.....#.#', '#...+.....+.....+.#', '#...#.....#.....#.#', '###################'];
    const terrain: Tile[][] = fourRoomRows.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
    const rA: Room = { x: 1, y: 1, width: 3, height: 1 };
    const rB: Room = { x: 5, y: 1, width: 5, height: 1 };
    const rC: Room = { x: 11, y: 1, width: 5, height: 1 };
    const rD: Room = { x: 17, y: 1, width: 1, height: 1 };
    const map: GameMap = { width: terrain[0].length, height: terrain.length, terrain, rooms: [rA, rB, rC, rD], exit: { x: 17, y: 1 } };
    const results = new Set<number | null>();
    for (let floor = 1; floor <= 30; floor++) {
      results.add(chooseDarkRoomIndex(map, 42, floor, { x: 2, y: 1 }, { x: 17, y: 1 }));
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('never selects the start room', () => {
    const map = threeRoomMap();
    for (let seed = 0; seed < 50; seed++) {
      const idx = chooseDarkRoomIndex(map, seed, 1, { x: 2, y: 2 }, { x: 12, y: 2 });
      if (idx !== null) expect(idx).not.toBe(0); // roomA contains (2,2)
    }
  });

  it('never selects the exit room', () => {
    const map = threeRoomMap();
    for (let seed = 0; seed < 50; seed++) {
      const idx = chooseDarkRoomIndex(map, seed, 1, { x: 2, y: 2 }, { x: 12, y: 2 });
      if (idx !== null) expect(idx).not.toBe(2); // roomC contains (12,2)
    }
  });

  it('with exactly one eligible room, always picks that room', () => {
    const twoRoomMap: GameMap = {
      width: threeRoomMap().width,
      height: threeRoomMap().height,
      terrain: threeRoomMap().terrain,
      rooms: [roomA, roomB],
      exit: { x: 12, y: 2 }, // not inside any room -> exit room index is -1
    };
    for (let seed = 0; seed < 20; seed++) {
      // start in roomA (index 0) excludes it; exit outside every room
      // excludes nothing extra, so only roomB (index 1) is eligible.
      expect(chooseDarkRoomIndex(twoRoomMap, seed, 1, { x: 2, y: 2 }, { x: 12, y: 2 })).toBe(1);
    }
  });

  it('with zero eligible rooms, returns null', () => {
    const oneRoomMap: GameMap = {
      width: threeRoomMap().width,
      height: threeRoomMap().height,
      terrain: threeRoomMap().terrain,
      rooms: [roomA],
      exit: { x: 2, y: 2 }, // same room as start -> the only room is excluded twice over
    };
    expect(chooseDarkRoomIndex(oneRoomMap, 999, 1, { x: 2, y: 2 }, { x: 2, y: 2 })).toBeNull();
  });

  it('deterministicRoomHash never returns an out-of-range index', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const modulus of [1, 2, 3, 7]) {
        const h = deterministicRoomHash(seed, seed % 5, modulus);
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThan(modulus);
      }
    }
  });

  it('does not consume any RNG stream (pure function of its arguments only)', () => {
    // No rng/createRng import is used anywhere in dark-rooms.ts; this is
    // a structural guarantee, spot-checked here by calling it many times
    // with the same arguments and confirming bit-for-bit identical output
    // (an RNG-driven implementation would very likely vary or require
    // external state to reproduce).
    const map = threeRoomMap();
    const results = new Set<number | null>();
    for (let i = 0; i < 10; i++) {
      results.add(chooseDarkRoomIndex(map, 7, 3, { x: 2, y: 2 }, { x: 12, y: 2 }));
    }
    expect(results.size).toBe(1);
  });
});

describe('dark-room placement: real map generation integration', () => {
  it('across many seeds, the chosen dark room (if any) is never the start or exit room, and map/placement results are unaffected', () => {
    for (let runSeed = 1; runSeed <= 60; runSeed++) {
      for (let floor = 1; floor <= 3; floor++) {
        const floorSeed = deriveFloorSeed(runSeed, floor);
        const result = generateMap(floorSeed);
        expect(result.ok).toBe(true);
        const map = result.map!;
        const placementRng = createRng(floorSeed ^ 0x51ed270b);
        const placement = choosePlacement(map, placementRng, 3);
        const darkIdx = chooseDarkRoomIndex(map, floorSeed, floor, placement.start, placement.exit);
        if (darkIdx === null) continue;
        const darkRoom = map.rooms[darkIdx];
        const inDarkRoom = (p: Vec2) => p.x >= darkRoom.x && p.x < darkRoom.x + darkRoom.width && p.y >= darkRoom.y && p.y < darkRoom.y + darkRoom.height;
        expect(inDarkRoom(placement.start)).toBe(false);
        expect(inDarkRoom(placement.exit)).toBe(false);
      }
    }
  });

  it('regenerating the same floorSeed/floor twice yields the same dark room index', () => {
    for (let runSeed = 1; runSeed <= 20; runSeed++) {
      const floorSeed = deriveFloorSeed(runSeed, 1);
      const map1 = generateMap(floorSeed).map!;
      const map2 = generateMap(floorSeed).map!;
      const rng1 = createRng(floorSeed ^ 0x51ed270b);
      const rng2 = createRng(floorSeed ^ 0x51ed270b);
      const p1 = choosePlacement(map1, rng1, 3);
      const p2 = choosePlacement(map2, rng2, 3);
      expect(p1.start).toEqual(p2.start);
      expect(p1.exit).toEqual(p2.exit);
      const d1 = chooseDarkRoomIndex(map1, floorSeed, 1, p1.start, p1.exit);
      const d2 = chooseDarkRoomIndex(map2, floorSeed, 1, p2.start, p2.exit);
      expect(d1).toBe(d2);
    }
  });
});

describe('dark-room visibility integration (implementation_gate.visibility + transition)', () => {
  function withDarkRoom(darkIndex: number | null): GameMap {
    const map = threeRoomMap();
    map.darkRoomIndex = darkIndex;
    return map;
  }

  it('a normal (non-dark) room still shows its whole interior', () => {
    const map = withDarkRoom(null);
    const result = computeCurrentVisibility(map, map.rooms, { x: 7, y: 2 });
    for (let x = 6; x <= 9; x++) expect(has(result, { x, y: 2 })).toBe(true);
  });

  it('the dark room (index 1 = roomB) does not show its far corner from the opposite corner (radius 3 < room span)', () => {
    const map = withDarkRoom(1);
    // roomB spans x=5..9, y=1..3 (width 5). From the near corner (5,1),
    // the far corner (9,3) is Chebyshev distance max(4,2)=4 away — beyond
    // the dark room's radius-3 FOV, so it must not be visible, even
    // though the ordinary whole-room rule would show it.
    const result = computeCurrentVisibility(map, map.rooms, { x: 5, y: 1 });
    expect(has(result, { x: 9, y: 3 })).toBe(false);
    const wholeRoom = roomVisibleTiles(map, roomB);
    expect(has(wholeRoom, { x: 9, y: 3 })).toBe(true); // sanity: the normal rule *would* show it
  });

  it('the dark room shows radius-3-reachable tiles but not radius-4-only tiles', () => {
    const map = withDarkRoom(1);
    const origin = { x: 6, y: 2 }; // left edge of roomB (x=5..9)
    const result = computeCurrentVisibility(map, map.rooms, origin);
    expect(has(result, { x: 9, y: 2 })).toBe(true); // distance 3
    // roomB's own rectangle only spans x=5..9 (width 5), so nothing at
    // distance 4 exists inside it to assert against directly; instead
    // compare directly against computeCorridorVisibility at radius 3 vs 4
    // on the same origin/map to confirm the dark room actually uses 3.
    const atRadius3 = computeCorridorVisibility(map, origin, DARK_ROOM_VISIBILITY_RADIUS);
    const atRadius4 = computeCorridorVisibility(map, origin, 4);
    expect(atRadius4.length).toBeGreaterThanOrEqual(atRadius3.length);
    expect(result.length).toBe(atRadius3.length);
  });

  it('standing in a plain corridor between rooms still uses radius 4, dark room or not', () => {
    const map = withDarkRoom(1);
    const corridorPos = { x: 4, y: 3 }; // the '+' doorway tile, outside every room rectangle
    const result = computeCurrentVisibility(map, map.rooms, corridorPos);
    const expected = computeCorridorVisibility(map, corridorPos, 4);
    expect(result.map((p) => `${p.x},${p.y}`).sort()).toEqual(expected.map((p) => `${p.x},${p.y}`).sort());
  });

  it("doorway_transition: standing at the dark room's own entrance tile (outside its rectangle) does not reveal the dark room's far interior", () => {
    const map = withDarkRoom(1);
    const entrance = { x: 4, y: 3 }; // just outside roomB's west boundary
    const result = computeCurrentVisibility(map, map.rooms, entrance);
    // The far (east) interior tiles of roomB are well beyond radius 4
    // from this entrance tile, so none of them should be visible yet —
    // whole-room visibility has not activated just by standing at the
    // threshold.
    expect(has(result, { x: 9, y: 1 })).toBe(false);
    expect(has(result, { x: 9, y: 3 })).toBe(false);
  });

  it('doorway_transition: crossing from the entrance into the dark room rectangle switches to radius-3 immediately (no lingering full-room reveal)', () => {
    const map = withDarkRoom(1);
    const justInside = { x: 5, y: 2 }; // first floor tile inside roomB's rectangle
    const result = computeCurrentVisibility(map, map.rooms, justInside);
    // roomB's own far corners (distance 4 from x=5,y=2's row extremes)
    // must not be visible: whole-room reveal never engages for a dark
    // room, even one step inside it.
    expect(has(result, { x: 9, y: 1 })).toBe(false);
    expect(has(result, { x: 9, y: 3 })).toBe(false);
  });

  it('doorway_transition: leaving the dark room into a normal room restores whole-room visibility', () => {
    const map = withDarkRoom(1);
    const result = computeCurrentVisibility(map, map.rooms, { x: 2, y: 2 }); // inside roomA (normal)
    const wholeRoomA = roomVisibleTiles(map, roomA);
    expect(result.length).toBe(wholeRoomA.length);
  });

  it('start/exit rooms are never dark for a floor with an eligible middle room (roomB), matching the placement gate', () => {
    const map = threeRoomMap();
    const darkIdx = chooseDarkRoomIndex(map, 1, 1, { x: 2, y: 2 }, { x: 12, y: 2 });
    expect(darkIdx).toBe(1); // only roomB is eligible in this 3-room fixture
  });
});
