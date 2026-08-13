import { describe, expect, it } from 'vitest';
import {
  closeInventory,
  hasInventoryCapacity,
  INVENTORY_CAPACITY,
  selectedItemId,
  totalInventoryCount,
} from '../inventory';
import { createEmptyInventory } from '../item-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';

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

describe('capacity display helpers (Phase 11.2)', () => {
  it('0 / 20 for an empty inventory', () => {
    const state = freshState();
    expect(totalInventoryCount(state)).toBe(0);
    expect(INVENTORY_CAPACITY).toBe(20);
  });

  it('an intermediate value sums across item ids', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 2, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    expect(totalInventoryCount(state)).toBe(6);
  });

  it('20 / 20 when full', () => {
    const state = freshState({
      inventory: { apple: 20, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    expect(totalInventoryCount(state)).toBe(20);
    expect(hasInventoryCapacity(state)).toBe(false);
  });

  it('updates after a successful place (count decreases by 1)', () => {
    const state = freshState({
      inventory: { apple: 5, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(totalInventoryCount(state)).toBe(4);
  });

  it('updates after a successful discard (count decreases by 1)', () => {
    const state = freshState({
      inventory: { apple: 5, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(totalInventoryCount(state)).toBe(4);
  });

  it('does not change after a failed/cancelled action', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(totalInventoryCount(state)).toBe(0);
  });
});

describe('place_item success (Phase 11.2)', () => {
  it('decreases inventory by exactly 1 from 2+', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(state.inventory.apple).toBe(2);
  });

  it('decreases inventory to 0 when placing the last copy', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(state.inventory.apple).toBe(0);
  });

  it('creates a groundItem with the correct itemId at the player position', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(state.groundItems).toHaveLength(1);
    expect(state.groundItems[0].itemId).toBe('apple');
    expect(state.groundItems[0].pos).toEqual(state.player.pos);
  });

  it('does not auto-repick the placed item within the same action', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(state.inventory.apple).toBe(0);
    expect(state.groundItems).toHaveLength(1);
  });

  it('consumes exactly 1 turn on success', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('runs enemy actions afterward like any other consumed action', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)],
    });
    const result = processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(result.enemyActed).toBe(true);
  });

  it('does not change combatRngState (no RNG used)', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      enemies: [],
    });
    const rngBefore = state.combatRngState;
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(state.combatRngState).toBe(rngBefore);
  });

  it('emits item_placed exactly once', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const result = processTurn(state, { type: 'place_item', itemId: 'apple' });
    const placedEvents = result.events.filter((e) => e.type === 'item_placed');
    expect(placedEvents).toEqual([{ type: 'item_placed', itemId: 'apple' }]);
  });

  it('placing a weapon still owned 2+ times leaves 1 remaining and equipped', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 2, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      equippedWeaponId: 'sword',
    });
    const result = processTurn(state, { type: 'place_item', itemId: 'sword' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.sword).toBe(1);
    expect(state.equippedWeaponId).toBe('sword');
  });
});

describe('place_item failure (Phase 11.2)', () => {
  it('does not change inventory/groundItems when the player tile already has a groundItem', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      groundItems: [{ id: 0, itemId: 'sword', pos: { x: 2, y: 1 } }],
    });
    const result = processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.apple).toBe(1);
    expect(state.groundItems).toEqual([{ id: 0, itemId: 'sword', pos: { x: 2, y: 1 } }]);
    expect(result.events).toContainEqual({ type: 'item_place_failed', itemId: 'apple', reason: 'ground_occupied' });
  });

  it('cannot place the last copy of a currently-equipped weapon', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      equippedWeaponId: 'sword',
    });
    const result = processTurn(state, { type: 'place_item', itemId: 'sword' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.sword).toBe(1);
    expect(state.groundItems).toHaveLength(0);
    expect(result.events).toContainEqual({ type: 'item_place_failed', itemId: 'sword', reason: 'equipped' });
  });

  it('cannot place the last copy of currently-equipped armor', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      equippedArmorId: 'armor',
    });
    const result = processTurn(state, { type: 'place_item', itemId: 'armor' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.armor).toBe(1);
  });

  it('cannot place an item with count 0', () => {
    const state = freshState();
    const result = processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(result.consumed).toBe(false);
    expect(result.events).toContainEqual({ type: 'item_place_failed', itemId: 'apple', reason: 'item_unavailable' });
  });

  it('does not consume a turn on failure', () => {
    const state = freshState();
    const turnBefore = state.turn;
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(state.turn).toBe(turnBefore);
  });

  it('does not change combatRngState on failure', () => {
    const state = freshState();
    const rngBefore = state.combatRngState;
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(state.combatRngState).toBe(rngBefore);
  });
});

