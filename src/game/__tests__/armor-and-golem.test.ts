import { describe, expect, it } from 'vitest';
import { closeInventory, inventoryEntries, toggleInventory, useSelectedInventoryItem } from '../inventory';
import { createEmptyInventory, ITEM_DEFINITIONS } from '../item-def';
import { ARMOR_DEFINITIONS } from '../armor-def';
import { getEnemyPoolForFloor } from '../enemy-def';
import { advanceToNextFloor, createInitialState, randomSeed } from '../state';
import {
  createInitialActor,
  createInitialEnemy,
  getEffectiveArmorValue,
  getIncomingDamage,
  processTurn,
} from '../turn';
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
    ...overrides,
  };
}

describe('armor definition (Phase 08.4)', () => {
  it('registers armor as an armor item with the correct display name and category', () => {
    expect(ITEM_DEFINITIONS.armor.displayName).toBe('アーマー');
    expect(ITEM_DEFINITIONS.armor.category).toBe('armor');
    expect(ITEM_DEFINITIONS.armor.consumable).toBe(false);
    expect(ITEM_DEFINITIONS.armor.stackable).toBe(false);
  });

  it('registers armor with armorValue 1', () => {
    expect(ARMOR_DEFINITIONS.armor.armorValue).toBe(1);
  });
});

describe('armor placement (floor 1 only)', () => {
  const RUN_SEEDS = [1, 2, 5, 13, 42, 100, 12345];

  it('places exactly one armor on floor 1, on a floor tile, not overlapping player/exit/enemy/apple/sword', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      const armors = state.groundItems.filter((item) => item.itemId === 'armor');
      expect(armors).toHaveLength(1);
      const armor = armors[0];
      expect(state.map.terrain[armor.pos.y][armor.pos.x]).toBe('floor');
      expect(armor.pos).not.toEqual(state.player.pos);
      expect(armor.pos).not.toEqual(state.exit);
      for (const enemy of state.enemies) {
        expect(armor.pos).not.toEqual(enemy.pos);
      }
      const apple = state.groundItems.find((i) => i.itemId === 'apple')!;
      const sword = state.groundItems.find((i) => i.itemId === 'sword')!;
      expect(armor.pos).not.toEqual(apple.pos);
      expect(armor.pos).not.toEqual(sword.pos);
    }
  });

  it('does not place armor on floor 2 or 3', () => {
    for (const runSeed of [1, 7, 42]) {
      let state = createInitialState(runSeed);
      for (let target = 2; target <= 3; target++) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        processTurn(state, { type: 'wait' });
        expect(state.phase).toBe('floor_cleared');
        state = advanceToNextFloor(state);
        expect(state.groundItems.filter((i) => i.itemId === 'armor')).toHaveLength(0);
      }
    }
  });

  it('is deterministic: the same seed places armor at the same coordinate', () => {
    for (const runSeed of RUN_SEEDS) {
      const a = createInitialState(runSeed);
      const b = createInitialState(runSeed);
      const armorA = a.groundItems.find((i) => i.itemId === 'armor');
      const armorB = b.groundItems.find((i) => i.itemId === 'armor');
      expect(armorA).toEqual(armorB);
    }
  });

  it('does not perturb existing map/placement/species/apple/sword determinism (independent RNG stream)', () => {
    const a = createInitialState(2780624551);
    const b = createInitialState(2780624551);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.player.pos).toEqual(b.player.pos);
    expect(a.exit).toEqual(b.exit);
    expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
      b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
    );
    const appleA = a.groundItems.find((i) => i.itemId === 'apple');
    const appleB = b.groundItems.find((i) => i.itemId === 'apple');
    expect(appleA).toEqual(appleB);
    const swordA = a.groundItems.find((i) => i.itemId === 'sword');
    const swordB = b.groundItems.find((i) => i.itemId === 'sword');
    expect(swordA).toEqual(swordB);
  });
});

describe('armor pickup', () => {
  it('picking up armor increases inventory.armor by 1, removes it from groundItems, in one normal-move turn', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'armor', pos: { x: 3, y: 1 } }],
    });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.inventory.armor).toBe(1);
    expect(state.groundItems).toHaveLength(0);
  });

  it('picking up armor does not auto-equip it', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'armor', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.equippedArmorId).toBeNull();
  });
});

