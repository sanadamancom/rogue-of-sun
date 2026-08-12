import {
  choosePlacement,
  chooseGroundItemPosition,
  chooseTrapPosition,
  roomIndexContaining,
  createRng,
  generateMap,
  MAP_GEN_PARAMS,
  ENEMY_COUNT_BY_FLOOR,
  ENEMY_COUNT_PER_FLOOR,
} from './mapgen';
import { createInitialActor, createInitialEnemy } from './turn';
import { chooseDarkRoomIndex } from './dark-rooms';
import { buildMonsterHouseFloorState, createMonsterHouseRng } from './monster-house';
import {
  chooseMonsterHouseEnemyTypes,
  computeMonsterHouseCandidateCells,
  computeMonsterHouseEnemyCount,
  createMonsterHouseEnemyPositionRng,
  createMonsterHouseEnemySpeciesRng,
  selectMonsterHouseEnemyPositions,
} from './monster-house';
import { deriveFloorSeed, TOTAL_FLOORS } from './floor';
import { ENEMY_DEFINITIONS, ENEMY_TYPES_IN_ORDER, getEnemyPoolForFloor } from './enemy-def';
import { createEmptyInventory, drawGroundItemCount, drawWeightedGroundItemSelection, getWeightedGroundItemPoolForFloor } from './item-def';
import { CARD_IDS_IN_ORDER } from './card-def';
import {
  FLOOR_EQUIPMENT_CURSE_CHANCE,
  isWeaponOrArmorId,
  mintEquipmentInstance,
  normalizeEquipmentInstances,
} from './equipment-instance';
import { generateSunlightLayer } from './sunlight';
import { HUNGER_MAX } from './hunger';
import {
  PROGRESSION_INITIAL_EXPERIENCE,
  PROGRESSION_INITIAL_LEVEL,
  PROGRESSION_INITIAL_UNSPENT_ABILITY_POINTS,
} from './progression';
import { INITIAL_ABILITY_VALUES } from './ability';
import { Actor, ActiveEffect, AbilityValues, CardId, ElementId, EnchantmentId, EnemyActor, EnemyType, EquipmentInstance, GameState, GroundItem, Inventory, ItemId, TrapTile, Vec2, WeaponId, ArmorId, Direction8 } from './types';

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
  hungerLowWarned: boolean;
  hungerZeroWarned: boolean;
  activeEffects: ActiveEffect[];
  level: number;
  experience: number;
  unspentAbilityPoints: number;
  abilities: AbilityValues;
  identifiedCardIds: CardId[];
  equipmentInstances: EquipmentInstance[];
  nextEquipmentInstanceId: number;
  equippedWeaponInstanceId: string | null;
  equippedArmorInstanceId: string | null;
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

