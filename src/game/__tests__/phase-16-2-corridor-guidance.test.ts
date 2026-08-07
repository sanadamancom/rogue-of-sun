import { describe, expect, it } from 'vitest';
import { generateMap, getRoomCorridorEntrances, roomIndexContaining } from '../mapgen';
import { GameMap, Room } from '../types';

/**
 * Phase 16.2 corridor guidance (tester feedback: "大きな部屋に入った際、
 * 進める通路の最初の1マスが見えると進みやすい"): getRoomCorridorEntrances
 * finds every corridor's first floor tile immediately outside a room's
 * boundary. This is the pure, testable piece of the feature; main.ts
 * wires it into explored-tile marking (Phaser/DOM, not covered by this
 * vitest suite — see docs/history/phase-16-early-game-balance.md's
 * Phase 16.2 section for how that wiring was verified instead).
 */

// Three fixed seeds confirmed (via a one-off scan) to each generate at
// least one room at or near Phase 16's largest allowed size (width 6-11,
// height 5-9), per the diagnosis requirement to check large-room seeds
// specifically.
const LARGE_ROOM_SEEDS = [6, 9, 10];

function assertEveryReturnedTileIsFloorJustOutsideRoom(map: GameMap, room: Room, entrances: { x: number; y: number }[]) {
  for (const tile of entrances) {
    expect(map.terrain[tile.y][tile.x]).toBe('floor');
    // Must be strictly outside the room's own rectangle...
    const insideRoom = tile.x >= room.x && tile.x < room.x + room.width && tile.y >= room.y && tile.y < room.y + room.height;
    expect(insideRoom).toBe(false);
    // ...but exactly one ring outside it (directly adjacent to one edge),
    // never two-or-more tiles away.
    const withinOneRingX = tile.x >= room.x - 1 && tile.x <= room.x + room.width;
    const withinOneRingY = tile.y >= room.y - 1 && tile.y <= room.y + room.height;
    expect(withinOneRingX && withinOneRingY).toBe(true);
  }
}

describe('getRoomCorridorEntrances', () => {
  it('finds at least one entrance for every room, for 3 fixed seeds with a large room (Phase 16 max size)', () => {
    for (const seed of LARGE_ROOM_SEEDS) {
      const { ok, map } = generateMap(seed);
      expect(ok).toBe(true);
      for (const room of map!.rooms) {
        const entrances = getRoomCorridorEntrances(map!, room);
        expect(entrances.length).toBeGreaterThan(0);
        assertEveryReturnedTileIsFloorJustOutsideRoom(map!, room, entrances);
      }
    }
  });

  it('a room with multiple doorways returns one entrance tile per doorway', () => {
    // seed 6's first room (10x9) has 3 sibling large rooms nearby, making
    // multiple connections likely; assert generically across all rooms
    // that entrance count matches a direct re-scan (no double-counting,
    // no missed doorway) rather than hardcoding a specific room's count.
    const { ok, map } = generateMap(6);
    expect(ok).toBe(true);
    for (const room of map!.rooms) {
      const entrances = getRoomCorridorEntrances(map!, room);
      const perimeterFloorTiles = countPerimeterFloorTiles(map!, room);
      expect(entrances.length).toBe(perimeterFloorTiles);
    }
  });

  it('never returns a tile belonging to another room (rooms never touch, per the doorway rule)', () => {
    for (const seed of LARGE_ROOM_SEEDS) {
      const { ok, map } = generateMap(seed);
      expect(ok).toBe(true);
      for (const room of map!.rooms) {
        const entrances = getRoomCorridorEntrances(map!, room);
        for (const tile of entrances) {
          const owningRoom = roomIndexContaining(map!.rooms, tile);
          expect(owningRoom).toBe(-1); // a doorway tile belongs to no room's rectangle
        }
      }
    }
  });

  it('never returns a wall tile', () => {
    for (const seed of LARGE_ROOM_SEEDS) {
      const { ok, map } = generateMap(seed);
      expect(ok).toBe(true);
      for (const room of map!.rooms) {
        for (const tile of getRoomCorridorEntrances(map!, room)) {
          expect(map!.terrain[tile.y][tile.x]).not.toBe('wall');
        }
      }
    }
  });

  it('returns nothing beyond the map edge (rooms flush against the border have no ring to scan on that side)', () => {
    // A minimal synthetic map where the room touches the top-left corner:
    // no north/west ring exists, so only south/east doorways (if any) can
    // ever be returned.
    const terrain = [
      ['floor', 'floor', 'floor', 'wall'],
      ['floor', 'floor', 'floor', 'wall'],
      ['wall', 'wall', 'floor', 'wall'],
    ];
    const map: GameMap = { width: 4, height: 3, terrain: terrain as GameMap['terrain'], rooms: [], exit: { x: 0, y: 0 } };
    const room: Room = { x: 0, y: 0, width: 2, height: 2 };
    const entrances = getRoomCorridorEntrances(map, room);
    expect(entrances).toEqual([
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]); // the two floor tiles on the room's east ring (row 2 of that column is a wall)
  });
});

function countPerimeterFloorTiles(map: GameMap, room: Room): number {
  let count = 0;
  if (room.y - 1 >= 0) {
    for (let x = room.x; x < room.x + room.width; x++) if (map.terrain[room.y - 1][x] === 'floor') count++;
  }
  if (room.y + room.height < map.height) {
    for (let x = room.x; x < room.x + room.width; x++) if (map.terrain[room.y + room.height][x] === 'floor') count++;
  }
  if (room.x - 1 >= 0) {
    for (let y = room.y; y < room.y + room.height; y++) if (map.terrain[y][room.x - 1] === 'floor') count++;
  }
  if (room.x + room.width < map.width) {
    for (let y = room.y; y < room.y + room.height; y++) if (map.terrain[y][room.x + room.width] === 'floor') count++;
  }
  return count;
}
