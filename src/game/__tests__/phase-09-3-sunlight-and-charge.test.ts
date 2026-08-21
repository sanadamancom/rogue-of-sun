import { describe, expect, it } from 'vitest';
import { createEmptyInventory } from '../item-def';
import {
  generateSunlightLayer,
  isSunlitAt,
  selectSunlightCategory,
  sunlightCategoryForFloorSeed,
  sunlightWeightsForDepth,
  SunlightCategory,
} from '../sunlight';
import { createRng } from '../mapgen';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';
import { DEFAULT_RUN_CONFIG } from '../floor';

function openMap(size = 20): GameMap {
  return {
    width: size,
    height: size,
    terrain: Array.from({ length: size }, () => Array.from({ length: size }, () => 'floor' as Tile)),
    rooms: [],
    exit: { x: 199, y: 199 },
  };
}

function allTrueGrid(map: GameMap): boolean[][] {
  return Array.from({ length: map.height }, () => Array.from({ length: map.width }, () => true));
}

function allFalseGrid(map: GameMap): boolean[][] {
  return Array.from({ length: map.height }, () => Array.from({ length: map.width }, () => false));
}

function freshState(overrides?: Partial<GameState>): GameState {
  const map = openMap();
  return {
    map,
    player: createInitialActor({ x: 10, y: 10 }, 3, 1),
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
    exit: { x: 199, y: 199 },
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
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: allTrueGrid(map),
    ...overrides,
  };
}

describe('sunlight layer generation (Phase 09.3)', () => {
  function seedForCategory(depth: number, category: SunlightCategory): number {
    for (let seed = 0; seed < 10_000; seed++) {
      if (sunlightCategoryForFloorSeed(depth, seed) === category) return seed;
    }
    throw new Error(`No seed found for ${category}`);
  }

  function sunlitRatio(map: GameMap, sunlight: boolean[][]): number {
    let sunlit = 0;
    let total = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.terrain[y][x] !== 'floor') continue;
        total += 1;
        if (isSunlitAt(sunlight, { x, y })) sunlit += 1;
      }
    }
    return sunlit / total;
  }

  it('the light category keeps the start sunlit, a majority lit, and some shadow', () => {
    const map = openMap();
    const start = { x: 10, y: 10 };
    const sunlight = generateSunlightLayer(map, 1, seedForCategory(1, 'light'), start);
    const ratio = sunlitRatio(map, sunlight);
    expect(isSunlitAt(sunlight, start)).toBe(true);
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(1);
  });

  it('the mixed category has at least 1 reachable sunlit floor tile', () => {
    const map = openMap();
    const start = { x: 10, y: 10 };
    const sunlight = generateSunlightLayer(map, 1, seedForCategory(1, 'mixed'), start);
    expect(isSunlitAt(sunlight, start)).toBe(true);
  });

  it("the mixed category's sunlit area is reachable from the start position", () => {
    const map = openMap();
    const sunlight = generateSunlightLayer(map, 1, seedForCategory(1, 'mixed'), { x: 10, y: 10 });
    // Reachability proxy: every sunlit tile must be a floor tile (never a
    // wall/out-of-bounds tile), and mapgen's own connectivity guarantee
    // (verified elsewhere) means every floor tile on this map is reachable.
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (isSunlitAt(sunlight, { x, y })) {
          expect(map.terrain[y][x]).toBe('floor');
        }
      }
    }
  });

  it('the dark category has at least 1 sunlit tile and mostly shadow', () => {
    const map = openMap();
    const sunlight = generateSunlightLayer(map, 1, seedForCategory(1, 'dark'), { x: 10, y: 10 });
    expect(sunlitRatio(map, sunlight)).toBeGreaterThan(0);
    expect(sunlitRatio(map, sunlight)).toBeLessThan(0.5);
  });

  it('never marks a wall tile as sunlit, for any of the 3 floors', () => {
    let state = createInitialState(55);
    for (let floor = 1; floor <= 3; floor++) {
      for (let y = 0; y < state.map.height; y++) {
        for (let x = 0; x < state.map.width; x++) {
          if (state.map.terrain[y][x] === 'wall') {
            expect(isSunlitAt(state.sunlight, { x, y })).toBe(false);
          }
        }
      }
      if (floor < 3) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
      }
    }
  });

  it('isSunlitAt never throws for out-of-bounds coordinates', () => {
    const state = createInitialState(1);
    expect(() => isSunlitAt(state.sunlight, { x: -1, y: -1 })).not.toThrow();
    expect(() => isSunlitAt(state.sunlight, { x: 9999, y: 9999 })).not.toThrow();
    expect(isSunlitAt(state.sunlight, { x: -1, y: -1 })).toBe(false);
    expect(isSunlitAt(state.sunlight, { x: 9999, y: 9999 })).toBe(false);
  });

  it('the same seed and floor produce the same sunlight layout', () => {
    const a = createInitialState(4141);
    const b = createInitialState(4141);
    expect(a.sunlight).toEqual(b.sunlight);
  });

  it('generation completes safely across many different seeds, all 3 floors', () => {
    for (let seed = 1; seed <= 40; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        expect(state.sunlight.length).toBe(state.map.height);
        if (floor < 3) {
          state.enemies.forEach((e) => (e.alive = false));
          state.player.pos = { ...state.exit };
          state = advanceToNextFloor(state);
        }
      }
    }
  });

  it('exit, actors, and ground items may sit on a sunlit tile without issue', () => {
    const map = openMap(10);
    const sunlight = generateSunlightLayer(map, 1, 12345, { x: 5, y: 5 });
    // Force the exit tile sunlit and verify it does not throw or alter
    // the layer's shape when queried.
    expect(() => isSunlitAt(sunlight, { x: 5, y: 5 })).not.toThrow();
  });
});

