import { createRng, bfsDistances } from './mapgen';
import { GameMap, Room, Vec2 } from './types';

/**
 * The sunlight layer's own independent RNG XOR constant (Phase 09.3),
 * distinct from every existing map-generation/placement stream's
 * constant (map generation, actor placement, species, apple, sword,
 * armor, spear, hammer, sun fruit, solar gun). Used only to derive a
 * fresh `createRng(floorSeed ^ SUNLIGHT_XOR)` stream — never touches any
 * other stream's sequence or consumption count.
 */
const SUNLIGHT_XOR = 0x7c3a91e6;

export type SunlightCategory = 'light' | 'mixed' | 'dark';

export interface SunlightCategoryWeights {
  light: number;
  mixed: number;
  dark: number;
}

const SUNLIGHT_DEPTH_BANDS: ReadonlyArray<{
  minDepth: number;
  maxDepth: number;
  weights: SunlightCategoryWeights;
}> = [
  { minDepth: 1, maxDepth: 6, weights: { light: 60, mixed: 30, dark: 10 } },
  { minDepth: 7, maxDepth: 13, weights: { light: 45, mixed: 35, dark: 20 } },
  { minDepth: 14, maxDepth: 19, weights: { light: 30, mixed: 40, dark: 30 } },
  { minDepth: 20, maxDepth: 26, weights: { light: 20, mixed: 35, dark: 45 } },
];

/** Returns the depth-only sunlight weights, clamped to the nearest defined band. */
export function sunlightWeightsForDepth(depth: number): SunlightCategoryWeights {
  const clampedDepth = Math.max(1, Math.min(26, depth));
  return SUNLIGHT_DEPTH_BANDS.find((band) => clampedDepth >= band.minDepth && clampedDepth <= band.maxDepth)!.weights;
}

/** Selects a sunlight category in the fixed light -> mixed -> dark order. */
export function selectSunlightCategory(depth: number, rng: () => number): SunlightCategory {
  const weights = sunlightWeightsForDepth(depth);
  const roll = rng() * 100;
  if (roll < weights.light) return 'light';
  if (roll < weights.light + weights.mixed) return 'mixed';
  return 'dark';
}

/** Returns the category selected by the first draw of a floor's sunlight stream. */
export function sunlightCategoryForFloorSeed(depth: number, floorSeed: number): SunlightCategory {
  return selectSunlightCategory(depth, createRng(floorSeed ^ SUNLIGHT_XOR));
}

/** Provisional fraction of floor 1's reachable floor kept in shadow (Phase 09.3; not finally tuned). */
const FLOOR1_SHADOW_FRACTION = 0.15;

/** Provisional cap on how many corridor tiles floor 3's sunlit "walkway" spans (Phase 09.3; not finally tuned). */
const FLOOR3_WALKWAY_LENGTH = 8;

/** An all-shadow grid the same dimensions as `map`, used as the starting point for every floor's layer. */
function createEmptyGrid(map: GameMap): boolean[][] {
  return Array.from({ length: map.height }, () => Array.from({ length: map.width }, () => false));
}

/**
 * Reads the sunlight layer at `pos`, treating any out-of-range coordinate
 * (should not occur in normal play) as shadow rather than throwing.
 */
export function isSunlitAt(sunlight: boolean[][], pos: Vec2): boolean {
  const row = sunlight[pos.y];
  if (!row) return false;
  return row[pos.x] ?? false;
}

/** Every reachable floor tile from `start`, in the same deterministic order bfsDistances visits them. */
function reachableFloorTiles(map: GameMap, start: Vec2): Vec2[] {
  const reached = bfsDistances(map, start);
  const tiles: Vec2[] = [];
  for (const key of reached.keys()) {
    const [xs, ys] = key.split(',');
    tiles.push({ x: Number(xs), y: Number(ys) });
  }
  return tiles;
}

/** Every floor tile within `room`'s rectangle (bounds-checked; the rectangle is expected to be entirely floor by construction, but this re-verifies terrain rather than assuming it). */
function floorTilesInRoom(map: GameMap, room: Room): Vec2[] {
  const tiles: Vec2[] = [];
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (y < 0 || y >= map.height || x < 0 || x >= map.width) continue;
      if (map.terrain[y][x] === 'floor') tiles.push({ x, y });
    }
  }
  return tiles;
}

function isInsideAnyRoom(rooms: Room[], x: number, y: number): boolean {
  return rooms.some((room) => x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height);
}

/** Deterministic in-place Fisher-Yates shuffle using the given rng; never touches any other RNG stream. */
function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

/**
 * Floor 1 ("塔前の庭・入口"): most reachable floor is sunlit, introducing
 * the mechanic; a deterministic minority (FLOOR1_SHADOW_FRACTION) stays
 * shaded so the sunlit/shadow visual distinction is demonstrable. The
 * start tile is always sunlit regardless of the random draw.
 */
