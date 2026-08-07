/**
 * Phase 17.1 — production visibility (FOV) module.
 *
 * Pure functions only: reads `GameMap`/`Room`, never mutates `GameState`,
 * never touches Canvas/DOM, never calls rng(). Combines two independently
 * verified pieces of logic:
 *
 *  1. A from-scratch "symmetric shadowcasting" implementation (general
 *     algorithmic idea only — no external library or repo code copied or
 *     adapted; see docs/history/phase-17-visibility-dark-areas.md for the
 *     Phase 17.0 comparison that motivated it). Scans the four cardinal
 *     quadrants around the origin row-by-row using exact integer-fraction
 *     slope comparisons (no floating point), so a wall tile's own near
 *     face is always revealed but nothing behind it is, and visibility
 *     leaking around a corner into a perpendicular corridor leg (the
 *     Phase 17.0 finding against plain ray casting / flood fill) does not
 *     happen — a row can only continue past a wall/floor boundary within
 *     the slope interval carved out by that boundary.
 *  2. This repository's own existing diagonal corner-cutting rule
 *     (map.ts's isDiagonalCornerOpen, already used for movement and melee
 *     legality) applied to sight instead of movement: a candidate tile is
 *     only ever considered visible if some sequence of legal single-step
 *     moves (by the exact same corner rule) reaches it within the radius.
 *     Shadowcasting alone does not encode this repo's specific "both
 *     corner tiles must be walkable" diagonal rule, so intersecting with
 *     this reachability set is what keeps sight and movement consistent
 *     (fixed_specification's "ゲームの角抜け禁止規則と矛盾しない").
 *
 * The final currently-visible set is the intersection of both. Room
 * interiors use a separate, non-radius rule (`roomVisibleTiles`): the
 * whole room plus each connected corridor's first tile, matching Phase
 * 16.2's existing intent (previously implemented ad hoc in main.ts via
 * markCameraWindowExplored + getRoomCorridorEntrances; this module is now
 * the single source of truth called by both production and its tests).
 */
import { GameMap, Room, Vec2 } from './types';
import { isInBounds, isDiagonalCornerOpen } from './map';

export type TileVisibility = 'unexplored' | 'explored_not_visible' | 'currently_visible';

/** Default corridor FOV radius (Chebyshev), per Phase 17.1's fixed_specification. */
export const CORRIDOR_VISIBILITY_RADIUS = 4;

export function pointKey(p: Vec2): string {
  return `${p.x},${p.y}`;
}

function keyToPoint(key: string): Vec2 {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

export function chebyshevDistance(a: Vec2, b: Vec2): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isWallOrOutOfBounds(map: GameMap, p: Vec2): boolean {
  if (!isInBounds(map, p)) return true;
  return map.terrain[p.y][p.x] === 'wall';
}

// ---------------------------------------------------------------------
// Symmetric shadowcasting: four 90° quadrants (north/south/east/west),
// each scanned as a stack of rows moving away from the origin along that
// quadrant's primary axis, with `col` the perpendicular offset. Using 4
// quadrants (rather than the more traditional 8 octants) is sufficient
// here because within a quadrant the slope interval already spans the
// full range needed on both sides of the primary axis — no separate
// "transpose" split is required.
// ---------------------------------------------------------------------

interface Quadrant {
  transform(depth: number, col: number): Vec2;
}

function makeQuadrants(origin: Vec2): Quadrant[] {
  return [
    { transform: (depth, col) => ({ x: origin.x + col, y: origin.y - depth }) }, // north
    { transform: (depth, col) => ({ x: origin.x + col, y: origin.y + depth }) }, // south
    { transform: (depth, col) => ({ x: origin.x + depth, y: origin.y + col }) }, // east
    { transform: (depth, col) => ({ x: origin.x - depth, y: origin.y + col }) }, // west
  ];
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}
function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / b);
}

/**
 * One row of a quadrant scan, `depth` tiles from the origin along the
 * quadrant's primary axis, restricted to the slope interval
 * [startNum/startDen, endNum/endDen] (both denominators always positive).
 * Recurses into `depth + 1` for each contiguous floor run once a
 * wall/floor or floor/wall boundary narrows the interval — this is the
 * "symmetric" part: the boundary slope used to narrow the interval is
 * computed identically regardless of which side of the boundary produced
 * it, which is what keeps "A sees B" and "B sees A" symmetric.
 */
function scanRow(
  map: GameMap,
  radius: number,
  quadrant: Quadrant,
  depth: number,
  startNum: number,
  startDen: number,
  endNum: number,
  endDen: number,
  visible: Set<string>,
): void {
  if (depth > radius) return;
  if (startNum * endDen > endNum * startDen) return; // start_slope > end_slope: empty interval

  const minCol = floorDiv(2 * startNum * depth + startDen, 2 * startDen);
  const maxCol = ceilDiv(2 * endNum * depth - endDen, 2 * endDen);

  let curStartNum = startNum;
  const curStartDen = startDen;
  let prevWall: boolean | null = null;

  for (let col = minCol; col <= maxCol; col++) {
    const p = quadrant.transform(depth, col);
    const blocked = isWallOrOutOfBounds(map, p);
    const symmetric = curStartNum * depth <= col * curStartDen && col * endDen <= endNum * depth;

    if (isInBounds(map, p) && (blocked || symmetric)) {
      visible.add(pointKey(p));
    }

    if (prevWall === true && !blocked) {
      // Wall -> floor boundary: everything from here on (this row) starts
      // fresh from this boundary's slope.
      curStartNum = 2 * col - 1;
    }
    if (prevWall === false && blocked) {
      // Floor -> wall boundary: the run that just ended continues into
      // the next row, capped at this boundary's slope.
      scanRow(map, radius, quadrant, depth + 1, curStartNum, curStartDen, 2 * col - 1, 2 * depth, visible);
    }
    prevWall = blocked;
  }

  if (prevWall === false) {
    // Row ended on an open (in-interval) floor run with no closing wall:
    // continue straight into the next row at the same interval.
    scanRow(map, radius, quadrant, depth + 1, curStartNum, curStartDen, endNum, endDen, visible);
  }
}

