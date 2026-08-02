import { choosePlacement, chooseGroundItemPosition, chooseTrapPosition, chooseRoomFloorPosition, roomIndexContaining, createRng, generateMap, MAP_GEN_PARAMS } from './mapgen';
import { createInitialActor, createInitialEnemy } from './turn';
import { deriveFloorSeed, TOTAL_FLOORS } from './floor';
import { ENEMY_DEFINITIONS, ENEMY_TYPES_IN_ORDER, getEnemyPoolForFloor } from './enemy-def';
import { createEmptyInventory } from './item-def';
import { generateSunlightLayer } from './sunlight';
import { HUNGER_MAX } from './hunger';
import {
  PROGRESSION_INITIAL_EXPERIENCE,
  PROGRESSION_INITIAL_LEVEL,
  PROGRESSION_INITIAL_UNSPENT_ABILITY_POINTS,
} from './progression';
import { Actor, ActiveEffect, EnchantmentId, EnemyActor, EnemyType, GameState, GroundItem, Inventory, TrapTile, Vec2, WeaponId, ArmorId, Direction8 } from './types';

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
  combatRngState: number;
  hunger: number;
  hungerDecreaseProgress: number;
  starvationProgress: number;
  hungerLowWarned: boolean;
  hungerZeroWarned: boolean;
  activeEffects: ActiveEffect[];
  level: number;
  experience: number;
  unspentAbilityPoints: number;
}

/** Fixed initial/maximum solar energy for a brand new run (Phase 09.1; provisional value, see history doc). */
const INITIAL_SOLAR_ENERGY = 5;
const INITIAL_MAX_SOLAR_ENERGY = 5;

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
function chooseSpecies(count: number, rng: () => number, pool: EnemyType[]): EnemyType[] {
  const types: EnemyType[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * pool.length);
    types.push(pool[index]);
  }
  return types;
}