export function buildEnemies(positions: Vec2[], types: EnemyType[], spawnTurn: number, idOffset: number = 0): EnemyActor[] {
  return positions.map((pos, i) => {
    const type = types[i];
    const def = ENEMY_DEFINITIONS[type];
    return createInitialEnemy(type, pos, def.hp, def.attack, spawnTurn, idOffset + i, def.defense, def.accuracy, def.evasion);
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
function buildFloorState(
  runSeed: number,
  floor: number,
  turn: number,
  carry?: CarryOverStats,
  enemyCount?: number,
  forcedSpecies?: EnemyType[],
): GameState {
  const floorSeed = deriveFloorSeed(runSeed, floor);
  const result = generateMap(floorSeed);
  if (!result.ok || !result.map) {
    throw new Error(
      `Map generation failed for floor seed ${floorSeed} (run ${runSeed}, floor ${floor}) after ${MAP_GEN_PARAMS.maxGenerationAttempts} attempts`,
    );
  }

  const map = result.map;
  const placementRng = createRng(floorSeed ^ 0x51ed270b);
  // Phase 15.5: an explicit enemyCount override (roster preview, tests)
  // always wins; otherwise resolve this floor's normal-play count from
  // mapgen.ts's ENEMY_COUNT_BY_FLOOR, falling back to the flat
  // ENEMY_COUNT_PER_FLOOR for any floor number that table doesn't define
  // (defensive only — TOTAL_FLOORS is 3, so every normal floor is
  // covered). This is the only place normal generation resolves enemy
  // count; choosePlacement itself is unaware of floor numbers.
  const resolvedEnemyCount = enemyCount ?? ENEMY_COUNT_BY_FLOOR[floor] ?? ENEMY_COUNT_PER_FLOOR;
  const placement = choosePlacement(map, placementRng, resolvedEnemyCount);

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
  map.monsterHouse = buildMonsterHouseFloorState(map, floor, placement.start, placement.exit, monsterHouseRng);

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
  const floorPool = getEnemyPoolForFloor(floor);
  let types = forcedSpecies ?? chooseSpecies(placement.enemies.length, speciesRng, floorPool);
  // Phase 08.4 floor-2 golem exception: golem is a candidate on floor 2
  // but must never appear more than once there. This is a deterministic
  // post-processing step (no additional rng() calls, so it doesn't
  // perturb the species RNG stream/consumption count) that demotes any
  // golem draw beyond the first to 'bok' (always present in every
  // floor's pool). Only applies to the real random-draw path, never to
  // forcedSpecies (buildRosterPreviewFloorState).
  if (!forcedSpecies && floor === 2) {
    let sawGolem = false;
    types = types.map((type) => {
      if (type !== 'golem') return type;
      if (sawGolem) return 'bok';
      sawGolem = true;
      return type;
    });
  }
  const enemies: EnemyActor[] = buildEnemies(placement.enemies, types, turn).map((e) => ({ ...e, spawnSource: 'normal' as const }));

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

  // Trap placement (Phase 12.2 slow_trap, Phase 12.3 poison_trap): at
  // most one each, using their own distinct independent RNG streams.
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
  const slowTrapExclusions = [placement.start, placement.exit, ...placement.enemies];
  const slowTrapRng = createRng(floorSeed ^ 0x1a6f83c5);
  const slowTrapPos = chooseTrapPosition(map, map.rooms, placement.start, placement.exit, slowTrapExclusions, slowTrapRng);
  if (slowTrapPos) {
    traps.push({ id: traps.length, pos: slowTrapPos, revealed: false, triggered: false, trapType: 'slow_trap' });
  }

  // Poison trap placement (Phase 12.3): prefers a different room from
  // slow_trap's (fixed_specification.poison_trap.placement's "可能なら
  // slow_trapとは別の部屋へ配置する") — unchanged from the pre-15.4b
  // logic, just with a groundItems-free exclusion list (see above).
  const poisonTrapExclusions = [placement.start, placement.exit, ...placement.enemies, ...traps.map((t) => t.pos)];
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
  if (poisonTrapPos) {
    traps.push({ id: traps.length, pos: poisonTrapPos, revealed: false, triggered: false, trapType: 'poison_trap' });
  }

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
  const alreadyUnlocked = getAlreadyUnlockedEnchantmentItemIds(carry);
  const weightedFloorItemPool = getWeightedGroundItemPoolForFloor(floor, alreadyUnlocked);
  const itemSelectionRng = createRng(floorSeed ^ 0x5c2e91d3);
  const selectedItemIds = drawWeightedGroundItemSelection(itemCount, weightedFloorItemPool, itemSelectionRng);

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
  const itemPlacementRng = createRng(floorSeed ^ 0x91b6d8e4);
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
  const equipmentCurseRng = createRng(floorSeed ^ 0xc7d4a19e);
  const floorEquipmentInstances: EquipmentInstance[] = carry ? carry.equipmentInstances.map((i) => ({ ...i })) : [];
  let nextFloorEquipmentInstanceId = carry ? carry.nextEquipmentInstanceId : 0;
  const groundItems: GroundItem[] = [];
  for (const itemId of selectedItemIds) {
    const exclusions = [
      placement.start,
      placement.exit,
      ...placement.enemies,
      ...traps.map((t) => t.pos),
      ...groundItems.map((item) => item.pos),
    ];
    const pos = chooseGroundItemPosition(map, placement.start, exclusions, itemPlacementRng);
    if (isWeaponOrArmorId(itemId)) {
      const roll = equipmentCurseRng();
      const cursed = roll < FLOOR_EQUIPMENT_CURSE_CHANCE;
      const instance = mintEquipmentInstance(nextFloorEquipmentInstanceId, itemId, cursed);
      nextFloorEquipmentInstanceId += 1;
      floorEquipmentInstances.push(instance);
      groundItems.push({ id: groundItems.length, itemId, pos, equipmentInstanceId: instance.instanceId });
    } else {
      groundItems.push({ id: groundItems.length, itemId, pos });
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
    const dedicatedTypes = chooseMonsterHouseEnemyTypes(dedicatedCount, floor, speciesRng, types.includes('golem'));
    const dedicatedEnemies = buildEnemies(dedicatedPositions, dedicatedTypes, turn, enemies.length).map((e) => ({
      ...e,
      spawnSource: 'monster_house' as const,
    }));
    enemies.push(...dedicatedEnemies);
  }

  const state: GameState = {
    map,
    player,
    enemies,
    turn,
    phase: 'playing',
    seed: floorSeed,
    runSeed,
    floor,
    totalFloors: TOTAL_FLOORS,
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

/** Builds a fresh GameState for floor 1 of the given run seed. */
export function createInitialState(runSeed: number): GameState {
  return buildFloorState(runSeed, 1, 0);
}

/**
 * Advances to the next floor of the same run, carrying over the player's
 * current HP, max HP, attack, and regen progress, and resetting all
 * per-floor state (map, position, enemies, exit).
 */
export function advanceToNextFloor(state: GameState): GameState {
  const carry: CarryOverStats = {
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
  };
  return buildFloorState(state.runSeed, state.floor + 1, state.turn, carry);
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
  return buildFloorState(runSeed, 1, 0, undefined, ENEMY_TYPES_IN_ORDER.length, ENEMY_TYPES_IN_ORDER);
}
