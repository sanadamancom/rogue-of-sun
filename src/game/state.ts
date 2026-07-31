import { choosePlacement, chooseGroundItemPosition, createRng, generateMap, MAP_GEN_PARAMS } from './mapgen';
import { createInitialActor, createInitialEnemy } from './turn';
import { deriveFloorSeed, TOTAL_FLOORS } from './floor';
import { ENEMY_DEFINITIONS, ENEMY_TYPES_IN_ORDER, getEnemyPoolForFloor } from './enemy-def';
import { createEmptyInventory } from './item-def';
import { Actor, EnemyActor, EnemyType, GameState, GroundItem, Inventory, Vec2, WeaponId, ArmorId, Direction8 } from './types';

/** Generates a random run seed without relying on Math.random's implicit global state at call sites. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

interface CarryOverStats {
  hp: number;
  maxHp: number;
  attack: number;
  regenProgress: number;
  inventory: Inventory;
  equippedWeaponId: WeaponId | null;
  equippedArmorId: ArmorId | null;
  facing: Direction8;
}

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
    return createInitialEnemy(type, pos, def.hp, def.attack, spawnTurn, i);
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
    ? createInitialActor(placement.start, carry.maxHp, carry.attack)
    : createInitialActor(placement.start, 3, 1);
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
    inventory: carry ? carry.inventory : createEmptyInventory(),
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: carry ? carry.equippedWeaponId : null,
    equippedArmorId: carry ? carry.equippedArmorId : null,
    // Always false at the start of a floor — never carried over, even
    // though equippedWeaponId is (Phase 08.7: "フロア遷移時は反動を解除
    // する" / "新しいゲーム開始時も反動なしで初期化する").
    hammerRecovery: false,
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
    regenProgress: state.regenProgress,
    inventory: state.inventory,
    equippedWeaponId: state.equippedWeaponId,
    equippedArmorId: state.equippedArmorId,
    facing: state.player.facing,
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
