import {
  choosePlacement,
  computeStartAndExit,
  chooseGroundItemPosition,
  chooseTrapPosition,
  roomIndexContaining,
  createRng,
  generateMap,
  MAP_GEN_PARAMS,
  ENEMY_COUNT_BY_FLOOR,
  ENEMY_COUNT_PER_FLOOR,
} from './mapgen';
import { createInitialActor, createInitialEnemy, revealTrap } from './turn';
import { GameEvent } from './events';
import { selectTrapType } from './curse-active';
import { chooseDarkRoomIndex } from './dark-rooms';
import { buildMonsterHouseFloorState, createMonsterHouseRng } from './monster-house';
import { buildSealedRoomFloorState, createSealedRoomRng } from './sealed-room';
import {
  chooseMonsterHouseEnemyTypes,
  computeMonsterHouseCandidateCells,
  computeMonsterHouseEnemyCount,
  createMonsterHouseEnemyPositionRng,
  createMonsterHouseEnemySpeciesRng,
  createMonsterHouseRewardPositionRng,
  createMonsterHouseRewardSelectionRng,
  MONSTER_HOUSE_REWARD_COUNT,
  selectMonsterHouseEnemyPositions,
  selectMonsterHouseRewardPositions,
} from './monster-house';
import { deriveFloorSeed, DEFAULT_RUN_CONFIG, normalizeRunConfig } from './floor';
import { floorVisitOrdinal, transitionFloor } from './floor-transition';
import { applyEnemyLevelMultiplier, ENEMY_DEFINITIONS, ENEMY_TYPES_IN_ORDER, getEnemyPoolForFloor } from './enemy-def';
import { resolveEnemySpawnsForDepth } from './enemy-depth-bands';
import {
  createEmptyInventory,
  drawGroundItemCount,
  drawWeightedGroundItemSelection,
  ENCHANTMENT_ITEM_IDS,
  getWeightedGroundItemPoolForFloor,
} from './item-def';
import { CARD_IDS_IN_ORDER } from './card-def';
import {
  FLOOR_EQUIPMENT_CURSE_CHANCE,
  isAccessoryId,
  isWeaponOrArmorId,
  mintEquipmentInstance,
  normalizeEquipmentInstances,
  resetPerFloorEquipmentEffectState,
} from './equipment-instance';
import { floorProgressRatio, isNormalEquipmentSlot, selectNormalEquipmentDefinition } from './equipment-loot';
import { substituteLootSlots } from './accessory-loot';
import { generateSunlightLayer } from './sunlight';
import { HUNGER_MAX } from './hunger';
import {
  PROGRESSION_INITIAL_EXPERIENCE,
  PROGRESSION_INITIAL_LEVEL,
  PROGRESSION_INITIAL_UNSPENT_ABILITY_POINTS,
} from './progression';
import { INITIAL_ABILITY_VALUES } from './ability';
import { normalizeIdentifiedGeneralItemIds } from './item-identification';
import { Actor, ActiveEffect, AbilityValues, AccessoryId, CardId, ElementId, EnchantmentId, EnemyActor, EnemyLevel, EnemyType, EquipmentInstance, GameState, GroundItem, Inventory, ItemId, TrapTile, Vec2, WeaponId, ArmorId, Direction8, RunConfig } from './types';

/** Generates a random run seed without relying on Math.random's implicit global state at call sites. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

interface CarryOverStats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  accuracy: number;
  evasion: number;
  regenProgress: number;
  inventory: Inventory;
  equippedWeaponId: WeaponId | null;
  equippedArmorId: ArmorId | null;
  facing: Direction8;
  solarEnergy: number;
  maxSolarEnergy: number;
  solUnlocked: boolean;
  selectedEnchantment: EnchantmentId;
  unlockedEnchantments: Record<ElementId, boolean>;
  combatRngState: number;
  hunger: number;
  hungerDecreaseProgress: number;
  starvationProgress: number;
  /** Phase 15.2 recovery/satiety/status rebalance: carried across floor transitions like hungerDecreaseProgress/starvationProgress — see types.ts's GameState.poisonTickProgress doc comment. */
  poisonTickProgress: number;
  /** Phase 24.6c4a food-shortage correction counter; see types.ts's GameState.foodDroughtFloors doc comment. */
  foodDroughtFloors: number;
  /** Phase 24.7e1 run-wide sealed-room cap; see types.ts's GameState.sealedRoomGeneratedThisRun doc comment. */
  sealedRoomGeneratedThisRun?: boolean;
  hungerLowWarned: boolean;
  hungerZeroWarned: boolean;
  activeEffects: ActiveEffect[];
  level: number;
  experience: number;
  unspentAbilityPoints: number;
  abilities: AbilityValues;
  identifiedCardIds: CardId[];
  identifiedGeneralItemIds: ItemId[];
  equipmentInstances: EquipmentInstance[];
  nextEquipmentInstanceId: number;
  equippedWeaponInstanceId: string | null;
  equippedArmorInstanceId: string | null;
  // Phase 24.5b: accessory's own equipped pair, carried across floor
  // transitions like weapon/armor's — see buildFloorState's identical
  // carry-over lines for equippedWeaponId/equippedArmorId.
  equippedAccessoryId?: AccessoryId | null;
  equippedAccessoryInstanceId?: string | null;
}

/**
 * Normalizes a possibly-absent/possibly-corrupted `identifiedCardIds`
 * value into a clean, deduplicated `CardId[]` containing only recognized
 * card ids, preserving first-seen order. Used by both
 * advanceToNextFloor's carry-over (defensive normalization of a value
 * that already passed through a prior floor) and would be the same
 * function a future save/load path should reuse (Phase 20.0b's
 * additive-default-and-normalize requirement) — see
 * types.ts's GameState.identifiedCardIds doc comment.
 */
export function normalizeIdentifiedCardIds(value: CardId[] | undefined): CardId[] {
  if (!value) return [];
  const known = new Set<CardId>(CARD_IDS_IN_ORDER);
  const seen = new Set<CardId>();
  const result: CardId[] = [];
  for (const id of value) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/** Fixed initial/maximum solar energy for a brand new run (Phase 09.1; Phase 15.1 rebalance raises this from 5 to 15 to match the player's initial max LIFE — see docs/history/phase-15-1-core-combat-rebalance.md). */
const INITIAL_SOLAR_ENERGY = 15;
const INITIAL_MAX_SOLAR_ENERGY = 15;

/**
 * Picks `count` species independently (with replacement) from `pool` using
 * `rng`, in fixed enemy-slot order. Each slot is an independent draw
 * (duplicates across slots are allowed). `pool` is normally the current
 * floor's unlocked candidate set (Phase 08.1 floor-based enemy pools) so
 * that, over enough seeds, every unlocked species appears somewhere across
 * floors without needing to inflate how many enemies a single floor spawns.
 * Selection remains a uniform draw over whatever pool is passed in — this
 * function does not itself know about floor numbers.
 */
export function chooseSpecies(count: number, rng: () => number, pool: EnemyType[]): EnemyType[] {
  const types: EnemyType[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * pool.length);
    types.push(pool[index]);
  }
  return types;
}

export function buildEnemies(
  positions: Vec2[],
  types: EnemyType[],
  spawnTurn: number,
  idOffset: number = 0,
  levels?: EnemyLevel[],
): EnemyActor[] {
  return positions.map((pos, i) => {
    const type = types[i];
    const def = ENEMY_DEFINITIONS[type];
    const level = levels?.[i] ?? 1;
    const stats = applyEnemyLevelMultiplier(def, level);
    return createInitialEnemy(type, pos, stats.hp, stats.attack, spawnTurn, idOffset + i, stats.defense, stats.accuracy, stats.evasion, level);
  });
}

