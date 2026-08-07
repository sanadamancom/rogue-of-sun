/**
 * Phase 17.0 comparison prototype — this repository's own two
 * game-specific visibility rules (independent of which general FOV
 * candidate computes the radius-based corridor case): "normal room ==
 * whole room + each connected corridor's first tile" (Phase 16.2) and
 * "dark room == small fixed radius overriding the whole-room rule".
 * NOT used by production code. See grid.ts's header comment.
 */
import { Grid, Point, Room, isWall, pointKey } from './grid';

/**
 * Every floor tile inside `room`'s rectangle. The whole-room-visible
 * rule (this repo's existing behavior for ordinary rooms, predating
 * Phase 17) — a normal room's interior is always fully visible once the
 * player is standing in it, with no radius or occlusion computation
 * needed for the room's own floor.
 */
export function roomInteriorTiles(grid: Grid, room: Room): Point[] {
  const tiles: Point[] = [];
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (!isWall(grid, { x, y })) tiles.push({ x, y });
    }
  }
  return tiles;
}

/**
 * Every corridor tile immediately outside `room`'s boundary (Phase
 * 16.2's corridor-guidance rule, reimplemented standalone here for
 * fixture-only comparison — production's real implementation is
 * src/game/mapgen.ts's getRoomCorridorEntrances, not imported here so
 * this prototype has zero production coupling in either direction).
 */
export function roomCorridorEntrances(grid: Grid, room: Room): Point[] {
  const entrances: Point[] = [];
  const push = (x: number, y: number) => {
    if (!isWall(grid, { x, y })) entrances.push({ x, y });
  };
  for (let x = room.x; x < room.x + room.width; x++) {
    push(x, room.y - 1);
    push(x, room.y + room.height);
  }
  for (let y = room.y; y < room.y + room.height; y++) {
    push(room.x - 1, y);
    push(room.x + room.width, y);
  }
  return entrances;
}

/**
 * Normal-room visibility (candidate rule under evaluation): the whole
 * room interior plus each connected corridor's first tile. Independent
 * of which radius-based FOV candidate (ray casting / flood fill /
 * eventually shadowcasting) computes corridor-only visibility elsewhere
 * — this rule only applies while standing inside a room rectangle.
 */
export function normalRoomVisibility(grid: Grid, room: Room): Point[] {
  const seen = new Set<string>();
  const result: Point[] = [];
  for (const p of [...roomInteriorTiles(grid, room), ...roomCorridorEntrances(grid, room)]) {
    const key = pointKey(p);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(p);
    }
  }
  return result;
}