describe('discard_item success and confirmation (Phase 11.2)', () => {
  it('inventory is unchanged before a discard is applied (simulating pre-confirmation state)', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    // No discard_item action submitted yet — inventory must be untouched.
    expect(state.inventory.apple).toBe(3);
  });

  it('applying discard_item decreases inventory by exactly 1', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(state.inventory.apple).toBe(2);
  });

  it('does not create a groundItem', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(state.groundItems).toHaveLength(0);
  });

  it('consumes exactly 1 turn on success', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('runs enemy actions afterward like any other consumed action', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)],
    });
    const result = processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(result.enemyActed).toBe(true);
  });

  it('does not change combatRngState (no RNG used)', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      enemies: [],
    });
    const rngBefore = state.combatRngState;
    processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(state.combatRngState).toBe(rngBefore);
  });

  it('emits item_discarded exactly once', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    const result = processTurn(state, { type: 'discard_item', itemId: 'apple' });
    const discardedEvents = result.events.filter((e) => e.type === 'item_discarded');
    expect(discardedEvents).toEqual([{ type: 'item_discarded', itemId: 'apple' }]);
  });
});

describe('discard_item failure and cancellation (Phase 11.2)', () => {
  it('a pending discardConfirmItemId with no confirm action does not change inventory', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      discardConfirmItemId: 'apple',
    });
    expect(state.inventory.apple).toBe(3);
  });

  it('clearing discardConfirmItemId (cancel) without submitting discard_item does not consume a turn', () => {
    const state = freshState({
      inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      discardConfirmItemId: 'apple',
    });
    const turnBefore = state.turn;
    state.discardConfirmItemId = null;
    expect(state.turn).toBe(turnBefore);
    expect(state.inventory.apple).toBe(3);
  });

  it('cannot discard the last copy of a currently-equipped weapon', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      equippedWeaponId: 'sword',
    });
    const result = processTurn(state, { type: 'discard_item', itemId: 'sword' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.sword).toBe(1);
    expect(result.events).toContainEqual({ type: 'item_discard_failed', itemId: 'sword', reason: 'equipped' });
  });

  it('can discard a non-last copy of a currently-equipped weapon', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 2, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      equippedWeaponId: 'sword',
    });
    const result = processTurn(state, { type: 'discard_item', itemId: 'sword' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.sword).toBe(1);
    expect(state.equippedWeaponId).toBe('sword');
  });

  it('cannot discard an item with count 0', () => {
    const state = freshState();
    const result = processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(result.consumed).toBe(false);
    expect(result.events).toContainEqual({ type: 'item_discard_failed', itemId: 'apple', reason: 'item_unavailable' });
  });

  it('does not change combatRngState on failure', () => {
    const state = freshState();
    const rngBefore = state.combatRngState;
    processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(state.combatRngState).toBe(rngBefore);
  });

  it('toggling the inventory overlay closed clears a pending discardConfirmItemId', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      inventoryOpen: true,
      discardConfirmItemId: 'apple',
    });
    closeInventory(state);
    expect(state.discardConfirmItemId).toBeNull();
  });
});

describe('selection correction after place/discard (Phase 11.2)', () => {
  it('selectedItemId returns null for an empty inventory', () => {
    const state = freshState();
    expect(selectedItemId(state)).toBeNull();
  });

  it('selectedItemId returns the entry at the current index', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      selectedItemIndex: 1,
    });
    expect(selectedItemId(state)).toBe('sword');
  });

  it('after the last copy of the selected item is placed, the selection index is clamped into range', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      selectedItemIndex: 1, // pointing at sword (2nd entry)
    });
    processTurn(state, { type: 'place_item', itemId: 'sword' });
    // Only 'apple' remains (1 entry), so the index must be clamped to 0.
    expect(state.selectedItemIndex).toBe(0);
  });

  it('after the last copy of the selected item is discarded, the selection index is clamped into range', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      selectedItemIndex: 1,
    });
    processTurn(state, { type: 'discard_item', itemId: 'sword' });
    expect(state.selectedItemIndex).toBe(0);
  });
});

describe('lifecycle: place/discard interplay with capacity and floor transitions (Phase 11.2)', () => {
  it('placing an item frees capacity for a subsequent pickup', () => {
    const state = freshState({
      inventory: { apple: 20, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    expect(hasInventoryCapacity(state)).toBe(false);
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(totalInventoryCount(state)).toBe(19);
    expect(hasInventoryCapacity(state)).toBe(true);
  });

  it('inventory changes from place/discard persist across a floor transition', () => {
    let state = freshState({
      inventory: { apple: 5, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
    });
    processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(state.inventory.apple).toBe(4);

    state.enemies.forEach((e) => (e.alive = false));
    state.exit = { x: 3, y: 1 };
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.inventory.apple).toBe(4);
  });

  it('a new run starts with no pending discard confirmation', () => {
    const state = createInitialState(2024);
    expect(state.discardConfirmItemId ?? null).toBeNull();
  });
});

describe('regression: existing use/equip behavior unaffected by place/discard additions', () => {
  it('use_item (apple heal) still works and closes the inventory overlay', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      inventoryOpen: true,
    });
    state.player.hp = 1;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.inventoryOpen).toBe(false);
  });

  it('equip_weapon still works while the overlay is open', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      inventoryOpen: true,
    });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBe('sword');
  });

  it('normal move is still rejected while the inventory overlay is open', () => {
    const state = freshState({ inventoryOpen: true });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(false);
  });

  it('place_item and discard_item are exempt from the inventoryOpen move/wait rejection, like use_item', () => {
    const state = freshState({
      inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      inventoryOpen: true,
    });
    const result = processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
  });
});
