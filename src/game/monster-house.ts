/**
 * Phase 21.1: monster house candidate-room extraction and selection.
 *
 * Pure, Phaser-independent logic only — not wired into production floor
 * construction, GameState, save schema, telemetry, UI, or turn processing.
 * See docs/history/phase-21-1-monster-house-room-selection.md.
 *
 * `extractMonsterHouseCandidateRooms` and `selectMonsterHouseRoom` are
 * deliberately separate pure functions: extraction never consumes RNG,
 * and selection consumes exactly one rng() call when candidates exist.
 * Neither function derives an RNG stream from a floor seed or introduces
 * a new XOR constant — that independent-stream wiring, and the decision
 * of which floors get a monster house at all, is Phase 21.2's job.
 */

import { EnemyType, GameMap, MonsterHouseState, Vec2 } from './types';
import { roomIndexContaining } from './mapgen';
import { getEnemyPoolForFloor } from './enemy-def';

/**
 * Returns the indices (into `map.rooms`, ascending) of every room that is
 * eligible to become the floor's monster house: every room except the one
 * containing `start` and the one containing `exit`. Room containment reuses
 * mapgen.ts's `roomIndexContaining` (half-open rectangle: x in
 * [room.x, room.x+room.width), y in [room.y, room.y+room.height)).
 *
 * Throws if `start` or `exit` is not inside any room in `map.rooms` — this
 * should never happen for a validly generated map, and silently producing
 * an unfiltered or wrong candidate set would be worse than failing loudly.
 *
 * Does not use RNG. Does not mutate `map`, `map.rooms`, `start`, or `exit`.
 * Room-area, distance-from-start/exit, enemy/item capacity, dark-room, and
 * floor/frequency exclusions are explicitly out of scope for Phase 21.1 —
 * see the module doc comment and phase-21-1 history doc.
 */
export function extractMonsterHouseCandidateRooms(
  map: GameMap,
  start: Vec2,
  exit: Vec2,
  excludeRoomIndices: number[] = [],
): number[] {
  const startRoomIndex = roomIndexContaining(map.rooms, start);
  if (startRoomIndex === -1) {
    throw new Error('extractMonsterHouseCandidateRooms: start position is not inside any room');
  }
  const exitRoomIndex = roomIndexContaining(map.rooms, exit);
  if (exitRoomIndex === -1) {
    throw new Error('extractMonsterHouseCandidateRooms: exit position is not inside any room');
  }

  const candidates: number[] = [];
  for (let i = 0; i < map.rooms.length; i++) {
    if (i === startRoomIndex || i === exitRoomIndex) continue;
    if (excludeRoomIndices.includes(i)) continue;
    candidates.push(i);
  }
  return candidates;
}

/**
 * Selects one room index from `candidateRoomIndices`, uniformly at random,
 * consuming exactly one `rng()` call — or returns `null` and consumes no
 * RNG at all if the candidate array is empty. Never mutates
 * `candidateRoomIndices`. `rng` must return a value in [0, 1); callers
 * supply their own stream (see the module doc comment: Phase 21.1 does not
 * derive a stream from a floor seed).
 */
export function selectMonsterHouseRoom(candidateRoomIndices: number[], rng: () => number): number | null {
  if (candidateRoomIndices.length === 0) return null;
  const pickIndex = Math.floor(rng() * candidateRoomIndices.length);
  return candidateRoomIndices[pickIndex];
}

/**
 * Phase 24.6c3a1: monster houses are a descent-only mechanic, eligible
 * from depth 2 through 26 inclusive. This supersedes the earlier 3-floor
 * development baseline.
 */
export const MONSTER_HOUSE_MINIMUM_DEPTH = 2;
export const MONSTER_HOUSE_MAXIMUM_DEPTH = 26;

/** Returns whether `depth` and `leg` are eligible to roll for a monster house. Pure; consumes no RNG. */
export function isMonsterHouseEligibleFloor(depth: number, leg: 'descent' | 'ascent'): boolean {
  return leg === 'descent' && depth >= MONSTER_HOUSE_MINIMUM_DEPTH && depth <= MONSTER_HOUSE_MAXIMUM_DEPTH;
}

