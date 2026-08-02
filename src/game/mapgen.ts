import { GameMap, Room, Tile, Vec2 } from './types';

// Section-based, deterministic dungeon generation. This module has no
// rendering dependency and never reads Date/Math.random state implicitly:
// all randomness flows from the seed passed in.
//
// Design reference: the section-first partitioning idea (split the map into
// a grid of sections, place at most one room per section, connect only
// orthogonally-adjacent sections, route corridors through section-local
// border points) is inspired by the general structure described in
// "いい感じにランダムで、いい感じに恣意的なランダムダンジョンを生成する"
// (https://qiita.com/kyooooooooma/items/a8ee1157b89b7f744098) and the
// accompanying sample repository RandomDungeonWithBluePrint
// (https://github.com/kyoma0220/RandomDungeonWithBluePrint). No code from
// either source was copied or ported; this file is an independent
// TypeScript implementation built around rogue-of-sun's own types, tests,
// and gameplay rules.

export const MAP_GEN_PARAMS = {
  width: 40,
  height: 30,
  outerWall: 1,
  sectionColumns: 3,
  sectionRows: 3,
  roomCount: { min: 6, max: 9 },
  roomWidth: { min: 4, max: 9 },
  roomHeight: { min: 4, max: 7 },
  sectionMargin: 1, // buffer kept between a room and its section's border
  extraConnections: { min: 1, max: 2 },
  maxGenerationAttempts: 50, // whole-map retries (new internal attempt number, same seed)
  maxConnectionAttempts: 20, // bounded alternate border points per connection
} as const;

/** Mulberry32 seeded PRNG: same seed + calls -> same sequence, always. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------------------------------------------------------------------
// Section partitioning
// ---------------------------------------------------------------------

export interface Section {
  id: number;
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Splits `total` into `parts` sizes as evenly as possible, with any remainder assigned to the earliest parts. */
function partitionSizes(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  const sizes: number[] = [];
  for (let i = 0; i < parts; i++) {
    sizes.push(base + (i < remainder ? 1 : 0));
  }
  return sizes;
}

/** Deterministically divides the interior (inside the outer wall) into a sectionColumns x sectionRows grid. */
function buildSections(): Section[] {
  const p = MAP_GEN_PARAMS;
  const interiorX = p.outerWall;
  const interiorY = p.outerWall;
  const interiorWidth = p.width - p.outerWall * 2;
  const interiorHeight = p.height - p.outerWall * 2;

  const colWidths = partitionSizes(interiorWidth, p.sectionColumns);
  const rowHeights = partitionSizes(interiorHeight, p.sectionRows);

  const colOffsets: number[] = [interiorX];
  for (let i = 0; i < colWidths.length; i++) colOffsets.push(colOffsets[i] + colWidths[i]);
  const rowOffsets: number[] = [interiorY];
  for (let i = 0; i < rowHeights.length; i++) rowOffsets.push(rowOffsets[i] + rowHeights[i]);

  const sections: Section[] = [];
  for (let row = 0; row < p.sectionRows; row++) {
    for (let col = 0; col < p.sectionColumns; col++) {
      sections.push({
        id: row * p.sectionColumns + col,
        col,
        row,
        x: colOffsets[col],
        y: rowOffsets[row],
        width: colWidths[col],
        height: rowHeights[row],
      });
    }
  }
  return sections;
}

function sectionAt(sections: Section[], col: number, row: number): Section | undefined {
  return sections.find((s) => s.col === col && s.row === row);
}

// ---------------------------------------------------------------------
// Rooms and relays
// ---------------------------------------------------------------------

/** A relay is a single-tile routing waypoint placed in a section that has no room. */
export type Relay = Vec2;

export interface SectionContent {
  section: Section;
  room: Room | null;
  relay: Relay | null;
}

