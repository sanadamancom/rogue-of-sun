import { GameMap, Room, Tile, Vec2 } from './types';

// Pure, deterministic map generation. This module has no rendering
// dependency (no Phaser import) and never reads Date/Math.random state
// implicitly: all randomness flows from the seed passed in.

export const MAP_GEN_PARAMS = {
  width: 40,
  height: 30,
  targetRoomCount: { min: 6, max: 9 },
  roomInteriorSize: { minWidth: 4, maxWidth: 9, minHeight: 4, maxHeight: 7 },
  corridorWidth: 1,
  extraConnections: { min: 1, max: 2 },
  roomMargin: 1,
  maxPlacementAttempts: 500,
  maxGenerationAttempts: 50,
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

function roomsOverlap(a: Room, b: Room, margin: number): boolean {
  return (
    a.x - margin < b.x + b.width &&
    a.x + a.width + margin > b.x &&
    a.y - margin < b.y + b.height &&
    a.y + a.height + margin > b.y
  );
}

function generateRooms(rng: () => number): Room[] {
  const p = MAP_GEN_PARAMS;
  const targetCount = randInt(rng, p.targetRoomCount.min, p.targetRoomCount.max);
  const rooms: Room[] = [];

  for (let i = 0; i < p.maxPlacementAttempts && rooms.length < targetCount; i++) {
    const width = randInt(rng, p.roomInteriorSize.minWidth, p.roomInteriorSize.maxWidth);
    const height = randInt(rng, p.roomInteriorSize.minHeight, p.roomInteriorSize.maxHeight);
    // Leave 1-tile wall border around the whole map.
    const x = randInt(rng, 1, p.width - width - 1);
    const y = randInt(rng, 1, p.height - height - 1);
    const candidate: Room = { x, y, width, height };

    const overlaps = rooms.some((r) => roomsOverlap(candidate, r, p.roomMargin));
    if (!overlaps) {
      rooms.push(candidate);
    }
  }

  return rooms;
}

export function roomCenter(room: Room): Vec2 {
  return {
    x: room.x + Math.floor(room.width / 2),
    y: room.y + Math.floor(room.height / 2),
  };
}

function carveRoom(terrain: Tile[][], room: Room): void {
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      terrain[y][x] = 'floor';
    }
  }
}

function inAnyRoom(rooms: Room[], x: number, y: number): boolean {
  return rooms.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

/** Builds the ordered tile sequence for an L-shaped corridor between two points (inclusive of endpoints). */
function buildLPath(from: Vec2, to: Vec2, horizontalFirst: boolean): Vec2[] {
  const path: Vec2[] = [];
  const pushRange = (fixed: number, a: number, b: number, vertical: boolean) => {
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    for (let v = lo; v <= hi; v++) {
      path.push(vertical ? { x: fixed, y: v } : { x: v, y: fixed });
    }
  };

  if (horizontalFirst) {
    pushRange(from.y, from.x, to.x, false);
    pushRange(to.x, from.y, to.y, true);
  } else {
    pushRange(from.x, from.y, to.y, true);
    pushRange(to.y, from.x, to.x, false);
  }

  // De-duplicate the shared elbow tile while preserving order.
  const seen = new Set<string>();
  return path.filter((p) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Checks whether carving `path` would create unwanted side-by-side contact
 * with a *different*, already-carved corridor. Room floor is always an
 * allowed neighbor (expected near entrances). A tile that already coincides
 * with existing floor is treated as an intentional crossing/junction and is
 * not checked for adjacency conflicts. Neighbors that are part of this same
 * path (including the immediately preceding/following tile) are exempt.
 */
function isRouteValid(terrain: Tile[][], rooms: Room[], path: Vec2[], width: number, height: number): boolean {
  const pathSet = new Set(path.map((p) => `${p.x},${p.y}`));

  for (const tile of path) {
    if (inAnyRoom(rooms, tile.x, tile.y)) continue; // room interior, never a new carve target
    if (terrain[tile.y][tile.x] === 'floor') continue; // existing floor here: intentional crossing/junction

    const neighbors: Vec2[] = [
      { x: tile.x + 1, y: tile.y },
      { x: tile.x - 1, y: tile.y },
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x, y: tile.y - 1 },
    ];

    for (const n of neighbors) {
      if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) continue;
      if (inAnyRoom(rooms, n.x, n.y)) continue; // entrance-adjacent contact is expected
      if (pathSet.has(`${n.x},${n.y}`)) continue; // this corridor's own tile (bend, prev/next)
      if (terrain[n.y][n.x] === 'floor') return false; // side-by-side contact with a different corridor
    }
  }

  return true;
}

/** Small set of alternate connection points inside a room, used when the room-center route is blocked. */
function connectionCandidates(room: Room): Vec2[] {
  const center = roomCenter(room);
  const points: Vec2[] = [center];
  const offsets: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [dx, dy] of offsets) {
    const x = center.x + dx;
    const y = center.y + dy;
    if (x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height) {
      points.push({ x, y });
    }
  }
  return points;
}

