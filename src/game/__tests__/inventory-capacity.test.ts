import { describe, expect, it } from 'vitest';
import { hasInventoryCapacity, INVENTORY_CAPACITY, totalInventoryCount } from '../inventory';
import { createEmptyInventory } from '../item-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';
import { DEFAULT_RUN_CONFIG } from '../floor';

// Same fixed layout as inventory-and-apple.test.ts, kept independent per
// the project's test-fixture-independence principle.
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
    enemies: [createInitialEnemy('bok', { x: 7, y: 6 }, 2, 1)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
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
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

describe('INVENTORY_CAPACITY / totalInventoryCount (Phase 11.1)', () => {
  it('capacity constant is 20', () => {
    expect(INVENTORY_CAPACITY).toBe(20);
  });

  it('sums all item counts, including non-stackable weapon/armor entries', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 3, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 2, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    expect(totalInventoryCount(state)).toBe(7);
  });

  it('an empty inventory totals 0', () => {
    const state = freshState();
    expect(totalInventoryCount(state)).toBe(0);
  });
});

describe('capacity boundary (Phase 11.1)', () => {
  it('can pick up items while below capacity (0 up to 19)', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 19, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    expect(hasInventoryCapacity(state)).toBe(true);
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.apple).toBe(20);
    expect(state.groundItems).toHaveLength(0);
    expect(result.events).toContainEqual({ type: 'item_picked_up', itemId: 'apple', unidentifiedCard: false, displayName: '未鑑定の消耗品' });
  });

  it('a pickup that brings the total exactly to 20 succeeds (no off-by-one)', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 19, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(totalInventoryCount(state)).toBe(20);
  });

  it('at exactly capacity (20), a further pickup is rejected', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 20, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      groundItems: [{ id: 0, itemId: 'sun_fruit', pos: { x: 3, y: 1 } }],
    });
    expect(hasInventoryCapacity(state)).toBe(false);
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.sun_fruit).toBe(0);
    expect(result.events).not.toContainEqual({ type: 'item_picked_up', itemId: 'sun_fruit' });
  });

  it('total inventory count never exceeds capacity after repeated pickup attempts', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 20, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'W' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(totalInventoryCount(state)).toBeLessThanOrEqual(INVENTORY_CAPACITY);
  });

  it('defensively rejects pickup even if inventory total is somehow already above capacity', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 21, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      groundItems: [{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.sword).toBe(0);
  });
});

describe('failed pickup on full inventory (Phase 11.1)', () => {
  function fullState(overrides?: Partial<GameState>): GameState {
    return freshState({
      inventory: { ...createEmptyInventory(), apple: 20, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      groundItems: [{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }],
      ...overrides,
    });
  }

  it('leaves the ground item in place (not removed) with id/type/position unchanged', () => {
    const state = fullState();
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.groundItems).toEqual([{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }]);
  });

  it('does not change existing inventory contents', () => {
    const state = fullState();
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.apple).toBe(20);
    expect(state.inventory.sword).toBe(0);
  });

  it('does not emit item_picked_up', () => {
    const state = fullState();
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events).not.toContainEqual(expect.objectContaining({ type: 'item_picked_up' }));
  });

  it('emits item_pickup_failed with reason inventory_full', () => {
    const state = fullState();
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events).toContainEqual({ type: 'item_pickup_failed', itemId: 'sword', reason: 'inventory_full', displayName: '未鑑定の武器' });
  });

  it('other ground items on different tiles are unaffected', () => {
    const state = fullState({
      groundItems: [
        { id: 0, itemId: 'sword', pos: { x: 3, y: 1 } },
        { id: 1, itemId: 'hammer', pos: { x: 5, y: 5 } },
      ],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.groundItems).toContainEqual({ id: 1, itemId: 'hammer', pos: { x: 5, y: 5 } });
  });

  it('the normal move still counts as this turn (player still moves, one turn consumed)', () => {
    const state = fullState();
    const turnBefore = state.turn;
    const posBefore = { ...state.player.pos };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.player.pos).not.toEqual(posBefore);
  });

  it('does not consume an additional turn beyond the normal move', () => {
    const state = fullState();
    const turnBefore = state.turn;
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('standing still on the same tile across multiple turns does not repeatedly consume the item or auto-retry pickup into inventory', () => {
    const state = fullState();
    processTurn(state, { type: 'move', direction: 'E' }); // move onto the item tile, fails
    processTurn(state, { type: 'wait' });
    processTurn(state, { type: 'wait' });
    expect(state.inventory.sword).toBe(0);
    expect(state.groundItems).toEqual([{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }]);
  });
});

describe('sol_enchantment is excluded from capacity (Phase 11.1)', () => {
  it('sol_enchantment pickup succeeds even when regular inventory is at capacity, and does not touch state.inventory', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 20, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      groundItems: [{ id: 0, itemId: 'sol_enchantment', pos: { x: 3, y: 1 } }],
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(state.solUnlocked).toBe(true);
    expect(state.inventory.sol_enchantment).toBe(0);
    expect(state.groundItems).toHaveLength(0);
    expect(result.events).toContainEqual({ type: 'sol_enchantment_acquired' });
  });

  it('does not count toward totalInventoryCount even after being unlocked', () => {
    const state = freshState({ solUnlocked: true });
    expect(totalInventoryCount(state)).toBe(0);
  });
});

describe('lifecycle: capacity and inventory survive floor transitions and initialization (Phase 11.1)', () => {
  it('inventory contents (and thus current capacity usage) are carried over across a floor transition', () => {
    let state = freshState({
      inventory: { ...createEmptyInventory(), apple: 5, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    state.enemies.forEach((e) => (e.alive = false));
    state.exit = { x: 3, y: 1 };
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(totalInventoryCount(state)).toBe(5);
  });

  it('a new run starts with total inventory count 0 (well under capacity)', () => {
    const state = createInitialState(2024);
    expect(totalInventoryCount(state)).toBe(0);
    expect(hasInventoryCapacity(state)).toBe(true);
  });
});

describe('regression: existing pickup/weapon/consumable behavior below capacity is unaffected', () => {
  it('picking up a weapon below capacity still succeeds as before', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }],
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.sword).toBe(1);
    expect(result.events).toContainEqual({ type: 'item_picked_up', itemId: 'sword', unidentifiedCard: false, displayName: '未鑑定の武器' });
  });

  it('moving onto a tile with no ground item is unaffected by capacity logic', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 20, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(result.events).toEqual([]);
  });
});
