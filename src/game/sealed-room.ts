/**
 * Phase 24.7a: sealed-room eligibility and floor-state decision.
 *
 * Pure, Phaser-independent logic only - not wired into production floor
 * construction, GameState, save schema, telemetry, UI, or turn processing.
 * Phase 24.7b adds pure candidate-room extraction and a convenience wrapper,
 * while keeping this module unwired from production floor construction.
 */

import type { EnemyActor, EnemyLevel, EquipmentInstance, GameMap, GroundItem, SealedRoomState, Vec2 } from './types';
import { roomIndexContaining } from './mapgen';
import { computeMonsterHouseEntryCells } from './monster-house';
import { getEnemyLevelBandForDepth } from './enemy-depth-bands';
import { mintEquipmentInstance } from './equipment-instance';

/** Minimum interior width and height required for a sealed-room candidate. */
export const SEALED_ROOM_MINIMUM_INTERIOR_SIZE = 5;

/** Returns eligible leaf-room indices in ascending order without consuming RNG. */
export function extractSealedRoomCandidateRooms(
  map: GameMap,
  start: Vec2,
  exit: Vec2,
  excludeRoomIndices: number[],
): number[] {
  const startRoomIndex = roomIndexContaining(map.rooms, start);
  if (startRoomIndex === -1) {
    throw new Error('extractSealedRoomCandidateRooms: start position is not inside any room');
  }
  const exitRoomIndex = roomIndexContaining(map.rooms, exit);
  if (exitRoomIndex === -1) {
    throw new Error('extractSealedRoomCandidateRooms: exit position is not inside any room');
  }

  const candidates: number[] = [];
  for (let i = 0; i < map.rooms.length; i++) {
    if (i === startRoomIndex) continue;
    if (i === exitRoomIndex) continue;
    if (excludeRoomIndices.includes(i)) continue;
    const room = map.rooms[i];
    if (room.width < SEALED_ROOM_MINIMUM_INTERIOR_SIZE || room.height < SEALED_ROOM_MINIMUM_INTERIOR_SIZE) continue;
    if (computeMonsterHouseEntryCells(map, i).length !== 1) continue;
    candidates.push(i);
  }
  return candidates;
}

/** Sealed rooms are descent-only, from depth 19 through 25 inclusive. */
export const SEALED_ROOM_MINIMUM_DEPTH = 19;
export const SEALED_ROOM_MAXIMUM_DEPTH = 25;

/** Returns whether `depth` and `leg` are eligible to roll for a sealed room. Pure; consumes no RNG. */
export function isSealedRoomEligibleFloor(depth: number, leg: 'descent' | 'ascent'): boolean {
  return leg === 'descent' && depth >= SEALED_ROOM_MINIMUM_DEPTH && depth <= SEALED_ROOM_MAXIMUM_DEPTH;
}

/** Provisional per-eligible-floor occurrence probability (Phase 24.7a). */
export const SEALED_ROOM_OCCURRENCE_PROBABILITY = 0.05;

/**
 * Phase 24.7a: derives this floor's independent sealed-room RNG stream from
 * `floorSeed`, using a dedicated XOR constant checked against every existing
 * floor-seed-derived stream salt: placement 0x51ed270b, depth enemy roster
 * 0xd4b82f19, species 0x8f3c9d21, slow trap 0x1a6f83c5, trap type slot 1
 * 0x6a3fc19d, poison trap 0x3f9c5e82, trap type slot 2 0x9b1ea472,
 * trap slot 3 0x73d5a8c1, trap type slot 3 0xc8462f5b, trap slot 4
 * 0x2be79164, trap type slot 4 0xf52c4a07, card category 0x2f7b91d4,
 * card rarity 0x6c1e83fa, card body 0x94b2d1c7, accessory rank
 * 0xa39f6e52, accessory item 0xe61c8b3d, item placement 0x91b6d8e4,
 * equipment curse 0xc7d4a19e, equipment definition 0xd4e8a273, item count
 * 0xa3c17f05, item selection 0x5c2e91d3, food-guarantee placement
 * 0x8f31c2a6, sunlight 0x7c3a91e6, monster-house occurrence/selection
 * 0x6b2f4d97, monster-house enemy position 0x2d84b6f1, monster-house enemy
 * species 0x7a19e3c8, monster-house reward position 0x4e7bc218, and
 * monster-house reward selection 0x9f1a5d63, and sealed-room guardian level
 * 0xc13fa9b7. It was also checked against
 * floor-seed-mixed enemy-drop salts 0x5e2f8b41, 0x8b1c4f6d, 0xa47d2c19,
 * 0xd1e9736c, 0x2f7b91d4, 0x6c1e83fa, 0x94b2d1c7, 0xa39f6e52, and
 * 0xe61c8b3d, plus generation-audit salt 0x17c4a9ed.
 */
