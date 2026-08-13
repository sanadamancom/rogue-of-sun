import { describe, expect, it } from 'vitest';
import { closeInventory, inventoryEntries, toggleInventory, useSelectedInventoryItem } from '../inventory';
import { createEmptyInventory, getGroundItemPoolForFloor, ITEM_DEFINITIONS } from '../item-def';
import { ARMOR_DEFINITIONS } from '../armor-def';
import { getEnemyPoolForFloor } from '../enemy-def';
import { ENEMY_COUNT_BY_FLOOR } from '../mapgen';
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
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

describe('armor definition (Phase 08.4)', () => {
  it('registers armor as an armor item with the correct display name and category', () => {
    expect(ITEM_DEFINITIONS.armor.displayName).toBe('クロスアーマー');
    expect(ITEM_DEFINITIONS.armor.category).toBe('armor');
    expect(ITEM_DEFINITIONS.armor.consumable).toBe(false);
    expect(ITEM_DEFINITIONS.armor.stackable).toBe(false);
  });

  it('registers armor with armorValue 2 (Phase 15.1 core combat rebalance, クロスアーマー)', () => {
    expect(ARMOR_DEFINITIONS.armor.armorValue).toBe(2);
  });
});

describe('armor placement (Phase 15.4b random ground item generation)', () => {
  const RUN_SEEDS = [1, 2, 5, 13, 42, 100, 12345];

  it('when armor is placed on floor 1, it is on a valid floor tile not overlapping player/exit/enemy/other items', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      const armors = state.groundItems.filter((item) => item.itemId === 'armor');
      for (const armor of armors) {
        expect(state.map.terrain[armor.pos.y][armor.pos.x]).toBe('floor');
        expect(armor.pos).not.toEqual(state.player.pos);
        expect(armor.pos).not.toEqual(state.exit);
        for (const enemy of state.enemies) {
          expect(armor.pos).not.toEqual(enemy.pos);
        }
        for (const other of state.groundItems) {
          if (other === armor) continue;
          expect(armor.pos).not.toEqual(other.pos);
        }
      }
    }
  });

  it('armor is no longer floor-1-exclusive: it stays in the cumulative pool on floor 2 and floor 3 too (Phase 15.4b)', () => {
    expect(getGroundItemPoolForFloor(1)).toContain('armor');
    expect(getGroundItemPoolForFloor(2)).toContain('armor');
    expect(getGroundItemPoolForFloor(3)).toContain('armor');
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
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    toggleInventory(state);
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(true);
    expect(state.equippedArmorId).toBe('armor');
  });

  it('cannot equip unowned armor', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    const result = processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(result.consumed).toBe(false);
    expect(state.equippedArmorId).toBeNull();
  });

  it('equip success consumes exactly 1 turn', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    const turnBefore = state.turn;
    processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('equip success runs enemy actions afterward (existing turn pipeline, no separate AI)', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    const result = processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(result.enemyActed).toBe(true);
  });

  it('equip success closes the inventory overlay', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    toggleInventory(state);
    useSelectedInventoryItem(state);
    expect(state.inventoryOpen).toBe(false);
  });

  it('re-equipping already-equipped armor is a no-op: no turn, inventory stays open', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 }, equippedArmorId: 'armor' });
    toggleInventory(state);
    const turnBefore = state.turn;
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.inventoryOpen).toBe(true);
  });

  it('equipping armor does not remove it from inventory', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(state.inventory.armor).toBe(1);
  });

  it('equipping armor does not affect the equipped weapon, and vice versa', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 }, equippedWeaponId: 'sword' });
    processTurn(state, { type: 'equip_armor', armorId: 'armor' });
    expect(state.equippedWeaponId).toBe('sword');
    expect(state.equippedArmorId).toBe('armor');

    const state2 = freshState({ inventory: { apple: 0, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 }, equippedArmorId: 'armor' });
    processTurn(state2, { type: 'equip_weapon', weaponId: 'sword' });
    expect(state2.equippedArmorId).toBe('armor');
    expect(state2.equippedWeaponId).toBe('sword');
  });

  it('equipping armor does not affect apple use behavior', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
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

  it('armor-equipped armor value is 2 (Phase 15.1 core combat rebalance)', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    expect(getEffectiveArmorValue(state)).toBe(2);
  });

  it('unarmored: incoming damage equals attack power unchanged', () => {
    const state = freshState();
    expect(getIncomingDamage(state, 10)).toBe(10);
    expect(getIncomingDamage(state, 20)).toBe(20);
    expect(getIncomingDamage(state, 30)).toBe(30);
  });

  it('armor 2: attack power 10 is proportionally reduced to 9 (Phase 15.1 割合軽減式)', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    expect(getIncomingDamage(state, 10)).toBe(9);
  });

  it('armor 2: attack power 20 is proportionally reduced to 17 (Phase 15.1 割合軽減式)', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    expect(getIncomingDamage(state, 20)).toBe(17);
  });

  it('armor 2: golem attack power 30 is proportionally reduced to 26 (Phase 15.1 割合軽減式)', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    expect(getIncomingDamage(state, 30)).toBe(26);
  });

  it('an armored player takes the floored minimum 1 damage from a bok (attack 1) melee hit (Phase 15.1: 割合軽減式 min 1)', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'wait' });
    expect(result.enemyAttacked).toBe(true);
    // Phase 16.2: natural regen now ticks every turn, immediately
    // offsetting the 1 floored-minimum damage taken this same turn —
    // net unchanged, not a missed hit.
    expect(state.player.hp).toBe(hpBefore);
  });

  it('a minimum-damage hit still consumes the turn and advances turn count', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    const turnBefore = state.turn;
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('a minimum-damage hit never sets player.alive to false / never triggers gameover on its own', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    processTurn(state, { type: 'wait' });
    expect(state.player.alive).toBe(true);
    expect(state.phase).toBe('playing');
  });

  it('a minimum-damage hit still advances other enemies and special cycles (golem slow_melee) normally', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    const golem = createInitialEnemy('golem', { x: 0, y: 0 }, 4, 3, 0, 1);
    golem.spawnTurn = 0;
    state.enemies = [bok, golem];
    const result = processTurn(state, { type: 'wait' });
    // bok deals only the floored 1 damage (armored), but both enemies should still have acted.
    expect(result.enemyActed).toBe(true);
  });

  it('emits an enemy_attack event with the floored minimum damage (1) when armor heavily reduces the hit (Phase 15.1)', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    const result = processTurn(state, { type: 'wait' });
    expect(result.events).toContainEqual({ type: 'enemy_attack', enemyType: 'bok', attackerId: 0, damage: 1 });
  });

  it('armor is not consumed/removed by absorbing hits', () => {
    const state = freshState({ equippedArmorId: 'armor', inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
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
      // Phase 23.1 Stage 4: skeleton's provisional normal first-
      // appearance floor is 3, an intended pool-composition change.
      new Set(['bok', 'bat', 'spider', 'cockatrice', 'mummy', 'skeleton']),
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

  it("2F normal enemy count matches ENEMY_COUNT_BY_FLOOR[2] (Phase 15.5: 7, previously a flat 2)", () => {
    let state: GameState = createInitialState(7);
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { x: state.exit.x, y: state.exit.y - 1 >= 0 ? state.exit.y - 1 : state.exit.y };
    if (state.player.pos.y === state.exit.y) {
      state.player.pos = { ...state.exit };
      processTurn(state, { type: 'wait' });
    } else {
      processTurn(state, { type: 'move', direction: 'S' });
    }
    state = advanceToNextFloor(state);
    // Phase 21.4 correction: ENEMY_COUNT_BY_FLOOR counts NORMAL enemies
    // only. Filter out dedicated monster-house enemies (spawnSource:
    // 'monster_house') before comparing — an enemy with spawnSource
    // absent is still treated as normal, matching every enemy's default
    // treatment elsewhere in production (see monster-house.ts/turn.ts's
    // hidden-check). Expected value 7 is unchanged.
    const normalEnemies = state.enemies.filter((e) => e.spawnSource !== 'monster_house');
    expect(normalEnemies).toHaveLength(ENEMY_COUNT_BY_FLOOR[2]);
  });

  it('golem stats are unchanged when it appears on 2F (HP10, attack 12, slow_melee) (Phase 15.1 rebalance)', () => {
    for (let runSeed = 0; runSeed < 200; runSeed++) {
      let s: GameState = createInitialState(runSeed);
      s.enemies.forEach((e) => (e.alive = false));
      s.player.pos = { ...s.exit };
      processTurn(s, { type: 'wait' });
      s = advanceToNextFloor(s);
      const golem = s.enemies.find((e) => e.type === 'golem');
      if (golem) {
        expect(golem.maxHp).toBe(10);
        expect(golem.attack).toBe(12);
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
    let state = freshState({ inventory: { apple: 0, sword: 0, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 }, equippedArmorId: 'armor' });
    state.enemies.forEach((e) => (e.alive = false));
    // Phase 22 trigger fix: progression requires the player's own
    // successful move onto the exit tile. This synthetic test map has
    // the player start at a known floor tile (2,1) with another floor
    // tile immediately to its east (3,1), so set the exit there and
    // move onto it rather than teleporting.
    state.exit = { x: 3, y: 1 };
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.inventory.armor).toBe(1);
    expect(state.equippedArmorId).toBe('armor');
  });

  it('sword possession/equip and apple count are unaffected by armor persistence (regression)', () => {
    let state = freshState({
      inventory: { apple: 1, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
      equippedWeaponId: 'sword',
      equippedArmorId: 'armor',
    });
    state.enemies.forEach((e) => (e.alive = false));
    // Phase 22 trigger fix: progression requires the player's own
    // successful move onto the exit tile. This synthetic test map has
    // the player start at a known floor tile (2,1) with another floor
    // tile immediately to its east (3,1), so set the exit there and
    // move onto it rather than teleporting.
    state.exit = { x: 3, y: 1 };
    processTurn(state, { type: 'move', direction: 'E' });
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
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    expect(inventoryEntries(state)).toEqual([
      { itemId: 'apple', count: 1 },
      { itemId: 'sword', count: 1 },
      { itemId: 'armor', count: 1 },
    ]);
  });

  it('opening/closing the inventory still consumes no turn with all three owned', () => {
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
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
  it('sword still deals its defined bonus damage (Phase 15.1: fixture player.attack 1 + sword bonus 2 - defense 0 = 3)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 20, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(17);
  });

  it('apple still heals, clamped to this fixture maxHp 3, and consumes 1 apple on success', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    state.player.hp = 1;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBe(3); // real healAmount is 20 but this fixture's maxHp is 3
    expect(state.inventory.apple).toBe(0);
  });
});