function buildEnemies(positions: Vec2[], types: EnemyType[], spawnTurn: number): EnemyActor[] {
  return positions.map((pos, i) => {
    const type = types[i];
    const def = ENEMY_DEFINITIONS[type];
    return createInitialEnemy(type, pos, def.hp, def.attack, spawnTurn, i, def.defense, def.accuracy, def.evasion);
  });
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
  const placement = choosePlacement(map, placementRng, enemyCount);

  const player: Actor = carry
    ? createInitialActor(placement.start, carry.maxHp, carry.attack, carry.defense, carry.accuracy, carry.evasion)
    : // Phase 10.2 combat stat/scale redesign: hp 3->30, attack 1->10
      // (10x scale, see docs/history for the full table); defense 0 (no
      // permanent player defense source yet besides equipped armor).
      // Phase 10.3 accuracy/evasion foundation: accuracy 90, evasion 0
      // (confirmed_design's initial_values.actors.player).
      createInitialActor(placement.start, 30, 10, 0, 90, 0);
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
  const enemies = buildEnemies(placement.enemies, types, turn);

  // Ground item placement (Phase 08.2) uses its own independent RNG stream
  // (a third distinct XOR constant), so adding the apple never perturbs
  // the existing map-generation, placement, or species RNG
  // sequences/determinism. Excludes start, exit, and every enemy position;
  // never falls back to a reduced item count — chooseGroundItemPosition
  // throws explicitly if no valid tile exists.
  const itemRng = createRng(floorSeed ^ 0xa3c17f05);
  const applePos = chooseGroundItemPosition(
    map,
    placement.start,
    [placement.start, placement.exit, ...placement.enemies],
    itemRng,
  );
  const groundItems: GroundItem[] = [{ id: 0, itemId: 'apple', pos: applePos }];

  // Sword placement (Phase 08.3 weapon/equipment foundation): floor 1
  // only, using a fourth distinct independent RNG stream so it never
  // perturbs the map/placement/species/apple RNG sequences or their
  // consumption order. Excludes the apple's tile too, in addition to
  // start/exit/every enemy position.
  if (floor === 1) {
    const swordRng = createRng(floorSeed ^ 0x5c2e91d3);
    const swordPos = chooseGroundItemPosition(
      map,
      placement.start,
      [placement.start, placement.exit, ...placement.enemies, applePos],
      swordRng,
    );
    groundItems.push({ id: 1, itemId: 'sword', pos: swordPos });

    // Armor placement (Phase 08.4 armor/defense foundation): floor 1
    // only, using a fifth distinct independent RNG stream so it never
    // perturbs the map/placement/species/apple/sword RNG sequences or
    // their consumption order. Excludes the sword's tile too, in
    // addition to start/exit/every enemy position/apple's tile.
    const armorRng = createRng(floorSeed ^ 0x91b6d8e4);
    const armorPos = chooseGroundItemPosition(
      map,
      placement.start,
      [placement.start, placement.exit, ...placement.enemies, applePos, swordPos],
      armorRng,
    );
    groundItems.push({ id: 2, itemId: 'armor', pos: armorPos });
  }

  // Spear placement (Phase 08.5 reach weapon): floor 2 only, using a
  // sixth distinct independent RNG stream so it never perturbs the
  // map/placement/species/apple/sword/armor RNG sequences or their
  // consumption order. Floor 2's only other ground item at this point is
  // the apple (sword/armor are floor-1-only), so only that needs
  // excluding in addition to start/exit/every enemy position.
  if (floor === 2) {
    const spearRng = createRng(floorSeed ^ 0x3d7a4c19);
    const spearPos = chooseGroundItemPosition(
      map,
      placement.start,
      [placement.start, placement.exit, ...placement.enemies, applePos],
      spearRng,
    );
    groundItems.push({ id: groundItems.length, itemId: 'spear', pos: spearPos });

    // Hammer placement (Phase 08.7 knockback weapon): floor 2 only, after
    // every other floor-2 item is placed, using a seventh distinct
    // independent RNG stream so it never perturbs the
    // map/placement/species/apple/spear RNG sequences or their
    // consumption order. Excludes the spear's tile too, in addition to
    // start/exit/every enemy position/apple's tile.
    const hammerRng = createRng(floorSeed ^ 0x6a1f38b2);
    const hammerPos = chooseGroundItemPosition(
      map,
      placement.start,
      [placement.start, placement.exit, ...placement.enemies, applePos, spearPos],
      hammerRng,
    );
    groundItems.push({ id: groundItems.length, itemId: 'hammer', pos: hammerPos });
  }

  // Sun fruit placement (Phase 09.1 solar energy foundation): floor 1 and
  // floor 2, one each, using its own distinct independent RNG stream (an
  // eighth XOR constant) placed after every other existing ground item on
  // that floor, so it never perturbs any prior RNG sequence/consumption
  // order and excludes every tile already used by another ground item in
  // addition to start/exit/every enemy position.
  if (floor === 1 || floor === 2) {
    const priorExclusions = [
      placement.start,
      placement.exit,
      ...placement.enemies,
      ...groundItems.map((item) => item.pos),
    ];
    const sunFruitRng = createRng(floorSeed ^ 0xd472e6a9);
    const sunFruitPos = chooseGroundItemPosition(map, placement.start, priorExclusions, sunFruitRng);
    groundItems.push({ id: groundItems.length, itemId: 'sun_fruit', pos: sunFruitPos });
  }

  // Solar gun placement (Phase 09.2 ranged solar weapon): floor 1 only,
  // using a ninth distinct independent RNG stream, placed after every
  // other floor-1 ground item (including sun fruit) so it never perturbs
  // any prior RNG sequence/consumption order.
  if (floor === 1) {
    const solarGunExclusions = [
      placement.start,
      placement.exit,
      ...placement.enemies,
      ...groundItems.map((item) => item.pos),
    ];
    const solarGunRng = createRng(floorSeed ^ 0x2b9e5c74);
    const solarGunPos = chooseGroundItemPosition(map, placement.start, solarGunExclusions, solarGunRng);
    groundItems.push({ id: groundItems.length, itemId: 'solar_gun', pos: solarGunPos });

    // Sol enchantment placement (Phase 10.1): floor 1 only, using a tenth
    // distinct independent RNG stream, placed after every other floor-1
    // ground item (including the solar gun) so it never perturbs any
    // prior RNG sequence/consumption order. Floor-1-only guarantees it is
    // reachable and pickable during every 3-floor playthrough, matching
    // confirmed_design's "3フロアの試作中に必ず取得して検証できる位置へ
    // 決定論的に1個配置する".
    const solEnchantExclusions = [
      placement.start,
      placement.exit,
      ...placement.enemies,
      ...groundItems.map((item) => item.pos),
    ];
    const solEnchantRng = createRng(floorSeed ^ 0x9f4a1e63);
    const solEnchantPos = chooseGroundItemPosition(map, placement.start, solEnchantExclusions, solEnchantRng);
    groundItems.push({ id: groundItems.length, itemId: 'sol_enchantment', pos: solEnchantPos });
  }

  // Chocolate placement (Phase 11.3 hunger foundation): every floor gets
  // exactly one, using its own distinct independent RNG stream (an
  // eleventh XOR constant) placed after every other existing ground item
  // on that floor, so it never perturbs any prior RNG sequence/
  // consumption order and excludes every tile already used by another
  // ground item in addition to start/exit/every enemy position — same
  // pattern as sun_fruit above, just unconditional on floor number
  // (fixed_specification.chocolate.placement.initial_rule: "各フロアに1
  // 個").
  {
    const chocolateExclusions = [
      placement.start,
      placement.exit,
      ...placement.enemies,
      ...groundItems.map((item) => item.pos),
    ];
    const chocolateRng = createRng(floorSeed ^ 0x7e1c4a92);
    const chocolatePos = chooseGroundItemPosition(map, placement.start, chocolateExclusions, chocolateRng);
    groundItems.push({ id: groundItems.length, itemId: 'chocolate', pos: chocolatePos });
  }

  // Banana placement (Phase 12.1 temporary-effect foundation): every
  // floor gets exactly one, using its own distinct independent RNG stream
  // (a twelfth XOR constant) placed after every other existing ground
  // item on that floor, so it never perturbs any prior RNG sequence/
  // consumption order and excludes every tile already used by another
  // ground item in addition to start/exit/every enemy position — same
  // pattern as chocolate above (fixed_specification.banana.placement's
  // "各フロアへ必ず1個配置する" / "既存のgroundItem配置処理を利用する").
  {
    const bananaExclusions = [
      placement.start,
      placement.exit,
      ...placement.enemies,
      ...groundItems.map((item) => item.pos),
    ];
    const bananaRng = createRng(floorSeed ^ 0x4c8d29f6);
    const bananaPos = chooseGroundItemPosition(map, placement.start, bananaExclusions, bananaRng);
    groundItems.push({ id: groundItems.length, itemId: 'banana', pos: bananaPos });
  }

  // Slow trap placement (Phase 12.2): at most one per floor, using its
  // own distinct independent RNG stream (a thirteenth XOR constant) so it
  // never perturbs any prior RNG sequence/consumption order. Restricted
  // to ordinary room-interior floor tiles via chooseTrapPosition (never
  // corridors/doorways/walls/the exit — see that function's doc comment),
  // excluding every already-placed ground item's tile in addition to
  // start/exit/every enemy position. Unlike every other placement helper
  // in this file, chooseTrapPosition returns null instead of throwing
  // when no candidate qualifies — that floor simply gets no trap
  // (fixed_specification.trap.placement's "条件を満たす候補がない場合
  // だけ配置なしを許可し、理由を記録する"; see chooseTrapPosition's doc
  // comment for why a code comment is this codebase's equivalent of a
  // "recorded reason").
  const traps: TrapTile[] = [];
  const slowTrapExclusions = [
    placement.start,
    placement.exit,
    ...placement.enemies,
    ...groundItems.map((item) => item.pos),
  ];
  const slowTrapRng = createRng(floorSeed ^ 0x1a6f83c5);
  const slowTrapPos = chooseTrapPosition(map, map.rooms, placement.start, placement.exit, slowTrapExclusions, slowTrapRng);
  if (slowTrapPos) {
    traps.push({ id: traps.length, pos: slowTrapPos, triggered: false, trapType: 'slow_trap' });
  }

  // Poison trap placement (Phase 12.3): at most one per floor, using its
  // own distinct independent RNG stream (a fourteenth XOR constant), added
  // to the same `traps` array as slow_trap (fixed_specification/
  // implementation_policy's "鈍足罠と毒罠で別々のGameState配列を作る"
  // 禁止) rather than a separate GameState field. Prefers a different
  // room from slow_trap's (fixed_specification.poison_trap.placement's
  // "可能ならslow_trapとは別の部屋へ配置する"): the first attempt below
  // restricts chooseTrapPosition's room list to every room except the one
  // slow_trap landed in (found via roomIndexContaining). Only if that
  // attempt finds zero candidates (meaning no *other* room has any valid
  // tile at all, given the exclusions/distance rules) does the second
  // attempt fall back to searching every room again — since the first
  // attempt already proved every other room empty, in practice this
  // second attempt can only ever succeed inside slow_trap's own room, so
  // it also adds `minDistanceFrom: { pos: slowTrapPos, distance: 3 }` to
  // satisfy "同じ部屋の場合はslow_trapからマンハッタン距離3以上離す".
  // Both attempts share one continuous rng stream: chooseTrapPosition
  // only ever consumes an rng() draw when it finds at least one
  // candidate (see its doc comment), so a null first attempt costs zero
  // draws and doesn't desynchronize the second attempt's result from what
  // a single-attempt call would have drawn.
  const poisonTrapExclusions = [
    placement.start,
    placement.exit,
    ...placement.enemies,
    ...groundItems.map((item) => item.pos),
    ...traps.map((t) => t.pos),
  ];
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
    traps.push({ id: traps.length, pos: poisonTrapPos, triggered: false, trapType: 'poison_trap' });
  }

  // Antidote placement (Phase 12.4 status-ailment removal foundation):
  // at most one per floor, restricted to ordinary room-interior floor
  // tiles via chooseRoomFloorPosition (never corridors/doorways/walls/
  // the exit — see that function's doc comment). Uses its own distinct
  // independent RNG stream (a fifteenth XOR constant) so it never
  // perturbs any prior RNG sequence/consumption order, and excludes
  // every already-placed ground item's tile plus both trap positions in
  // addition to start/exit/every enemy position. Returns null (never
  // throws) when no candidate qualifies — that floor simply gets no
  // antidote.
  const antidoteExclusions = [
    placement.start,
    placement.exit,
    ...placement.enemies,
    ...groundItems.map((item) => item.pos),
    ...traps.map((t) => t.pos),
  ];
  const antidoteRng = createRng(floorSeed ^ 0x6d5a91e7);
  const antidotePos = chooseRoomFloorPosition(map, map.rooms, antidoteExclusions, antidoteRng);
  if (antidotePos) {
    groundItems.push({ id: groundItems.length, itemId: 'antidote', pos: antidotePos });
  }

  // Panacea placement (Phase 12.4): at most one per floor, same
  // mechanism as antidote immediately above, using its own distinct
  // independent RNG stream (a sixteenth XOR constant). Excludes
  // antidote's own just-chosen tile (in addition to every other
  // exclusion) so the two new items never land on the same tile
  // (placement.common_requirements's "毒消しと万能薬を互いに重複させな
  // い").
  const panaceaExclusions = [
    placement.start,
    placement.exit,
    ...placement.enemies,
    ...groundItems.map((item) => item.pos),
    ...traps.map((t) => t.pos),
  ];
  const panaceaRng = createRng(floorSeed ^ 0x2e8f4b6d);
  const panaceaPos = chooseRoomFloorPosition(map, map.rooms, panaceaExclusions, panaceaRng);
  if (panaceaPos) {
    groundItems.push({ id: groundItems.length, itemId: 'panacea', pos: panaceaPos });
  }

  return {
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
    // Sunlight layer (Phase 09.3): always regenerated fresh per floor from
    // the finished map/start, using its own independent RNG stream (see
    // sunlight.ts) — never carried over across floor transitions, like
    // webs/groundItems.
    sunlight: generateSunlightLayer(map, floor, floorSeed, placement.start),
  };
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
    combatRngState: state.combatRngState,
    hunger: state.hunger ?? HUNGER_MAX,
    hungerDecreaseProgress: state.hungerDecreaseProgress ?? 0,
    starvationProgress: state.starvationProgress ?? 0,
    hungerLowWarned: state.hungerLowWarned ?? false,
    hungerZeroWarned: state.hungerZeroWarned ?? false,
    activeEffects: state.activeEffects ?? [],
    level: state.level ?? PROGRESSION_INITIAL_LEVEL,
    experience: state.experience ?? PROGRESSION_INITIAL_EXPERIENCE,
    unspentAbilityPoints: state.unspentAbilityPoints ?? PROGRESSION_INITIAL_UNSPENT_ABILITY_POINTS,
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