/**
 * Phase 15.4b random ground item generation: the subset of
 * ENCHANTMENT_ITEM_IDS that `carry` (if any) has already unlocked, and
 * therefore must never be drawn again as a ground item on this floor —
 * see item-def.ts's drawGroundItemSelection doc comment. A brand new run
 * (no carry) has nothing unlocked yet, matching every other carry-based
 * field's "absent carry = fresh defaults" convention elsewhere in this
 * file (e.g. solUnlocked/unlockedEnchantments themselves, just below).
 */
function getAlreadyUnlockedEnchantmentItemIds(carry?: CarryOverStats): Set<ItemId> {
  const unlocked = new Set<ItemId>();
  if (!carry) return unlocked;
  if (carry.solUnlocked) unlocked.add('sol_enchantment');
  if (carry.unlockedEnchantments.flame) unlocked.add('flame_enchantment');
  if (carry.unlockedEnchantments.frost) unlocked.add('frost_enchantment');
  if (carry.unlockedEnchantments.cloud) unlocked.add('cloud_enchantment');
  if (carry.unlockedEnchantments.earth) unlocked.add('earth_enchantment');
  return unlocked;
}

/** Phase 24.6c3a2 trap slots per current depth, clamped to the designed bands. */
export function trapCountForDepth(depth: number): number {
  if (Number.isNaN(depth) || depth <= 10) return 2;
  if (depth <= 19) return 3;
  return 4;
}

/**
 * Builds the GameState for a single floor of a run. Retries via
 * generateMap's own deterministic retry loop; if generation still fails,
 * throws, since there is no sensible playable fallback for a failed floor.
 *
 * Normal play always spawns ENEMY_COUNT_PER_FLOOR (2) enemies, each an
 * independently seeded-random species draw from the full 9-species roster
 * (enemy-roster-density-correction); this keeps floor density at its
 * pre-Phase-06 value while still making every species a normal spawn
 * candidate. `enemyCount`/`forcedSpecies` let buildRosterPreviewFloorState
 * (test/dev-only, see below) reuse this same generation path to place all
 * 9 species together without touching normal spawning.
 */