/** Attempts to place a room inside `section`, respecting the section margin. Returns null if the section is too small. */
function placeRoomInSection(section: Section, rng: () => number): Room | null {
  const p = MAP_GEN_PARAMS;
  const availableWidth = section.width - p.sectionMargin * 2;
  const availableHeight = section.height - p.sectionMargin * 2;

  if (availableWidth < p.roomWidth.min || availableHeight < p.roomHeight.min) {
    return null; // section too small to fit even the minimum room size
  }

  const maxWidth = Math.min(p.roomWidth.max, availableWidth);
  const maxHeight = Math.min(p.roomHeight.max, availableHeight);
  const width = randInt(rng, p.roomWidth.min, maxWidth);
  const height = randInt(rng, p.roomHeight.min, maxHeight);

  const slackX = availableWidth - width;
  const slackY = availableHeight - height;
  const x = section.x + p.sectionMargin + (slackX > 0 ? randInt(rng, 0, slackX) : 0);
  const y = section.y + p.sectionMargin + (slackY > 0 ? randInt(rng, 0, slackY) : 0);

  return { x, y, width, height };
}

function placeRelayInSection(section: Section, rng: () => number): Relay | null {
  // Keep the relay off the section's outer edge so routing has room to move.
  if (section.width < 3 || section.height < 3) return null;
  const x = randInt(rng, section.x + 1, section.x + section.width - 2);
  const y = randInt(rng, section.y + 1, section.y + section.height - 2);
  return { x, y };
}

/** Decides which sections get a room (roomCount of them) and gives the rest a relay. Returns null on failure. */
function buildSectionContents(sections: Section[], rng: () => number): SectionContent[] | null {
  const p = MAP_GEN_PARAMS;
  const roomCount = randInt(rng, p.roomCount.min, p.roomCount.max);
  const order = shuffle(sections, rng);

  const contents = new Map<number, SectionContent>();
  let placed = 0;

  for (const section of order) {
    if (placed < roomCount) {
      const room = placeRoomInSection(section, rng);
      if (room) {
        contents.set(section.id, { section, room, relay: null });
        placed += 1;
        continue;
      }
      // Section too small for a room: fall through to relay instead, and
      // this section no longer counts toward the room target.
    }
    const relay = placeRelayInSection(section, rng);
    if (!relay) return null; // section too small for even a relay: explicit failure
    contents.set(section.id, { section, room: null, relay });
  }

  if (placed < p.roomCount.min) return null; // could not place the minimum required rooms

  return sections.map((s) => contents.get(s.id)!);
}

// ---------------------------------------------------------------------
// Connection graph (section adjacency)
// ---------------------------------------------------------------------

export interface SectionEdge {
  a: number;
  b: number;
}

function buildAdjacencyEdges(sections: Section[]): SectionEdge[] {
  const edges: SectionEdge[] = [];
  for (const section of sections) {
    const east = sectionAt(sections, section.col + 1, section.row);
    if (east) edges.push({ a: section.id, b: east.id });
    const south = sectionAt(sections, section.col, section.row + 1);
    if (south) edges.push({ a: section.id, b: south.id });
  }
  return edges;
}

class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

/** Builds a random spanning tree over the section adjacency graph (all 9 sections), plus 1-2 extra edges. */
function buildConnections(sections: Section[], rng: () => number): SectionEdge[] {
  const p = MAP_GEN_PARAMS;
  const allEdges = buildAdjacencyEdges(sections);
  const shuffled = shuffle(allEdges, rng);

  const uf = new UnionFind(sections.length);
  const treeEdges: SectionEdge[] = [];
  const treeKeys = new Set<string>();

  const edgeKey = (e: SectionEdge) => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;

  for (const edge of shuffled) {
    if (uf.union(edge.a, edge.b)) {
      treeEdges.push(edge);
      treeKeys.add(edgeKey(edge));
    }
  }

  const remaining = allEdges.filter((e) => !treeKeys.has(edgeKey(e)));
  const shuffledRemaining = shuffle(remaining, rng);
  const extraCount = Math.min(randInt(rng, p.extraConnections.min, p.extraConnections.max), remaining.length);
  const extraEdges = shuffledRemaining.slice(0, extraCount);

  return [...treeEdges, ...extraEdges];
}

