import { describe, expect, it } from 'vitest';
import {
  closeInventory,
  inventoryEntries,
  moveInventorySelection,
  toggleInventory,
  useSelectedInventoryItem,
} from '../inventory';
import { createEmptyInventory, ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from '../item-def';
import { bfsDistances, chooseGroundItemPosition, createRng } from '../mapgen';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';

// Small fixed layout retained only for these unit tests; production maps
// come from mapgen.ts (see multi-floor-robustness.test.ts for coverage
// against real generated maps).
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
    selectedEnchantment: 'none',
    sunlight: [],
    ...overrides,
  };
}

describe('item definition (Phase 08.2/08.3)', () => {
  it('registers apple with the correct display name and heal amount', () => {
    expect(ITEM_IDS_IN_ORDER).toContain('apple');
    expect(ITEM_DEFINITIONS.apple.displayName).toBe('リンゴ');
    expect(ITEM_DEFINITIONS.apple.healAmount).toBe(2);
    expect(ITEM_DEFINITIONS.apple.category).toBe('consumable');
  });

  it('createEmptyInventory starts every registered item at 0', () => {
    const inventory = createEmptyInventory();
    for (const id of ITEM_IDS_IN_ORDER) {
      expect(inventory[id]).toBe(0);
    }
  });
});

describe('ground item placement (chooseGroundItemPosition)', () => {
  it('places on a reachable floor tile, excluding start/exit/enemy positions', () => {
    const map = testMap();
    const start = { x: 2, y: 1 };
    const exit = { x: 7, y: 1 };
    const enemyPos = { x: 7, y: 6 };
    for (const seed of [1, 2, 3, 42, 999]) {
      const rng = createRng(seed);
      const pos = chooseGroundItemPosition(map, start, [start, exit, enemyPos], rng);
      expect(map.terrain[pos.y][pos.x]).toBe('floor');
      expect(pos).not.toEqual(start);
      expect(pos).not.toEqual(exit);
      expect(pos).not.toEqual(enemyPos);
      expect(bfsDistances(map, start).has(`${pos.x},${pos.y}`)).toBe(true);
    }
  });

  it('is deterministic for a fixed rng seed', () => {
    const map = testMap();
    const start = { x: 2, y: 1 };
    const a = chooseGroundItemPosition(map, start, [start], createRng(777));
    const b = chooseGroundItemPosition(map, start, [start], createRng(777));
    expect(a).toEqual(b);
  });

  it('throws explicitly rather than silently placing nothing when no candidate tile exists', () => {
    const map = testMap();
    const start = { x: 2, y: 1 };
    const everyFloorTile: { x: number; y: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (map.terrain[y][x] === 'floor') everyFloorTile.push({ x, y });
      }
    }
    expect(() => chooseGroundItemPosition(map, start, everyFloorTile, createRng(1))).toThrow();
  });
});

describe('apple placement in real floor generation (createInitialState)', () => {
  const RUN_SEEDS = [1, 2, 5, 13, 42, 100, 12345];

  it('places exactly one apple per floor, on a floor tile, not overlapping player/exit/enemies', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      const apples = state.groundItems.filter((item) => item.itemId === 'apple');
      expect(apples).toHaveLength(1);
      const apple = apples[0];
      expect(state.map.terrain[apple.pos.y][apple.pos.x]).toBe('floor');
      expect(apple.pos).not.toEqual(state.player.pos);
      expect(apple.pos).not.toEqual(state.exit);
      for (const enemy of state.enemies) {
        expect(apple.pos).not.toEqual(enemy.pos);
      }
    }
  });

  it('is deterministic: the same seed places the apple at the same coordinate', () => {
    for (const runSeed of RUN_SEEDS) {
      const a = createInitialState(runSeed);
      const b = createInitialState(runSeed);
      expect(a.groundItems).toEqual(b.groundItems);
    }
  });

  it('does not perturb existing map/placement/species determinism (independent RNG stream)', () => {
    const a = createInitialState(2780624551);
    const b = createInitialState(2780624551);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.player.pos).toEqual(b.player.pos);
    expect(a.exit).toEqual(b.exit);
    expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
      b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
    );
  });

  it('each floor of a run gets exactly one apple, reset per floor (not carried over)', () => {
    let state = createInitialState(7);
    for (let target = 2; target <= 3; target++) {
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      processTurn(state, { type: 'wait' });
      expect(state.phase).toBe('floor_cleared');
      state = advanceToNextFloor(state);
      expect(state.floor).toBe(target);
      const apples = state.groundItems.filter((item) => item.itemId === 'apple');
      expect(apples).toHaveLength(1);
    }
  });
});

describe('pickup (auto-pickup on move)', () => {
  it('picking up the apple increases inventory.apple by 1 and removes it from groundItems, in one normal-move turn', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1); // exactly one turn, no extra
    expect(state.inventory.apple).toBe(1);
    expect(state.groundItems).toHaveLength(0);
  });

  it('emits an item_picked_up event on pickup', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events).toContainEqual({ type: 'item_picked_up', itemId: 'apple' });
  });

  it('does not pick up anything when moving onto a tile with no ground item', () => {
    const state = freshState();
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.apple).toBe(0);
  });

  it('new game starts with an empty inventory', () => {
    const state = createInitialState(2024);
    expect(state.inventory.apple).toBe(0);
  });

  it('inventory is carried over across a floor transition', () => {
    let state = freshState({
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.apple).toBe(1);

    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { x: 99, y: 99 };
    state.exit = { x: 99, y: 99 };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.inventory.apple).toBe(1);
  });
});

