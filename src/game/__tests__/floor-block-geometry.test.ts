import { describe, expect, it } from 'vitest';
import { generateMap } from '../mapgen';
import { GameMap, Room, Tile } from '../types';

/**
 * A 2x2 block of four floor tiles is only allowed when it lies entirely
 * within a single room's interior. Any other all-floor 2x2 block (outside
 * any room, straddling a room boundary, touching a relay, or formed by two
 * different corridor segments) is a forbidden "thick" shape per the
 * project's corridor geometry rules: normal 1-wide lines, L-bends, and
 * single-tile T/X junctions never fill all four corners of a 2x2 block.
 */
export function findForbiddenFloorBlocks(map: GameMap): string[] {
  const inSingleRoom = (x: number, y: number, x2: number, y2: number): boolean =>
    map.rooms.some(
      (r) => x >= r.x && x2 < r.x + r.width && y >= r.y && y2 < r.y + r.height,
    );

  const hits: string[] = [];
  for (let y = 0; y < map.height - 1; y++) {
    for (let x = 0; x < map.width - 1; x++) {
      const allFloor =
        map.terrain[y][x] === 'floor' &&
        map.terrain[y][x + 1] === 'floor' &&
        map.terrain[y + 1][x] === 'floor' &&
        map.terrain[y + 1][x + 1] === 'floor';
      if (!allFloor) continue;
      if (inSingleRoom(x, y, x + 1, y + 1)) continue; // fully inside one room: allowed
      hits.push(`(${x},${y})`);
    }
  }
  return hits;
}

describe('regression - seed 2780624551 (thick room entrance / floor blocks)', () => {
  it('produces no forbidden 2x2 floor blocks', () => {
    const { ok, map } = generateMap(2780624551);
    expect(ok).toBe(true);
    const hits = findForbiddenFloorBlocks(map!);
    expect(hits).toEqual([]);
  });
});

function buildTestMap(width: number, height: number, floors: [number, number][], rooms: Room[] = []): GameMap {
  const terrain = Array.from({ length: height }, () => Array.from({ length: width }, () => 'wall' as Tile));
  for (const [x, y] of floors) terrain[y][x] = 'floor';
  return { width, height, terrain, rooms, exit: floors[0] ? { x: floors[0][0], y: floors[0][1] } : { x: 0, y: 0 } };
}

describe('detector unit tests - allowed shapes', () => {
  it('allows a 2x2 block fully inside a single room', () => {
    const room: Room = { x: 2, y: 2, width: 4, height: 4 };
    const floors: [number, number][] = [];
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) floors.push([x, y]);
    const map = buildTestMap(10, 10, floors, [room]);
    expect(findForbiddenFloorBlocks(map)).toEqual([]);
  });

  it('allows a 1-wide straight corridor', () => {
    const floors: [number, number][] = [];
    for (let x = 1; x <= 8; x++) floors.push([x, 4]);
    const map = buildTestMap(10, 10, floors);
    expect(findForbiddenFloorBlocks(map)).toEqual([]);
  });

  it('allows a 1-wide L-bend', () => {
    const floors: [number, number][] = [];
    for (let x = 1; x <= 5; x++) floors.push([x, 2]);
    for (let y = 2; y <= 7; y++) floors.push([5, y]);
    const map = buildTestMap(10, 10, floors);
    expect(findForbiddenFloorBlocks(map)).toEqual([]);
  });

  it('allows a T-junction converging on a single center tile', () => {
    const floors: [number, number][] = [];
    for (let x = 1; x <= 8; x++) floors.push([x, 4]); // horizontal
    for (let y = 0; y <= 4; y++) floors.push([4, y]); // vertical meeting at (4,4)
    const map = buildTestMap(10, 10, floors);
    expect(findForbiddenFloorBlocks(map)).toEqual([]);
  });

  it('allows a cross (X) junction converging on a single center tile', () => {
    const floors: [number, number][] = [];
    for (let x = 1; x <= 8; x++) floors.push([x, 4]);
    for (let y = 1; y <= 8; y++) floors.push([4, y]);
    const map = buildTestMap(10, 10, floors);
    expect(findForbiddenFloorBlocks(map)).toEqual([]);
  });
});

describe('detector unit tests - forbidden shapes', () => {
  it('flags a plain 2x2 floor block outside any room', () => {
    const map = buildTestMap(10, 10, [
      [4, 4], [5, 4], [4, 5], [5, 5],
    ]);
    expect(findForbiddenFloorBlocks(map).length).toBeGreaterThan(0);
  });

  it('flags a 2x2 block straddling a room boundary', () => {
    const room: Room = { x: 2, y: 2, width: 3, height: 3 }; // x2-4, y2-4
    // (4,4) is the room's bottom-right corner; (5,4),(4,5),(5,5) are outside it.
    const map = buildTestMap(10, 10, [
      [4, 4], [5, 4], [4, 5], [5, 5],
    ], [room]);
    expect(findForbiddenFloorBlocks(map).length).toBeGreaterThan(0);
  });

  it('flags a short two-corridor side-by-side contact', () => {
    const floors: [number, number][] = [];
    for (let y = 1; y <= 6; y++) floors.push([4, y]);
    for (let y = 3; y <= 4; y++) floors.push([5, y]); // 1-tile-long parallel stub next to the main corridor
    const map = buildTestMap(10, 10, floors);
    expect(findForbiddenFloorBlocks(map).length).toBeGreaterThan(0);
  });

  it('flags a 2x2 block that happens to include a room-less relay tile', () => {
    // A relay is just a floor tile with no room; a 2x2 touching it is still forbidden.
    const map = buildTestMap(10, 10, [
      [4, 4], [5, 4], [4, 5], [5, 5],
    ]);
    expect(findForbiddenFloorBlocks(map).length).toBeGreaterThan(0);
  });

  it('flags a 2x2 block formed by two segments of the same connection (pathA/pathB)', () => {
    // Simulates the historical bug: pathA ends with a vertical run and pathB
    // also runs vertically one column over across the same rows.
    const floors: [number, number][] = [
      [3, 5], [3, 6], [3, 7],
      [4, 5], [4, 6], [4, 7],
    ];
    const map = buildTestMap(10, 10, floors);
    expect(findForbiddenFloorBlocks(map).length).toBeGreaterThan(0);
  });
});