/**
 * Per-floor occurrence probability (independent per eligible floor; no
 * run-wide cap, no minimum guarantee, no dynamic adjustment based on prior
 * rolls). Phase 24.6c3a1 supersedes the earlier 3-floor development
 * baseline with the long-run balance value.
 */
export const MONSTER_HOUSE_OCCURRENCE_PROBABILITY = 0.05;

/**
 * Phase 21.2: derives this floor's independent monster-house RNG stream
 * from `floorSeed`, using a dedicated XOR constant distinct from every
 * other existing floorSeed-derived stream in state.ts (placement:
 * 0x51ed270b, species: 0x8f3c9d21, slow trap: 0x1a6f83c5, poison trap:
 * 0x3f9c5e82, item count: 0xa3c17f05, item selection: 0x5c2e91d3, item
 * placement: 0x91b6d8e4, equipment curse: 0xc7d4a19e). Consuming this
 * stream can never perturb any of those, since each is already its own
 * independent mulberry32 stream keyed off the same floorSeed with a
 * different constant. `floor` is not mixed in separately here because
 * `floorSeed` already encodes the floor number (see floor.ts's
 * deriveFloorSeed) — matching every other floorSeed-derived stream above.
 */
const MONSTER_HOUSE_RNG_XOR = 0x6b2f4d97;

/** Creates this floor's dedicated monster-house RNG stream (see `MONSTER_HOUSE_RNG_XOR`'s doc comment). `createRngFn` is the caller's `createRng` (mapgen.ts), injected to avoid a circular import between monster-house.ts and mapgen.ts. */
export function createMonsterHouseRng(floorSeed: number, createRngFn: (seed: number) => () => number): () => number {
  return createRngFn(floorSeed ^ MONSTER_HOUSE_RNG_XOR);
}

/**
 * Phase 21.2: decides this floor's full monster-house state exactly once,
 * in a fixed order — eligibility, candidate extraction, occurrence roll,
 * room selection — consuming `rng` according to this table:
 *
 * - Ineligible floor: 0 calls, returns `null`.
 * - Eligible floor, no candidate rooms: 0 calls, returns `null`.
 * - Eligible floor, occurrence roll fails: 1 call, returns `null`.
 * - Eligible floor, occurrence roll succeeds: 2 calls total (the
 *   occurrence roll, then `selectMonsterHouseRoom`'s one call), returns
 *   `{ roomIndex, status: 'hidden' }`.
 *
 * The occurrence roll succeeds when `rng() < MONSTER_HOUSE_OCCURRENCE_PROBABILITY`
 * (so a roll of exactly the probability boundary fails — consistent with
 * this codebase's existing `< probability` roll convention). Does not
 * mutate `map`, `start`, or `exit`. Callers are responsible for actually
 * storing the returned value on `map.monsterHouse` (see state.ts's
 * buildFloorState) — this function itself has no side effects.
 */
export function buildMonsterHouseFloorState(
  map: GameMap,
  depth: number,
  leg: 'descent' | 'ascent',
  start: Vec2,
  exit: Vec2,
  rng: () => number,
  excludeRoomIndices: number[] = [],
): MonsterHouseState {
  if (!isMonsterHouseEligibleFloor(depth, leg)) return null;

  const candidates = extractMonsterHouseCandidateRooms(map, start, exit, excludeRoomIndices);
  if (candidates.length === 0) return null;

  const roll = rng();
  if (roll >= MONSTER_HOUSE_OCCURRENCE_PROBABILITY) return null;

  const roomIndex = selectMonsterHouseRoom(candidates, rng);
  if (roomIndex === null) return null; // unreachable given candidates.length > 0, kept for type-safety
  return { roomIndex, status: 'hidden' };
}

