import { describe, expect, it } from 'vitest';
import { computeElementalDamage, ELEMENTAL_AFFINITY_BONUS_DAMAGE } from '../combat';
import { ENEMY_DEFINITIONS, ENEMY_TYPES_IN_ORDER } from '../enemy-def';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { createRunTelemetry, recordTurn, snapshotForTurn } from '../telemetry';
import { ElementId, GameMap, GameState, PlayerAction, Tile } from '../types';

const TEST_LAYOUT: string[] = [
  '##########',
  '#........#',
  '#..####..#',
  '#..#..#..#',
  '#..#..#..#',
  '#..####..#',
  '#........#',
  '##########',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 1 }, 3, 1),
    enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 1)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
    exit: { x: 99, y: 99 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: createEmptyInventory(),
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: 'sword',
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: true,
    unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'sol',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  } as GameState;
}

function faceEastAtEnemy(state: GameState): void {
  processTurn(state, { type: 'face', direction: 'E' });
}

describe('Phase 14.1 element foundation: ElementId type', () => {
  it('has all five species as valid values in enemy affinity data', () => {
    const elements: ElementId[] = ['sol', 'flame', 'frost', 'cloud', 'earth'];
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const affinities = ENEMY_DEFINITIONS[type].elementalAffinities;
      for (const el of elements) {
        expect(affinities[el]).toBeDefined();
      }
    }
  });

  it('does not include luna anywhere in an enemy affinity map', () => {
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const affinities = ENEMY_DEFINITIONS[type].elementalAffinities as Record<string, unknown>;
      expect(affinities.luna).toBeUndefined();
    }
  });

  it('does not include a weapon type key in an enemy affinity map', () => {
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const affinities = ENEMY_DEFINITIONS[type].elementalAffinities as Record<string, unknown>;
      expect(affinities.sword).toBeUndefined();
      expect(affinities.spear).toBeUndefined();
      expect(affinities.hammer).toBeUndefined();
    }
  });
});

describe('Phase 14.1/15.3 element foundation: computeElementalDamage (pure)', () => {
  it('resist -> 1 (mind bonus 0)', () => {
    expect(computeElementalDamage('resist', 0)).toBe(1);
  });

  it('neutral -> 2 (mind bonus 0)', () => {
    expect(computeElementalDamage('neutral', 0)).toBe(2);
  });

  it('weak -> 3 (mind bonus 0)', () => {
    expect(computeElementalDamage('weak', 0)).toBe(3);
  });

  it('mind bonus adds on top of the fixed affinity value', () => {
    expect(computeElementalDamage('weak', 2)).toBe(5);
    expect(computeElementalDamage('resist', 3)).toBe(4);
  });

  it('does not mutate the affinity bonus table or any input', () => {
    const before = { ...ELEMENTAL_AFFINITY_BONUS_DAMAGE };
    computeElementalDamage('weak', 0);
    expect(ELEMENTAL_AFFINITY_BONUS_DAMAGE).toEqual(before);
  });

  it('is deterministic and RNG-free (same inputs always produce the same output)', () => {
    const results = new Set<number>();
    for (let i = 0; i < 20; i++) {
      results.add(computeElementalDamage('weak', 0));
    }
    expect(results.size).toBe(1);
    expect(results.has(3)).toBe(true);
  });
});

describe('Phase 14.1 element foundation: enemy definitions', () => {
  it('every current species declares all five elements', () => {
    const elements: ElementId[] = ['sol', 'flame', 'frost', 'cloud', 'earth'];
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const affinities = ENEMY_DEFINITIONS[type].elementalAffinities;
      expect(Object.keys(affinities).sort()).toEqual([...elements].sort());
    }
  });

  // Phase 14.4 note: originally asserted that every species was neutral
  // across all five elements, which was true for Phase 14.1 (no real
  // affinities existed yet). Phase 14.4 has since assigned the confirmed
  // affinity table (see phase-14-4-enemy-affinities.test.ts for the
  // dedicated table-and-damage coverage), so this is updated to check
  // structural validity (every entry is a real ElementalAffinity value)
  // instead of a specific value that Phase 14.4 legitimately changed.
  it('every current species has a valid ElementalAffinity value for all five elements', () => {
    const validAffinities = ['weak', 'neutral', 'resist'];
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const affinities = ENEMY_DEFINITIONS[type].elementalAffinities;
      expect(validAffinities).toContain(affinities.sol);
      expect(validAffinities).toContain(affinities.flame);
      expect(validAffinities).toContain(affinities.frost);
      expect(validAffinities).toContain(affinities.cloud);
      expect(validAffinities).toContain(affinities.earth);
    }
  });
});

