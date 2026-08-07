/**
 * Phase 17.2 — deterministic dark-room selection.
 *
 * Pure function only: reads `GameMap`/`Vec2`, never mutates its inputs,
 * never calls `rng()`/`createRng()`, and never touches any of the
 * existing generation RNG streams (map layout, placement, species
 * selection, ground items, traps — see state.ts's buildFloorState). The
 * dark room is chosen from `floorSeed`/`floor` via a self-contained
 * integer hash (a standard 32-bit mix, not copied from any external
 * library), so the same seed/floor always picks the same room without
 * perturbing — or even being able to perturb — any other generation
 * result's RNG consumption count.
 */
import { GameMap, Vec2 } from './types';
import { roomIndexContaining } from './mapgen';

/**
 * Self-contained 32-bit integer hash (Murmur3-style finalizer mix; a
 * well-known, generic bit-mixing technique, not copied from any specific
 * library's source) of `(floorSeed, floor)`, reduced into `[0, modulus)`.
 * `modulus` must be a positive integer. No floating point involved beyond
 * the final `%`, so results are exact and reproducible across platforms.
 */
export function deterministicRoomHash(floorSeed: number, floor: number, modulus: number): number {
  let h = (floorSeed >>> 0) ^ Math.imul(floor + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % modulus;
}

/**
 * Chooses this floor's single dark room (Phase 17.2 dark_area_definition:
 * one room per floor, excluding the start room and the exit room), or
 * `null` when no eligible room exists (fallback: no dark room that
 * floor — the start/exit rooms themselves are never darkened). The
 * returned value is an index into `map.rooms`, the same stable ordering
 * `generateMap` already produces deterministically for a given seed, so
 * it doubles as a stable "room id" without needing a new field on `Room`.
 */
export function chooseDarkRoomIndex(map: GameMap, floorSeed: number, floor: number, start: Vec2, exit: Vec2): number | null {
  const startRoomIndex = roomIndexContaining(map.rooms, start);
  const exitRoomIndex = roomIndexContaining(map.rooms, exit);

  const eligible: number[] = [];
  map.rooms.forEach((_, index) => {
    if (index === startRoomIndex) return;
    if (index === exitRoomIndex) return;
    eligible.push(index);
  });

  if (eligible.length === 0) return null;
  const pick = deterministicRoomHash(floorSeed, floor, eligible.length);
  return eligible[pick];
}
