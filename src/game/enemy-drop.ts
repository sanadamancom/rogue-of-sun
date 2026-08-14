import { createRng } from './mapgen';
import { isWalkable } from './map';
import { getGroundItemPoolForFloor } from './item-def';
import { FLOOR_EQUIPMENT_CURSE_CHANCE } from './equipment-instance';
import { floorProgressRatio, isNormalEquipmentSlot, selectNormalEquipmentDefinition } from './equipment-loot';
import { resolveCardSlot } from './card-loot';
import { ALL_DIRECTIONS, ArmorId, DIRECTION_VECTORS, GameMap, ItemId, Vec2, WeaponId } from './types';

/**
 * Phase 24.4b: deterministic enemy-drop resolution and placement search.
 * Every function here is pure (no state mutation, no access to
 * GameState) — turn.ts's single terminal-defeat choke point
 * (defeatEnemyIfNeeded) is the only caller, and it alone performs the
 * actual state mutation (GroundItem push, EquipmentInstance mint,
 * nextGroundItemId/nextEquipmentInstanceId increments), matching this
 * module's "候補列挙と実抽選を専用moduleへ集約する" contract while
 * keeping the "新しいmutable RNG stateをGameStateへ追加しない" contract
 * — nothing here is stored; every rng() stream is created fresh per
 * call from (floorSeed, enemyId, salt) alone, so results never depend on
 * defeat order, call count, or any other enemy's outcome.
 */

/**
 * Phase 24.6-tunable provisional per-defeat drop probability (10%, per
 * producer_decisions' drop_chance). Not a final balance value — see this
 * module's history doc (docs/history/phase-24-4b-enemy-drops.md) and
 * Phase 24.4a's identical RANK_WEIGHT_PROVISIONAL precedent
 * (equipment-loot.ts) for the same "single named constant, Phase 24.6
 * retunes only this" pattern. No per-species/per-floor/per-attack-method
 * modifier exists yet — deliberately out of this Phase's scope.
 */
export const ENEMY_DROP_CHANCE_PROVISIONAL = 0.1;

// Each drop-relevant decision (occurrence roll, item-category draw,
// equipment definition draw, curse roll) gets its own independent salt
// so that, for example, an enemy whose drop-occurrence roll fails never
// perturbs what a *different* enemy's item-selection roll would have
// been — every stream is independently derived from (floorSeed,
// enemyId, salt) alone, never chained from a shared counter.
const SALT_DROP_OCCURS = 0x5e2f8b41;
const SALT_ITEM_SELECTION = 0x8b1c4f6d;
const SALT_EQUIPMENT_DEFINITION = 0xa47d2c19;
const SALT_EQUIPMENT_CURSE = 0xd1e9736c;
// Phase 24.4c: 3 further independent salts for the card-vs-noncard
// category roll, card rarity roll, and card body roll — applied only
// *after* rollEnemyDropOccurs already succeeded (producer_decisions'
// "enemy_dropではドロップ成立後の候補選択だけにカード10%を適用する"),
// so a failed drop-occurrence roll never consumes any of these 3
// streams at all.
const SALT_CARD_CATEGORY = 0x2f7b91d4;
const SALT_CARD_RARITY = 0x6c1e83fa;
const SALT_CARD_BODY = 0x94b2d1c7;

/**
 * Combines `floorSeed` (already unique per run+floor — GameState.seed,
 * derived in floor.ts from runSeed) with `enemyId` (EnemyActor.id — stable
 * for this enemy's entire life on this floor, assigned once at creation
 * time from its creation-time index in state.enemies, never an ad hoc
 * array-position lookup) and a purpose-specific `salt`, producing a
 * single uint32 seed. Pure arithmetic, no RNG consumed by this function
 * itself. `Math.imul` prevents float-precision loss for the
 * `(enemyId + 1) * constant` term at typical enemyId ranges.
 */
