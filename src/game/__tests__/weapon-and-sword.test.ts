import { describe, expect, it } from 'vitest';
import { closeInventory, inventoryEntries, toggleInventory, useSelectedInventoryItem } from '../inventory';
import { createEmptyInventory, getGroundItemPoolForFloor, ITEM_DEFINITIONS } from '../item-def';
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
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

describe('weapon definition (Phase 08.3)', () => {
  it('registers sword as a weapon item with the correct display name and category', () => {
    expect(ITEM_DEFINITIONS.sword.displayName).toBe('グラディウス');
    expect(ITEM_DEFINITIONS.sword.category).toBe('weapon');
    expect(ITEM_DEFINITIONS.sword.consumable).toBe(false);
    expect(ITEM_DEFINITIONS.sword.stackable).toBe(false);
  });

  it('registers sword with attack power 2 (bonus over bare hands; Phase 15.1, see weapon-def.ts) and reach 1', () => {
    expect(WEAPON_DEFINITIONS.sword.attackPower).toBe(2);
    expect(WEAPON_DEFINITIONS.sword.reach).toBe(1);
  });
});

describe('sword placement (Phase 15.4b random ground item generation)', () => {
  const RUN_SEEDS = [1, 2, 5, 13, 42, 100, 12345];

  it('when a sword is placed on floor 1, it is on a valid floor tile not overlapping player/exit/enemy/other items', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      const swords = state.groundItems.filter((item) => item.itemId === 'sword');
      for (const sword of swords) {
        expect(state.map.terrain[sword.pos.y][sword.pos.x]).toBe('floor');
        expect(sword.pos).not.toEqual(state.player.pos);
        expect(sword.pos).not.toEqual(state.exit);
        for (const enemy of state.enemies) {
          expect(sword.pos).not.toEqual(enemy.pos);
        }
        for (const other of state.groundItems) {
          if (other === sword) continue;
          expect(sword.pos).not.toEqual(other.pos);
        }
      }
    }
  });

  it('sword is no longer floor-1-exclusive: it stays in the cumulative pool on floor 2 and floor 3 too (Phase 15.4b)', () => {
    // Phase 15.4b removes the old "sword only ever appears on floor 1"
    // guarantee — sword is in GROUND_ITEM_POOL_FLOOR_1 and every later
    // floor's pool is a superset, so it remains a valid candidate.
    expect(getGroundItemPoolForFloor(1)).toContain('sword');
    expect(getGroundItemPoolForFloor(2)).toContain('sword');
    expect(getGroundItemPoolForFloor(3)).toContain('sword');
  });

  it('is deterministic: the same seed places the sword at the same coordinate (present or absent alike)', () => {
    for (const runSeed of RUN_SEEDS) {
      const a = createInitialState(runSeed);
      const b = createInitialState(runSeed);
      const swordA = a.groundItems.find((i) => i.itemId === 'sword');
      const swordB = b.groundItems.find((i) => i.itemId === 'sword');
      expect(swordA).toEqual(swordB);
    }
  });

  it('does not perturb existing map/placement/species determinism (independent RNG streams)', () => {
    const a = createInitialState(2780624551);
    const b = createInitialState(2780624551);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.player.pos).toEqual(b.player.pos);
    expect(a.exit).toEqual(b.exit);
    expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
      b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
    );
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('sword appearance is no longer guaranteed every floor-1 run (Phase 15.4b): it varies across seeds', () => {
    let seenPresent = false;
    let seenAbsent = false;
    for (let runSeed = 0; runSeed < 60; runSeed++) {
      const state = createInitialState(runSeed);
      const count = state.groundItems.filter((i) => i.itemId === 'sword').length;
      if (count >= 1) seenPresent = true;
      else seenAbsent = true;
    }
    expect(seenPresent).toBe(true);
    expect(seenAbsent).toBe(true);
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
    expect(result.events).toContainEqual({ type: 'item_picked_up', itemId: 'sword', unidentifiedCard: false });
  });
});