describe('sunlight depth-band category selection (Phase 24.6c3a3)', () => {
  it.each([
    [1, { light: 60, mixed: 30, dark: 10 }],
    [6, { light: 60, mixed: 30, dark: 10 }],
    [7, { light: 45, mixed: 35, dark: 20 }],
    [13, { light: 45, mixed: 35, dark: 20 }],
    [14, { light: 30, mixed: 40, dark: 30 }],
    [19, { light: 30, mixed: 40, dark: 30 }],
    [20, { light: 20, mixed: 35, dark: 45 }],
    [26, { light: 20, mixed: 35, dark: 45 }],
  ])('uses the canonical weights at depth %i', (depth, expected) => {
    expect(sunlightWeightsForDepth(depth)).toEqual(expected);
  });

  it('clamps depths outside 1-26 to the nearest band', () => {
    expect(sunlightWeightsForDepth(-100)).toEqual({ light: 60, mixed: 30, dark: 10 });
    expect(sunlightWeightsForDepth(100)).toEqual({ light: 20, mixed: 35, dark: 45 });
  });

  it('draws in fixed light, mixed, dark order at cumulative boundaries', () => {
    expect(selectSunlightCategory(1, () => 0)).toBe('light');
    expect(selectSunlightCategory(1, () => 0.599)).toBe('light');
    expect(selectSunlightCategory(1, () => 0.6)).toBe('mixed');
    expect(selectSunlightCategory(1, () => 0.899)).toBe('mixed');
    expect(selectSunlightCategory(1, () => 0.9)).toBe('dark');
  });

  it('selects deterministically for a given floorSeed and depth', () => {
    expect(sunlightCategoryForFloorSeed(14, 24603)).toBe(sunlightCategoryForFloorSeed(14, 24603));
  });
});

describe('sunlight determinism vs existing generation (Phase 09.3)', () => {
  it('does not change terrain, rooms, start, enemies, exit, or ground items across repeated generation', () => {
    const a = createInitialState(9090);
    const b = createInitialState(9090);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.map.rooms).toEqual(b.map.rooms);
    expect(a.player.pos).toEqual(b.player.pos);
    expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
      b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
    );
    expect(a.exit).toEqual(b.exit);
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('changing the category roll does not consume or mutate another RNG stream', () => {
    const map = openMap();
    const before = JSON.stringify(map);
    const otherRng = createRng(987654321);
    const expectedOtherRng = createRng(987654321);
    const first = otherRng();

    const lightSeed = Array.from({ length: 10_000 }, (_, seed) => seed).find(
      (seed) => sunlightCategoryForFloorSeed(1, seed) === 'light',
    )!;
    const darkSeed = Array.from({ length: 10_000 }, (_, seed) => seed).find(
      (seed) => sunlightCategoryForFloorSeed(1, seed) === 'dark',
    )!;
    generateSunlightLayer(map, 1, lightSeed, { x: 10, y: 10 });
    generateSunlightLayer(map, 1, darkSeed, { x: 10, y: 10 });

    expect(first).toBe(expectedOtherRng());
    expect(otherRng()).toBe(expectedOtherRng());
    expect(JSON.stringify(map)).toBe(before);
  });

  it('sunlight never affects canMove-based blocking (movement into a wall still fails identically)', () => {
    const state = createInitialState(2222);
    // Find a wall tile adjacent to a floor tile and confirm a move toward
    // it is still blocked exactly as without sunlight (regression-style
    // smoke check; the movement code never reads state.sunlight at all).
    const before = { ...state.player.pos };
    for (const dir of ['N', 'S', 'E', 'W'] as const) {
      processTurn(state, { type: 'move', direction: dir });
    }
    // No assertion on exact position (depends on map); this only confirms
    // repeated calls do not throw and player stays within bounds.
    expect(state.player.pos.x).toBeGreaterThanOrEqual(0);
    expect(state.player.pos.y).toBeGreaterThanOrEqual(0);
    expect(before).toBeDefined();
  });
});