export function buildFloorState(
  runSeed: number,
  floor: number,
  turn: number,
  floorVisitOrdinal: number,
  runConfig: Readonly<RunConfig>,
  carry?: CarryOverStats,
  enemyCount?: number,
  forcedSpecies?: EnemyType[],
  leg: GameState['leg'] = 'descent',
  enemySpawnPath: 'legacy' | 'depth' = 'legacy',
): GameState {
  const incomingFoodDroughtFloors = carry?.foodDroughtFloors ?? 0;
  const incomingSealedRoomGeneratedThisRun = carry?.sealedRoomGeneratedThisRun ?? false;
  const floorSeed = deriveFloorSeed(runSeed, floor, leg);
  const result = generateMap(floorSeed);
  if (!result.ok || !result.map) {
    throw new Error(
      `Map generation failed for floor seed ${floorSeed} (run ${runSeed}, floor ${floor}) after ${MAP_GEN_PARAMS.maxGenerationAttempts} attempts`,
    );
  }

  const map = result.map;
  const placementRng = createRng(floorSeed ^ 0x51ed270b);
  // The long-run transition path resolves its initial roster from the
  // canonical depth table on a dedicated stream. The legacy path remains
  // the default so createInitialState/advanceToNextFloor keep their exact
  // three-floor spawning contract.
  const depthSpawns = enemySpawnPath === 'depth'
    ? resolveEnemySpawnsForDepth(floor, createRng(floorSeed ^ 0xd4b82f19))
    : null;
  // Phase 15.5: an explicit enemyCount override (roster preview, tests)
  // always wins; otherwise resolve this floor's normal-play count from
  // mapgen.ts's ENEMY_COUNT_BY_FLOOR, falling back to the flat
  // ENEMY_COUNT_PER_FLOOR for any floor number that table doesn't define
  // (defensive only — TOTAL_FLOORS is 3, so every normal floor is
  // covered). This is the only place normal generation resolves enemy
  // count; choosePlacement itself is unaware of floor numbers.
  const resolvedEnemyCount = enemyCount ?? depthSpawns?.initialEnemyCount ?? ENEMY_COUNT_BY_FLOOR[floor] ?? ENEMY_COUNT_PER_FLOOR;
  const { start, exit } = computeStartAndExit(map);

  /**
   * Phase 24.7e1: decide and tag this floor's sealed room exactly once using
   * its independent RNG stream, without perturbing any other stream's
   * consumption order, and thread the run cap. Computed before
   * choosePlacement (Phase 24.7e2) so the sealed room's interior cells can
   * be excluded from normal enemy placement below; reordering when this
   * independent stream is created never perturbs placementRng's own
   * consumption count/order. Phase 24.7e2 also excludes these cells from
   * every trap/ground-item placement further down. Guardian spawning,
   * rewards, blocking-door enforcement, and telemetry remain deferred to a
   * later slice.
   */
  const sealedRoomRng = createSealedRoomRng(floorSeed, createRng);
  map.sealedRoom = buildSealedRoomFloorState(
    map,
    floor,
    leg,
    start,
    exit,
    incomingSealedRoomGeneratedThisRun,
    [],
    sealedRoomRng,
  );
  const sealedRoomExclusionCells: Vec2[] = map.sealedRoom
    ? computeMonsterHouseCandidateCells(map, map.sealedRoom.roomIndex, [])
    : [];
  const placement = choosePlacement(map, placementRng, resolvedEnemyCount, sealedRoomExclusionCells);

  // Phase 17.2: dark-room selection is a pure function of (floorSeed,
  // floor, map.rooms, start, exit) — no rng() call, so it cannot perturb
  // placementRng/speciesRng or any other stream's consumption count.
  // Mutating `map` here (rather than threading a new field through
  // generateMap's return type) keeps map generation itself untouched and
  // matches this field's doc comment on GameMap (owned by the map/floor
  // state, not derived ad hoc by the renderer).
  map.darkRoomIndex = chooseDarkRoomIndex(map, floorSeed, floor, placement.start, placement.exit);

  // Phase 21.2: monster house state is decided exactly once here, using
  // its own independent RNG stream (createMonsterHouseRng, XOR constant
  // 0x6b2f4d97 — distinct from every other floorSeed-derived stream in
  // this function) so it can never perturb placementRng/speciesRng/trap/
  // item RNG sequences or their consumption order. Not yet connected to
  // reveal/entry/enemy/reward/dark-room logic — see monster-house.ts and
  // docs/history/phase-21-2-monster-house-floor-state.md.
  const monsterHouseRng = createMonsterHouseRng(floorSeed, createRng);
  map.monsterHouse = buildMonsterHouseFloorState(
    map,
    floor,
    leg,
    placement.start,
    placement.exit,
    monsterHouseRng,
    map.sealedRoom ? [map.sealedRoom.roomIndex] : [],
  );

  const sealedRoomGeneratedThisRun = incomingSealedRoomGeneratedThisRun || map.sealedRoom !== null;

  const player: Actor = carry
    ? createInitialActor(placement.start, carry.maxHp, carry.attack, carry.defense, carry.accuracy, carry.evasion)
    : // Phase 15.1 core combat rebalance: maxHp 30->15, attack 10->2 (see
      // docs/history/phase-15-1-core-combat-rebalance.md); defense 0 (no
      // permanent player defense source yet besides equipped armor).
      // Phase 10.3 accuracy/evasion foundation: accuracy 90, evasion 0
      // (confirmed_design's initial_values.actors.player).
      createInitialActor(placement.start, 15, 2, 0, 90, 0);
  if (carry) {
    // maxHp/attack already set via createInitialActor above; only current
    // HP and facing need to be overridden to the carried-over values
    // (HP is never healed by a floor transition; facing is preserved
    // per Phase 08.6's "フロア遷移では向きを維持する").
    player.hp = carry.hp;
    player.facing = carry.facing;
  }

  // Species selection uses its own RNG stream (distinct XOR constant from
  // placementRng) so choosing species never perturbs the existing
  // placement-position RNG sequence/determinism.
  const speciesRng = createRng(floorSeed ^ 0x8f3c9d21);
  const types = forcedSpecies ?? depthSpawns?.spawns.map((spawn) => spawn.type)
    ?? chooseSpecies(placement.enemies.length, speciesRng, getEnemyPoolForFloor(floor));
  const levels = forcedSpecies ? undefined : depthSpawns?.spawns.map((spawn) => spawn.level);
  const enemies: EnemyActor[] = buildEnemies(placement.enemies, types, turn, 0, levels)
    .map((e) => ({ ...e, spawnSource: 'normal' as const }));

  // Phase 15.4b random ground item generation (replaces the previous
  // per-item, per-floor-condition guaranteed-placement blocks — see
  // docs/history/phase-15-4-random-ground-items.md). Traps are generated
  // first (see below `traps` block) so item placement can exclude their
  // tiles; item generation itself uses three independent RNG streams
  // (count, selection, placement — each its own distinct XOR constant),
  // so it never perturbs the map/placement/species RNG sequences or
  // their consumption order, and adding/removing items never perturbs
  // trap generation's own RNG streams either (traps are derived above
  // this point, from floorSeed alone, not from anything item-related).

  // Trap placement (Phase 12.2 slow_trap, Phase 12.3 poison_trap;
  // Phase 24.6c3a2 depth-keyed slots): 2 slots at depth 1-10, 3 at
  // depth 11-19, and 4 at depth 20-26, defensively clamped outside it.
  // Every slot uses distinct position/type RNG streams.
  // Phase 15.4b moves this ahead of ground item generation (previously
  // traps were placed after most, but not all, items) so that ground
  // items can uniformly exclude every trap tile — traps themselves only
  // ever need to exclude start/exit/every enemy position, since no
  // ground item exists yet at this point in generation. Phase 21.4:
  // dedicated monster-house enemies are generated AFTER this point (see
  // below, right before `state` is assembled), specifically so trap and
  // ground-item generation stay completely untouched by their existence
  // — dedicated enemies avoid trap/item positions, never the reverse.
  const traps: TrapTile[] = [];
  const slowTrapExclusions = [placement.start, placement.exit, ...placement.enemies, ...sealedRoomExclusionCells];
  const slowTrapRng = createRng(floorSeed ^ 0x1a6f83c5);
  const slowTrapPos = chooseTrapPosition(map, map.rooms, placement.start, placement.exit, slowTrapExclusions, slowTrapRng);
  // Phase 24.4e1: this slot's *position* selection above is completely
  // unchanged from Phase 12.2 (same RNG stream, same exclusions, same
  // consumption count) — only its *type* is now a weighted draw
  // (curse-active.ts's selectTrapType, 45/45/10) from its own
  // independent RNG stream, instead of the previous hardcoded
  // 'slow_trap' literal. Consumed only when this slot actually produces
  // a position (mirrors the existing `if (slowTrapPos)` gate), so a
  // floor whose slot 1 placement fails never perturbs this stream's
  // future consumption either.
  const trapTypeSlot1Rng = createRng(floorSeed ^ 0x6a3fc19d);
  if (slowTrapPos) {
    traps.push({ id: traps.length, pos: slowTrapPos, revealed: false, triggered: false, trapType: selectTrapType(trapTypeSlot1Rng) });
  }

  // Poison trap placement (Phase 12.3): prefers a different room from
  // slow_trap's (fixed_specification.poison_trap.placement's "可能なら
  // slow_trapとは別の部屋へ配置する") — unchanged from the pre-15.4b
  // logic, just with a groundItems-free exclusion list (see above).
  const poisonTrapExclusions = [placement.start, placement.exit, ...placement.enemies, ...traps.map((t) => t.pos), ...sealedRoomExclusionCells];
  const poisonTrapRng = createRng(floorSeed ^ 0x3f9c5e82);
  const slowTrapRoomIndex = slowTrapPos ? roomIndexContaining(map.rooms, slowTrapPos) : -1;
  const otherRooms = slowTrapRoomIndex === -1 ? map.rooms : map.rooms.filter((_, i) => i !== slowTrapRoomIndex);
  let poisonTrapPos = chooseTrapPosition(
    map,
    otherRooms,
    placement.start,
    placement.exit,
    poisonTrapExclusions,
    poisonTrapRng,
  );
  if (!poisonTrapPos && slowTrapPos) {
    poisonTrapPos = chooseTrapPosition(
      map,
      map.rooms,
      placement.start,
      placement.exit,
      poisonTrapExclusions,
      poisonTrapRng,
      { pos: slowTrapPos, distance: 3 },
    );
  }
  // Phase 24.4e1: same treatment as slot 1 above — position RNG/logic
  // unchanged, only the type is now a weighted draw from its own
  // independent stream in place of the previous hardcoded 'poison_trap'
  // literal.
  const trapTypeSlot2Rng = createRng(floorSeed ^ 0x9b1ea472);
  if (poisonTrapPos) {
    traps.push({ id: traps.length, pos: poisonTrapPos, revealed: false, triggered: false, trapType: selectTrapType(trapTypeSlot2Rng) });
  }

  const trapSlotCount = trapCountForDepth(floor);
  if (trapSlotCount >= 3) {
    const trapSlot3Rng = createRng(floorSeed ^ 0x73d5a8c1);
    const trapSlot3Pos = chooseTrapPosition(
      map, map.rooms, placement.start, placement.exit,
      [placement.start, placement.exit, ...placement.enemies, ...traps.map((t) => t.pos), ...sealedRoomExclusionCells],
      trapSlot3Rng,
    );
    if (trapSlot3Pos) {
      const trapTypeSlot3Rng = createRng(floorSeed ^ 0xc8462f5b);
      traps.push({ id: traps.length, pos: trapSlot3Pos, revealed: false, triggered: false, trapType: selectTrapType(trapTypeSlot3Rng) });
    }
  }

  if (trapSlotCount >= 4) {
    const trapSlot4Rng = createRng(floorSeed ^ 0x2be79164);
    const trapSlot4Pos = chooseTrapPosition(
      map, map.rooms, placement.start, placement.exit,
      [placement.start, placement.exit, ...placement.enemies, ...traps.map((t) => t.pos), ...sealedRoomExclusionCells],
      trapSlot4Rng,
    );
    if (trapSlot4Pos) {
      const trapTypeSlot4Rng = createRng(floorSeed ^ 0xf52c4a07);
      traps.push({ id: traps.length, pos: trapSlot4Pos, revealed: false, triggered: false, trapType: selectTrapType(trapTypeSlot4Rng) });
    }
  }

  const alreadyUnlocked = getAlreadyUnlockedEnchantmentItemIds(carry);
  let selectedItemIds: ItemId[] = [];
  const cardCategoryRng = createRng(floorSeed ^ 0x2f7b91d4);
  const cardRarityRng = createRng(floorSeed ^ 0x6c1e83fa);
  const cardBodyRng = createRng(floorSeed ^ 0x94b2d1c7);
  const accessoryRankRng = createRng(floorSeed ^ 0xa39f6e52);
  const accessoryItemRng = createRng(floorSeed ^ 0xe61c8b3d);
  const itemPlacementRng = createRng(floorSeed ^ 0x91b6d8e4);
  const equipmentCurseRng = createRng(floorSeed ^ 0xc7d4a19e);
  const equipmentDefinitionRng = createRng(floorSeed ^ 0xd4e8a273);
  const equipmentFloorRatio = floorProgressRatio(floor, runConfig.totalFloors);
  const floorEquipmentInstances: EquipmentInstance[] = carry ? carry.equipmentInstances.map((i) => ({ ...i })) : [];
  let nextFloorEquipmentInstanceId = carry ? carry.nextEquipmentInstanceId : 0;
  const groundItems: GroundItem[] = [];

  if (leg === 'descent') {

  // Ground item count (Phase 15.4b): drawn once from item-def.ts's
  // GROUND_ITEM_COUNT_WEIGHTS (2-6, expected value 4.0), using its own
  // independent RNG stream so it never perturbs any other stream's
  // consumption order.
  const itemCountRng = createRng(floorSeed ^ 0xa3c17f05);
  const itemCount = drawGroundItemCount(itemCountRng);

  // Ground item selection (Phase 15.4b; Phase 20.0e adds weighted card
  // candidates): drawn from this floor's combined weighted candidate list
  // (item-def.ts's getWeightedGroundItemPoolForFloor — the pre-existing
  // non-card pool at BASE_GROUND_ITEM_WEIGHT each, plus Phase
  // 20.1/20.2/20.3's 9 implemented cards at their own lootWeight), with
  // already-unlocked enchantment ids filtered out first (they can never
  // be drawn again once carried over as unlocked) via the same
  // `excludedIds` parameter the unweighted pool used to be `.filter()`ed
  // with directly, using its own independent RNG stream — separate from
  // both the count stream above and the placement stream below, per
  // implementation_requirements' "種類抽選と座標抽選のRNGストリームを分
  // 離する". Still exactly one rng() call per drawn slot, unchanged from
  // before cards existed — see drawWeightedGroundItemSelection's doc
  // comment.
  const weightedFloorItemPool = getWeightedGroundItemPoolForFloor(floor, alreadyUnlocked, leg);
  const itemSelectionRng = createRng(floorSeed ^ 0x5c2e91d3);
  const drawnItemIds = drawWeightedGroundItemSelection(itemCount, weightedFloorItemPool, itemSelectionRng);

  // Phase 24.4c: card-supply connection. Every one of the itemCount
  // slots just drawn above (unchanged: same weighted non-card pool, same
  // itemSelectionRng stream, same consumption count) independently gets
  // a 10% chance (card-loot.ts's CARD_ROUTE_WEIGHT_PROVISIONAL) of being
  // replaced by a card instead — via 3 brand-new, dedicated RNG streams
  // (own XOR constants, never touching itemCountRng/itemSelectionRng/
  // itemPlacementRng/equipmentCurseRng/equipmentDefinitionRng's own
  // consumption order/count). Placed *before* the floor-1 chocolate
  // guarantee below so that guarantee's own "is chocolate present"
  // check/substitution — an existing, out-of-scope-for-this-Phase
  // balance rule — keeps taking priority exactly as before: if the
  // guarantee's target slot happens to have just become a card, the
  // guarantee still overwrites it with chocolate, unchanged from every
  // prior Phase's behavior for that slot.
  // Phase 24.5c: this same categoryRng stream (unchanged salt) now
  // decides among 3 categories per slot (card/accessory/non_card) via
  // accessory-loot.ts's rollLootCategory instead of card-loot.ts's old
  // 2-way rollIsCardSlot — still exactly one rng() call per slot, and
  // card's own share of that single roll is numerically unchanged (see
  // rollLootCategory's doc comment), so card's production rate is
  // unaffected by this Phase. 2 further independent streams
  // (accessoryRankRng/accessoryItemRng, own XOR constants) back the
  // accessory rank+body draw, consumed only for a slot this roll
  // actually resolves to 'accessory' — never touching
  // itemCountRng/itemSelectionRng/itemPlacementRng/equipmentCurseRng/
  // equipmentDefinitionRng/cardRarityRng/cardBodyRng's own consumption
  // order or count.
  selectedItemIds = substituteLootSlots(
    drawnItemIds,
    cardCategoryRng,
    cardRarityRng,
    cardBodyRng,
    accessoryRankRng,
    accessoryItemRng,
    { depth: floor, leg },
  );

  // Phase 16.1 early-resource-and-combat-pressure rebalance: floor 1's
  // ground-item pool has 11 candidate ids but 'chocolate' (the only
  // hunger-restoring item — apple heals HP, not hunger) is just one
  // uniform draw among them, so with the average draw count of 4 the
  // floor had roughly a 68% chance of generating zero food at all (see
  // docs/history/phase-16-early-game-balance.md's Phase 16.1 section for
  // the measured figure). Rather than reduce that risk only
  // probabilistically (raising the draw count or chocolate's weight
  // would also inflate every OTHER item's expected count, which
  // balance_targets rules out — "アイテム総数を過剰に増やさない"),
  // floor 1 specifically gets a hard floor-item content guarantee: if
  // this draw didn't happen to include 'chocolate', the last drawn slot
  // is swapped for one — same total item count, same RNG consumption
  // (count/selection/placement streams are all untouched; this is a
  // fixed post-draw substitution, not an extra draw), same placement
  // logic below. Floors 2+ are unaffected — by floor 2 the player has
  // had a full floor to find *some* food, and per-floor cumulative pool
  // growth (item-def.ts) already broadens the odds naturally from there.
  if (floor === 1 && !selectedItemIds.includes('chocolate')) {
    selectedItemIds[selectedItemIds.length - 1] = 'chocolate';
  }

  // Ground item placement (Phase 15.4b): each selected id is placed in
  // draw order via chooseGroundItemPosition, excluding start/exit/every
  // enemy position/every already-placed trap/every ground item placed
  // earlier in this same loop — using its own independent RNG stream, so
  // adding/removing items never perturbs the count or selection streams'
  // consumption order. Never falls back to a reduced item count or a
  // relaxed exclusion set: chooseGroundItemPosition throws explicitly if
  // no valid tile exists for a given draw (unchanged from every prior
  // phase's ground-item placement contract).
  // Phase 20.0c: floor-generated weapon/armor individuals are minted
  // here (curse roll included) — never at pickup — so a floor-generated
  // equipment individual's identity and curse result are fixed the
  // instant it's placed on the floor, before the player ever sees or
  // picks it up (rogue-of-sun-card-effects-spec.md's "床に存在する段階
  // で結果が個体へ固定される" / "pickup時に再抽選しない"). Uses its own
  // independent RNG stream (own XOR constant, like every other stream in
  // this function), consumed exactly once per floor-generated weapon/
  // armor ground item — never for a consumable/card ground item, and
  // never perturbing itemCountRng/itemSelectionRng/itemPlacementRng's own
  // consumption order. Continues the same counter/array `carry` would
  // have supplied, so ids never collide across floors and every
  // previously-held individual's attributes survive unchanged into this
  // floor's equipmentInstances before any new ones are appended.
  // Phase 24.4a: resolves a ground-item pool equipment "slot" ('sword' |
  // 'spear' | 'hammer' | 'armor' | 'solar_gun') into an actual catalog
  // definitionId (e.g. 'flamberge'), weighted by this floor's depth
  // ratio — see equipment-loot.ts. Its own independent RNG stream (own
  // XOR constant), consumed exactly once per floor-generated weapon/
  // armor ground item (normal generation below and monsterHouse reward
  // generation further down), in the same relative order as
  // equipmentCurseRng — never perturbing itemCountRng/itemSelectionRng/
  // itemPlacementRng/equipmentCurseRng's own consumption counts.
  // Phase 24.6c4a food-shortage correction (long-run balance design §12):
  // reserve the guaranteed chocolate's cell before normal placement. Its
  // dedicated stream is created/consumed only when the guarantee fires, so
  // every pre-existing item/equipment/card/accessory stream remains exactly
  // unchanged in both consumption count and order.
  if (incomingFoodDroughtFloors >= 3) {
    const foodGuaranteePlacementRng = createRng(floorSeed ^ 0x8f31c2a6);
    const pos = chooseGroundItemPosition(
      map,
      placement.start,
      [placement.start, placement.exit, ...placement.enemies, ...traps.map((t) => t.pos), ...sealedRoomExclusionCells],
      foodGuaranteePlacementRng,
    );
    groundItems.push({ id: groundItems.length, itemId: 'chocolate', pos });
  }
  for (const itemId of selectedItemIds) {
    const exclusions = [
      placement.start,
      placement.exit,
      ...placement.enemies,
      ...traps.map((t) => t.pos),
      ...groundItems.map((item) => item.pos),
      ...sealedRoomExclusionCells,
    ];
    const pos = chooseGroundItemPosition(map, placement.start, exclusions, itemPlacementRng);
    if (isWeaponOrArmorId(itemId)) {
      const roll = equipmentCurseRng();
      const cursed = roll < FLOOR_EQUIPMENT_CURSE_CHANCE;
      // Phase 24.4a: itemId here is always one of the 5 pool "slots"
      // (isNormalEquipmentSlot true) — the resolved catalog definitionId
      // is what actually gets minted/placed, so pickup/inventory/equip
      // downstream see the real species (e.g. 'flamberge') from the
      // moment it's on the floor, matching the pre-existing "結果が個体
      // へ固定される" contract this same curse roll already followed.
      const resolvedDefinitionId = isNormalEquipmentSlot(itemId)
        ? selectNormalEquipmentDefinition(itemId, equipmentFloorRatio, equipmentDefinitionRng, {
          depth: floor,
          leg,
          })
        : itemId;
      const instance = mintEquipmentInstance(nextFloorEquipmentInstanceId, resolvedDefinitionId, cursed);
      nextFloorEquipmentInstanceId += 1;
      floorEquipmentInstances.push(instance);
      groundItems.push({ id: groundItems.length, itemId: resolvedDefinitionId, pos, equipmentInstanceId: instance.instanceId });
    } else if (isAccessoryId(itemId)) {
      // Phase 24.5c: accessory has no slot indirection (unlike weapon/
      // armor's 5-slot pool) — accessory-loot.ts's substituteLootSlots
      // already resolved this slot to a concrete AccessoryId, so no
      // definitionId resolution step is needed here. No curse roll
      // either (accessory-def.ts's 6 initial species are curse-excluded
      // this phase, per docs/history/phase-24-5a2-accessory-selection-
      // audit.md's finalized selection) — equipmentCurseRng is never
      // consumed for an accessory slot, preserving its existing
      // weapon/armor-only consumption count. Minted only after `pos`
      // above already succeeded (chooseGroundItemPosition throws
      // otherwise), so no orphaned instance is ever created.
      const instance = mintEquipmentInstance(nextFloorEquipmentInstanceId, itemId, false);
      nextFloorEquipmentInstanceId += 1;
      floorEquipmentInstances.push(instance);
      groundItems.push({ id: groundItems.length, itemId, pos, equipmentInstanceId: instance.instanceId });
    } else {
      groundItems.push({ id: groundItems.length, itemId, pos });
    }
  }
  }

  // Phase 21.4: dedicated monster-house enemies, generated last — after
  // every normal generation step (enemies, traps, ground items,
  // equipment) has fully finished — so the dedicated roster is the one
  // that avoids their positions, never the reverse, and normal
  // generation's own RNG streams/results are completely untouched by
  // whether a monster house exists at all. Position and species draws
  // each use their own independent RNG stream (distinct XOR constants
  // from every other floorSeed-derived stream, including monster-house
  // occurrence/selection's own 0x6b2f4d97), consumed only when
  // map.monsterHouse is non-null. Count (N) is derived purely from how
  // many eligible cells remain (C) — never from the floor number — via
  // computeMonsterHouseEnemyCount's N=clamp(ceil(sqrt(C)),4,8); a floor
  // number is only ever used afterward, to pick this floor's legal enemy
  // species pool (same as normal generation). See monster-house.ts and
  // docs/history/phase-21-4-monster-house-enemy-placement.md.
  if (map.monsterHouse) {
    const monsterHouseRoomIndex = map.monsterHouse.roomIndex;
    const occupiedExclusions: Vec2[] = [
      placement.start,
      placement.exit,
      ...placement.enemies,
      ...traps.map((t) => t.pos),
      ...groundItems.map((item) => item.pos),
    ];
    const candidateCells = computeMonsterHouseCandidateCells(map, monsterHouseRoomIndex, occupiedExclusions);
    const dedicatedCount = computeMonsterHouseEnemyCount(candidateCells.length);
    const positionRng = createMonsterHouseEnemyPositionRng(floorSeed, createRng);
    const speciesRng = createMonsterHouseEnemySpeciesRng(floorSeed, createRng);
    const dedicatedPositions = selectMonsterHouseEnemyPositions(candidateCells, dedicatedCount, positionRng);
    const dedicatedTypes = chooseMonsterHouseEnemyTypes(dedicatedCount, floor, speciesRng);
    const dedicatedEnemies = buildEnemies(dedicatedPositions, dedicatedTypes, turn, enemies.length).map((e) => ({
      ...e,
      spawnSource: 'monster_house' as const,
    }));
    enemies.push(...dedicatedEnemies);

    // Phase 21.5: dedicated monster-house rewards, generated right after
    // dedicated enemies so their positions are excluded too — reward
    // placement never causes normal generation (or Phase 21.4's enemy
    // placement) to be redone, moved, or deleted; it only ever avoids
    // everything already finalized. Uses its own two independent RNG
    // streams (position, selection — same pattern as normal item
    // generation's itemCountRng/itemSelectionRng split), consumed only
    // when a monster house exists. Item candidates reuse the exact same
    // legal weighted pool as normal ground item generation
    // (getWeightedGroundItemPoolForFloor), which already excludes cards
    // (floorDropEnabled: false) and any valuables/keys/debug items not
    // in that pool — no new reward table is introduced. Degrades to
    // fewer than MONSTER_HOUSE_REWARD_COUNT rewards (never throws, never
    // deletes existing generation) if fewer eligible cells remain — see
    // selectMonsterHouseRewardPositions's doc comment. See
    // docs/history/phase-21-5-monster-house-reward-placement.md.
    const rewardExclusions: Vec2[] = [
      placement.start,
      placement.exit,
      ...placement.enemies,
      ...dedicatedPositions,
      ...traps.map((t) => t.pos),
      ...groundItems.map((item) => item.pos),
    ];
    const rewardCandidateCells = computeMonsterHouseCandidateCells(map, monsterHouseRoomIndex, rewardExclusions);
    const rewardPositionRng = createMonsterHouseRewardPositionRng(floorSeed, createRng);
    const rewardSelectionRng = createMonsterHouseRewardSelectionRng(floorSeed, createRng);
    const rewardPositions = selectMonsterHouseRewardPositions(rewardCandidateCells, MONSTER_HOUSE_REWARD_COUNT, rewardPositionRng);
    if (rewardPositions.length > 0) {
      // Same one-enchantment-per-floor rule normal generation enforces
      // within its own draw (item-def.ts's drawWeightedGroundItemSelection)
      // must also hold across normal generation + this separate reward
      // draw combined — so any enchantment already selected by normal
      // generation this floor is excluded from the reward pool too.
      const alreadySelectedEnchantments = selectedItemIds.filter((id) => ENCHANTMENT_ITEM_IDS.includes(id));
      const rewardExcludedIds = new Set([...alreadyUnlocked, ...alreadySelectedEnchantments]);
      const rewardPool = getWeightedGroundItemPoolForFloor(floor, rewardExcludedIds, leg);
      const drawnRewardItemIds = drawWeightedGroundItemSelection(rewardPositions.length, rewardPool, rewardSelectionRng);
      // Phase 24.4c: same card-substitution pass as normal generation
      // above, continuing the same 3 dedicated card-selection streams
      // (cardCategoryRng/cardRarityRng/cardBodyRng) in their existing
      // consumption order — mirroring how equipmentDefinitionRng/
      // equipmentCurseRng already continue across both loops. Phase
      // 24.5c: also continues accessoryRankRng/accessoryItemRng in
      // their existing consumption order, via the same 3-way
      // substituteLootSlots normal generation above now uses.
      const rewardItemIds = substituteLootSlots(
        drawnRewardItemIds,
        cardCategoryRng,
        cardRarityRng,
        cardBodyRng,
        accessoryRankRng,
        accessoryItemRng,
        { depth: floor, leg },
      );
      for (let i = 0; i < rewardPositions.length; i++) {
        const rewardItemId = rewardItemIds[i];
        const rewardPos = rewardPositions[i];
        if (isWeaponOrArmorId(rewardItemId)) {
          const roll = equipmentCurseRng();
          const cursed = roll < FLOOR_EQUIPMENT_CURSE_CHANCE;
          // Phase 24.4a: same slot->definitionId resolution as normal
          // generation above, same equipmentDefinitionRng stream
          // (continuing its consumption order, never a separate table).
          const resolvedRewardDefinitionId = isNormalEquipmentSlot(rewardItemId)
            ? selectNormalEquipmentDefinition(rewardItemId, equipmentFloorRatio, equipmentDefinitionRng, {
                depth: floor,
                leg,
              })
            : rewardItemId;
          const instance = mintEquipmentInstance(nextFloorEquipmentInstanceId, resolvedRewardDefinitionId, cursed);
          nextFloorEquipmentInstanceId += 1;
          floorEquipmentInstances.push(instance);
          groundItems.push({
            id: groundItems.length,
            itemId: resolvedRewardDefinitionId,
            pos: rewardPos,
            equipmentInstanceId: instance.instanceId,
            spawnSource: 'monster_house',
          });
        } else if (isAccessoryId(rewardItemId)) {
          // Phase 24.5c: identical accessory branch to normal generation
          // above — no slot resolution, no curse roll, mint only after
          // rewardPos is already known-valid.
          const instance = mintEquipmentInstance(nextFloorEquipmentInstanceId, rewardItemId, false);
          nextFloorEquipmentInstanceId += 1;
          floorEquipmentInstances.push(instance);
          groundItems.push({
            id: groundItems.length,
            itemId: rewardItemId,
            pos: rewardPos,
            equipmentInstanceId: instance.instanceId,
            spawnSource: 'monster_house',
          });
        } else {
          groundItems.push({ id: groundItems.length, itemId: rewardItemId, pos: rewardPos, spawnSource: 'monster_house' });
        }
      }
    }
  }

  const state: GameState = {
    map,
    player,
    enemies,
    turn,
    floorTurn: 0,
    phase: 'playing',
    seed: floorSeed,
    runSeed,
    floor,
    leg,
    floorVisitOrdinal,
    reinforcementOrdinal: 0,
    // Phase 24.6c4a: only descent generation changes the drought counter;
    // ascent floors hold the incoming value. The finalized groundItems array
    // is inspected, so normal selection, floor-1 substitution, or the
    // dedicated guarantee can reset it independently of later pickup.
    foodDroughtFloors: leg === 'descent'
      ? (groundItems.some((item) => item.itemId === 'chocolate') ? 0 : incomingFoodDroughtFloors + 1)
      : incomingFoodDroughtFloors,
    sealedRoomGeneratedThisRun,
    totalFloors: runConfig.totalFloors,
    runDepthTier: runConfig.runDepthTier,
    exit: placement.exit,
    regenProgress: carry ? carry.regenProgress : 0,
    // Always fresh per floor build (enemy-behavior-02): a new floor,
    // restart (Enter), or new run (N) never carries over the previous
    // floor's webs or id counter.
    webs: [],
    nextWebId: 0,
    // Ground items are per-floor, like webs (Phase 08.2/08.3); the
    // inventory and equipped weapon (below) are what carry over.
    groundItems,
    nextGroundItemId: groundItems.length,
    // Slow trap (Phase 12.2): always freshly built per floor, never
    // carried over from `carry` — like webs/groundItems, this floor's
    // trap array is independent of the previous floor's.
    traps,
    inventory: carry ? carry.inventory : createEmptyInventory(),
    inventoryOpen: false,
    selectedItemIndex: 0,
    // Phase 20.0c equipment-instance foundation: carried over across
    // floor transitions like inventory/equippedWeaponId; a brand new run
    // always starts with no individuals and the counter at 0. A fresh
    // array per call (never the same reference as `carry.equipmentInstances`),
    // matching identifiedCardIds'/abilities' own per-call-copy reasoning.
    // Phase 20.0c: floorEquipmentInstances/nextFloorEquipmentInstanceId
    // (computed above, during the ground-item placement loop) already
    // equal `carry`'s values plus this floor's newly-minted
    // floor-generated individuals — see that loop's own doc comment.
    equipmentInstances: floorEquipmentInstances,
    nextEquipmentInstanceId: nextFloorEquipmentInstanceId,
    equippedWeaponInstanceId: carry ? carry.equippedWeaponInstanceId : null,
    equippedArmorInstanceId: carry ? carry.equippedArmorInstanceId : null,
    equippedWeaponId: carry ? carry.equippedWeaponId : null,
    equippedArmorId: carry ? carry.equippedArmorId : null,
    // Phase 24.5b: accessory carries over across floor transitions like
    // weapon/armor's own equipped pair, and defaults to unequipped
    // (null) on a brand new run (carry undefined) — identical pattern
    // to equippedWeaponId/equippedArmorId above.
    equippedAccessoryId: carry ? (carry.equippedAccessoryId ?? null) : null,
    equippedAccessoryInstanceId: carry ? (carry.equippedAccessoryInstanceId ?? null) : null,
    // Always false at the start of a floor — never carried over, even
    // though equippedWeaponId is (Phase 08.7: "フロア遷移時は反動を解除
    // する" / "新しいゲーム開始時も反動なしで初期化する").
    hammerRecovery: false,
    // Solar energy foundation (Phase 09.1): carried over across floor
    // transitions like inventory/equippedWeaponId; a brand new run always
    // starts at 5/5.
    solarEnergy: carry ? carry.solarEnergy : INITIAL_SOLAR_ENERGY,
    maxSolarEnergy: carry ? carry.maxSolarEnergy : INITIAL_MAX_SOLAR_ENERGY,
    // Sol enchantment state (Phase 10.1): persists across floor transitions
    // like solarEnergy/equippedWeaponId; a brand new run always starts
    // locked and unselected.
    solUnlocked: carry ? carry.solUnlocked : false,
    selectedEnchantment: carry ? carry.selectedEnchantment : 'none',
    // Five-element unlock state (Phase 14.1): carried over across floor
    // transitions like solUnlocked; a brand new run always starts every
    // element unlocked: false. Only 'sol' is ever set true in play this
    // phase (kept in sync with solUnlocked at its own pickup site).
    unlockedEnchantments: carry
      ? carry.unlockedEnchantments
      : { sol: false, flame: false, frost: false, cloud: false, earth: false },
    // Combat RNG (Phase 10.3 accuracy/evasion foundation): seeded from
    // runSeed via its own distinct XOR constant on a brand new run,
    // carried over (already-advanced) across floor transitions like
    // solarEnergy — never re-seeded mid-run, so the combat roll sequence
    // continues uninterrupted across floors. Independent of every
    // map-generation RNG stream (placementRng/speciesRng/itemRng/etc.),
    // so combat rolls never perturb map/placement/species/item/sunlight
    // determinism, and vice versa.
    combatRngState: carry ? carry.combatRngState : runSeed ^ 0x4e6d3a17,
    // Hunger (Phase 11.3): carried over across floor transitions like
    // solarEnergy/combatRngState; a brand new run or a post-death retry
    // always starts at HUNGER_MAX with both progress counters and both
    // warning flags cleared (fixed_specification.floor_and_run_lifecycle
    // / hunger_state's "new_run_value"/"retry_after_death_value": 100).
    hunger: carry ? carry.hunger : HUNGER_MAX,
    hungerDecreaseProgress: carry ? carry.hungerDecreaseProgress : 0,
    starvationProgress: carry ? carry.starvationProgress : 0,
    // Phase 15.2 recovery/satiety/status rebalance: carried across floor
    // transitions like hungerDecreaseProgress/starvationProgress; a brand
    // new run or a post-death retry always starts at 0 (poison itself is
    // never carried into either case — see activeEffects below).
    poisonTickProgress: carry ? carry.poisonTickProgress : 0,
    hungerLowWarned: carry ? carry.hungerLowWarned : false,
    hungerZeroWarned: carry ? carry.hungerZeroWarned : false,
    // Active temporary status effects (Phase 12.1): carried over across
    // floor transitions like inventory/equippedWeaponId (fixed_
    // specification.lifecycle.floor_transition's "attack_upと残りターン
    // を次フロアへ維持する"); a brand new run or a post-death retry always
    // starts with none (fixed_specification.lifecycle.new_run/
    // retry_after_death's "active effectなしで開始する"). A fresh array
    // per call (never the same reference as `carry.activeEffects`) so a
    // later mutation on this floor's state never reaches back into the
    // CarryOverStats object built from the previous floor.
    activeEffects: carry ? carry.activeEffects.map((effect) => ({ ...effect })) : [],
    // Progression (Phase 13.1): carried over across floor transitions
    // like inventory/equippedWeaponId; a brand new run or a post-death
    // retry (both go through createInitialState/restart, which never
    // pass a carry) always starts at level 1, 0 experience, 0 unspent
    // ability points (fixed_specification.state_lifecycle's new_run/
    // retry_after_death values).
    level: carry ? carry.level : PROGRESSION_INITIAL_LEVEL,
    experience: carry ? carry.experience : PROGRESSION_INITIAL_EXPERIENCE,
    unspentAbilityPoints: carry ? carry.unspentAbilityPoints : PROGRESSION_INITIAL_UNSPENT_ABILITY_POINTS,
    // Ability values (Phase 13.2): carried over across floor transitions
    // like level/experience/unspentAbilityPoints; a brand new run or a
    // post-death retry (both go through createInitialState/restart,
    // which never pass a carry) always starts all 4 at 0
    // (fixed_specification.lifecycle.new_run/retry_after_death). A fresh
    // object per call (never the same reference as `carry.abilities`),
    // matching activeEffects's own per-call-copy reasoning above.
    abilities: carry ? { ...carry.abilities } : { ...INITIAL_ABILITY_VALUES },
    // Card identification (Phase 20.0b/20.3): carried over across floor
    // transitions like abilities; a brand new run or a post-death retry
    // (both go through createInitialState/restart, which never pass a
    // carry) always starts empty. A fresh array per call (never the same
    // reference as `carry.identifiedCardIds`), matching abilities' own
    // per-call-copy reasoning above.
    identifiedCardIds: carry ? [...carry.identifiedCardIds] : [],
    // General item identification (Phase 24.4d1): carried over across
    // floor transitions like identifiedCardIds; a brand new run or a
    // post-death retry (both go through createInitialState/restart,
    // which never pass a carry) always starts empty. A fresh array per
    // call, matching identifiedCardIds' own per-call-copy reasoning.
    identifiedGeneralItemIds: carry ? [...carry.identifiedGeneralItemIds] : [],
    // Ability overlay state (Phase 13.2): never carried over across
    // floor transitions or restarts — always closed with no pending
    // confirmation at the start of a floor/run, like inventoryOpen/
    // discardConfirmItemId above.
    abilityOverlayOpen: false,
    selectedAbilityIndex: 0,
    abilityConfirmPending: null,
    abilityConfirmChoice: 'no',
    // Sunlight layer (Phase 09.3): always regenerated fresh per floor from
    // the finished map/start, using its own independent RNG stream (see
    // sunlight.ts) — never carried over across floor transitions, like
    // webs/groundItems.
    sunlight: generateSunlightLayer(map, floor, floorSeed, placement.start),
  };
  // Phase 20.0c equipment-instance foundation: backfills any missing
  // default instance against `inventory`'s weapon/armor counts (covers a
  // legacy/test-constructed `carry`, e.g. one hand-built without ever
  // populating equipmentInstances) and corrects any malformed per-
  // instance attribute — see normalizeEquipmentInstances's own doc
  // comment. Called last, after every other field above is finalized, so
  // it sees the real `state.inventory`/`state.equipmentInstances` this
  // floor actually starts with.
  normalizeEquipmentInstances(state);
  return state;
}