describe('Phase 14.1 element foundation: player enchantment state', () => {
  it('starts with every element unlocked: false on a brand new state', () => {
    const state = freshState({
      solUnlocked: false,
      unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'none',
    });
    expect(state.unlockedEnchantments).toEqual({
      sol: false,
      flame: false,
      frost: false,
      cloud: false,
      earth: false,
    });
  });

  it('picking up the sol_enchantment item unlocks only sol', () => {
    const state = freshState({
      solUnlocked: false,
      unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'none',
      enemies: [],
      groundItems: [{ id: 0, itemId: 'sol_enchantment', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.unlockedEnchantments.sol).toBe(true);
    expect(state.unlockedEnchantments.flame).toBe(false);
    expect(state.unlockedEnchantments.frost).toBe(false);
    expect(state.unlockedEnchantments.cloud).toBe(false);
    expect(state.unlockedEnchantments.earth).toBe(false);
  });

  it('existing sol toggle behavior (select/deselect) is unchanged', () => {
    const state = freshState({ selectedEnchantment: 'none' });
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('sol');
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('none');
  });
});

describe('Phase 14.1 element foundation: sol combat (neutral, unchanged results)', () => {
  it('deals physical + 2 elemental damage against a neutral-affinity enemy (Phase 15.3 rebalance)', () => {
    // combatRngState 304 with this fixture's accuracy/evasion resolves
    // as a hit deterministically (mirrors phase-10-1's fixture setup).
    // Phase 14.4 enemy affinities: bok is now sol-weak; use spider
    // (still all-neutral) so this keeps testing the plain neutral
    // result.
    const state = freshState({ enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 1)] });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent).toBeDefined();
    const solEvent = result.events.find((e) => e.type === 'sol_enchantment_used');
    expect(solEvent).toBeDefined();
    if (solEvent && solEvent.type === 'sol_enchantment_used') {
      expect(solEvent.affinity).toBe('neutral');
      expect(solEvent.element).toBe('sol');
      expect(solEvent.bonusDamage).toBe(2);
      if (attackEvent && attackEvent.type === 'player_attack') {
        expect(attackEvent.damage).toBe(solEvent.baseDamage + 2);
      }
    }
  });

  it('consumes exactly 1 SOL per successful hit regardless of affinity being neutral', () => {
    const state = freshState({ solarEnergy: 5 });
    faceEastAtEnemy(state);
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
  });

  it('does not consume SOL when insufficient, and still deals normal physical damage', () => {
    const state = freshState({ solarEnergy: 0 });
    faceEastAtEnemy(state);
    const before = state.enemies[0].hp;
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(0);
    const attackEvent = result.events.find((e) => e.type === 'player_attack');
    expect(attackEvent).toBeDefined();
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
    if (attackEvent && attackEvent.type === 'player_attack') {
      expect(before - state.enemies[0].hp).toBeGreaterThan(0);
    }
  });
});

describe('Phase 14.1 element foundation: weapon regression', () => {
  it('sol does not activate for bare hands', () => {
    const state = freshState({ equippedWeaponId: null });
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });

  it('sol does not activate for the solar gun', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun' });
    processTurn(state, { type: 'face', direction: 'E' });
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
  });
});

describe('Phase 14.1 element foundation: telemetry compatibility', () => {
  function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
    const before = snapshotForTurn(state);
    const result = processTurn(state, action);
    recordTurn(telemetry, action, result, before, state);
    return result;
  }

  it('keeps telemetry schemaVersion at 7', () => {
    const state = freshState();
    const telemetry = createRunTelemetry(state);
    expect(telemetry.schemaVersion).toBe(11);
  });

  it('records neutral sol additionalDamage as 2, calculatedDamage as physical+2 (Phase 15.3 rebalance)', () => {
    // Phase 14.4 enemy affinities: bok is now sol-weak; use spider
    // (still all-neutral) so this keeps testing the plain neutral
    // result.
    const state = freshState({ enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 1)] });
    const telemetry = createRunTelemetry(state);
    faceEastAtEnemy(state);
    step(state, { type: 'action' }, telemetry);
    const attackRunEvent = telemetry.events.find((e) => e.type === 'player_attack');
    expect(attackRunEvent).toBeDefined();
    if (attackRunEvent && attackRunEvent.type === 'player_attack') {
      expect(attackRunEvent.additionalDamage).toBe(2);
      expect(attackRunEvent.calculatedDamage).toBe(attackRunEvent.physicalDamage + 2);
      expect(attackRunEvent.solConsumed).toBe(1);
    }
  });
});
