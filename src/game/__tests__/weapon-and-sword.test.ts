import { describe, expect, it } from 'vitest';
import { closeInventory, inventoryEntries, toggleInventory, useSelectedInventoryItem } from '../inventory';
import { createEmptyInventory, ITEM_DEFINITIONS } from '../item-def';
import { WEAPON_DEFINITIONS } from '../weapon-def';
import { advanceToNextFloor, createInitialState, randomSeed } from '../state';
import { createInitialActor, createInitialEnemy, getEffectiveAttackPower, processTurn } from '../turn';
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
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

describe('weapon definition (Phase 08.3)', () => {
  it('registers sword as a weapon item with the correct display name and category', () => {
    expect(ITEM_DEFINITIONS.sword.displayName).toBe('ソード');
    expect(ITEM_DEFINITIONS.sword.category).toBe('weapon');
    expect(ITEM_DEFINITIONS.sword.consumable).toBe(false);
    expect(ITEM_DEFINITIONS.sword.stackable).toBe(false);
  });

  it('registers sword with attack power 10 (bonus over bare hands; Phase 10.2, see weapon-def.ts) and reach 1', () => {
    expect(WEAPON_DEFINITIONS.sword.attackPower).toBe(10);
    expect(WEAPON_DEFINITIONS.sword.reach).toBe(1);
  });
});

describe('sword placement (floor 1 only)', () => {
  const RUN_SEEDS = [1, 2, 5, 13, 42, 100, 12345];

  it('places exactly one sword on floor 1, on a floor tile, not overlapping player/exit/enemy/apple', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      const swords = state.groundItems.filter((item) => item.itemId === 'sword');
      expect(swords).toHaveLength(1);
      const sword = swords[0];
      expect(state.map.terrain[sword.pos.y][sword.pos.x]).toBe('floor');
      expect(sword.pos).not.toEqual(state.player.pos);
      expect(sword.pos).not.toEqual(state.exit);
      for (const enemy of state.enemies) {
        expect(sword.pos).not.toEqual(enemy.pos);
      }
      const apple = state.groundItems.find((item) => item.itemId === 'apple')!;
      expect(sword.pos).not.toEqual(apple.pos);
    }
  });

  it('does not place a sword on floor 2 or 3', () => {
    for (const runSeed of [1, 7, 42]) {
      let state = createInitialState(runSeed);
      for (let target = 2; target <= 3; target++) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        processTurn(state, { type: 'wait' });
        expect(state.phase).toBe('floor_cleared');
        state = advanceToNextFloor(state);
        expect(state.floor).toBe(target);
        expect(state.groundItems.filter((i) => i.itemId === 'sword')).toHaveLength(0);
      }
    }
  });

  it('is deterministic: the same seed places the sword at the same coordinate', () => {
    for (const runSeed of RUN_SEEDS) {
      const a = createInitialState(runSeed);
      const b = createInitialState(runSeed);
      const swordA = a.groundItems.find((i) => i.itemId === 'sword');
      const swordB = b.groundItems.find((i) => i.itemId === 'sword');
      expect(swordA).toEqual(swordB);
    }
  });

  it('does not perturb existing map/placement/species/apple determinism (independent RNG stream)', () => {
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
  });

  it('never introduces a random sword-appearance rate: every fresh floor-1 state has exactly one', () => {
    for (let runSeed = 0; runSeed < 30; runSeed++) {
      const state = createInitialState(runSeed);
      expect(state.groundItems.filter((i) => i.itemId === 'sword')).toHaveLength(1);
    }
  });
});

describe('sword pickup', () => {
  it('picking up the sword increases inventory.sword by 1, removes it from groundItems, in one normal-move turn', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }],
    });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.inventory.sword).toBe(1);
    expect(state.groundItems).toHaveLength(0);
  });

  it('picking up the sword does not auto-equip it', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.equippedWeaponId).toBeNull();
  });

  it('emits an item_picked_up event on sword pickup', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }],
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events).toContainEqual({ type: 'item_picked_up', itemId: 'sword' });
  });
});

describe('equipping the sword', () => {
  it('can equip an owned sword from the inventory, setting equippedWeaponId', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    toggleInventory(state);
    // Selection order follows ITEM_IDS_IN_ORDER filtered to owned items;
    // with only sword owned, it is entry 0.
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBe('sword');
  });

  it('cannot equip an unowned sword', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.consumed).toBe(false);
    expect(state.equippedWeaponId).toBeNull();
  });

  it('equip success consumes exactly 1 turn', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    const turnBefore = state.turn;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('equip success runs enemy actions afterward (existing turn pipeline, no separate AI)', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.enemyActed).toBe(true);
    expect(result.enemyAttacked).toBe(true);
    expect(state.player.hp).toBe(hpBefore - 1);
  });

  it('equip success closes the inventory overlay', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    toggleInventory(state);
    useSelectedInventoryItem(state);
    expect(state.inventoryOpen).toBe(false);
  });

  it('equipping does not remove the sword from inventory', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(state.inventory.sword).toBe(1);
  });

  it('re-equipping the already-equipped sword is a no-op: no turn, inventory stays open', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 }, equippedWeaponId: 'sword' });
    toggleInventory(state);
    const turnBefore = state.turn;
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.inventoryOpen).toBe(true);
  });

  it('re-equipping the already-equipped sword emits weapon_already_equipped', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 }, equippedWeaponId: 'sword' });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.events).toContainEqual({ type: 'weapon_already_equipped', weaponId: 'sword' });
  });

  it('equipping does not change apple use behavior', () => {
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = 1;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBeGreaterThan(1);
    expect(state.inventory.apple).toBe(0);
  });
});