/**
 * Builds a fresh GameState for floor 1 of the given run seed.
 *
 * `runConfig` (Phase 24.6b1, optional) — omitted (every pre-24.6b1
 * caller) defaults to DEFAULT_RUN_CONFIG, producing byte-for-byte the
 * same state a bare `createInitialState(runSeed)` always has. When
 * supplied, it's validated and cloned by normalizeRunConfig before any
 * state is built (throws RangeError first, constructs nothing on
 * invalid input).
 */
export function createInitialState(runSeed: number, runConfig?: RunConfig): GameState {
  const normalizedConfig = runConfig ? normalizeRunConfig(runConfig) : DEFAULT_RUN_CONFIG;
  return buildFloorState(
    runSeed,
    1,
    0,
    1,
    normalizedConfig,
    undefined,
    undefined,
    undefined,
    'descent',
    normalizedConfig.runDepthTier === 'short' ? 'legacy' : 'depth',
  );
}

/**
 * Advances to the next floor of the same run, carrying over the player's
 * current HP, max HP, attack, and regen progress, and resetting all
 * per-floor state (map, position, enemies, exit).
 *
 * `events` (Phase 24.5d, optional) — when supplied, receives every
 * grigri_glasses trap-reveal event for the newly-built floor if
 * grigri_glasses is still equipped after the carry-over above (equip_
 * order's "装備したまま次floorへ進んだ場合、生成後のtrapも全て発見済み
 * にする"). Uses the exact same revealTrap helper as the equip-time
 * activation (turn.ts) and clairvoyance_fruit, so the same idempotent/
 * no-double-notify guarantees hold. Omitting `events` (existing callers)
 * still reveals every trap in nextState.traps identically — only the
 * event emission is skipped — since the underlying trap.revealed state
 * change (this feature's actual game-mechanical effect) must never
 * depend on whether a caller happens to want the message.
 */