function deriveEnemyDropSeed(floorSeed: number, enemyId: number, salt: number): number {
  return ((floorSeed ^ Math.imul(enemyId + 1, 0x9e3779b1)) ^ salt) >>> 0;
}

/** A fresh, single-use RNG stream for one (floorSeed, enemyId, salt) triple. Never stored — a new instance is created and consumed exactly once per call site below, so no mutable RNG state is ever added to GameState. */
function createEnemyDropRng(floorSeed: number, enemyId: number, salt: number): () => number {
  return createRng(deriveEnemyDropSeed(floorSeed, enemyId, salt));
}

/**
 * Whether this genuinely-defeated enemy drops loot at all — the sole
 * occurrence roll, consuming exactly one rng() call from its own
 * SALT_DROP_OCCURS-derived stream. Never touches state.combatRngState or
 * any other existing stream.
 */
export function rollEnemyDropOccurs(floorSeed: number, enemyId: number): boolean {
  const rng = createEnemyDropRng(floorSeed, enemyId, SALT_DROP_OCCURS);
  return rng() < ENEMY_DROP_CHANCE_PROVISIONAL;
}

/**
 * Draws one non-card ordinary-item candidate id for `floor`
 * (producer_decisions' drop_contents: reuse the existing normal-floor
 * loot candidates, add no new ItemId, exclude cards/special-event-only
 * items/black_armor). `getGroundItemPoolForFloor` (item-def.ts,
 * unchanged from Phase 15.4b/24.4a) already is exactly that set — it
 * never includes a CardId, a black_armor entry, or any id outside the
 * production non-card ground pool — so this draws uniformly from it
 * with no separate exclusion filtering needed. Consumes exactly one
 * rng() call from its own SALT_ITEM_SELECTION-derived stream, uniform
 * (equal weight), matching the equal BASE_GROUND_ITEM_WEIGHT every
 * non-card id already shares in normal floor generation.
 */
export function selectEnemyDropItemId(floor: number, floorSeed: number, enemyId: number): ItemId {
  const pool = getGroundItemPoolForFloor(floor);
  const rng = createEnemyDropRng(floorSeed, enemyId, SALT_ITEM_SELECTION);
  const index = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[index];
}

/**
 * Phase 24.4c: the enemy-drop route's card-supply connection point.
 * Only ever called after rollEnemyDropOccurs already succeeded — this
 * function itself resolves what that successful drop's contents are.
 * First tries card-loot.ts's shared resolveCardSlot (3 dedicated
 * streams, own salts, consumed only when this function runs at all —
 * so a failed drop-occurrence roll costs nothing here); if that
 * resolves to null (the 90% non-card branch), falls back to
 * selectEnemyDropItemId's existing non-card draw unchanged (same pool,
 * same SALT_ITEM_SELECTION stream, same 1-rng()-call contract). Never
 * duplicates the card candidate table or weighting logic — both live
 * solely in card-loot.ts.
 */
export function selectEnemyDropItemIdWithCards(floor: number, floorSeed: number, enemyId: number): ItemId {
  const categoryRng = createEnemyDropRng(floorSeed, enemyId, SALT_CARD_CATEGORY);
  const rarityRng = createEnemyDropRng(floorSeed, enemyId, SALT_CARD_RARITY);
  const bodyRng = createEnemyDropRng(floorSeed, enemyId, SALT_CARD_BODY);
  const card = resolveCardSlot(categoryRng, rarityRng, bodyRng);
  if (card) return card;
  return selectEnemyDropItemId(floor, floorSeed, enemyId);
}

/**
 * Resolves a drawn equipment "slot" id ('sword' | 'spear' | 'hammer' |
 * 'armor' | 'solar_gun') into an actual catalog definitionId, reusing
 * Phase 24.4a's floorProgressRatio/selectNormalEquipmentDefinition
 * verbatim (never reimplemented here) — so enemy drops follow the exact
 * same C/B/A rank-weight curve, at the same depth ratio, as normal floor
 * generation and monsterHouse rewards, and S/R/black_armor are excluded
 * by the same structural guarantee (equipment-loot.ts's
 * getNormalEquipmentCandidates never includes them). Consumes exactly
 * one rng() call from its own SALT_EQUIPMENT_DEFINITION-derived stream.
 */