/**
 * Phase 21.3: reveals `map.monsterHouse` (hidden -> revealed) exactly when
 * the player's move just now entered its room from outside it — i.e. all
 * of: a monster house exists on this floor, its status is still
 * `'hidden'`, `posBefore` is NOT inside `map.rooms[monsterHouse.roomIndex]`,
 * and `posAfter` IS inside that room. Uses `roomIndexContaining`'s same
 * half-open rectangle membership as Phase 21.1/21.2 — doorway/corridor
 * tiles lie strictly outside every room rectangle (see doorway-rule.
 * test.ts), so standing on a doorway approaching the room never reveals
 * it; only actually landing on one of the room's floor tiles does.
 *
 * A pure mutation of `map.monsterHouse.status` only — `roomIndex` is left
 * untouched, no new monster house is generated or re-rolled, and no RNG
 * is consumed. Returns `true` if a reveal happened this call, `false`
 * otherwise (including when `map.monsterHouse` is `undefined`/`null`,
 * already `'revealed'`, or the move didn't cross into the room) — this
 * boolean is the minimal observable boundary later phases (21.6 logging/
 * UI/telemetry) can build on; this function itself does nothing beyond
 * the state.status mutation. Safe to call on every move; re-entering an
 * already-revealed room, moving within the room, moving outside it, or
 * moving between two points both outside it are all no-ops.
 *
 * Callers are responsible for only invoking this after an actually-
 * consumed player move and before enemy actions resolve (see
 * turn.ts's processTurn) — this function does not itself inspect
 * `action.type` or turn/consumption state.
 */
export function applyMonsterHouseReveal(map: GameMap, posBefore: Vec2, posAfter: Vec2): boolean {
  const monsterHouse = map.monsterHouse;
  if (!monsterHouse) return false;
  if (monsterHouse.status !== 'hidden') return false;

  const room = map.rooms[monsterHouse.roomIndex];
  if (!room) return false; // defensive: roomIndex should always be valid per Phase 21.1/21.2's invariants

  const wasInside = roomIndexContaining([room], posBefore) === 0;
  const isInside = roomIndexContaining([room], posAfter) === 0;
  if (wasInside || !isInside) return false;

  monsterHouse.status = 'revealed';
  return true;
}

/**
 * Phase 21.4: dedicated monster-house enemy count as a pure function of
 * the number of eligible placement cells (`C`), never the floor number —
 * `N = clamp(ceil(sqrt(C)), 4, 8)`. Deliberately floor-independent: the
 * dedicated roster size scales with how much room the target room
 * actually has, not with which floor it's on, so adding future floors
 * never requires touching this function or adding a floor-number branch
 * here. Throws explicitly if `C < 4` — this codebase's existing
 * convention of failing loudly rather than silently placing fewer
 * enemies than intended (see e.g. mapgen.ts's chooseGroundItemPosition).
 * Consumes no RNG.
 */
export function computeMonsterHouseEnemyCount(candidateCellCount: number): number {
  if (candidateCellCount < 4) {
    throw new Error(
      `computeMonsterHouseEnemyCount: only ${candidateCellCount} eligible placement cells, need at least 4`,
    );
  }
  const raw = Math.ceil(Math.sqrt(candidateCellCount));
  return Math.min(8, Math.max(4, raw));
}

function key(pos: Vec2): string {
  return `${pos.x},${pos.y}`;
}

/**
 * Phase 21.4: every floor tile inside `map.rooms[roomIndex]` that is
 * walkable ('floor') and has at least one orthogonal neighbor that is (a)
 * walkable and (b) NOT inside that same room rectangle — i.e. a doorway/
 * corridor tile or a different room's tile lying just outside it. This is
 * exactly "the room-interior tile a player first steps onto when entering
 * from outside" for every doorway feeding this room (doorway tiles
 * themselves always lie strictly outside every room rectangle — see
 * doorway-rule.test.ts — so they are never entry cells themselves, only
 * adjacent to one). Pure; does not mutate `map`.
 */
export function computeMonsterHouseEntryCells(map: GameMap, roomIndex: number): Vec2[] {
  const room = map.rooms[roomIndex];
  if (!room) return [];

  const isWalkableFloorTile = (pos: Vec2): boolean =>
    pos.x >= 0 && pos.x < map.width && pos.y >= 0 && pos.y < map.height && map.terrain[pos.y][pos.x] === 'floor';

  const entryCells: Vec2[] = [];
  const deltas: Vec2[] = [
    { x: 0, y: -1 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ];

  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      const pos = { x, y };
      if (!isWalkableFloorTile(pos)) continue;

      const hasOutsideNeighbor = deltas.some((d) => {
        const neighbor = { x: x + d.x, y: y + d.y };
        if (!isWalkableFloorTile(neighbor)) return false;
        return roomIndexContaining([room], neighbor) !== 0;
      });
      if (hasOutsideNeighbor) entryCells.push(pos);
    }
  }

  return entryCells;
}