describe('equipping armor', () => {
  it('can equip owned armor from the inventory, setting equippedArmorId', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    toggleInventory(state);
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(true);
    expect(state.equippedArmorId).toBe('armor');
  });

  it('cannot equip unowned armor', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    const result = processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(result.consumed).toBe(false);
    expect(state.equippedArmorId).toBeNull();
  });

  it('equip success consumes exactly 1 turn', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    const turnBefore = state.turn;
    processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('equip success runs enemy actions afterward (existing turn pipeline, no separate AI)', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    const result = processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(result.enemyActed).toBe(true);
  });

  it('equip success closes the inventory overlay', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    toggleInventory(state);
    useSelectedInventoryItem(state);
    expect(state.inventoryOpen).toBe(false);
  });

  it('re-equipping already-equipped armor is a no-op: no turn, inventory stays open', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 }, equippedArmorId: 'armor' });
    toggleInventory(state);
    const turnBefore = state.turn;
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.inventoryOpen).toBe(true);
  });

  it('equipping armor does not remove it from inventory', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(state.inventory.armor).toBe(1);
  });

  it('equipping armor does not affect the equipped weapon, and vice versa', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 }, equippedWeaponId: 'sword' });
    processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(state.equippedWeaponId).toBe('sword');
    expect(state.equippedArmorId).toBe('armor');

    const state2 = freshState({ inventory: { apple: 0, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 }, equippedArmorId: 'armor' });
    processTurn(state2, { type: 'equip_weapon', weaponId: 'sword' });
    expect(state2.equippedArmorId).toBe('armor');
    expect(state2.equippedWeaponId).toBe('sword');
  });

  it('equipping armor does not affect apple use behavior', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    state.player.hp = 1;
    processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.apple).toBe(0);
  });
});

describe('armor damage reduction', () => {
  it('unarmored armor value is 0', () => {
    const state = freshState();
    expect(getEffectiveArmorValue(state)).toBe(0);
  });

  it('armor-equipped armor value is 1', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    expect(getEffectiveArmorValue(state)).toBe(1);
  });

  it('unarmored: incoming damage equals attack power unchanged', () => {
    const state = freshState();
    expect(getIncomingDamage(state, 1)).toBe(1);
    expect(getIncomingDamage(state, 2)).toBe(2);
    expect(getIncomingDamage(state, 3)).toBe(3);
  });

  it('armor 1: attack power 1 becomes 0 damage', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    expect(getIncomingDamage(state, 1)).toBe(0);
  });

  it('armor 1: attack power 2 becomes 1 damage', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    expect(getIncomingDamage(state, 2)).toBe(1);
  });

  it('armor 1: golem attack power 3 becomes 2 damage', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    expect(getIncomingDamage(state, 3)).toBe(2);
  });

  it('an armored player takes 0 damage from a bok (attack 1) melee hit; HP unchanged', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'wait' });
    expect(result.enemyAttacked).toBe(true);
    expect(state.player.hp).toBe(hpBefore);
  });

  it('a 0-damage hit still consumes the turn and advances turn count', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    const turnBefore = state.turn;
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('a 0-damage hit never sets player.alive to false / never triggers gameover', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    processTurn(state, { type: 'wait' });
    expect(state.player.alive).toBe(true);
    expect(state.phase).toBe('playing');
  });

  it('a 0-damage hit still advances other enemies and special cycles (golem slow_melee) normally', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    const golem = createInitialEnemy('golem', { x: 0, y: 0 }, 4, 3, 0, 1);
    golem.spawnTurn = 0;
    state.enemies = [bok, golem];
    const result = processTurn(state, { type: 'wait' });
    // bok deals 0 damage (armored), but both enemies should still have acted.
    expect(result.enemyActed).toBe(true);
  });

  it('emits an enemy_attack event with damage: 0 when armor fully blocks', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    const result = processTurn(state, { type: 'wait' });
    expect(result.events).toContainEqual({ type: 'enemy_attack', enemyType: 'bok', damage: 0 });
  });

  it('armor is not consumed/removed by absorbing hits', () => {
    const state = freshState({ equippedArmorId: 'armor', inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    processTurn(state, { type: 'wait' });
    processTurn(state, { type: 'wait' });
    expect(state.inventory.armor).toBe(1);
    expect(state.equippedArmorId).toBe('armor');
  });
});