// ---------------------------------------------------------------------
// Corridor routing (section-local)
// ---------------------------------------------------------------------

type Direction4 = 'N' | 'S' | 'E' | 'W';

function directionBetween(a: Section, b: Section): Direction4 {
  if (b.col === a.col + 1) return 'E';
  if (b.col === a.col - 1) return 'W';
  if (b.row === a.row + 1) return 'S';
  return 'N';
}

const OPPOSITE: Record<Direction4, Direction4> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** The single point where a corridor leaves a room's wall toward `direction`, or the relay point itself. */
function anchorPoint(content: SectionContent, direction: Direction4): Vec2 {
  if (content.room) {
    const room = content.room;
    const midY = Math.min(Math.max(room.y + Math.floor(room.height / 2), room.y + 1), room.y + room.height - 2);
    const midX = Math.min(Math.max(room.x + Math.floor(room.width / 2), room.x + 1), room.x + room.width - 2);
    switch (direction) {
      case 'E':
        return { x: room.x + room.width, y: midY };
      case 'W':
        return { x: room.x - 1, y: midY };
      case 'S':
        return { x: midX, y: room.y + room.height };
      case 'N':
        return { x: midX, y: room.y - 1 };
    }
  }
  // Relay: no walls, the relay tile itself is the anchor.
  return { ...content.relay! };
}

/**
 * Returns true if the 2x2 block whose top-left corner is (x, y) is fully
 * floor AND fully contained within a single room. A 2x2 block is allowed
 * only when this holds; every other all-floor 2x2 block (outside any room,
 * straddling a room boundary, touching a relay, or formed by two different
 * corridor segments) is forbidden. Normal 1-wide lines, L-bends, and
 * single-tile T/X junctions never fill all four corners of a 2x2 block, so
 * this check does not over-flag ordinary corridor shapes.
 */
function isAllowed2x2Block(terrain: Tile[][], rooms: Room[], x: number, y: number, width: number, height: number): boolean {
  if (x < 0 || y < 0 || x + 1 >= width || y + 1 >= height) return true; // out of range: nothing to check
  const allFloor =
    terrain[y][x] === 'floor' &&
    terrain[y][x + 1] === 'floor' &&
    terrain[y + 1][x] === 'floor' &&
    terrain[y + 1][x + 1] === 'floor';
  if (!allFloor) return true;
  return rooms.some((r) => x >= r.x && x + 1 < r.x + r.width && y >= r.y && y + 1 < r.y + r.height);
}

/**
 * Checks whether carving `path` onto `terrain` (which already reflects all
 * previously-carved rooms, relays, and corridors) would create any
 * forbidden 2x2 floor block touching one of the new tiles. Only blocks
 * touching a newly-carved tile need checking, since pre-existing terrain
 * was already validated when it was carved.
 */
function isRouteValid(terrain: Tile[][], rooms: Room[], path: Vec2[], width: number, height: number): boolean {
  for (const tile of path) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) return false;
  }

  const tempTerrain = terrain.map((row) => row.slice());
  carvePath(tempTerrain, path);

  const checked = new Set<string>();
  for (const tile of path) {
    for (const dx of [-1, 0]) {
      for (const dy of [-1, 0]) {
        const bx = tile.x + dx;
        const by = tile.y + dy;
        const key = `${bx},${by}`;
        if (checked.has(key)) continue;
        checked.add(key);
        if (!isAllowed2x2Block(tempTerrain, rooms, bx, by, width, height)) return false;
      }
    }
  }
  return true;
}