/**
 * Finds a corridor path between two rooms that doesn't run alongside an
 * existing, different corridor. Tries both L-shape orientations from the
 * room centers first; if neither is valid, tries a bounded set of alternate
 * connection points within each room. Returns null (a deterministic,
 * bounded "no route found" result) rather than forcing an unconditional
 * carve or deleting floor after the fact.
 */
function findValidCorridorPath(
  terrain: Tile[][],
  rooms: Room[],
  roomA: Room,
  roomB: Room,
  rng: () => number,
  width: number,
  height: number,
): Vec2[] | null {
  const primaryFrom = roomCenter(roomA);
  const primaryTo = roomCenter(roomB);
  const primaryOrder: boolean[] = rng() < 0.5 ? [true, false] : [false, true];

  const tryOrientations = (from: Vec2, to: Vec2, orientations: boolean[]): Vec2[] | null => {
    for (const horizontalFirst of orientations) {
      const path = buildLPath(from, to, horizontalFirst);
      if (isRouteValid(terrain, rooms, path, width, height)) return path;
    }
    return null;
  };

  const primary = tryOrientations(primaryFrom, primaryTo, primaryOrder);
  if (primary) return primary;

  // Bounded fallback: try a small set of alternate entry/exit points within
  // each room (deterministic given the seeded rng's already-consumed state).
  const candidatesA = connectionCandidates(roomA);
  const candidatesB = connectionCandidates(roomB);
  let attempts = 0;
  const maxAttempts = 24;

  for (const a of candidatesA) {
    for (const b of candidatesB) {
      if (a.x === primaryFrom.x && a.y === primaryFrom.y && b.x === primaryTo.x && b.y === primaryTo.y) continue;
      if (attempts >= maxAttempts) return null;
      attempts += 1;
      const found = tryOrientations(a, b, [true, false]);
      if (found) return found;
    }
  }

  return null;
}

function carvePath(terrain: Tile[][], path: Vec2[]): void {
  for (const tile of path) {
    terrain[tile.y][tile.x] = 'floor';
  }
}

interface Edge {
  a: number;
  b: number;
  dist: number;
}

function buildEdges(centers: Vec2[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const dx = centers[i].x - centers[j].x;
      const dy = centers[i].y - centers[j].y;
      edges.push({ a: i, b: j, dist: Math.abs(dx) + Math.abs(dy) });
    }
  }
  return edges;
}

/** Builds a minimum spanning tree (Prim's algorithm) connecting all room indices. */
function minimumSpanningTree(centers: Vec2[]): [number, number][] {
  const edges = buildEdges(centers);
  const connected = new Set<number>([0]);
  const mstEdges: [number, number][] = [];

  while (connected.size < centers.length) {
    let best: Edge | null = null;
    for (const edge of edges) {
      const aIn = connected.has(edge.a);
      const bIn = connected.has(edge.b);
      if (aIn === bIn) continue; // need exactly one endpoint already connected
      if (!best || edge.dist < best.dist) best = edge;
    }
    if (!best) break; // should not happen with a complete graph
    mstEdges.push([best.a, best.b]);
    connected.add(best.a);
    connected.add(best.b);
  }

  return mstEdges;
}