describe('equipping the sword', () => {
  it('can equip an owned sword from the inventory, setting equippedWeaponId', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    toggleInventory(state);
    // Selection order follows ITEM_IDS_IN_ORDER filtered to owned items;
    // with only sword owned, it is entry 0.
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBe('sword');
  });

  it('cannot equip an unowned sword', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.consumed).toBe(false);
    expect(state.equippedWeaponId).toBeNull();
  });

  it('equip success consumes exactly 1 turn', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    const turnBefore = state.turn;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('equip success runs enemy actions afterward (existing turn pipeline, no separate AI)', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.enemyActed).toBe(true);
    expect(result.enemyAttacked).toBe(true);
    // Phase 16.2: natural regen now ticks every turn (REGEN_TURNS_PER_HP
    // 10->1), so the 1 damage taken this same turn is immediately offset
    // by 1 HP of regen (hp was already below max going in), netting to
    // no visible change — this is the intended new behavior, not a
    // missed hit; see docs/history/phase-16-early-game-balance.md's
    // Phase 16.2 section.
    expect(state.player.hp).toBe(hpBefore);
  });

  it('equip success closes the inventory overlay', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    toggleInventory(state);
    useSelectedInventoryItem(state);
    expect(state.inventoryOpen).toBe(false);
  });

  it('equipping does not remove the sword from inventory', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(state.inventory.sword).toBe(1);
  });

  it('re-equipping the already-equipped sword is a no-op: no turn, inventory stays open', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 }, equippedWeaponId: 'sword' });
    toggleInventory(state);
    const turnBefore = state.turn;
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.inventoryOpen).toBe(true);
  });

  it('re-equipping the already-equipped sword emits weapon_already_equipped', () => {
    const state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 }, equippedWeaponId: 'sword' });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.events).toContainEqual({ type: 'weapon_already_equipped', weaponId: 'sword' });
  });

  it('equipping does not change apple use behavior', () => {
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
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

  it('sword-equipped attack power is 3 (Phase 15.1: fixture player.attack 1 + sword bonus 2)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    expect(getEffectiveAttackPower(state)).toBe(3);
  });

  it('an adjacent attack while unarmed deals 1 damage (unchanged)', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(4);
  });

  it('an adjacent attack while sword-equipped deals its defined bonus damage (Phase 15.1: fixture player.attack 1 + sword bonus 2 = 3)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 20, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(17);
  });

  it('sword attack works on diagonal adjacency too (range unchanged from unarmed)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'SE';
    const enemy = createInitialEnemy('bok', { x: 3, y: 2 }, 20, 1); // diagonal from (2,1)
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(17);
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
      damage: 3,
      targetHpBefore: 20,
      targetHpAfter: 17,
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

  it('golem (HP40) is not defeated by a single sword hit (bonus damage 3, not lethal in one hit) (Phase 15.1)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const golem = createInitialEnemy('golem', { x: 3, y: 1 }, 40, 3, 0, 0);
    state.enemies = [golem];
    processTurn(state, { type: 'action' });
    expect(golem.alive).toBe(true);
    expect(golem.hp).toBe(37);
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
    const state = freshState({ equippedWeaponId: 'sword', inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
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
    let state = freshState({ inventory: { apple: 0, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 }, equippedWeaponId: 'sword' });
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
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    expect(inventoryEntries(state)).toEqual([
      { itemId: 'apple', count: 1 },
      { itemId: 'sword', count: 1 },
    ]);
  });

  it('opening/closing the inventory still consumes no turn with both items owned', () => {
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
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
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    state.player.hp = 1;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBe(3);
    expect(state.inventory.apple).toBe(0);
  });

  it('apple still fails at full HP without consuming a turn', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 } });
    state.player.hp = state.player.maxHp;
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.inventory.apple).toBe(1);
  });
});
