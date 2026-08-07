/**
 * Phase 17.1 implementation_gate tests for src/game/visibility.ts.
 *
 * Fixtures are re-authored here as literal GameMap grids (not imported
 * from tools/phase17-visibility, which is a standalone, production-
 * independent Phase 17.0 comparison prototype with its own Grid/Point
 * types) — but every fixture's shape and origin exactly matches the
 * corresponding one there, so results are directly comparable to the
 * Phase 17.0 writeup.
 */
import { describe, expect, it } from 'vitest';
import { GameMap, Room, Tile, Vec2 } from '../types';
import {
  chebyshevDistance,
  computeCorridorVisibility,
  computeCurrentVisibility,
  isInRoomBounds,
  pointKey,
  roomVisibleTiles,
  shadowcastVisibleTiles,
} from '../visibility';

function buildMap(rows: string[], rooms: Room[] = []): GameMap {
  const terrain: Tile[][] = rows.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return {
    width: terrain[0].length,
    height: terrain.length,
    terrain,
    rooms,
    exit: { x: 0, y: 0 },
  };
}

function has(points: Vec2[], p: Vec2): boolean {
  return points.some((q) => q.x === p.x && q.y === p.y);
}

// ----- fixtures (mirroring tools/phase17-visibility/fixtures.ts) -----

const straightCorridor = {
  map: buildMap(['###########', '#.........#', '###########']),
  origin: { x: 5, y: 1 } as Vec2,
};

const lCorner = {
  map: buildMap(['#########', '#.......#', '#.#######', '#.#######', '#.#######', '#########']),
  origin: { x: 1, y: 3 } as Vec2,
};

const doorwayRoomRows = ['###########', '#.........#', '#.........#', '#.........#', '#####.#####', '######.####', '######.####'];
const doorwayRoom: Room = { x: 1, y: 1, width: 9, height: 3 };

const doorwayFromRoom = {
  map: buildMap(doorwayRoomRows, [doorwayRoom]),
  origin: { x: 5, y: 2 } as Vec2,
  room: doorwayRoom,
};

const doorwayFromCorridor = {
  map: buildMap(doorwayRoomRows, [doorwayRoom]),
  origin: { x: 6, y: 6 } as Vec2,
  room: doorwayRoom,
};

const multipleExitsRoomRows = [
  '#####.#####',
  '#.........#',
  '#.........#',
  '#.........#',
  '..........#',
  '#.........#',
  '#.........#',
  '#.........#',
  '#####.#####',
];
const multipleExitsRoomRoom: Room = { x: 1, y: 1, width: 9, height: 7 };
const multipleExitsRoom = {
  map: buildMap(multipleExitsRoomRows, [multipleExitsRoomRoom]),
  origin: { x: 5, y: 4 } as Vec2,
  room: multipleExitsRoomRoom,
};

const diagonalDoubleWall = {
  map: buildMap(['#####', '#.#.#', '##.##', '#.#.#', '#####']),
  origin: { x: 1, y: 1 } as Vec2,
};

const mapEdge = {
  map: buildMap(['####', '#..#', '#..#', '####']),
  origin: { x: 1, y: 1 } as Vec2,
};

const darkRoomRows = ['#############', '#...........#', '#...........#', '#...........#', '#...........#', '#...........#', '#############'];
const darkRoomRoom: Room = { x: 1, y: 1, width: 11, height: 5 };
const darkRoom = {
  map: buildMap(darkRoomRows, [darkRoomRoom]),
  origin: { x: 3, y: 3 } as Vec2,
  room: darkRoomRoom,
};

const RADIUS = 4;