function generateFloor1(map: GameMap, start: Vec2, rng: () => number): boolean[][] {
  const grid = createEmptyGrid(map);
  const reachable = reachableFloorTiles(map, start);
  for (const tile of reachable) grid[tile.y][tile.x] = true;

  const shadowCount = Math.max(1, Math.floor(reachable.length * FLOOR1_SHADOW_FRACTION));
  const shuffled = [...reachable];
  shuffleInPlace(shuffled, rng);

  let marked = 0;
  for (const tile of shuffled) {
    if (marked >= shadowCount) break;
    if (tile.x === start.x && tile.y === start.y) continue; // start always sunlit
    grid[tile.y][tile.x] = false;
    marked += 1;
  }
  grid[start.y][start.x] = true;
  return grid;
}

/**
 * Floor 2 ("塔内部・吹き抜け階"): 1-2 existing rooms are deterministically
 * chosen as a sunlit courtyard/atrium; everything else stays shadowed.
 * Rooms are part of the connected map by mapgen's own guarantee, so a
 * chosen room's sunlit area is always reachable without a separate check.
 */
function generateFloor2(map: GameMap, start: Vec2, rng: () => number): boolean[][] {
  const grid = createEmptyGrid(map);
  const rooms = map.rooms;

  if (rooms.length === 0) {
    // Defensive fallback (should not occur given normal map generation
    // parameters): guarantees the "at least 1 sunlit tile" requirement.
    grid[start.y][start.x] = true;
    return grid;
  }

  const roomCount = rooms.length >= 2 && rng() < 0.5 ? 2 : 1;
  const chosenIndices = new Set<number>();
  let guard = 0;
  const maxAttempts = 50; // deterministic upper bound on the selection search
  while (chosenIndices.size < Math.min(roomCount, rooms.length) && guard < maxAttempts) {
    chosenIndices.add(Math.floor(rng() * rooms.length));
    guard += 1;
  }

  for (const index of chosenIndices) {
    for (const tile of floorTilesInRoom(map, rooms[index])) {
      grid[tile.y][tile.x] = true;
    }
  }

  if (!grid.some((row) => row.some(Boolean))) {
    grid[start.y][start.x] = true; // defensive fallback, should be unreachable
  }
  return grid;
}

/**
 * Floor 3 ("上層接続部"): mostly shadow, with a small sunlit "walkway"
 * carved out of corridor tiles (floor tiles reachable from start but not
 * inside any room rectangle) standing in for an outdoor connecting
 * passage. If no corridor tiles can be identified, falls back to a whole
 * room as a terrace-equivalent sunlit area per failure_policy, without
 * touching map generation.
 */
function generateFloor3(map: GameMap, start: Vec2, rng: () => number): boolean[][] {
  const grid = createEmptyGrid(map);
  const reachable = reachableFloorTiles(map, start);
  const corridorTiles = reachable.filter((tile) => !isInsideAnyRoom(map.rooms, tile.x, tile.y));

  if (corridorTiles.length > 0) {
    const anchor = corridorTiles[Math.floor(rng() * corridorTiles.length)];
    const corridorSet = new Set(corridorTiles.map((tile) => `${tile.x},${tile.y}`));

    // BFS restricted to corridor tiles only, fixed neighbor order, so the
    // same anchor tile always yields the same walkway shape.
    const key = (p: Vec2) => `${p.x},${p.y}`;
    const visited = new Set<string>([key(anchor)]);
    const queue: Vec2[] = [anchor];
    const walkway: Vec2[] = [];
    let head = 0;
    while (head < queue.length && walkway.length < FLOOR3_WALKWAY_LENGTH) {
      const current = queue[head++];
      walkway.push(current);
      const neighbors = [
        { x: current.x + 1, y: current.y },
        { x: current.x - 1, y: current.y },
        { x: current.x, y: current.y + 1 },
        { x: current.x, y: current.y - 1 },
      ];
      for (const neighbor of neighbors) {
        const nk = key(neighbor);
        if (corridorSet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(neighbor);
        }
      }
    }
    for (const tile of walkway) grid[tile.y][tile.x] = true;
    return grid;
  }

  // No identifiable corridor tiles on this generated map: use one whole
  // room as a terrace-equivalent sunlit region instead (failure_policy
  // fallback — never modifies map generation to force corridor tiles to
  // exist).
  if (map.rooms.length > 0) {
    const index = Math.floor(rng() * map.rooms.length);
    for (const tile of floorTilesInRoom(map, map.rooms[index])) {
      grid[tile.y][tile.x] = true;
    }
  } else {
    grid[start.y][start.x] = true; // last-resort defensive fallback
  }
  return grid;
}

/**
 * Builds this floor's sunlight layer (Phase 09.3), entirely independent
 * of `map.terrain` and every existing RNG stream (map generation, actor
 * placement, species, and every ground item's own stream) — it only
 * reads the already-finished `map`/`start` and consumes its own fresh
 * `createRng(floorSeed ^ SUNLIGHT_XOR)` stream, so it never perturbs any
 * prior stream's sequence or consumption count, and is fully deterministic
 * for a given (map, floor, floorSeed, start).
 */
export function generateSunlightLayer(map: GameMap, floor: number, floorSeed: number, start: Vec2): boolean[][] {
  const rng = createRng(floorSeed ^ SUNLIGHT_XOR);
  const category = selectSunlightCategory(floor, rng);
  if (category === 'light') return generateFloor1(map, start, rng);
  if (category === 'mixed') return generateFloor2(map, start, rng);
  return generateFloor3(map, start, rng);
}