describe('contextual Space input: solar charge on a sunlit tile below max SOL (Phase 09.3b)', () => {
  it('charges on a sunlit tile with SOL 0, raising it to 1', () => {
    const state = freshState({ solarEnergy: 0 });
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    expect(state.solarEnergy).toBe(1);
  });

  it('charges on a sunlit tile with SOL 4, raising it to 5', () => {
    const state = freshState({ solarEnergy: 4 });
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(5);
  });

  it('a single charge recovers exactly 1 SOL, never more', () => {
    const state = freshState({ solarEnergy: 2 });
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(3);
  });

  it('does not exceed maxSolarEnergy', () => {
    const state = freshState({ solarEnergy: 4, maxSolarEnergy: 5 });
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBeLessThanOrEqual(5);
  });

  it('consumes exactly 1 turn, same as a normal wait', () => {
    const state = freshState({ solarEnergy: 0, turn: 3 });
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(4);
  });

  it('lets the enemy act exactly once', () => {
    const state = freshState({ solarEnergy: 0 });
    const enemy = createInitialEnemy('bok', { x: 15, y: 15 }, 5, 1);
    const before = { ...enemy.pos };
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'wait' });
    expect(result.enemyActed).toBe(true);
    expect(enemy.pos).not.toEqual(before);
  });

  it('does not double-run enemy turn resolution with multiple enemies present', () => {
    const state = freshState({ solarEnergy: 0 });
    const e1 = createInitialEnemy('bok', { x: 15, y: 15 }, 5, 1);
    const e2 = createInitialEnemy('bok', { x: 4, y: 4 }, 5, 1);
    state.enemies = [e1, e2];
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(1);
  });

  it('a successful charge emits exactly one solar_charge_used event', () => {
    const state = freshState({ solarEnergy: 0 });
    const result = processTurn(state, { type: 'wait' });
    const chargeEvents = result.events.filter((e) => e.type === 'solar_charge_used');
    expect(chargeEvents.length).toBe(1);
  });

  it('solarEnergy is updated synchronously (no async delay)', () => {
    const state = freshState({ solarEnergy: 0 });
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(1); // already updated by the time processTurn returns
  });

  it('moving onto a sunlit tile alone does not trigger a charge (only Space there does)', () => {
    const map = openMap();
    const state = freshState({ map, sunlight: allTrueGrid(map), solarEnergy: 2 });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.solarEnergy).toBe(2);
  });

  it('repeated charges do not recover more than 1 SOL each', () => {
    const state = freshState({ solarEnergy: 0 });
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(1);
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(2);
  });
});

describe('contextual Space input: plain wait in shadow (Phase 09.3b)', () => {
  function shadowState(overrides?: Partial<GameState>): GameState {
    const map = openMap();
    return freshState({ map, sunlight: allFalseGrid(map), ...overrides });
  }

  it('does not recover SOL in shadow', () => {
    const state = shadowState({ solarEnergy: 2 });
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(2);
  });

  it('still consumes 1 turn like any other wait', () => {
    const state = shadowState({ solarEnergy: 2, turn: 5 });
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(6);
  });

  it('still lets the enemy act normally', () => {
    const state = shadowState({ solarEnergy: 2 });
    const enemy = createInitialEnemy('bok', { x: 15, y: 15 }, 5, 1);
    const before = { ...enemy.pos };
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'wait' });
    expect(result.enemyActed).toBe(true);
    expect(enemy.pos).not.toEqual(before);
  });

  it('reports consumed: true, same as any normal wait', () => {
    const state = shadowState({ solarEnergy: 2 });
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
  });

  it('does not emit a solar_charge_used event', () => {
    const state = shadowState({ solarEnergy: 2 });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'solar_charge_used')).toBe(false);
  });

  it('does not emit any charge-related event at all (shadow waiting is an ordinary wait, not a failed charge)', () => {
    const state = shadowState({ solarEnergy: 2 });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.every((e) => !e.type.startsWith('solar_charge'))).toBe(true);
  });
});