function buildCarryOverStats(state: GameState): CarryOverStats {
  return {
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    attack: state.player.attack,
    defense: state.player.defense,
    accuracy: state.player.accuracy,
    evasion: state.player.evasion,
    regenProgress: state.regenProgress,
    inventory: state.inventory,
    equippedWeaponId: state.equippedWeaponId,
    equippedArmorId: state.equippedArmorId,
    facing: state.player.facing,
    solarEnergy: state.solarEnergy,
    maxSolarEnergy: state.maxSolarEnergy,
    solUnlocked: state.solUnlocked,
    selectedEnchantment: state.selectedEnchantment,
    unlockedEnchantments: state.unlockedEnchantments,
    combatRngState: state.combatRngState,
    hunger: state.hunger ?? HUNGER_MAX,
    hungerDecreaseProgress: state.hungerDecreaseProgress ?? 0,
    starvationProgress: state.starvationProgress ?? 0,
    poisonTickProgress: state.poisonTickProgress ?? 0,
    foodDroughtFloors: state.foodDroughtFloors ?? 0,
    sealedRoomGeneratedThisRun: state.sealedRoomGeneratedThisRun ?? false,
    hungerLowWarned: state.hungerLowWarned ?? false,
    hungerZeroWarned: state.hungerZeroWarned ?? false,
    activeEffects: state.activeEffects ?? [],
    level: state.level ?? PROGRESSION_INITIAL_LEVEL,
    experience: state.experience ?? PROGRESSION_INITIAL_EXPERIENCE,
    unspentAbilityPoints: state.unspentAbilityPoints ?? PROGRESSION_INITIAL_UNSPENT_ABILITY_POINTS,
    abilities: state.abilities ? { ...state.abilities } : { ...INITIAL_ABILITY_VALUES },
    // Phase 20.0b/20.3: `state.identifiedCardIds` may be absent (schemaVersion
    // 7 pre-Phase-20 saves/fixtures never set it — see types.ts's
    // GameState.identifiedCardIds doc comment) — defaults to empty, same
    // additive-default pattern as hunger/activeEffects/level above (no
    // schemaVersion bump). Also defensively normalizes away any
    // duplicate or unrecognized CardId that might reach here from a
    // stale/corrupted value, so a malformed carry can never propagate
    // duplicates or invalid ids forward — see normalizeIdentifiedCardIds.
    identifiedCardIds: normalizeIdentifiedCardIds(state.identifiedCardIds),
    // Phase 24.4d1 general item identification: additive-default pattern
    // identical to identifiedCardIds above (no schemaVersion bump — see
    // types.ts's GameState.identifiedGeneralItemIds doc comment).
    identifiedGeneralItemIds: normalizeIdentifiedGeneralItemIds(state.identifiedGeneralItemIds),
    // Phase 20.0c equipment-instance foundation: additive-default pattern
    // identical to identifiedCardIds above (no schemaVersion bump — see
    // types.ts's GameState.equipmentInstances doc comment). Malformed
    // per-instance attributes and any inventory/instance-count mismatch
    // are corrected by buildFloorState's own normalizeEquipmentInstances
    // call on the constructed next-floor state, not here — this only
    // supplies safe defaults for a possibly-absent legacy `state`.
    equipmentInstances: state.equipmentInstances ? state.equipmentInstances.map((i) => ({ ...i })) : [],
    nextEquipmentInstanceId: state.nextEquipmentInstanceId ?? 0,
    equippedWeaponInstanceId: state.equippedWeaponInstanceId ?? null,
    equippedArmorInstanceId: state.equippedArmorInstanceId ?? null,
    // Phase 24.5b: additive-default pattern identical to
    // equippedWeaponInstanceId/equippedArmorInstanceId above.
    equippedAccessoryId: state.equippedAccessoryId ?? null,
    equippedAccessoryInstanceId: state.equippedAccessoryInstanceId ?? null,
  };
}