describe('inventory overlay controls (Tab/Escape/Arrow/Enter)', () => {
  it('toggleInventory opens then closes, without consuming a turn', () => {
    const state = freshState();
    const turnBefore = state.turn;
    toggleInventory(state);
    expect(state.inventoryOpen).toBe(true);
    toggleInventory(state);
    expect(state.inventoryOpen).toBe(false);
    expect(state.turn).toBe(turnBefore);
  });

  it('closeInventory closes an open overlay without consuming a turn', () => {
    const state = freshState();
    toggleInventory(state);
    const turnBefore = state.turn;
    closeInventory(state);
    expect(state.inventoryOpen).toBe(false);
    expect(state.turn).toBe(turnBefore);
  });

  it('opening resets the selected index to 0', () => {
    const state = freshState({ inventory: { apple: 3, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 }, selectedItemIndex: 5 });
    toggleInventory(state);
    expect(state.selectedItemIndex).toBe(0);
  });

  it('moveInventorySelection does not consume a turn', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    toggleInventory(state);
    const turnBefore = state.turn;
    moveInventorySelection(state, 1);
    expect(state.turn).toBe(turnBefore);
  });

  it('inventory display excludes zero-count items (inventoryEntries)', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    expect(inventoryEntries(state)).toEqual([]);
  });

  it('inventory display includes positive-count items', () => {
    const state = freshState({ inventory: { apple: 2, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    expect(inventoryEntries(state)).toEqual([{ itemId: 'apple', count: 2 }]);
  });

  it('while the overlay is open, move/wait input is rejected (no turn consumed, no effect)', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    toggleInventory(state);
    const turnBefore = state.turn;
    const posBefore = { ...state.player.pos };
    const moveResult = processTurn(state, { type: 'move', direction: 'E' });
    expect(moveResult.consumed).toBe(false);
    expect(state.player.pos).toEqual(posBefore);
    const waitResult = processTurn(state, { type: 'wait' });
    expect(waitResult.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
  });

  it('useSelectedInventoryItem on an empty inventory does not throw, does not consume a turn', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    toggleInventory(state);
    const turnBefore = state.turn;
    expect(() => useSelectedInventoryItem(state)).not.toThrow();
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
  });
});

describe('apple use rules (Phase 08.2)', () => {
  it('using apple at HP1 (max 3) heals to HP3 and consumes exactly 1 apple', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = 1;
    toggleInventory(state);
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBe(3);
    expect(state.inventory.apple).toBe(0);
  });

  it('using apple at HP2 (max 3) heals to HP3 (capped at maxHp) and still consumes 1 apple', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = 2;
    toggleInventory(state);
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBe(3);
    expect(state.inventory.apple).toBe(0);
  });

  it('cannot use apple at full HP: not consumed, apple count unchanged, inventory stays open', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = state.player.maxHp;
    toggleInventory(state);
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(false);
    expect(state.inventory.apple).toBe(1);
    expect(state.inventoryOpen).toBe(true);
    expect(result.events).toContainEqual({ type: 'item_use_failed', itemId: 'apple', reason: 'full_hp' });
  });

  it('full-HP use attempt does not consume a turn', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = state.player.maxHp;
    toggleInventory(state);
    const turnBefore = state.turn;
    useSelectedInventoryItem(state);
    expect(state.turn).toBe(turnBefore);
  });

  it('a successful use consumes exactly 1 turn and runs enemy actions afterward', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = 1;
    // Put a lone bok directly adjacent so it will attack this turn.
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    toggleInventory(state);
    const turnBefore = state.turn;
    const result = useSelectedInventoryItem(state);
    expect(state.turn).toBe(turnBefore + 1);
    expect(result.enemyActed).toBe(true);
    // Healed to 3, then the adjacent bok (attack 1) hits: net HP 2.
    expect(state.player.hp).toBe(2);
  });

  it('a failed use (full HP) does not trigger any enemy action', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = state.player.maxHp;
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    toggleInventory(state);
    const hpBefore = state.player.hp;
    const result = useSelectedInventoryItem(state);
    expect(result.enemyActed).toBe(false);
    expect(state.player.hp).toBe(hpBefore);
  });

  it('a successful use closes the inventory overlay', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = 1;
    toggleInventory(state);
    useSelectedInventoryItem(state);
    expect(state.inventoryOpen).toBe(false);
  });

  it('inventory count never goes negative even if use is attempted with 0 apples', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = 1;
    // Directly exercise the use_item action with a stale/invalid selection.
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.apple).toBe(0);
  });

  it('a successful use preserves special enemy behavior cycles (e.g. golem slow_melee acting phase)', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = 1;
    const golem = createInitialEnemy('golem', { x: 3, y: 1 }, 4, 3, 0, 0);
    golem.spawnTurn = state.turn; // acting phase 0 == this is an acting turn
    state.enemies = [golem];
    toggleInventory(state);
    const result = useSelectedInventoryItem(state);
    // Healed to 3, then golem (on its acting phase) attacks for 3: HP 0, defeated.
    expect(result.enemyAttacked).toBe(true);
  });
});

describe('regression: existing move/wait/attack behavior unaffected when inventory is closed', () => {
  it('a normal move still works exactly as before when the inventory has never been opened', () => {
    const state = freshState();
    const before = { ...state.player.pos };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.player.pos).not.toEqual(before);
  });

  it('a normal wait still works exactly as before', () => {
    const state = freshState();
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
  });
});