describe('weapon-aware combat', () => {
  it('unarmed attack power is 1', () => {
    const state = freshState();
    expect(getEffectiveAttackPower(state)).toBe(1);
  });

  it('sword-equipped attack power is 11 (Phase 10.2: fixture player.attack 1 + sword bonus 10)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    expect(getEffectiveAttackPower(state)).toBe(11);
  });

  it('an adjacent attack while unarmed deals 1 damage (unchanged)', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(4);
  });

  it('an adjacent attack while sword-equipped deals its defined bonus damage (Phase 10.2: fixture player.attack 1 + sword bonus 10 = 11)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 20, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(9);
  });

  it('sword attack works on diagonal adjacency too (range unchanged from unarmed)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'SE';
    const enemy = createInitialEnemy('bok', { x: 3, y: 2 }, 20, 1); // diagonal from (2,1)
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(9);
  });

  it('player_attack event includes weaponId when equipped, omits it when unarmed', () => {
    const armed = freshState({ equippedWeaponId: 'sword' });
    armed.player.facing = 'E';
    const armedEnemy = createInitialEnemy('bok', { x: 3, y: 1 }, 20, 1);
    armed.enemies = [armedEnemy];
    const armedResult = processTurn(armed, { type: 'action' });
    expect(armedResult.events).toContainEqual({
      type: 'player_attack',
      enemyType: 'bok',
      targetId: 0,
      damage: 11,
      targetHpBefore: 20,
      targetHpAfter: 9,
      weaponId: 'sword',
    });

    const unarmed = freshState();
    unarmed.player.facing = 'E';
    const unarmedEnemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    unarmed.enemies = [unarmedEnemy];
    const unarmedResult = processTurn(unarmed, { type: 'action' });
    expect(unarmedResult.events).toContainEqual({
      type: 'player_attack',
      enemyType: 'bok',
      targetId: 0,
      damage: 1,
      targetHpBefore: 5,
      targetHpAfter: 4,
    });
  });

  it('sword attack still triggers normal enemy actions and special cycles afterward (golem slow_melee)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const golem = createInitialEnemy('golem', { x: 3, y: 1 }, 40, 3, 0, 0);
    golem.spawnTurn = 0;
    state.enemies = [golem];
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyAttacked).toBe(true); // golem's acting phase on turn 0
  });

  it('golem (HP40) is not defeated by a single sword hit (bonus damage 11, not lethal in one hit) (Phase 10.2, scaled 10x from HP4/dmg2)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const golem = createInitialEnemy('golem', { x: 3, y: 1 }, 40, 3, 0, 0);
    state.enemies = [golem];
    processTurn(state, { type: 'action' });
    expect(golem.alive).toBe(true);
    expect(golem.hp).toBe(29);
  });

  it('sword attacks do not knock the enemy back (position unchanged aside from defeat)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    state.enemies = [enemy];
    const posBefore = { ...enemy.pos };
    processTurn(state, { type: 'action' });
    expect(enemy.pos).toEqual(posBefore);
  });

  it('equipping the sword does not consume it (no durability/consumption on use)', () => {
    const state = freshState({ equippedWeaponId: 'sword', inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    processTurn(state, { type: 'wait' });
    expect(state.inventory.sword).toBe(1);
    expect(state.equippedWeaponId).toBe('sword');
  });

  it('defeating an enemy with the sword still fires enemy_defeated as before', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyDefeated).toBe(true);
    expect(result.events).toContainEqual({ type: 'enemy_defeated', enemyType: 'bok', targetId: 0 });
  });
});

describe('persistence and reset (Phase 08.3)', () => {
  it('sword possession and equip state carry over across a floor transition', () => {
    let state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 }, equippedWeaponId: 'sword' });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.inventory.sword).toBe(1);
    expect(state.equippedWeaponId).toBe('sword');
  });

  it('a new game resets sword possession to 0 and equippedWeaponId to null', () => {
    const state = createInitialState(randomSeed());
    expect(state.inventory.sword).toBe(0);
    expect(state.equippedWeaponId).toBeNull();
  });

  it('apple count still resets to 0 on a new game (regression)', () => {
    const state = createInitialState(randomSeed());
    expect(state.inventory.apple).toBe(0);
  });
});

describe('inventory controls with both apple and sword (Phase 08.3)', () => {
  it('inventoryEntries lists both when both are owned, in ITEM_IDS_IN_ORDER order', () => {
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    expect(inventoryEntries(state)).toEqual([
      { itemId: 'apple', count: 1 },
      { itemId: 'sword', count: 1 },
    ]);
  });

  it('opening/closing the inventory still consumes no turn with both items owned', () => {
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    const turnBefore = state.turn;
    toggleInventory(state);
    closeInventory(state);
    expect(state.turn).toBe(turnBefore);
  });

  it('inventory display remains empty-safe when neither item is owned', () => {
    const state = freshState();
    expect(inventoryEntries(state)).toEqual([]);
  });
});

describe('regression: Phase 08.2 apple behavior unaffected', () => {
  it('apple still heals 2 HP and consumes 1 apple on success', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = 1;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBe(3);
    expect(state.inventory.apple).toBe(0);
  });

  it('apple still fails at full HP without consuming a turn', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = state.player.maxHp;
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.inventory.apple).toBe(1);
  });
});