describe('floor 2 golem availability (Phase 08.4)', () => {
  it("1F candidate pool does not include golem", () => {
    expect(getEnemyPoolForFloor(1)).not.toContain('golem');
  });

  it('2F candidate pool includes golem', () => {
    expect(getEnemyPoolForFloor(2)).toContain('golem');
  });

  it('3F candidate pool is unchanged (no golem)', () => {
    expect(getEnemyPoolForFloor(3)).not.toContain('golem');
    expect(new Set(getEnemyPoolForFloor(3))).toEqual(
      new Set(['bok', 'bat', 'spider', 'cockatrice', 'mummy']),
    );
  });

  it('2F never has more than 1 golem, across many seeds', () => {
    for (let runSeed = 0; runSeed < 200; runSeed++) {
      let s: GameState = createInitialState(runSeed);
      s.enemies.forEach((e) => (e.alive = false));
      s.player.pos = { ...s.exit };
      processTurn(s, { type: 'wait' });
      s = advanceToNextFloor(s);
      const golemCount = s.enemies.filter((e) => e.type === 'golem').length;
      expect(golemCount).toBeLessThanOrEqual(1);
    }
  });

  it("2F total enemy count is unchanged (still 2)", () => {
    let state: GameState = createInitialState(7);
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    state = advanceToNextFloor(state);
    expect(state.enemies).toHaveLength(2);
  });

  it('golem stats are unchanged when it appears on 2F (HP4, attack 3, slow_melee)', () => {
    for (let runSeed = 0; runSeed < 200; runSeed++) {
      let s: GameState = createInitialState(runSeed);
      s.enemies.forEach((e) => (e.alive = false));
      s.player.pos = { ...s.exit };
      processTurn(s, { type: 'wait' });
      s = advanceToNextFloor(s);
      const golem = s.enemies.find((e) => e.type === 'golem');
      if (golem) {
        expect(golem.maxHp).toBe(4);
        expect(golem.attack).toBe(3);
      }
    }
  });

  it('same seed reproduces the same 2F species+position composition (determinism preserved)', () => {
    for (const runSeed of [1, 42, 12345]) {
      let a: GameState = createInitialState(runSeed);
      a.enemies.forEach((e) => (e.alive = false));
      a.player.pos = { ...a.exit };
      processTurn(a, { type: 'wait' });
      a = advanceToNextFloor(a);

      let b: GameState = createInitialState(runSeed);
      b.enemies.forEach((e) => (e.alive = false));
      b.player.pos = { ...b.exit };
      processTurn(b, { type: 'wait' });
      b = advanceToNextFloor(b);

      expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
        b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
      );
    }
  });
});

describe('persistence and reset (Phase 08.4)', () => {
  it('armor possession and equip state carry over across a floor transition', () => {
    let state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 }, equippedArmorId: 'armor' });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.inventory.armor).toBe(1);
    expect(state.equippedArmorId).toBe('armor');
  });

  it('sword possession/equip and apple count are unaffected by armor persistence (regression)', () => {
    let state = freshState({
      inventory: { apple: 1, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 },
      equippedWeaponId: 'sword',
      equippedArmorId: 'armor',
    });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    state = advanceToNextFloor(state);
    expect(state.inventory.sword).toBe(1);
    expect(state.equippedWeaponId).toBe('sword');
    expect(state.inventory.apple).toBe(1);
  });

  it('a new game resets armor possession to 0 and equippedArmorId to null', () => {
    const state = createInitialState(randomSeed());
    expect(state.inventory.armor).toBe(0);
    expect(state.equippedArmorId).toBeNull();
  });

  it('a new game still resets sword/apple as before (regression)', () => {
    const state = createInitialState(randomSeed());
    expect(state.inventory.sword).toBe(0);
    expect(state.equippedWeaponId).toBeNull();
    expect(state.inventory.apple).toBe(0);
  });
});

describe('inventory controls with apple, sword, and armor (Phase 08.4)', () => {
  it('inventoryEntries lists all three when owned, in ITEM_IDS_IN_ORDER order', () => {
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    expect(inventoryEntries(state)).toEqual([
      { itemId: 'apple', count: 1 },
      { itemId: 'sword', count: 1 },
      { itemId: 'armor', count: 1 },
    ]);
  });

  it('opening/closing the inventory still consumes no turn with all three owned', () => {
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    const turnBefore = state.turn;
    toggleInventory(state);
    closeInventory(state);
    expect(state.turn).toBe(turnBefore);
  });

  it('empty inventory display and Enter no-op remain safe (regression)', () => {
    const state = freshState();
    expect(inventoryEntries(state)).toEqual([]);
    toggleInventory(state);
    const turnBefore = state.turn;
    expect(() => useSelectedInventoryItem(state)).not.toThrow();
    expect(state.turn).toBe(turnBefore);
  });
});

describe('regression: Phase 08.2/08.3 behavior unaffected', () => {
  it('sword attack power is still 2', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(3);
  });

  it('apple still heals 2 HP and consumes 1 apple on success', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0 } });
    state.player.hp = 1;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBe(3);
    expect(state.inventory.apple).toBe(0);
  });
});