/** Result of a single generation attempt; `ok: false` means it should be retried or reported as a failure. */
export interface MapGenResult {
  ok: boolean;
  map?: GameMap;
  roomCount?: number;
  /** True only when this attempt failed because a corridor route could not be found without unwanted contact. */
  corridorRouteFailure?: boolean;
}

function tryGenerateOnce(rng: () => number): MapGenResult {
  const p = MAP_GEN_PARAMS;
  const rooms = generateRooms(rng);

  if (rooms.length < p.targetRoomCount.min) {
    return { ok: false, roomCount: rooms.length };
  }

  const terrain: Tile[][] = Array.from({ length: p.height }, () =>
    Array.from({ length: p.width }, () => 'wall' as Tile),
  );

  for (const room of rooms) carveRoom(terrain, room);

  const centers = rooms.map(roomCenter);
  const mstEdges = minimumSpanningTree(centers);

  for (const [a, b] of mstEdges) {
    const path = findValidCorridorPath(terrain, rooms, rooms[a], rooms[b], rng, p.width, p.height);
    if (!path) {
      return { ok: false, roomCount: rooms.length, corridorRouteFailure: true };
    }
    carvePath(terrain, path);
  }

  // Extra connections to introduce loops: pick from edges not already in the MST.
  const mstKeySet = new Set(mstEdges.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  const remainingEdges = buildEdges(centers)
    .filter((e) => !mstKeySet.has(`${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`))
    .sort((x, y) => x.dist - y.dist);

  const extraCount = Math.min(
    randInt(rng, p.extraConnections.min, p.extraConnections.max),
    remainingEdges.length,
  );
  for (let i = 0; i < extraCount; i++) {
    const edge = remainingEdges[i];
    const path = findValidCorridorPath(terrain, rooms, rooms[edge.a], rooms[edge.b], rng, p.width, p.height);
    // Extra connections are optional loops, not required for connectivity;
    // skip silently (no unconditional carve, no floor deletion) if no
    // contact-free route is found rather than failing the whole attempt.
    if (path) carvePath(terrain, path);
  }

  const exit = roomCenter(rooms[rooms.length - 1]);

  const map: GameMap = {
    width: p.width,
    height: p.height,
    terrain,
    rooms,
    exit,
  };

  return { ok: true, map, roomCount: rooms.length };
}

/** BFS distance map (in floor steps) from `start`, keyed by "x,y"; unreachable tiles are absent. */
function bfsDistances(map: GameMap, start: Vec2): Map<string, number> {
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
  enemy: Vec2;
}

/**
 * Chooses start (in the first room), exit (in the room whose center is
 * farthest by floor-path distance from start, guaranteed to be a
 * different room), and an enemy tile that is reachable, not on start or
 * exit, and not adjacent to start.
 */
export function choosePlacement(map: GameMap, rng: () => number): Placement {
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
      const p = { x, y };
      if (!distFromStart.has(key(p))) continue;
      if (p.x === start.x && p.y === start.y) continue;
      if (p.x === exit.x && p.y === exit.y) continue;
      const dx = Math.abs(p.x - start.x);
      const dy = Math.abs(p.y - start.y);
      const adjacentToStart = dx <= 1 && dy <= 1;
      if (adjacentToStart) continue;
      candidates.push(p);
    }
  }

  const enemy =
    candidates.length > 0
      ? candidates[Math.floor(rng() * candidates.length)]
      : exit;

  return { start, exit, enemy };
}

/**
 * Generates a room-and-corridor map deterministically from `seed`.
 * Retries deterministically (seed does not change, only an internal
 * attempt counter mixed in) up to maxGenerationAttempts before returning
 * an explicit failure.
 */
export function generateMap(seed: number): MapGenResult {
  for (let attempt = 0; attempt < MAP_GEN_PARAMS.maxGenerationAttempts; attempt++) {
    // Mix the attempt index into the seed so retries are deterministic
    // (same seed -> same sequence of attempts -> same eventual result)
    // without depending on Date.now() or Math.random().
    const rng = createRng(seed + attempt * 0x9e3779b1);
    const result = tryGenerateOnce(rng);
    if (result.ok) return result;
  }
  return { ok: false };
}
