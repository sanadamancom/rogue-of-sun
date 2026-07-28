import { describe, expect, it } from 'vitest';
import { generateMap } from '../mapgen';
import { GameMap, Room } from '../types';

/**
 * For each room, finds every floor tile immediately outside the room that
 * is adjacent to the room's boundary (a "doorway tile" candidate), grouped
 * by which wall side it's on. The doorway_rule requires each connection to
 * cross the wall at exactly one tile, and multiple doorways on the same
 * wall must not be adjacent to each other (no 2-wide entrance, no two
 * doorways touching).
 */
function doorwayTilesPerSide(map: GameMap, room: Room): Record<'N' | 'S' | 'E' | 'W', number[]> {
  const sides: Record<'N' | 'S' | 'E' | 'W', number[]> = { N: [], S: [], E: [], W: [] };

  // North wall: row above the room, columns spanning the room's width.
  if (room.y - 1 >= 0) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (map.terrain[room.y - 1][x] === 'floor') sides.N.push(x);
    }
  }
  // South wall: row below the room.
  if (room.y + room.height < map.height) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (map.terrain[room.y + room.height][x] === 'floor') sides.S.push(x);
    }
  }
  // West wall: column left of the room.
  if (room.x - 1 >= 0) {
    for (let y = room.y; y < room.y + room.height; y++) {
      if (map.terrain[y][room.x - 1] === 'floor') sides.W.push(y);
    }
  }
  // East wall: column right of the room.
  if (room.x + room.width < map.width) {
    for (let y = room.y; y < room.y + room.height; y++) {
      if (map.terrain[y][room.x + room.width] === 'floor') sides.E.push(y);
    }
  }

  return sides;
}

const SEEDS_100 = Array.from({ length: 100 }, (_, i) => i * 53 + 11);

describe('doorway rule - one tile per side, no adjacent doorways', () => {
  it('never has more than one contiguous doorway tile on the same wall side across 100 seeds', () => {
    const failures: { seed: number; roomIndex: number; side: string; coords: number[] }[] = [];
    for (const seed of SEEDS_100) {
      const { ok, map } = generateMap(seed);
      expect(ok).toBe(true);
      map!.rooms.forEach((room, roomIndex) => {
        const sides = doorwayTilesPerSide(map!, room);
        for (const side of ['N', 'S', 'E', 'W'] as const) {
          const coords = sides[side];
          if (coords.length === 0) continue;
          // Doorway tiles on the same side must not be adjacent to each
          // other (that would look like a 2-wide entrance or two doorways
          // merged together); each doorway is a single, isolated tile.
          const sorted = [...coords].sort((a, b) => a - b);
          for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] - sorted[i - 1] === 1) {
              failures.push({ seed, roomIndex, side, coords: sorted });
              break;
            }
          }
        }
      });
    }
    expect(failures).toEqual([]);
  });

  it('never carves a corridor tile along more than one point of the same wall run (no thick entrance)', () => {
    // A thick entrance would show up as a 2x2 forbidden floor block at the
    // room boundary; this is already covered by floor-block-geometry.test.ts,
    // so here we just confirm doorway tile counts stay low (1 per side used).
    const failures: { seed: number; roomIndex: number; side: string; count: number }[] = [];
    for (const seed of SEEDS_100) {
      const { ok, map } = generateMap(seed);
      expect(ok).toBe(true);
      map!.rooms.forEach((room, roomIndex) => {
        const sides = doorwayTilesPerSide(map!, room);
        for (const side of ['N', 'S', 'E', 'W'] as const) {
          if (sides[side].length > 1) {
            failures.push({ seed, roomIndex, side, count: sides[side].length });
          }
        }
      });
    }
    // Each section side connects to at most one neighbor, so each room wall
    // should have at most one doorway; more than one indicates unexpected
    // multi-point wall contact.
    expect(failures).toEqual([]);
  });
});
