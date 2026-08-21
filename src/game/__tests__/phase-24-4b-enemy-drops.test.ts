/**
 * Phase 24.4b: deterministic enemy drops on genuine terminal defeat.
 * Covers enemy-drop.ts's pure functions (occurrence/candidate/curse
 * rolls, placement search) directly, plus integration through
 * processTurn's single defeatEnemyIfNeeded choke point: skeleton body/
 * head/revival, double-defeat non-duplication, multi-attack-path
 * routing (melee, room-wide card), determinism/RNG non-interference,
 * and placement collision avoidance.
 */
import { describe, expect, it } from 'vitest';
import {
  ENEMY_DROP_CHANCE_PROVISIONAL,
  findNearestValidDropCell,
  resolveEnemyDropEquipmentDefinition,
  rollEnemyDropCurse,
  rollEnemyDropOccurs,
  selectEnemyDropItemId,
} from '../enemy-drop';
import { getGroundItemPoolForFloor } from '../item-def';
import { floorProgressRatio, getNormalEquipmentCandidates, isNormalEquipmentSlot } from '../equipment-loot';
import { FLOOR_EQUIPMENT_CURSE_CHANCE } from '../equipment-instance';
import { WEAPON_DEFINITIONS, WEAPON_IDS_IN_ORDER } from '../weapon-def';
import { ARMOR_DEFINITIONS, ARMOR_IDS_IN_ORDER } from '../armor-def';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, ELEMENT_ENCHANTMENT_SOL_COST, processTurn } from '../turn';
import { rollPercent } from '../rng';
import { EnemyActor, EnemyType, GameMap, GameState, Tile, WeaponId, ArmorId } from '../types';
import { DEFAULT_RUN_CONFIG } from '../floor';

// ---------------------------------------------------------------------
// Pure-function coverage (enemy-drop.ts)
// ---------------------------------------------------------------------

describe('ENEMY_DROP_CHANCE_PROVISIONAL', () => {
  it('is the provisional 10%', () => {
    expect(ENEMY_DROP_CHANCE_PROVISIONAL).toBe(0.1);
  });
});

describe('rollEnemyDropOccurs: determinism and statistical rate', () => {
  it('is a pure function of (floorSeed, enemyId): repeated calls agree', () => {
    for (const enemyId of [0, 1, 5, 42, 999]) {
      const a = rollEnemyDropOccurs(777, enemyId);
      const b = rollEnemyDropOccurs(777, enemyId);
      expect(a).toBe(b);
    }
  });

  it('different enemyIds under the same floorSeed are independently resolved (not all identical)', () => {
    const results = new Set<boolean>();
    for (let enemyId = 0; enemyId < 200; enemyId++) {
      results.add(rollEnemyDropOccurs(123, enemyId));
    }
    expect(results.size).toBe(2);
  });

  it('a fixed set of 2000 enemyIds yields a drop rate close to provisional 10% (statistical, fixed seed set — never flaky)', () => {
    let drops = 0;
    const N = 2000;
    for (let enemyId = 0; enemyId < N; enemyId++) {
      if (rollEnemyDropOccurs(2024, enemyId)) drops++;
    }
    const rate = drops / N;
    expect(rate).toBeGreaterThan(0.07);
    expect(rate).toBeLessThan(0.13);
  });
});

describe('selectEnemyDropItemId: candidates and determinism', () => {
  it('always returns an id from getGroundItemPoolForFloor(floor) — never a card, never black_armor', () => {
    for (const floor of [1, 2, 3]) {
      const pool = new Set(getGroundItemPoolForFloor(floor, 'descent'));
      for (let enemyId = 0; enemyId < 100; enemyId++) {
        const picked = selectEnemyDropItemId(floor, 55, enemyId, 'descent');
        expect(pool.has(picked)).toBe(true);
        expect(picked).not.toBe('black_armor');
      }
    }
  });

  it('is deterministic for the same (floor, floorSeed, enemyId)', () => {
    expect(selectEnemyDropItemId(2, 99, 7, 'descent')).toBe(selectEnemyDropItemId(2, 99, 7, 'descent'));
  });
});