/**
 * Phase 21.4: every eligible dedicated-monster-house-enemy placement cell
 * inside `map.rooms[roomIndex]` — every 'floor' tile in the room
 * rectangle, minus every entry cell (`computeMonsterHouseEntryCells`) and
 * minus every position in `exclusions` (player/start, exit, every already
 * -finalized normal enemy/trap/ground-item/equipment position — see
 * state.ts's call site, which computes this only after every normal
 * generation step has fully finished). Deduplicates by coordinate. Pure;
 * does not mutate `map` or `exclusions`. The length of this array is `C`
 * — feed it directly to `computeMonsterHouseEnemyCount`.
 */
export function computeMonsterHouseCandidateCells(map: GameMap, roomIndex: number, exclusions: Vec2[]): Vec2[] {
  const room = map.rooms[roomIndex];
  if (!room) return [];

  const entryCellKeys = new Set(computeMonsterHouseEntryCells(map, roomIndex).map(key));
  const excludedKeys = new Set(exclusions.map(key));

  const candidates: Vec2[] = [];
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (map.terrain[y][x] !== 'floor') continue;
      const pos = { x, y };
      const k = key(pos);
      if (entryCellKeys.has(k)) continue;
      if (excludedKeys.has(k)) continue;
      candidates.push(pos);
    }
  }
  return candidates;
}

/**
 * Phase 21.4: selects `count` distinct positions from `candidates`
 * (typically `computeMonsterHouseCandidateCells`'s output), uniformly at
 * random, via a partial Fisher-Yates shuffle — exactly one `rng()` call
 * per candidate considered during the shuffle (standard shuffle cost),
 * never re-rolling a duplicate. Never mutates the input `candidates`
 * array (copies internally). Throws explicitly if
 * `candidates.length < count` — same explicit-failure convention as
 * `computeMonsterHouseEnemyCount`.
 */
export function selectMonsterHouseEnemyPositions(candidates: Vec2[], count: number, rng: () => number): Vec2[] {
  if (candidates.length < count) {
    throw new Error(
      `selectMonsterHouseEnemyPositions: only ${candidates.length} candidate cells, need ${count}`,
    );
  }
  const pool = candidates.slice();
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, count);
}

/**
 * Phase 21.4: chooses `count` enemy species for the dedicated monster-
 * house roster, reusing the exact same legal per-floor pool
 * (enemy-def.ts's `getEnemyPoolForFloor`) and the same uniform-draw
 * selection shape as normal enemy generation (state.ts's `chooseSpecies`,
 * which this mirrors rather than imports to avoid a circular dependency
 * between monster-house.ts and state.ts — both are one-line uniform
 * `Math.floor(rng() * pool.length)` draws over the identical pool).
 * Phase 23.6: no per-species post-processing of any kind — every draw
 * (including any number of golem draws on the same floor, and
 * regardless of how many normal-generation golems already exist) is
 * returned exactly as drawn. The earlier Phase 08.4 floor-2 golem-cap
 * exception (and its `golemAlreadyPresent` parameter) was removed once
 * golem's own first-appearance floor moved to 3, making it unreachable
 * — see this phase's history for why removing it changes no observable
 * floor-2 behavior. Consumes exactly one rng() call per position.
 */
export function chooseMonsterHouseEnemyTypes(count: number, floor: number, rng: () => number): EnemyType[] {
  const pool = getEnemyPoolForFloor(floor);
  const types: EnemyType[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * pool.length);
    types.push(pool[index]);
  }
  return types;
}

/**
 * Phase 21.4: derives this floor's dedicated monster-house enemy RNG
 * streams (position, species) from `floorSeed`, using two dedicated XOR
 * constants distinct from every other existing floorSeed-derived stream
 * (placement: 0x51ed270b, species: 0x8f3c9d21, slow trap: 0x1a6f83c5,
 * poison trap: 0x3f9c5e82, item count: 0xa3c17f05, item selection:
 * 0x5c2e91d3, item placement: 0x91b6d8e4, equipment curse: 0xc7d4a19e,
 * monster house occurrence/selection: 0x6b2f4d97). Two separate streams
 * (not one shared) matches this codebase's existing convention of never
 * mixing a "which species" draw and a "which position" draw on the same
 * stream (see placementRng vs speciesRng). Only ever called when a
 * monster house actually exists on this floor — a floor with none never
 * creates or consumes these streams at all.
 */
