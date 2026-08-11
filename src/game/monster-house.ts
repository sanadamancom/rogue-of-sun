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

import { GameMap, MonsterHouseState, Vec2 } from './types';
import { roomIndexContaining } from './mapgen';

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
export function extractMonsterHouseCandidateRooms(map: GameMap, start: Vec2, exit: Vec2): number[] {
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
 * Phase 21.2: floors eligible to roll for a monster house at all. The
 * current 3-floor prototype only makes floors 2 and 3 eligible (floor 1
 * never has one); the full-game floor structure is Phase 23's concern, so
 * this stays a small named constant rather than a formula. Not exported
 * mutable — treat as read-only.
 */
export const MONSTER_HOUSE_ELIGIBLE_FLOORS: ReadonlySet<number> = new Set([2, 3]);

/** Returns whether `floor` is eligible to roll for a monster house at all (see `MONSTER_HOUSE_ELIGIBLE_FLOORS`). Pure; consumes no RNG. */
export function isMonsterHouseEligibleFloor(floor: number): boolean {
  return MONSTER_HOUSE_ELIGIBLE_FLOORS.has(floor);
}

/**
 * Provisional per-floor occurrence probability (independent per eligible
 * floor; no run-wide cap, no minimum guarantee, no dynamic adjustment based
 * on prior rolls). A Phase 20-style placeholder value, reconsidered at
 * Phase 21.7/23/27 balance passes — see phase-21-2 history doc.
 */
export const MONSTER_HOUSE_OCCURRENCE_PROBABILITY = 0.2;

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
  floor: number,
  start: Vec2,
  exit: Vec2,
  rng: () => number,
): MonsterHouseState {
  if (!isMonsterHouseEligibleFloor(floor)) return null;

  const candidates = extractMonsterHouseCandidateRooms(map, start, exit);
  if (candidates.length === 0) return null;

  const roll = rng();
  if (roll >= MONSTER_HOUSE_OCCURRENCE_PROBABILITY) return null;

  const roomIndex = selectMonsterHouseRoom(candidates, rng);
  if (roomIndex === null) return null; // unreachable given candidates.length > 0, kept for type-safety
  return { roomIndex, status: 'hidden' };
}