describe('resolveEnemyDropEquipmentDefinition: rank eligibility, exclusion, and equipment-loot reuse', () => {
  const SLOTS = ['sword', 'spear', 'hammer', 'armor', 'solar_gun'] as const;

  it('never resolves to black_armor, S, or R at any floor/totalFloors', () => {
    for (const slot of SLOTS) {
      if (slot === 'hammer') continue; // the hammer slot/species becomes eligible at absolute depth 9
      for (const totalFloors of [3, 10, 100]) {
        for (const floor of [1, Math.ceil(totalFloors / 2), totalFloors]) {
          for (let enemyId = 0; enemyId < 20; enemyId++) {
            const picked = resolveEnemyDropEquipmentDefinition(slot, floor, totalFloors, 314, enemyId, 'descent');
            expect(picked).not.toBe('black_armor');
            const isWeapon = (WEAPON_IDS_IN_ORDER as readonly string[]).includes(picked);
            const rank = isWeapon ? WEAPON_DEFINITIONS[picked as WeaponId].rank : ARMOR_DEFINITIONS[picked as ArmorId]?.rank;
            expect(rank).not.toBe('S');
            expect(rank).not.toBe('R');
          }
        }
      }
    }
  });

  it('every result is a member of equipment-loot.ts\'s own candidate list for the same ratio (single shared source of truth)', () => {
    for (const slot of SLOTS) {
      const ratio = floorProgressRatio(2, 3);
      const candidateIds = new Set(getNormalEquipmentCandidates(slot, ratio, { depth: 26, leg: 'descent' }).map((c) => c.definitionId));
      for (let enemyId = 0; enemyId < 30; enemyId++) {
        const picked = resolveEnemyDropEquipmentDefinition(slot, 2, 3, 1, enemyId, 'descent');
        expect(candidateIds.has(picked)).toBe(true);
      }
    }
  });

  it('7/10 and 70/100 resolve identically for slots unaffected by depth gating', () => {
    for (const slot of ['sword', 'armor', 'solar_gun'] as const) {
      for (let enemyId = 0; enemyId < 10; enemyId++) {
        const a = resolveEnemyDropEquipmentDefinition(slot, 7, 10, 5000, enemyId, 'descent');
        const b = resolveEnemyDropEquipmentDefinition(slot, 70, 100, 5000, enemyId, 'descent');
        expect(a).toBe(b);
      }
    }
  });
});

describe('rollEnemyDropCurse: statistical rate matches FLOOR_EQUIPMENT_CURSE_CHANCE', () => {
  it('a fixed set of 2000 enemyIds yields a curse rate close to FLOOR_EQUIPMENT_CURSE_CHANCE', () => {
    let cursed = 0;
    const N = 2000;
    for (let enemyId = 0; enemyId < N; enemyId++) {
      if (rollEnemyDropCurse(88, enemyId)) cursed++;
    }
    const rate = cursed / N;
    expect(rate).toBeGreaterThan(FLOOR_EQUIPMENT_CURSE_CHANCE - 0.03);
    expect(rate).toBeLessThan(FLOOR_EQUIPMENT_CURSE_CHANCE + 0.03);
  });
});

describe('isNormalEquipmentSlot (re-export)', () => {
  it('matches equipment-loot.ts\'s own definition', () => {
    for (const id of ['sword', 'spear', 'hammer', 'armor', 'solar_gun', 'flamberge', 'apple']) {
      expect(isNormalEquipmentSlot(id)).toBe(['sword', 'spear', 'hammer', 'armor', 'solar_gun'].includes(id));
    }
  });
});