export function advanceToNextFloor(state: GameState, events?: GameEvent[]): GameState {
  const carry = buildCarryOverStats(state);
  const nextState = buildFloorState(
    state.runSeed,
    state.floor + 1,
    state.turn,
    (state.floorVisitOrdinal ?? state.floor) + 1,
    { totalFloors: state.totalFloors, runDepthTier: state.runDepthTier },
    carry,
  );
  // Phase 24.3 effect_state floor_transition: floorTriggerUses/
  // defeatedEnemyTypes reset per floor; solSpentRemainder/
  // equippedTurnCounter (not touched here) persist across the
  // transition via `carry.equipmentInstances`'s plain `{ ...i }` copy
  // above.
  resetPerFloorEquipmentEffectState(nextState);
  // Phase 24.5d grigri_glasses: see this function's own doc comment
  // above. `carry.equippedAccessoryId` is what buildFloorState copies
  // onto nextState, so this reads nextState.equippedAccessoryId (never
  // the pre-transition state's) to decide whether it's still equipped
  // on the new floor.
  if (nextState.equippedAccessoryId === 'grigri_glasses') {
    const localEvents: GameEvent[] = [];
    let revealedCount = 0;
    for (const trap of nextState.traps ?? []) {
      if (revealTrap(trap, localEvents, 'grigri_glasses')) revealedCount++;
    }
    localEvents.push({ type: 'grigri_glasses_activated', revealedCount });
    if (events) events.push(...localEvents);
  }
  return nextState;
}