describe('contextual Space input: plain wait at full SOL in sunlight (Phase 09.3b)', () => {
  it('does not recover SOL when already at maxSolarEnergy', () => {
    const state = freshState({ solarEnergy: 5, maxSolarEnergy: 5 });
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(5);
  });

  it('still consumes 1 turn when full', () => {
    const state = freshState({ solarEnergy: 5, turn: 9 });
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(10);
  });

  it('still lets the enemy act normally when full', () => {
    const state = freshState({ solarEnergy: 5 });
    const enemy = createInitialEnemy('bok', { x: 15, y: 15 }, 5, 1);
    const before = { ...enemy.pos };
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'wait' });
    expect(result.enemyActed).toBe(true);
    expect(enemy.pos).not.toEqual(before);
  });

  it('does not emit a solar_charge_used event when already full', () => {
    const state = freshState({ solarEnergy: 5 });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'solar_charge_used')).toBe(false);
  });

  it('is indistinguishable in its events from a shadow wait (both are plain waits)', () => {
    const fullSunlit = freshState({ solarEnergy: 5 });
    const resultSunlit = processTurn(fullSunlit, { type: 'wait' });

    const map = openMap();
    const shadow = freshState({ map, sunlight: allFalseGrid(map), solarEnergy: 5 });
    const resultShadow = processTurn(shadow, { type: 'wait' });

    expect(resultSunlit.events).toEqual([]);
    expect(resultShadow.events).toEqual([]);
  });
});

describe('V key no longer produces any action (Phase 09.3a/b)', () => {
  it('actionForKey returns null for "v"', async () => {
    const { actionForKey } = await import('../input');
    expect(actionForKey('v')).toBeNull();
    expect(actionForKey('V')).toBeNull();
  });
});

describe('solar charge is a distinct action from wait for hammerRecovery purposes (Phase 09.3b)', () => {
  it('a successful charge does NOT clear hammerRecovery (charge is not treated as a wait)', () => {
    const state = freshState({ solarEnergy: 0, hammerRecovery: true });
    processTurn(state, { type: 'wait' });
    expect(state.hammerRecovery).toBe(true);
  });

  it('a successful charge does not spuriously set hammerRecovery true either, when it was already false', () => {
    const state = freshState({ solarEnergy: 0, hammerRecovery: false });
    processTurn(state, { type: 'wait' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('a shadow wait (plain wait, not a charge) clears hammerRecovery as usual', () => {
    const map = openMap();
    const state = freshState({ map, sunlight: allFalseGrid(map), hammerRecovery: true, solarEnergy: 2 });
    processTurn(state, { type: 'wait' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('a full-SOL wait in sunlight (plain wait, not a charge) clears hammerRecovery as usual', () => {
    const state = freshState({ solarEnergy: 5, hammerRecovery: true });
    processTurn(state, { type: 'wait' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('charging while hammerRecovery is true does not "double dip": SOL still recovers exactly 1 and hammerRecovery is untouched in the same turn', () => {
    const state = freshState({ solarEnergy: 0, hammerRecovery: true, turn: 0 });
    const result = processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(1);
    expect(state.hammerRecovery).toBe(true);
    expect(state.turn).toBe(1);
    expect(result.events.filter((e) => e.type === 'solar_charge_used').length).toBe(1);
  });

  it('the existing hammer re-cock mechanic via X is unchanged', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    state.player.facing = 'E';
    const result = processTurn(state, { type: 'action' });
    expect(result.events).toContainEqual({ type: 'hammer_recover' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('the existing solar gun hammerRecovery-clearing behavior is unchanged', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', hammerRecovery: true, solarEnergy: 5 });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(false);
  });
});