describe('findNearestValidDropCell: deterministic placement search', () => {
  function smallOpenMap(): GameMap {
    const rows = ['#####', '#...#', '#...#', '#...#', '#####'];
    const terrain: Tile[][] = rows.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
    return { width: 5, height: 5, terrain, rooms: [], exit: { x: 99, y: 99 } };
  }

  it('returns the origin itself when it is eligible', () => {
    const map = smallOpenMap();
    const result = findNearestValidDropCell(map, { x: 2, y: 2 }, []);
    expect(result).toEqual({ x: 2, y: 2 });
  });

  it('finds the nearest eligible cell when origin is excluded', () => {
    const map = smallOpenMap();
    const result = findNearestValidDropCell(map, { x: 2, y: 2 }, [{ x: 2, y: 2 }]);
    expect(result).not.toBeNull();
    expect(result).not.toEqual({ x: 2, y: 2 });
    // Must be walkable and adjacent (nearest ring) to the origin.
    const dx = Math.abs(result!.x - 2);
    const dy = Math.abs(result!.y - 2);
    expect(Math.max(dx, dy)).toBe(1);
  });

  it('returns null (never throws) when every reachable cell is excluded', () => {
    const map = smallOpenMap();
    const allFloorCells = [
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 },
      { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 },
    ];
    expect(() => findNearestValidDropCell(map, { x: 2, y: 2 }, allFloorCells)).not.toThrow();
    expect(findNearestValidDropCell(map, { x: 2, y: 2 }, allFloorCells)).toBeNull();
  });

  it('never returns a wall or out-of-bounds cell', () => {
    const map = smallOpenMap();
    const result = findNearestValidDropCell(map, { x: 1, y: 1 }, [{ x: 1, y: 1 }]);
    expect(result).not.toBeNull();
    expect(map.terrain[result!.y][result!.x]).toBe('floor');
  });

  it('is deterministic: same inputs always return the same cell', () => {
    const map = smallOpenMap();
    const a = findNearestValidDropCell(map, { x: 2, y: 2 }, [{ x: 2, y: 2 }, { x: 2, y: 1 }]);
    const b = findNearestValidDropCell(map, { x: 2, y: 2 }, [{ x: 2, y: 2 }, { x: 2, y: 1 }]);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------
// Integration: terminal defeat through processTurn
// ---------------------------------------------------------------------

const TEST_LAYOUT: string[] = [
  '##########',
  '#........#',
  '#........#',
  '#........#',
  '#........#',
  '##########',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms: [{ x: 1, y: 1, width: width - 2, height: height - 2 }], exit: { x: 99, y: 99 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 2 }, 20, 50, 0, 90, 0),
    enemies: [],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
    otencoState: 'sealed',
    runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
    exit: { x: 99, y: 99 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: createEmptyInventory(),
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: null,
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 15,
    maxSolarEnergy: 15,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    equipmentInstances: [],
    nextEquipmentInstanceId: 0,
    ...overrides,
  };
}

function faceEast(state: GameState): void {
  processTurn(state, { type: 'face', direction: 'E' });
}

function enemyAt(type: EnemyType, x: number, y: number, hp: number, id: number): EnemyActor {
  return createInitialEnemy(type, { x, y }, hp, 1, 0, id, 0, 0, 0);
}

/** A combatRngState guaranteed to resolve as a hit for `hitChance` (found via the same rollPercent formula production uses — no randomness, no flakiness). */
function findGuaranteedHitState(hitChance: number): number {
  for (let s = 0; s < 2000; s++) {
    if (rollPercent(s).roll < hitChance) return s;
  }
  throw new Error('no guaranteed-hit state found');
}

describe('terminal defeat integration: melee attack path', () => {
  it('a genuine one-hit kill triggers at most one drop-related state change (groundItems grows by 0 or 1)', () => {
    const hitState = findGuaranteedHitState(90);
    const state = freshState({
      player: createInitialActor({ x: 2, y: 2 }, 20, 50, 0, 90, 0),
      enemies: [enemyAt('bok', 3, 2, 1, 0)],
      combatRngState: hitState,
    });
    faceEast(state);
    const before = state.groundItems.length;
    processTurn(state, { type: 'action' });
    const after = state.groundItems.length;
    expect(after - before).toBeGreaterThanOrEqual(0);
    expect(after - before).toBeLessThanOrEqual(1);
    expect(state.enemies[0].alive).toBe(false);
  });

  it('calling a second attack against an already-dead enemy never adds a second drop', () => {
    const hitState = findGuaranteedHitState(90);
    const state = freshState({
      player: createInitialActor({ x: 2, y: 2 }, 20, 50, 0, 90, 0),
      enemies: [enemyAt('bok', 3, 2, 1, 0)],
      combatRngState: hitState,
    });
    faceEast(state);
    processTurn(state, { type: 'action' });
    const afterFirst = state.groundItems.length;
    // Enemy is already dead; a second attack finds no valid target and
    // is a pure no-op for combat/drop purposes.
    processTurn(state, { type: 'action' });
    expect(state.groundItems.length).toBe(afterFirst);
  });

  it('across many independent enemyIds (fixed set, same seed/floor), no illegal candidate (black_armor/S/R/card) ever appears on the floor', () => {
    for (let enemyId = 0; enemyId < 60; enemyId++) {
      const hitState = findGuaranteedHitState(90);
      const state = freshState({
        player: createInitialActor({ x: 2, y: 2 }, 20, 50, 0, 90, 0),
        enemies: [enemyAt('bok', 3, 2, 1, enemyId)],
        combatRngState: hitState,
      });
      faceEast(state);
      processTurn(state, { type: 'action' });
      for (const item of state.groundItems) {
        expect(item.itemId).not.toBe('black_armor');
        const isWeapon = (WEAPON_IDS_IN_ORDER as readonly string[]).includes(item.itemId);
        if (isWeapon) expect(WEAPON_DEFINITIONS[item.itemId as WeaponId].rank).not.toMatch(/^[SR]$/);
        const isArmor = (ARMOR_IDS_IN_ORDER as readonly string[]).includes(item.itemId);
        if (isArmor) expect(ARMOR_DEFINITIONS[item.itemId as ArmorId].rank).not.toMatch(/^[SR]$/);
      }
    }
  });
});

describe('terminal defeat integration: determinism and RNG non-interference', () => {
  it('same seed/floor/enemyId combat sequence produces identical groundItems/equipmentInstances results', () => {
    function run(): GameState {
      const hitState = findGuaranteedHitState(90);
      const state = freshState({
        player: createInitialActor({ x: 2, y: 2 }, 20, 50, 0, 90, 0),
        enemies: [enemyAt('bok', 3, 2, 1, 7)],
        combatRngState: hitState,
        seed: 42,
      });
      faceEast(state);
      processTurn(state, { type: 'action' });
      return state;
    }
    const a = run();
    const b = run();
    expect(a.groundItems).toEqual(b.groundItems);
    expect(a.equipmentInstances).toEqual(b.equipmentInstances);
  });

  it('enemy defeat order does not change each individual enemy\'s own drop outcome (array-order-reversed room attack)', () => {
    function runWithEnemyArrayOrder(idFirst: number, idSecond: number): GameState {
      const state = freshState({
        player: createInitialActor({ x: 2, y: 2 }, 1, 50, 0, 90, 0),
        enemies: [enemyAt('bok', 3, 2, 1, idFirst), enemyAt('bok', 4, 2, 1, idSecond)],
        seed: 9,
        inventory: { ...createEmptyInventory(), justice: 1 },
      });
      state.player.hp = 0;
      processTurn(state, { type: 'use_item', itemId: 'justice' as never });
      return state;
    }
    // Same two enemyIds, but constructed in opposite state.enemies array
    // order — since the drop seed is keyed by enemyId alone (never array
    // position or resolution order), each enemyId's own drop outcome
    // (itemId set, ignoring incidental array/position ordering) must be
    // identical either way.
    const forward = runWithEnemyArrayOrder(30, 31);
    const reversed = runWithEnemyArrayOrder(31, 30);
    const dropItemIds = (gs: GameState) => new Set(gs.groundItems.map((g) => g.itemId));
    expect(dropItemIds(forward)).toEqual(dropItemIds(reversed));
  });

  it('a genuine defeat never consumes an extra combatRngState step beyond the attack roll itself (drop RNG is fully separate)', () => {
    const hitState = findGuaranteedHitState(90);
    const state = freshState({
      player: createInitialActor({ x: 2, y: 2 }, 20, 50, 0, 90, 0),
      enemies: [enemyAt('bok', 3, 2, 1, 0)],
      combatRngState: hitState,
    });
    faceEast(state);
    const { nextState: expectedAfterOneRoll } = rollPercent(hitState);
    processTurn(state, { type: 'action' });
    expect(state.combatRngState).toBe(expectedAfterOneRoll);
  });
});

describe('terminal defeat integration: skeleton body/head/revival contract', () => {
  it('body-form skeleton hit with no activated element headifies — never drops', () => {
    const hitState = findGuaranteedHitState(90);
    const state = freshState({
      player: createInitialActor({ x: 2, y: 2 }, 20, 50, 0, 90, 0),
      enemies: [{ ...enemyAt('skeleton', 3, 2, 1, 0), skeletonForm: 'body' }],
      combatRngState: hitState,
      selectedEnchantment: 'none',
    });
    faceEast(state);
    processTurn(state, { type: 'action' });
    expect(state.enemies[0].alive).toBe(true);
    expect(state.enemies[0].skeletonForm).toBe('head');
    expect(state.groundItems.length).toBe(0);
  });

  it('head-form skeleton fully defeated by an activated element can drop (goes through the normal terminal-defeat path once)', () => {
    const hitState = findGuaranteedHitState(90);
    const state = freshState({
      player: createInitialActor({ x: 2, y: 2 }, 20, 50, 0, 90, 0),
      enemies: [{ ...enemyAt('skeleton', 3, 2, 1, 0), skeletonForm: 'head' }],
      combatRngState: hitState,
      equippedWeaponId: 'sword',
      selectedEnchantment: 'sol',
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      solarEnergy: ELEMENT_ENCHANTMENT_SOL_COST.sol,
    });
    faceEast(state);
    processTurn(state, { type: 'action' });
    expect(state.enemies[0].alive).toBe(false);
    // Drop is probabilistic (10%), but must never exceed exactly 1
    // GroundItem for this single enemy regardless of outcome.
    expect(state.groundItems.length).toBeLessThanOrEqual(1);
  });
});

describe('terminal defeat integration: room-wide card attack path', () => {
  it('justice-defeated enemies each independently get at most one drop', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 2 }, 1, 50, 0, 90, 0),
      enemies: [enemyAt('bok', 3, 2, 1, 0), enemyAt('bok', 4, 2, 1, 1)],
      inventory: { ...createEmptyInventory(), justice: 1 },
    });
    // player.hp === player.maxHp is required for a nonzero justice
    // effect (max(1, maxHp - hp)); force hp to 1 below maxHp so damage
    // is guaranteed positive without needing prior combat.
    state.player.hp = 0;
    processTurn(state, { type: 'use_item', itemId: 'justice' as never });
    // Both enemies share the same room (the whole open test map) and
    // justice's fixed damage (max(1, maxHp-hp)=1) at hp=1 defeats them.
    expect(state.enemies.every((e) => e.alive === false)).toBe(true);
    expect(state.groundItems.length).toBeLessThanOrEqual(2);
    const positions = state.groundItems.map((g) => `${g.pos.x},${g.pos.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('terminal defeat integration: placement collision avoidance', () => {
  it('two adjacent enemies defeated in the same turn never produce overlapping GroundItem positions', () => {
    // Force both drops to occur by picking enemyIds known to roll true
    // for this floorSeed (search deterministically, no randomness).
    let idA = -1;
    let idB = -1;
    for (let id = 0; id < 500 && (idA < 0 || idB < 0); id++) {
      if (rollEnemyDropOccurs(1, id)) {
        if (idA < 0) idA = id;
        else if (idB < 0 && id !== idA) idB = id;
      }
    }
    expect(idA).toBeGreaterThanOrEqual(0);
    expect(idB).toBeGreaterThanOrEqual(0);

    const state = freshState({
      player: createInitialActor({ x: 2, y: 2 }, 1, 50, 0, 90, 0),
      enemies: [enemyAt('bok', 3, 2, 1, idA), enemyAt('bok', 3, 3, 1, idB)],
      inventory: { ...createEmptyInventory(), justice: 1 },
    });
    state.player.hp = 0;
    processTurn(state, { type: 'use_item', itemId: 'justice' as never });
    const positions = state.groundItems.map((g) => `${g.pos.x},${g.pos.y}`);
    expect(new Set(positions).size).toBe(positions.length);
  });
});