export const SEALED_ROOM_RNG_XOR = 0x35ad70e9;

/** Dedicated floor-seed salt for the sealed-room guardian's level roll. */
export const SEALED_ROOM_GUARDIAN_LEVEL_RNG_XOR = 0xc13fa9b7;

/** Spawn-origin identity reserved for the later production guardian wiring slice. */
export const SEALED_ROOM_GUARDIAN_SPAWN_SOURCE = 'sealed_room_guardian' as const;

/** Creates this floor's dedicated sealed-room RNG stream. `createRngFn` is injected to avoid a circular import. */
export function createSealedRoomRng(
  floorSeed: number,
  createRngFn: (seed: number) => () => number,
): () => number {
  return createRngFn(floorSeed ^ SEALED_ROOM_RNG_XOR);
}

/** Creates an RNG stream independent from sealed-room occurrence and room selection. */
export function createSealedRoomGuardianLevelRng(
  floorSeed: number,
  createRngFn: (seed: number) => () => number,
): () => number {
  return createRngFn(floorSeed ^ SEALED_ROOM_GUARDIAN_LEVEL_RNG_XOR);
}

/** Resolves the canonical golem level for an eligible sealed-room depth. */
export function resolveSealedRoomGuardianLevel(depth: number, rng: () => number): EnemyLevel {
  const selection = getEnemyLevelBandForDepth('golem', depth);
  if (selection === null) {
    throw new RangeError(`Sealed-room guardian depth is outside the golem appearance window: ${depth}`);
  }

  const totalWeight = (Object.values(selection.weights) as number[]).reduce((sum, weight) => sum + weight, 0);
  const roll = rng() * totalWeight;
  let cumulative = 0;
  let level: EnemyLevel = 3;
  for (const candidateLevel of [1, 2, 3] as const) {
    cumulative += selection.weights[candidateLevel];
    if (roll < cumulative) {
      level = candidateLevel;
      break;
    }
  }
  return level;
}

/** Returns whether an enemy carries the dedicated sealed-room guardian identity. */
export function isSealedRoomGuardian(enemy: { spawnSource?: EnemyActor['spawnSource'] }): boolean {
  return enemy.spawnSource === SEALED_ROOM_GUARDIAN_SPAWN_SOURCE;
}

/** Mints the guardian's deterministic one-individual reward after its defeat. */
export function generateSealedRoomGuardianReward(
  nextEquipmentInstanceId: number,
  nextGroundItemId: number,
  rewardPosition: Vec2,
  guardianDefeated: boolean,
  alreadyGenerated: boolean,
): { instance: EquipmentInstance; groundItem: GroundItem } | null {
  if (!guardianDefeated || alreadyGenerated) return null;

  const instance = mintEquipmentInstance(nextEquipmentInstanceId, 'black_armor');
  return {
    instance,
    groundItem: {
      id: nextGroundItemId,
      itemId: 'black_armor',
      pos: rewardPosition,
      equipmentInstanceId: instance.instanceId,
      spawnSource: 'sealed_room_reward',
    },
  };
}

export type SealedRoomFloorState = SealedRoomState;

/**
 * Decides this floor's sealed-room state in the fixed order: eligibility,
 * run-wide cap, candidate availability, occurrence roll, then uniform room
 * selection. Ineligible, already-satisfied, and candidate-empty cases consume
 * no RNG; a failed roll consumes one call and a successful decision two.
 */
export function decideSealedRoomFloorState(
  depth: number,
  leg: 'descent' | 'ascent',
  alreadyGeneratedThisRun: boolean,
  candidateRoomIndices: number[],
  rng: () => number,
): SealedRoomFloorState {
  if (!isSealedRoomEligibleFloor(depth, leg)) return null;
  if (alreadyGeneratedThisRun) return null;
  if (candidateRoomIndices.length === 0) return null;

  if (rng() >= SEALED_ROOM_OCCURRENCE_PROBABILITY) return null;

  const pickIndex = Math.floor(rng() * candidateRoomIndices.length);
  return { roomIndex: candidateRoomIndices[pickIndex] };
}

/** Extracts candidates and decides sealed-room state with eligibility/run-cap short-circuiting. */
export function buildSealedRoomFloorState(
  map: GameMap,
  depth: number,
  leg: 'descent' | 'ascent',
  start: Vec2,
  exit: Vec2,
  alreadyGeneratedThisRun: boolean,
  excludeRoomIndices: number[],
  rng: () => number,
): SealedRoomFloorState {
  if (!isSealedRoomEligibleFloor(depth, leg)) return null;
  if (alreadyGeneratedThisRun) return null;
  const candidates = extractSealedRoomCandidateRooms(map, start, exit, excludeRoomIndices);
  return decideSealedRoomFloorState(depth, leg, alreadyGeneratedThisRun, candidates, rng);
}