/** Builds the ordered tile sequence for an L-shaped path between two points (inclusive of endpoints, de-duplicated). */
function buildLPath(from: Vec2, to: Vec2, horizontalFirst: boolean): Vec2[] {
  const path: Vec2[] = [];
  const pushRange = (fixed: number, a: number, b: number, vertical: boolean) => {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    for (let v = lo; v <= hi; v++) path.push(vertical ? { x: fixed, y: v } : { x: v, y: fixed });
  };

  if (horizontalFirst) {
    pushRange(from.y, from.x, to.x, false);
    pushRange(to.x, from.y, to.y, true);
  } else {
    pushRange(from.x, from.y, to.y, true);
    pushRange(to.y, from.x, to.x, false);
  }

  const seen = new Set<string>();
  return path.filter((p) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function carvePath(terrain: Tile[][], path: Vec2[]): void {
  for (const tile of path) terrain[tile.y][tile.x] = 'floor';
}

/**
 * Routes a single section-to-section connection. The corridor travels from
 * the source anchor to a border point inside the source section, crosses
 * directly into the neighboring section (adjacent tiles, since sections
 * tile the map with no gap), then travels from the border to the
 * destination anchor inside the destination section. All bends happen
 * within their own section. Tries a bounded number of alternate border
 * points/orientations before giving up (returns null).
 */
function routeConnection(
  terrain: Tile[][],
  rooms: Room[],
  sectionA: Section,
  sectionB: Section,
  contentA: SectionContent,
  contentB: SectionContent,
  rng: () => number,
  width: number,
  height: number,
): Vec2[] | null {
  const dirAtoB = directionBetween(sectionA, sectionB);
  const dirBtoA = OPPOSITE[dirAtoB];
  const anchorA = anchorPoint(contentA, dirAtoB);
  const anchorB = anchorPoint(contentB, dirBtoA);

  const horizontal = dirAtoB === 'E' || dirAtoB === 'W';

  const rangeLo = horizontal ? Math.max(sectionA.y, sectionB.y) + 1 : Math.max(sectionA.x, sectionB.x) + 1;
  const rangeHi = horizontal
    ? Math.min(sectionA.y + sectionA.height, sectionB.y + sectionB.height) - 2
    : Math.min(sectionA.x + sectionA.width, sectionB.x + sectionB.width) - 2;

  if (rangeLo > rangeHi) return null;

  const borderColA = dirAtoB === 'E' ? sectionA.x + sectionA.width - 1 : sectionA.x;
  const borderColB = dirAtoB === 'E' ? sectionB.x : sectionB.x + sectionB.width - 1;
  const borderRowA = dirAtoB === 'S' ? sectionA.y + sectionA.height - 1 : sectionA.y;
  const borderRowB = dirAtoB === 'S' ? sectionB.y : sectionB.y + sectionB.height - 1;

  const p = MAP_GEN_PARAMS;

  // For a room-anchored side, the orientation is not a free choice: the
  // wall-normal axis (the anchor's fixed coordinate) must be the *last*
  // step taken, so the corridor only ever touches the room at the single
  // intended doorway tile instead of running alongside its wall. A
  // relay has no wall to hug, so both orientations remain safe to try.
  const orientsA: boolean[] = contentA.room ? [horizontal] : [true, false];
  const orientsB: boolean[] = contentB.room ? [!horizontal] : [true, false];

  for (let attempt = 0; attempt < p.maxConnectionAttempts; attempt++) {
    const coord = rangeHi === rangeLo ? rangeLo : randInt(rng, rangeLo, rangeHi);

    const borderPointA: Vec2 = horizontal ? { x: borderColA, y: coord } : { x: coord, y: borderRowA };
    const borderPointB: Vec2 = horizontal ? { x: borderColB, y: coord } : { x: coord, y: borderRowB };

    for (const orientA of orientsA) {
      const pathA = buildLPath(anchorA, borderPointA, orientA);
      if (!isRouteValid(terrain, rooms, pathA, width, height)) continue;

      // Validate pathB against a terrain copy that already includes pathA,
      // so contact between the two segments of *this same* connection
      // (including the historical pathA/pathB parallel-run bug) is caught
      // exactly like contact with any other, unrelated corridor or room.
      const tempTerrain = terrain.map((row) => row.slice());
      carvePath(tempTerrain, pathA);

      for (const orientB of orientsB) {
        const pathB = buildLPath(borderPointB, anchorB, orientB);
        if (!isRouteValid(tempTerrain, rooms, pathB, width, height)) continue;

        return [...pathA, ...pathB];
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------
// Full generation
// ---------------------------------------------------------------------

export interface MapGenResult {
  ok: boolean;
  map?: GameMap;
  roomCount?: number;
}

/** Internal generation state, exposed read-only for tests that need to inspect sections/relays/connections directly. */
export interface GenerationDebugInfo {
  ok: boolean;
  sections: Section[];
  contents: SectionContent[] | null;
  connections: SectionEdge[] | null;
  map?: GameMap;
}

function tryGenerateOnceDebug(rng: () => number): GenerationDebugInfo {
  const p = MAP_GEN_PARAMS;
  const sections = buildSections();
  const contents = buildSectionContents(sections, rng);
  if (!contents) return { ok: false, sections, contents: null, connections: null };

  const rooms: Room[] = contents.filter((c) => c.room).map((c) => c.room!);
  if (rooms.length < p.roomCount.min) return { ok: false, sections, contents, connections: null };

  const terrain: Tile[][] = Array.from({ length: p.height }, () =>
    Array.from({ length: p.width }, () => 'wall' as Tile),
  );
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) terrain[y][x] = 'floor';
    }
  }
  for (const content of contents) {
    if (content.relay) terrain[content.relay.y][content.relay.x] = 'floor';
  }

  const connections = buildConnections(sections, rng);
  const contentBySection = new Map(contents.map((c) => [c.section.id, c]));

  for (const edge of connections) {
    const sectionA = sections[edge.a];
    const sectionB = sections[edge.b];
    const contentA = contentBySection.get(edge.a)!;
    const contentB = contentBySection.get(edge.b)!;
    const path = routeConnection(terrain, rooms, sectionA, sectionB, contentA, contentB, rng, p.width, p.height);
    if (!path) return { ok: false, sections, contents, connections };
    carvePath(terrain, path);
  }

  const exit = roomCenter(rooms[rooms.length - 1]);
  const map: GameMap = { width: p.width, height: p.height, terrain, rooms, exit };
  return { ok: true, sections, contents, connections, map };
}

/** Test/debug entry point: runs a single (non-retrying) generation attempt for `seed` and returns internal state. */
export function generateMapDebug(seed: number): GenerationDebugInfo {
  const rng = createRng(seed);
  return tryGenerateOnceDebug(rng);
}

function tryGenerateOnce(rng: () => number): MapGenResult {
  const debugInfo = tryGenerateOnceDebug(rng);
  const roomCount = debugInfo.contents?.filter((c) => c.room).length;
  if (!debugInfo.ok) return { ok: false, roomCount };
  return { ok: true, map: debugInfo.map, roomCount };
}

export function roomCenter(room: Room): Vec2 {
  return {
    x: room.x + Math.floor(room.width / 2),
    y: room.y + Math.floor(room.height / 2),
  };
}

/** BFS distance map (in floor steps) from `start`, keyed by "x,y"; unreachable tiles are absent. */
export function bfsDistances(map: GameMap, start: Vec2): Map<string, number> {
  const key = (p: Vec2) => `${p.x},${p.y}`;
  const dist = new Map<string, number>([[key(start), 0]]);
  const queue: Vec2[] = [start];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(key(cur))!;
    const neighbors = [
      { x: cur.x + 1, y: cur.y },
      { x: cur.x - 1, y: cur.y },
      { x: cur.x, y: cur.y + 1 },
      { x: cur.x, y: cur.y - 1 },
    ];
    for (const n of neighbors) {
      if (n.x < 0 || n.y < 0 || n.x >= map.width || n.y >= map.height) continue;
      if (map.terrain[n.y][n.x] !== 'floor') continue;
      const k = key(n);
      if (!dist.has(k)) {
        dist.set(k, d + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

export interface Placement {
  start: Vec2;
  exit: Vec2;
  enemies: Vec2[];
}

/**
 * Number of enemies placed on every normal floor (fixed, no per-floor
 * scaling). Reverted to the pre-Phase-06 value of 2 per
 * enemy-roster-density-correction: showing every registered species at
 * once must not be achieved by inflating normal floor density (see
 * choosePlacement's `count` parameter and state.ts's
 * buildRosterPreviewFloorState for the test-only way to see all species
 * together).
 */
export const ENEMY_COUNT_PER_FLOOR = 2;

/**
 * Chooses start (in the first room), exit (in the room whose center is
 * farthest by floor-path distance from start, guaranteed to be a
 * different room), and `count` enemy tiles that are each reachable, not on
 * start or exit, not on each other, and not adjacent to start. Selection is
 * deterministic given `rng` (the floor's placement RNG) and never falls
 * back to a reduced enemy count: if the map does not offer enough valid
 * candidate tiles, this throws explicitly rather than silently placing
 * fewer enemies.
 *
 * `count` defaults to ENEMY_COUNT_PER_FLOOR (normal play); callers may pass
 * a larger value for test-only/dev-only purposes (e.g. a roster preview
 * that places all 9 species at once) without changing normal generation.
 */
export function choosePlacement(
  map: GameMap,
  rng: () => number,
  count: number = ENEMY_COUNT_PER_FLOOR,
): Placement {
  const start = roomCenter(map.rooms[0]);
  const distFromStart = bfsDistances(map, start);
  const key = (p: Vec2) => `${p.x},${p.y}`;

  let exitRoomIndex = 1 % map.rooms.length;
  let bestDist = -1;
  for (let i = 0; i < map.rooms.length; i++) {
    if (i === 0) continue;
    const center = roomCenter(map.rooms[i]);
    const d = distFromStart.get(key(center)) ?? -1;
    if (d > bestDist) {
      bestDist = d;
      exitRoomIndex = i;
    }
  }
  const exit = roomCenter(map.rooms[exitRoomIndex]);

  const candidates: Vec2[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.terrain[y][x] !== 'floor') continue;
      const pos = { x, y };
      if (!distFromStart.has(key(pos))) continue;
      if (pos.x === start.x && pos.y === start.y) continue;
      if (pos.x === exit.x && pos.y === exit.y) continue;
      const dx = Math.abs(pos.x - start.x);
      const dy = Math.abs(pos.y - start.y);
      const adjacentToStart = dx <= 1 && dy <= 1;
      if (adjacentToStart) continue;
      candidates.push(pos);
    }
  }

  if (candidates.length < count) {
    throw new Error(
      `Not enough valid enemy placement candidates: need ${count}, found ${candidates.length}`,
    );
  }

  // Deterministic sampling without replacement: repeatedly pick a random
  // remaining candidate and swap it to the front, consuming rng() exactly
  // once per enemy in a fixed order, so results stay reproducible for a
  // given rng sequence regardless of pool size.
  const pool = candidates.slice();
  const enemies: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const remaining = pool.length - i;
    const pickIndex = i + Math.floor(rng() * remaining);
    const picked = pool[pickIndex];
    pool[pickIndex] = pool[i];
    pool[i] = picked;
    enemies.push(picked);
  }

  return { start, exit, enemies };
}

/**
 * Chooses a single deterministic reachable-floor tile for a ground item
 * (Phase 08.2 apple placement), excluding every position in `exclude`
 * (player start, exit, and every live enemy position). Uses `rng` — the
 * caller passes an independent RNG stream (its own derived seed) so item
 * placement never perturbs the existing map-generation/enemy-placement RNG
 * sequences or their consumption order. Throws explicitly (never silently
 * places nothing, never loops indefinitely) if no valid candidate tile
 * exists.
 */
export function chooseGroundItemPosition(
  map: GameMap,
  start: Vec2,
  exclude: Vec2[],
  rng: () => number,
): Vec2 {
  const distFromStart = bfsDistances(map, start);
  const key = (p: Vec2) => `${p.x},${p.y}`;
  const excluded = new Set(exclude.map(key));

  const candidates: Vec2[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (map.terrain[y][x] !== 'floor') continue;
      const pos = { x, y };
      if (!distFromStart.has(key(pos))) continue;
      if (excluded.has(key(pos))) continue;
      candidates.push(pos);
    }
  }

  if (candidates.length === 0) {
    throw new Error('No valid ground item placement candidates found.');
  }

  const pickIndex = Math.floor(rng() * candidates.length);
  return candidates[pickIndex];
}

/**
 * Chooses a single deterministic room-interior floor tile for the slow
 * trap (Phase 12.2), or `null` if no candidate satisfies every
 * constraint (fixed_specification.trap.placement's "条件を満たす候補が
 * ない場合だけ配置なしを許可し、理由を記録する" — this doc comment is
 * that record: this codebase has no runtime logging path for generation
 * decisions, so the "reason" a floor ends up with no trap is simply
 * "the constraints below left zero candidates on this particular
 * generated map", which the caller (state.ts's buildFloorState) accepts
 * by placing no trap that floor rather than retrying or throwing).
 *
 * Restricted to `rooms` rectangles only (never corridors/doorways — see
 * doorway-rule.test.ts's finding that doorway tiles always lie strictly
 * outside a room's own rectangle, so scanning only room interiors
 * automatically excludes every corridor and doorway tile without needing
 * a separate corridor-detection pass), excluding every tile in `exclude`
 * (start/exit/every enemy position/every already-placed ground item, by
 * convention matching chooseGroundItemPosition's caller), at least 4
 * tiles (Manhattan) from `start` and at least 2 tiles (Manhattan) from
 * `exit`. Candidates are gathered in a fixed order (rooms in `rooms`'
 * existing deterministic order, then row-major within each room) so the
 * single rng() draw among them stays reproducible for a given seed.
 */
export function chooseTrapPosition(
  map: GameMap,
  rooms: Room[],
  start: Vec2,
  exit: Vec2,
  exclude: Vec2[],
  rng: () => number,
): Vec2 | null {
  const key = (p: Vec2) => `${p.x},${p.y}`;
  const excluded = new Set(exclude.map(key));

  const candidates: Vec2[] = [];
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        if (map.terrain[y][x] !== 'floor') continue;
        const pos = { x, y };
        if (excluded.has(key(pos))) continue;
        const manhattanFromStart = Math.abs(x - start.x) + Math.abs(y - start.y);
        if (manhattanFromStart < 4) continue;
        const manhattanFromExit = Math.abs(x - exit.x) + Math.abs(y - exit.y);
        if (manhattanFromExit < 2) continue;
        candidates.push(pos);
      }
    }
  }

  if (candidates.length === 0) return null;

  const pickIndex = Math.floor(rng() * candidates.length);
  return candidates[pickIndex];
}

/**
 * Generates a section-based room-and-corridor map deterministically from
 * `seed`. Retries deterministically (seed does not change, only an internal
 * attempt counter mixed in) up to maxGenerationAttempts before returning an
 * explicit failure. Seed compatibility with the previous (pre-section)
 * generator is not maintained or required.
 */
export function generateMap(seed: number): MapGenResult {
  for (let attempt = 0; attempt < MAP_GEN_PARAMS.maxGenerationAttempts; attempt++) {
    const rng = createRng(seed + attempt * 0x9e3779b1);
    const result = tryGenerateOnce(rng);
    if (result.ok) return result;
  }
  return { ok: false };
}