export function resolveEnemyDropEquipmentDefinition(
  slot: 'sword' | 'spear' | 'hammer' | 'armor' | 'solar_gun',
  floor: number,
  totalFloors: number,
  floorSeed: number,
  enemyId: number,
): WeaponId | ArmorId {
  const ratio = floorProgressRatio(floor, totalFloors);
  const rng = createEnemyDropRng(floorSeed, enemyId, SALT_EQUIPMENT_DEFINITION);
  return selectNormalEquipmentDefinition(slot, ratio, rng);
}

/**
 * The curse roll for an enemy-dropped equipment individual — same
 * FLOOR_EQUIPMENT_CURSE_CHANCE threshold floor-generated equipment
 * already uses (equipment-instance.ts), but its own independent
 * SALT_EQUIPMENT_CURSE-derived stream, so it never shares or perturbs
 * state.ts's equipmentCurseRng consumption order. Consumes exactly one
 * rng() call.
 */
export function rollEnemyDropCurse(floorSeed: number, enemyId: number): boolean {
  const rng = createEnemyDropRng(floorSeed, enemyId, SALT_EQUIPMENT_CURSE);
  return rng() < FLOOR_EQUIPMENT_CURSE_CHANCE;
}

/**
 * Deterministic, RNG-free nearest-valid-cell search for placing an enemy
 * drop: `origin` (the defeat cell) is checked first; if occupied/
 * ineligible, a breadth-first search outward from `origin` — expanding
 * neighbors in the fixed ALL_DIRECTIONS order every time (never a random
 * order), so the result is identical for identical inputs regardless of
 * call context — finds the nearest walkable, unexcluded floor tile.
 * `exclusions` should already include the map exit, every
 * movement-blocking Actor's position (player and enemies), and every
 * existing GroundItem's position, per producer_decisions' placement
 * rules; this function itself only ever checks `isWalkable` (in-bounds,
 * terrain === 'floor') plus membership in `exclusions`. Returns null
 * (never throws) if the entire reachable board has no eligible cell —
 * the caller must treat that as "drop discarded", never blocking enemy
 * defeat/EXP/turn progression.
 */
export function findNearestValidDropCell(map: GameMap, origin: Vec2, exclusions: ReadonlyArray<Vec2>): Vec2 | null {
  const key = (p: Vec2) => `${p.x},${p.y}`;
  const excluded = new Set(exclusions.map(key));
  const isEligible = (p: Vec2) => isWalkable(map, p) && !excluded.has(key(p));

  if (isEligible(origin)) return origin;

  const visited = new Set<string>([key(origin)]);
  const queue: Vec2[] = [origin];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const dir of ALL_DIRECTIONS) {
      const vec = DIRECTION_VECTORS[dir];
      const next: Vec2 = { x: current.x + vec.x, y: current.y + vec.y };
      const nextKey = key(next);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      // Walls are dead ends for this search (never expanded through),
      // matching the exclusion of non-floor tiles from eligibility —
      // but they are still valid to *pass over* as BFS frontier nodes
      // only when walkable, so a wall never contributes a shorter path
      // around itself for this purely grid-distance (not path-distance)
      // search. This keeps the search cheap and fully deterministic
      // without needing full pathfinding for what is only ever a "find
      // any nearby empty tile" placement fallback.
      if (!isWalkable(map, next)) continue;
      if (isEligible(next)) return next;
      queue.push(next);
    }
  }
  return null;
}

/** True for exactly the 5 pool slot ids equipment resolution applies to — re-exported here so turn.ts's terminal hook never needs to import isNormalEquipmentSlot from equipment-loot.ts directly for this one check. */
export { isNormalEquipmentSlot };