const MONSTER_HOUSE_ENEMY_POSITION_RNG_XOR = 0x2d84b6f1;
const MONSTER_HOUSE_ENEMY_SPECIES_RNG_XOR = 0x7a19e3c8;

export function createMonsterHouseEnemyPositionRng(floorSeed: number, createRngFn: (seed: number) => () => number): () => number {
  return createRngFn(floorSeed ^ MONSTER_HOUSE_ENEMY_POSITION_RNG_XOR);
}

export function createMonsterHouseEnemySpeciesRng(floorSeed: number, createRngFn: (seed: number) => () => number): () => number {
  return createRngFn(floorSeed ^ MONSTER_HOUSE_ENEMY_SPECIES_RNG_XOR);
}

/**
 * Fixed dedicated-reward count per monster house occurrence. Confirmed as
 * the final 3-floor run baseline by Phase 23.7 (see docs/history/
 * phase-23-7-final-run-structure.md's monster_house section) — value
 * unchanged from Phase 21.5, only locked in as the shipped count.
 * Deliberately not derived from room size (C) the way Phase 21.4's enemy
 * count is; that remains a deliberate design choice, not an oversight.
 */
export const MONSTER_HOUSE_REWARD_COUNT = 3;

/**
 * Phase 21.5: derives this floor's dedicated monster-house reward
 * position RNG stream from `floorSeed`, using a dedicated XOR constant
 * distinct from every other existing floorSeed-derived stream (placement:
 * 0x51ed270b, species: 0x8f3c9d21, slow trap: 0x1a6f83c5, poison trap:
 * 0x3f9c5e82, item count: 0xa3c17f05, item selection: 0x5c2e91d3, item
 * placement: 0x91b6d8e4, equipment curse: 0xc7d4a19e, monster house
 * occurrence/selection: 0x6b2f4d97, monster house enemy position:
 * 0x2d84b6f1, monster house enemy species: 0x7a19e3c8). Only ever called
 * when a monster house actually exists on this floor.
 */
const MONSTER_HOUSE_REWARD_POSITION_RNG_XOR = 0x4e7bc218;
const MONSTER_HOUSE_REWARD_SELECTION_RNG_XOR = 0x9f1a5d63;

export function createMonsterHouseRewardPositionRng(floorSeed: number, createRngFn: (seed: number) => () => number): () => number {
  return createRngFn(floorSeed ^ MONSTER_HOUSE_REWARD_POSITION_RNG_XOR);
}

export function createMonsterHouseRewardSelectionRng(floorSeed: number, createRngFn: (seed: number) => () => number): () => number {
  return createRngFn(floorSeed ^ MONSTER_HOUSE_REWARD_SELECTION_RNG_XOR);
}

/**
 * Phase 21.5: selects up to `count` distinct positions from `candidates`,
 * uniformly at random, via the same partial Fisher-Yates shuffle as
 * `selectMonsterHouseEnemyPositions` — but degrades gracefully instead of
 * throwing when `candidates.length < count`: it simply returns every
 * available candidate (i.e. `min(count, candidates.length)` positions)
 * rather than failing generation or padding with duplicates. This
 * matches Phase 21.5's insufficient_capacity contract (place as many as
 * fit, never throw, never delete existing generation to make room) —
 * deliberately different from Phase 21.4's enemy placement, which does
 * throw on shortfall. Consumes one rng() call per candidate considered
 * during the shuffle (0 calls if candidates is empty). Never mutates the
 * input `candidates` array.
 */
export function selectMonsterHouseRewardPositions(candidates: Vec2[], count: number, rng: () => number): Vec2[] {
  const actualCount = Math.min(count, candidates.length);
  if (actualCount === 0) return [];
  const pool = candidates.slice();
  for (let i = 0; i < actualCount; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, actualCount);
}
