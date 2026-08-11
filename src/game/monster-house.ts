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

import { GameMap, Vec2 } from './types';
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