/**
 * Raw symmetric-shadowcasting visible set from `origin` out to `radius`
 * (Chebyshev), before the corner-rule reachability filter below. Exported
 * mainly so tests can inspect shadowcasting in isolation; production
 * visibility always goes through `computeCorridorVisibility`.
 */
export function shadowcastVisibleTiles(map: GameMap, origin: Vec2, radius: number): Vec2[] {
  const visible = new Set<string>();
  if (isInBounds(map, origin)) visible.add(pointKey(origin));
  for (const quadrant of makeQuadrants(origin)) {
    scanRow(map, radius, quadrant, 1, -1, 1, 1, 1, visible);
  }
  return [...visible].map(keyToPoint);
}

// ---------------------------------------------------------------------
// Corner-rule reachability: a breadth-first walk from origin, admitting a
// step only when it doesn't cut a diagonal corner illegally (reusing
// map.ts's own isDiagonalCornerOpen — the exact same rule movement and
// melee attacks already use), and never continuing past a wall.
// ---------------------------------------------------------------------

const ALL_8_STEPS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function legallyReachableTiles(map: GameMap, origin: Vec2, radius: number): Set<string> {
  const visited = new Set<string>();
  if (!isInBounds(map, origin)) return visited;
  visited.add(pointKey(origin));
  const queue: Vec2[] = [origin];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentIsWall = isInBounds(map, current) && map.terrain[current.y][current.x] === 'wall';
    // A wall tile is a valid endpoint (its near face is visible) but the
    // walk never continues *through* it.
    if (currentIsWall && pointKey(current) !== pointKey(origin)) continue;

    for (const [dx, dy] of ALL_8_STEPS) {
      const next: Vec2 = { x: current.x + dx, y: current.y + dy };
      if (!isInBounds(map, next)) continue;
      if (chebyshevDistance(origin, next) > radius) continue;
      const key = pointKey(next);
      if (visited.has(key)) continue;
      if (Math.abs(dx) === 1 && Math.abs(dy) === 1 && !isDiagonalCornerOpen(map, current, next)) continue;
      visited.add(key);
      queue.push(next);
    }
  }

  return visited;
}

/**
 * Corridor-side current visibility: symmetric shadowcasting intersected
 * with corner-rule-legal reachability, so a tile is only ever visible if
 * both (a) no wall/corner interval excludes it by angle, and (b) some
 * sequence of legal sight-steps (this repo's own diagonal corner rule)
 * reaches it within `radius`. Pure function: no RNG, no map mutation,
 * deterministic for a given (map, origin, radius).
 */
export function computeCorridorVisibility(map: GameMap, origin: Vec2, radius: number): Vec2[] {
  const shadow = shadowcastVisibleTiles(map, origin, radius);
  const reachable = legallyReachableTiles(map, origin, radius);
  return shadow.filter((p) => reachable.has(pointKey(p)));
}

// ---------------------------------------------------------------------
// Room / corridor-entrance visibility (Phase 16.2 rule, generalized).
// ---------------------------------------------------------------------

export function isInRoomBounds(room: Room, pos: Vec2): boolean {
  return pos.x >= room.x && pos.x < room.x + room.width && pos.y >= room.y && pos.y < room.y + room.height;
}

/**
 * Whole room interior plus, on each of the room's 4 straight sides, every
 * tile in the one-tile ring immediately outside it (both the room's own
 * bounding walls and any genuine single-tile corridor doorway — see
 * getRoomCorridorEntrances's doc comment in mapgen.ts for why every such
 * ring floor tile is guaranteed to be a real, isolated doorway belonging
 * only to this room). Deliberately excludes the four diagonal corner
 * cells of the ring (matching Phase 16.2's original entrance scan, which
 * never included them either) so no unconnected/ambiguous tile is ever
 * revealed "for free" just for being diagonally adjacent to the room.
 */
export function roomVisibleTiles(map: GameMap, room: Room): Vec2[] {
  const seen = new Set<string>();
  const tiles: Vec2[] = [];
  const push = (x: number, y: number) => {
    const p = { x, y };
    if (!isInBounds(map, p)) return;
    const key = pointKey(p);
    if (seen.has(key)) return;
    seen.add(key);
    tiles.push(p);
  };

  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) push(x, y);
  }
  for (let x = room.x; x < room.x + room.width; x++) {
    push(x, room.y - 1);
    push(x, room.y + room.height);
  }
  for (let y = room.y; y < room.y + room.height; y++) {
    push(room.x - 1, y);
    push(room.x + room.width, y);
  }

  return tiles;
}

// ---------------------------------------------------------------------
// Top-level entry point.
// ---------------------------------------------------------------------

/**
 * The player's full currently-visible tile set for this turn: whole-room
 * visibility while standing inside a room's rectangle (`rooms` — Phase
 * 16.2's "room activation" rule), otherwise radius-based corridor
 * visibility centered on `playerPos`. Pure function, no side effects.
 */
export function computeCurrentVisibility(map: GameMap, rooms: Room[], playerPos: Vec2, radius: number = CORRIDOR_VISIBILITY_RADIUS): Vec2[] {
  const room = rooms.find((r) => isInRoomBounds(r, playerPos));
  if (room) return roomVisibleTiles(map, room);
  return computeCorridorVisibility(map, playerPos, radius);
}
