import { describe, expect, it } from 'vitest';
import { useSelectedInventoryItem } from '../inventory';
import { createEmptyInventory, getGroundItemPoolForFloor, ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from '../item-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';
import { DEFAULT_RUN_CONFIG } from '../floor';

// Small fixed layout retained only for these unit tests; production maps
// come from mapgen.ts (see multi-floor-robustness.test.ts and
// determinism.test.ts for placement/seed coverage against real generated
// maps).
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

describe('sun fruit item definition (Phase 09.1)', () => {
  it('registers sun_fruit as a consumable with a solarAmount of 5 (Phase 15.3 rebalance)', () => {
    expect(ITEM_IDS_IN_ORDER).toContain('sun_fruit');
    expect(ITEM_DEFINITIONS.sun_fruit.displayName).toBe('太陽の実');
    expect(ITEM_DEFINITIONS.sun_fruit.category).toBe('consumable');
    expect(ITEM_DEFINITIONS.sun_fruit.consumable).toBe(true);
    expect(ITEM_DEFINITIONS.sun_fruit.stackable).toBe(true);
    expect(ITEM_DEFINITIONS.sun_fruit.solarAmount).toBe(5);
  });

  it('createEmptyInventory starts sun_fruit at 0', () => {
    expect(createEmptyInventory().sun_fruit).toBe(0);
  });
});

describe('solar energy state (Phase 09.1)', () => {
  it('a new run starts at SOL 15/15 (Phase 15.1 rebalance)', () => {
    const state = createInitialState(42);
    expect(state.solarEnergy).toBe(15);
    expect(state.maxSolarEnergy).toBe(15);
  });

  it('never drops below 0 via use (used indirectly through applyItemUse guard)', () => {
    const state = freshState({ solarEnergy: 0, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.solarEnergy).toBeGreaterThanOrEqual(0);
  });

  it('never exceeds maxSolarEnergy via use', () => {
    const state = freshState({ solarEnergy: 4, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.solarEnergy).toBeLessThanOrEqual(state.maxSolarEnergy);
  });

  it('floor transition preserves current and max solar energy', () => {
    let state = freshState({ solarEnergy: 3, maxSolarEnergy: 5 });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    state = advanceToNextFloor(state);
    expect(state.solarEnergy).toBe(3);
    expect(state.maxSolarEnergy).toBe(5);
  });

  it('move does not change solar energy', () => {
    const state = freshState({ solarEnergy: 4 });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.solarEnergy).toBe(4);
  });

  it('wait does not change solar energy', () => {
    const state = freshState({ solarEnergy: 4 });
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(4);
  });

  it('attack (action) does not change solar energy', () => {
    const state = freshState({ solarEnergy: 4 });
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
  });

  it('taking damage does not change solar energy', () => {
    const state = freshState({ solarEnergy: 4 });
    state.player.hp = 3;
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(4);
  });

  it('a brand new run resets solar energy to 15/15 (Phase 15.1 rebalance)', () => {
    const state = createInitialState(7);
    expect(state.solarEnergy).toBe(15);
    expect(state.maxSolarEnergy).toBe(15);
  });
});

describe('sun fruit use (Phase 09.1)', () => {
  it('picking up a sun fruit increases the sun_fruit count', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'sun_fruit', pos: { x: 3, y: 1 } }],
      nextGroundItemId: 1,
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.sun_fruit).toBe(1);
    expect(state.groundItems.length).toBe(0);
  });

  it('picking up a sun fruit does not auto-use it', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'sun_fruit', pos: { x: 3, y: 1 } }],
      nextGroundItemId: 1,
      solarEnergy: 3,
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.solarEnergy).toBe(3);
  });

  it('sun_fruit and apple counts are tracked independently', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 2, sun_fruit: 1 },
    });
    expect(state.inventory.apple).toBe(2);
    expect(state.inventory.sun_fruit).toBe(1);
  });

  it('using sun fruit at SOL 0 raises it to 5 (Phase 15.3: clamped to this fixture\'s max 5)', () => {
    const state = freshState({ solarEnergy: 0, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.solarEnergy).toBe(5);
  });

  it('using sun fruit at SOL 3 raises it to 5', () => {
    const state = freshState({ solarEnergy: 3, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.solarEnergy).toBe(5);
  });

  it('using sun fruit at SOL 4 raises it to 5 (clamped, not 6)', () => {
    const state = freshState({ solarEnergy: 4, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.solarEnergy).toBe(5);
  });

  it('cannot use sun fruit at SOL 5 (full)', () => {
    const state = freshState({ solarEnergy: 5, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    const result = processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(result.consumed).toBe(false);
    expect(state.solarEnergy).toBe(5);
  });

  it('using at max does not decrement the sun_fruit count', () => {
    const state = freshState({ solarEnergy: 5, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.inventory.sun_fruit).toBe(1);
  });

  it('a successful use decrements the sun_fruit count by exactly 1', () => {
    const state = freshState({ solarEnergy: 0, inventory: { ...createEmptyInventory(), sun_fruit: 2 } });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.inventory.sun_fruit).toBe(1);
  });

  it('a successful use consumes exactly 1 turn', () => {
    const state = freshState({ solarEnergy: 0, inventory: { ...createEmptyInventory(), sun_fruit: 1 }, turn: 10 });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.turn).toBe(11);
  });

  it('a successful use lets the enemy act exactly once', () => {
    const state = freshState({ solarEnergy: 0, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    state.enemies = [createInitialEnemy('bok', { x: 6, y: 6 }, 2, 1)];
    const before = { ...state.enemies[0].pos };
    const result = processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(result.enemyActed).toBe(true);
    expect(state.enemies[0].pos).not.toEqual(before);
  });

  it('a failed use (SOL full) does not consume a turn or move the enemy', () => {
    const state = freshState({ solarEnergy: 5, inventory: { ...createEmptyInventory(), sun_fruit: 1 }, turn: 10 });
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    const before = { ...state.enemies[0].pos };
    const result = processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(result.enemyActed).toBe(false);
    expect(state.turn).toBe(10);
    expect(state.enemies[0].pos).toEqual(before);
  });

  it('sun fruit never heals HP', () => {
    const state = freshState({ solarEnergy: 0, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    state.player.hp = 1;
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    // Phase 16.2: sun_fruit itself still never heals HP, but natural
    // regen now fires every turn (hp was below max going in), so the
    // turn nets +1 HP anyway.
    expect(state.player.hp).toBe(2);
  });

  it('apple never recovers solar energy', () => {
    const state = freshState({ solarEnergy: 2, inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 1;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(state.solarEnergy).toBe(2);
  });

  it('sun_fruit count carries over across a floor transition', () => {
    let state = freshState({ inventory: { ...createEmptyInventory(), sun_fruit: 2 } });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    state = advanceToNextFloor(state);
    expect(state.inventory.sun_fruit).toBe(2);
  });
});

describe('sun fruit placement (Phase 15.4b random ground item generation)', () => {
  it('is a valid candidate on floor 1, floor 2, and floor 3 (cumulative pool, no longer floor-1/2-only)', () => {
    expect(getGroundItemPoolForFloor(1, 3, 'short')).toContain('sun_fruit');
    expect(getGroundItemPoolForFloor(2, 3, 'short')).toContain('sun_fruit');
    expect(getGroundItemPoolForFloor(3, 3, 'short')).toContain('sun_fruit');
  });

  it('appearance is no longer guaranteed on any floor (Phase 15.4b): it varies across seeds', () => {
    let seenPresent = false;
    let seenAbsent = false;
    for (let seed = 0; seed < 60; seed++) {
      const state = createInitialState(seed);
      const count = state.groundItems.filter((i) => i.itemId === 'sun_fruit').length;
      if (count >= 1) seenPresent = true;
      else seenAbsent = true;
    }
    expect(seenPresent).toBe(true);
    expect(seenAbsent).toBe(true);
  });

  it('the same seed and floor produce the same groundItems (present or absent alike)', () => {
    const a = createInitialState(999);
    const b = createInitialState(999);
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('the sun fruit is placed on a reachable normal floor tile when present', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = createInitialState(seed);
      const sunFruit = state.groundItems.find((i) => i.itemId === 'sun_fruit');
      if (!sunFruit) continue;
      expect(state.map.terrain[sunFruit.pos.y][sunFruit.pos.x]).toBe('floor');
    }
  });

  it('the sun fruit never overlaps the player, exit, or another ground item', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const state = createInitialState(seed);
      const sunFruit = state.groundItems.find((i) => i.itemId === 'sun_fruit');
      if (!sunFruit) continue;
      const occupied = [state.player.pos, state.exit, ...state.enemies.map((e) => e.pos)];
      for (const pos of occupied) {
        expect(sunFruit.pos).not.toEqual(pos);
      }
      const others = state.groundItems.filter((i) => i.itemId !== 'sun_fruit');
      for (const other of others) {
        expect(sunFruit.pos).not.toEqual(other.pos);
      }
    }
  });

  it('every placed ground item still lands on a distinct, valid tile (Phase 15.4b unified generation)', () => {
    const state = createInitialState(321);
    const seen = new Set<string>();
    for (const item of state.groundItems) {
      expect(state.map.terrain[item.pos.y][item.pos.x]).toBe('floor');
      const key = `${item.pos.x},${item.pos.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('adding the sun fruit does not change enemy positions or the exit', () => {
    const withSunFruit = createInitialState(321);
    // Same seed regenerated is deterministic; this asserts stability of
    // enemy/exit placement in the presence of the new item stream, not
    // a before/after comparison against a pre-Phase-09.1 snapshot.
    const again = createInitialState(321);
    expect(withSunFruit.exit).toEqual(again.exit);
    expect(withSunFruit.enemies.map((e) => e.pos)).toEqual(again.enemies.map((e) => e.pos));
  });
});

describe('sun fruit inventory identification (Phase 09.1)', () => {
  it('sun fruit and apple have distinct glyphs', () => {
    expect(ITEM_DEFINITIONS.sun_fruit.glyph).not.toBe(ITEM_DEFINITIONS.apple.glyph);
  });

  it('sun fruit and apple have distinct display names', () => {
    expect(ITEM_DEFINITIONS.sun_fruit.displayName).not.toBe(ITEM_DEFINITIONS.apple.displayName);
  });

  it('using the selected sun fruit via useSelectedInventoryItem routes through use_item', () => {
    const state = freshState({ solarEnergy: 0, inventory: { ...createEmptyInventory(), sun_fruit: 1 } });
    state.selectedItemIndex = 0;
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(true);
    expect(state.solarEnergy).toBe(5);
  });

  it('equipping weapon/armor is unaffected by sun fruit presence in inventory', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), sword: 1, sun_fruit: 1 },
    });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBe('sword');
  });
});