/**
 * Builds the next floor on the run's descent/ascent route. This is kept
 * separate from the legacy descent-only advanceToNextFloor wrapper until
 * the run phase logic is migrated to the long-run structure.
 */
export function advanceRunFloor(state: GameState, events?: GameEvent[]): GameState | 'runComplete' {
  const transition = transitionFloor({
    depth: state.floor,
    leg: state.leg,
    totalFloors: state.totalFloors,
    otencoState: 'sealed',
  });
  if (transition === 'runComplete') return transition;
  if (transition.depth === state.floor && transition.leg === state.leg) return state;

  const nextState = buildFloorState(
    state.runSeed,
    transition.depth,
    state.turn,
    floorVisitOrdinal({ ...transition, totalFloors: state.totalFloors }),
    { totalFloors: state.totalFloors, runDepthTier: state.runDepthTier },
    buildCarryOverStats(state),
    undefined,
    undefined,
    transition.leg,
    'depth',
  );
  resetPerFloorEquipmentEffectState(nextState);
  if (nextState.equippedAccessoryId === 'grigri_glasses') {
    const localEvents: GameEvent[] = [];
    let revealedCount = 0;
    for (const trap of nextState.traps ?? []) {
      if (revealTrap(trap, localEvents, 'grigri_glasses')) revealedCount++;
    }
    localEvents.push({ type: 'grigri_glasses_activated', revealedCount });
    if (events) events.push(...localEvents);
  }
  return nextState;
}

/**
 * Test/dev-only: builds a floor-1 GameState with all 9 species placed at
 * once (one of each, in fixed ENEMY_TYPES_IN_ORDER order), reusing the
 * exact same map generation and placement path as normal play, just with a
 * larger enemy count and a forced species list instead of a random draw.
 * Not called from main.ts/production code and not exposed via any runtime
 * key binding; it exists purely so tests (and, if needed, ad-hoc local
 * inspection) can confirm all 9 species spawn, render, and behave
 * correctly together without changing normal floor density.
 */
export function buildRosterPreviewFloorState(runSeed: number): GameState {
  return buildFloorState(runSeed, 1, 0, 1, DEFAULT_RUN_CONFIG, undefined, ENEMY_TYPES_IN_ORDER.length, ENEMY_TYPES_IN_ORDER);
}