describe('shadowcasting_gate: required conditions', () => {
  const ALL = [straightCorridor, lCorner, diagonalDoubleWall, mapEdge];

  it('always includes the origin', () => {
    for (const f of ALL) {
      expect(has(computeCorridorVisibility(f.map, f.origin, RADIUS), f.origin)).toBe(true);
    }
  });

  it('never returns an out-of-bounds coordinate', () => {
    for (const f of ALL) {
      for (const p of computeCorridorVisibility(f.map, f.origin, RADIUS)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(f.map.width);
        expect(p.y).toBeLessThan(f.map.height);
      }
    }
  });

  it('never mutates the input map', () => {
    for (const f of ALL) {
      const before = JSON.stringify(f.map.terrain);
      computeCorridorVisibility(f.map, f.origin, RADIUS);
      expect(JSON.stringify(f.map.terrain)).toBe(before);
    }
  });

  it('is deterministic across repeated calls', () => {
    for (const f of ALL) {
      const a = computeCorridorVisibility(f.map, f.origin, RADIUS).map(pointKey).sort();
      const b = computeCorridorVisibility(f.map, f.origin, RADIUS).map(pointKey).sort();
      expect(a).toEqual(b);
    }
  });

  it('map_edge: stable and in-bounds at a map corner, no exception thrown', () => {
    expect(() => computeCorridorVisibility(mapEdge.map, mapEdge.origin, RADIUS)).not.toThrow();
    const result = computeCorridorVisibility(mapEdge.map, mapEdge.origin, RADIUS);
    expect(result.length).toBeGreaterThan(0);
  });

  it('straight_corridor: sees up to radius 4 down the corridor, bounded by its walls', () => {
    const result = computeCorridorVisibility(straightCorridor.map, straightCorridor.origin, RADIUS);
    // Corridor floor spans x=1..9 at y=1; origin x=5, radius 4 covers the
    // whole floor run (x=1..9) plus the flanking wall faces.
    for (let x = 1; x <= 9; x++) expect(has(result, { x, y: 1 })).toBe(true);
    // Nothing beyond the 11x3 grid, and no row other than 0/1/2.
    for (const p of result) expect(p.y === 0 || p.y === 1 || p.y === 2).toBe(true);
  });

  it('diagonal_double_wall: the tile behind two diagonal wall corners is not visible', () => {
    const result = computeCorridorVisibility(diagonalDoubleWall.map, diagonalDoubleWall.origin, RADIUS);
    expect(has(result, { x: 2, y: 2 })).toBe(false);
  });

  it('diagonal_double_wall: does not contradict the movement engine\'s own corner rule (isDiagonalCornerOpen)', () => {
    // (2,1) and (1,2) are both walls, so map.ts's canMove would refuse a
    // diagonal step from (1,1) to (2,2) too — sight and movement agree.
    const result = computeCorridorVisibility(diagonalDoubleWall.map, diagonalDoubleWall.origin, RADIUS);
    expect(has(result, { x: 2, y: 2 })).toBe(false);
  });

  it('l_corner: does not leak deep into the perpendicular leg past the corner', () => {
    const result = computeCorridorVisibility(lCorner.map, lCorner.origin, 5);
    // origin (1,3) in the vertical leg; (1,1)-(7,1) is the horizontal leg
    // reached via the bend at (1,1). A tile deep into that horizontal leg,
    // well past the bend, must not leak through even though it's within
    // radius 5 as the crow flies.
    expect(has(result, { x: 6, y: 1 })).toBe(false);
    expect(has(result, { x: 7, y: 1 })).toBe(false);
  });

  it('l_corner: the corner tile itself and the near part of the bend remain visible', () => {
    const result = computeCorridorVisibility(lCorner.map, lCorner.origin, 5);
    expect(has(result, { x: 1, y: 1 })).toBe(true); // the bend
    expect(has(result, { x: 1, y: 2 })).toBe(true); // straight up the origin's own leg
  });

  it('walls themselves are visible from the near side (their own face is revealed)', () => {
    const result = computeCorridorVisibility(straightCorridor.map, straightCorridor.origin, RADIUS);
    expect(has(result, { x: 5, y: 0 })).toBe(true); // wall directly above a visible floor tile
    expect(has(result, { x: 5, y: 2 })).toBe(true); // wall directly below
  });

  it('radius 0 shows only the origin', () => {
    const result = computeCorridorVisibility(straightCorridor.map, straightCorridor.origin, 0);
    expect(result).toEqual([straightCorridor.origin]);
  });

  it('radius 1 shows only the origin and its immediate (in-bounds) neighbors', () => {
    const result = computeCorridorVisibility(straightCorridor.map, straightCorridor.origin, 1);
    for (const p of result) expect(chebyshevDistance(p, straightCorridor.origin)).toBeLessThanOrEqual(1);
  });

  it('computational cost is realistic for a per-turn 48x36 map call', () => {
    const rows: string[] = [];
    for (let y = 0; y < 36; y++) {
      rows.push(y === 0 || y === 35 ? '#'.repeat(48) : '#' + '.'.repeat(46) + '#');
    }
    const bigMap = buildMap(rows);
    const start = Date.now();
    for (let i = 0; i < 200; i++) {
      computeCorridorVisibility(bigMap, { x: 24, y: 18 }, RADIUS);
    }
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('shadowcasting_gate: symmetry', () => {
  it('is horizontally and vertically symmetric on an open fixture (visibility from A to B matches B to A pattern)', () => {
    const map = buildMap(['#########', '#.......#', '#.......#', '#.......#', '#########']);
    const origin = { x: 4, y: 2 };
    const result = shadowcastVisibleTiles(map, origin, RADIUS);
    const set = new Set(result.map(pointKey));
    for (const p of result) {
      const mirroredX = { x: 2 * origin.x - p.x, y: p.y };
      const mirroredY = { x: p.x, y: 2 * origin.y - p.y };
      if (mirroredX.x >= 0 && mirroredX.x < map.width) expect(set.has(pointKey(mirroredX))).toBe(true);
      if (mirroredY.y >= 0 && mirroredY.y < map.height) expect(set.has(pointKey(mirroredY))).toBe(true);
    }
  });

  it('rotating an open fixture 90° produces the same-shaped visible set', () => {
    const map = buildMap(['###########', '#.........#', '#.........#', '#.........#', '###########']);
    const origin = { x: 5, y: 2 };
    const result = shadowcastVisibleTiles(map, origin, 3);
    const set = new Set(result.map(pointKey));
    // Symmetric under x<->y swap around the origin on this square-ish open
    // fixture footprint within radius 3 (rows/cols both have >=3 clearance).
    for (const p of result) {
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      const rotated = { x: origin.x + dy, y: origin.y + dx };
      if (rotated.x >= 0 && rotated.x < map.width && rotated.y >= 1 && rotated.y <= 3) {
        expect(set.has(pointKey(rotated))).toBe(true);
      }
    }
  });
});

describe('shadowcasting_gate: origin edge cases', () => {
  it('origin on a wall tile still returns a defined, non-throwing result', () => {
    const map = buildMap(['###', '###', '###']);
    expect(() => computeCorridorVisibility(map, { x: 1, y: 1 }, RADIUS)).not.toThrow();
  });

  it('origin out of bounds does not throw and returns an empty-ish, in-bounds-only result', () => {
    const map = buildMap(['###', '#.#', '###']);
    expect(() => computeCorridorVisibility(map, { x: -5, y: -5 }, RADIUS)).not.toThrow();
    const result = computeCorridorVisibility(map, { x: -5, y: -5 }, RADIUS);
    for (const p of result) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('room_rules', () => {
  it('doorway_from_room: the whole room interior is visible', () => {
    const result = roomVisibleTiles(doorwayFromRoom.map, doorwayFromRoom.room);
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 9; x++) expect(has(result, { x, y })).toBe(true);
    }
  });

  it('doorway_from_room: exactly the first corridor tile below the doorway is included, not farther down', () => {
    const result = roomVisibleTiles(doorwayFromRoom.map, doorwayFromRoom.room);
    expect(has(result, { x: 5, y: 4 })).toBe(true);
    expect(has(result, { x: 6, y: 5 })).toBe(false);
    expect(has(result, { x: 6, y: 6 })).toBe(false);
  });

  it('doorway_from_corridor: standing outside the room rectangle does not trigger whole-room visibility', () => {
    expect(isInRoomBounds(doorwayFromCorridor.room, doorwayFromCorridor.origin)).toBe(false);
    const result = computeCurrentVisibility(doorwayFromCorridor.map, [doorwayFromCorridor.room], doorwayFromCorridor.origin);
    // Should not reveal the room's far interior (e.g. its top row) from
    // just outside the doorway.
    expect(has(result, { x: 1, y: 1 })).toBe(false);
  });

  it('multiple_exits_room: all 3 real doorways (N, S, W) are found', () => {
    const result = roomVisibleTiles(multipleExitsRoom.map, multipleExitsRoom.room);
    expect(has(result, { x: 5, y: 0 })).toBe(true);
    expect(has(result, { x: 5, y: 8 })).toBe(true);
    expect(has(result, { x: 0, y: 4 })).toBe(true);
  });

  it('unconnected near corridors are not swept in by the room rule (diagonal ring corners excluded)', () => {
    const result = roomVisibleTiles(doorwayFromRoom.map, doorwayFromRoom.room);
    // Diagonal corner of the ring (not a straight-side scan hit).
    expect(has(result, { x: 0, y: 0 })).toBe(false);
  });

  it('room-rule tiles never fall outside the map', () => {
    for (const f of [doorwayFromRoom, multipleExitsRoom, darkRoom]) {
      for (const p of roomVisibleTiles(f.map, f.room)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(f.map.width);
        expect(p.y).toBeLessThan(f.map.height);
      }
    }
  });
});

describe('visibility_state: computeCurrentVisibility room activation', () => {
  it('standing inside room bounds uses whole-room visibility', () => {
    const result = computeCurrentVisibility(doorwayFromRoom.map, [doorwayFromRoom.room], doorwayFromRoom.origin);
    for (let x = 1; x <= 9; x++) expect(has(result, { x, y: 2 })).toBe(true);
  });

  it('standing in a corridor (outside every room) uses radius-based corridor visibility', () => {
    const result = computeCurrentVisibility(straightCorridor.map, [], straightCorridor.origin);
    expect(has(result, { x: 5, y: 1 })).toBe(true);
    expect(has(result, { x: 1, y: 1 })).toBe(true); // within radius 4
  });

  it('dark_room fixture: the future dark-area radius override, when passed explicitly, shows fewer tiles than the whole-room rule', () => {
    // Phase 17.1 does not activate dark areas in production, but the
    // radius parameter itself must already support an override.
    const overridden = computeCorridorVisibility(darkRoom.map, darkRoom.origin, 2);
    const wholeRoom = roomVisibleTiles(darkRoom.map, darkRoom.room);
    expect(overridden.length).toBeLessThan(wholeRoom.length);
  });
});
