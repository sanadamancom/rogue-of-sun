import { describe, expect, it } from 'vitest';
import { closeInventory, inventoryEntries, toggleInventory, useSelectedInventoryItem } from '../inventory';
import { createEmptyInventory, ITEM_DEFINITIONS } from '../item-def';
import { WEAPON_DEFINITIONS } from '../weapon-def';
import { advanceToNextFloor, createInitialState, randomSeed } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';

const TEST_LAYOUT: string[] = [
  '###############',
  '#.............#',
  '#..####..####.#',
  '#..#..#..#..#.#',
  '#..#..#..#..#.#',
  '#..####..####.#',
  '#.............#',
  '###############',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain, rooms: [], exit: { x: 199, y: 199 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 1 }, 3, 1),
    enemies: [createInitialEnemy('bok', { x: 12, y: 6 }, 2, 1)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
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
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

describe('weapon definition (Phase 08.5)', () => {
  it('registers spear as a weapon with the correct display name and category', () => {
    expect(ITEM_DEFINITIONS.spear.displayName).toBe('スピア');
    expect(ITEM_DEFINITIONS.spear.category).toBe('weapon');
    expect(ITEM_DEFINITIONS.spear.consumable).toBe(false);
    expect(ITEM_DEFINITIONS.spear.stackable).toBe(false);
  });

  it('registers spear with attackPower 0 (bare-hands-equivalent bonus; Phase 10.2, see weapon-def.ts) and reach 2', () => {
    expect(WEAPON_DEFINITIONS.spear.attackPower).toBe(0);
    expect(WEAPON_DEFINITIONS.spear.reach).toBe(2);
  });

  it('sword keeps attackPower 10 (bonus over bare hands; Phase 10.2) and reach 1 (regression)', () => {
    expect(WEAPON_DEFINITIONS.sword.attackPower).toBe(10);
    expect(WEAPON_DEFINITIONS.sword.reach).toBe(1);
  });
});

describe('spear placement (floor 2 only)', () => {
  const RUN_SEEDS = [1, 2, 5, 13, 42, 100, 12345];

  it('does not place a spear on floor 1', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      expect(state.groundItems.filter((i) => i.itemId === 'spear')).toHaveLength(0);
    }
  });

  it('places exactly one spear on floor 2, on a floor tile, not overlapping player/exit/enemy/apple', () => {
    for (const runSeed of RUN_SEEDS) {
      let state = createInitialState(runSeed);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      processTurn(state, { type: 'wait' });
      state = advanceToNextFloor(state);
      expect(state.floor).toBe(2);
      const spears = state.groundItems.filter((i) => i.itemId === 'spear');
      expect(spears).toHaveLength(1);
      const spear = spears[0];
      expect(state.map.terrain[spear.pos.y][spear.pos.x]).toBe('floor');
      expect(spear.pos).not.toEqual(state.player.pos);
      expect(spear.pos).not.toEqual(state.exit);
      for (const enemy of state.enemies) {
        expect(spear.pos).not.toEqual(enemy.pos);
      }
      const apple = state.groundItems.find((i) => i.itemId === 'apple')!;
      expect(spear.pos).not.toEqual(apple.pos);
    }
  });

  it('does not place a new spear on floor 3', () => {
    for (const runSeed of [1, 7, 42]) {
      let state = createInitialState(runSeed);
      for (let target = 2; target <= 3; target++) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        processTurn(state, { type: 'wait' });
        state = advanceToNextFloor(state);
      }
      expect(state.floor).toBe(3);
      expect(state.groundItems.filter((i) => i.itemId === 'spear')).toHaveLength(0);
    }
  });

  it('is deterministic: the same seed places the spear at the same coordinate', () => {
    for (const runSeed of RUN_SEEDS) {
      const advance = (seed: number) => {
        let s = createInitialState(seed);
        s.enemies.forEach((e) => (e.alive = false));
        s.player.pos = { ...s.exit };
        processTurn(s, { type: 'wait' });
        return advanceToNextFloor(s);
      };
      const a = advance(runSeed);
      const b = advance(runSeed);
      const spearA = a.groundItems.find((i) => i.itemId === 'spear');
      const spearB = b.groundItems.find((i) => i.itemId === 'spear');
      expect(spearA).toEqual(spearB);
    }
  });

  it('does not perturb existing floor-2 map/enemy/apple determinism (independent RNG stream)', () => {
    const advance = (seed: number) => {
      let s = createInitialState(seed);
      s.enemies.forEach((e) => (e.alive = false));
      s.player.pos = { ...s.exit };
      processTurn(s, { type: 'wait' });
      return advanceToNextFloor(s);
    };
    const a = advance(2780624551);
    const b = advance(2780624551);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.exit).toEqual(b.exit);
    expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
      b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
    );
    const appleA = a.groundItems.find((i) => i.itemId === 'apple');
    const appleB = b.groundItems.find((i) => i.itemId === 'apple');
    expect(appleA).toEqual(appleB);
  });
});

describe('spear pickup', () => {
  it('picking up the spear increases inventory.spear by 1, removes it from groundItems, in one normal-move turn', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'spear', pos: { x: 3, y: 1 } }],
    });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.inventory.spear).toBe(1);
    expect(state.groundItems).toHaveLength(0);
  });

  it('picking up the spear does not auto-equip it', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'spear', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.equippedWeaponId).toBeNull();
  });
});

describe('equipping the spear', () => {
  it('can equip an owned spear, setting equippedWeaponId', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBe('spear');
  });

  it('cannot equip an unowned spear', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
    expect(result.consumed).toBe(false);
    expect(state.equippedWeaponId).toBeNull();
  });

  it('equip success consumes exactly 1 turn and runs enemy actions afterward', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
    expect(state.turn).toBe(turnBefore + 1);
    expect(result.enemyActed).toBe(true);
  });

  it('equip success closes the inventory overlay', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    toggleInventory(state);
    useSelectedInventoryItem(state);
    expect(state.inventoryOpen).toBe(false);
  });

  it('re-equipping the already-equipped spear is a no-op: no turn, inventory stays open', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 0, armor: 0, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 },
      equippedWeaponId: 'spear',
    });
    toggleInventory(state);
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.inventoryOpen).toBe(true);
  });

  it('spear is not consumed by equipping', () => {
    const state = freshState({ inventory: { apple: 0, sword: 0, armor: 0, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
    expect(state.inventory.spear).toBe(1);
  });

  it('equipping spear un-equips sword (single weapon slot)', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 1, armor: 0, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 },
      equippedWeaponId: 'sword',
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
    expect(state.equippedWeaponId).toBe('spear');
  });

  it('equipping sword un-equips spear (single weapon slot)', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 1, armor: 0, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 },
      equippedWeaponId: 'spear',
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(state.equippedWeaponId).toBe('sword');
  });

  it('neither sword nor spear is removed from inventory when switching between them', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 1, armor: 0, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 },
      equippedWeaponId: 'sword',
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
    expect(state.inventory.sword).toBe(1);
    expect(state.inventory.spear).toBe(1);
  });

  it('equipping spear does not affect equippedArmorId', () => {
    const state = freshState({
      inventory: { apple: 0, sword: 0, armor: 1, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 },
      equippedArmorId: 'armor',
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
    expect(state.equippedArmorId).toBe('armor');
  });

  it('inventoryEntries lists spear alongside apple/sword/armor when owned', () => {
    const state = freshState({ inventory: { apple: 1, sword: 1, armor: 1, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    expect(inventoryEntries(state)).toEqual([
      { itemId: 'apple', count: 1 },
      { itemId: 'sword', count: 1 },
      { itemId: 'armor', count: 1 },
      { itemId: 'spear', count: 1 },
    ]);
  });
});

describe('two-tile spear attack (via X action)', () => {
  it('attacks an adjacent enemy normally when equipped with spear', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    state.enemies = [enemy];
    const posBefore = { ...state.player.pos };
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBe(4); // spear attackPower 1
    expect(state.player.pos).toEqual(posBefore);
  });

  it('attacks a 2-tiles-away enemy when the adjacent tile is empty', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 5, 1); // 2 tiles east
    state.enemies = [enemy];
    const posBefore = { ...state.player.pos };
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBe(4);
    expect(state.player.pos).toEqual(posBefore); // did not move
  });

  it('deals exactly 1 damage with the spear (regression-safe distinct from sword)', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(4);
  });

  it('2-tile attack consumes exactly 1 turn and triggers enemy actions afterward', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    const farEnemy = createInitialEnemy('bok', { x: 4, y: 1 }, 5, 1);
    const nearAttacker = createInitialEnemy('bok', { x: 1, y: 1 }, 2, 1); // adjacent from other side
    state.enemies = [farEnemy, nearAttacker];
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'action' });
    expect(state.turn).toBe(turnBefore + 1);
    expect(result.enemyActed).toBe(true);
  });

  it('prefers the adjacent enemy over a farther one in the same direction', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    const nearEnemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    const farEnemy = createInitialEnemy('bok', { x: 4, y: 1 }, 5, 1);
    state.enemies = [nearEnemy, farEnemy];
    processTurn(state, { type: 'action' });
    expect(nearEnemy.hp).toBe(4);
    expect(farEnemy.hp).toBe(5); // untouched
  });

  it('does not damage more than one enemy in a single attack', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 5, 1);
    const bystander = createInitialEnemy('bat', { x: 4, y: 3 }, 5, 1); // unrelated tile
    state.enemies = [enemy, bystander];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(4);
    expect(bystander.hp).toBe(5);
  });

  it('X whiffs (no damage, but still consumes a turn and lets enemies act) when no enemy is within reach in that direction', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    state.enemies = [createInitialEnemy('bok', { x: 12, y: 6 }, 2, 1)]; // far away
    const posBefore = { ...state.player.pos };
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.player.pos).toEqual(posBefore); // X never moves the player
    expect(result.events).toContainEqual({ type: 'player_whiff', weaponId: 'spear' });
  });

  it('moving E toward an empty tile is a normal move regardless of equipped weapon (Phase 08.6 regression)', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.enemies = [createInitialEnemy('bok', { x: 12, y: 6 }, 2, 1)]; // far away
    const posBefore = { ...state.player.pos };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.playerAttacked).toBe(false);
    expect(state.player.pos).not.toEqual(posBefore);
  });

  it('unarmed X cannot attack 2 tiles away (whiffs instead)', () => {
    const state = freshState();
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(5);
    expect(state.player.pos).toEqual({ x: 2, y: 1 }); // X never moves the player
  });

  it('sword X cannot attack 2 tiles away (whiffs instead)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(5);
    expect(state.player.pos).toEqual({ x: 2, y: 1 });
  });

  it('moving toward an enemy 1 tile away is now just a blocked move, not an attack (Phase 08.6 regression)', () => {
    const state = freshState();
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(false);
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(5);
    expect(state.player.pos).toEqual({ x: 2, y: 1 });
    expect(state.player.facing).toBe('E'); // facing still updates on a blocked move
  });

  it('defeating a 2-tiles-away enemy triggers enemy_defeated exactly once, and the defeated enemy does not act', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 1, 1); // 1 HP, dies in one hit
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyDefeated).toBe(true);
    const defeatEvents = result.events.filter((e) => e.type === 'enemy_defeated');
    expect(defeatEvents).toHaveLength(1);
    expect(enemy.alive).toBe(false);
  });
});

describe('spear obstruction and diagonal rules (via X action)', () => {
  it('cannot attack 2 tiles away through a wall', () => {
    // Layout row y=2: "#..####..####.#" — from x=3,y=2 (floor) east is a wall at x=4.
    const state = freshState({ equippedWeaponId: 'spear', player: createInitialActor({ x: 3, y: 2 }, 3, 1) });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 5, y: 2 }, 5, 1); // beyond the wall block
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(5);
  });

  it('attacks the intervening enemy rather than reaching past it', () => {
    const state = freshState({ equippedWeaponId: 'spear' });
    state.player.facing = 'E';
    const nearEnemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    const farEnemy = createInitialEnemy('bat', { x: 4, y: 1 }, 5, 1);
    state.enemies = [nearEnemy, farEnemy];
    processTurn(state, { type: 'action' });
    expect(nearEnemy.hp).toBe(4);
    expect(farEnemy.hp).toBe(5);
  });

  it('a ground item in the intervening tile does not block the attack', () => {
    const state = freshState({
      equippedWeaponId: 'spear',
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBe(4);
  });

  it('the exit tile in the intervening position does not block the attack', () => {
    const state = freshState({ equippedWeaponId: 'spear', exit: { x: 3, y: 1 } });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 4, y: 1 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBe(4);
  });

  it('does not attack outside the map bounds', () => {
    const state = freshState({
      equippedWeaponId: 'spear',
      player: createInitialActor({ x: 1, y: 1 }, 3, 1),
    });
    state.player.facing = 'W';
    state.enemies = [];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
  });

  it('can attack 2 tiles away diagonally when both segments are clear', () => {
    const openMap: GameMap = {
      width: 6,
      height: 6,
      terrain: Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 'floor' as Tile)),
      rooms: [],
      exit: { x: 199, y: 199 },
    };
    const state = freshState({
      map: openMap,
      equippedWeaponId: 'spear',
      player: createInitialActor({ x: 1, y: 1 }, 3, 1),
      exit: { x: 199, y: 199 },
    });
    state.player.facing = 'SE';
    const enemy = createInitialEnemy('bok', { x: 3, y: 3 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBe(4);
  });

  it('cannot attack diagonally when the first-segment corner is blocked', () => {
    // From (2,3), SE corner: moving toward (3,4) then (4,5) is blocked because
    // (3,3) is wall and (2,4) is wall in the "#..#..#..#..#.#" rows.
    const state = freshState({ equippedWeaponId: 'spear', player: createInitialActor({ x: 2, y: 3 }, 3, 1) });
    state.player.facing = 'SE';
    const enemy = createInitialEnemy('bok', { x: 4, y: 5 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(5);
  });
});

describe('persistence and reset (Phase 08.5)', () => {
  it('spear possession and equip state carry over across a floor transition', () => {
    let state = freshState({
      inventory: { apple: 0, sword: 0, armor: 0, spear: 1, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 },
      equippedWeaponId: 'spear',
    });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.inventory.spear).toBe(1);
    expect(state.equippedWeaponId).toBe('spear');
  });

  it('sword, armor, and apple persistence are unaffected by spear (regression)', () => {
    let state = freshState({
      inventory: { apple: 1, sword: 1, armor: 1, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 },
      equippedWeaponId: 'sword',
      equippedArmorId: 'armor',
    });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    state = advanceToNextFloor(state);
    expect(state.inventory.sword).toBe(1);
    expect(state.equippedWeaponId).toBe('sword');
    expect(state.inventory.armor).toBe(1);
    expect(state.equippedArmorId).toBe('armor');
    expect(state.inventory.apple).toBe(1);
  });

  it('a new game resets spear possession to 0 and equippedWeaponId to null', () => {
    const state = createInitialState(randomSeed());
    expect(state.inventory.spear).toBe(0);
    expect(state.equippedWeaponId).toBeNull();
  });

  it('a new game still resets sword/armor/apple as before (regression)', () => {
    const state = createInitialState(randomSeed());
    expect(state.inventory.sword).toBe(0);
    expect(state.inventory.armor).toBe(0);
    expect(state.inventory.apple).toBe(0);
    expect(state.equippedArmorId).toBeNull();
  });
});

describe('regression: Phase 08.2/08.3/08.4 behavior unaffected', () => {
  it('sword still deals its defined bonus damage and still only hits adjacent enemies (Phase 10.2: fixture player.attack 1 + sword bonus 10 - defense 0 = 11)', () => {
    const state = freshState({ equippedWeaponId: 'sword' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 20, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(9);
  });

  it('armor still reduces damage via max(0, attackPower - armorValue)', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('apple still heals 2 HP and consumes 1 apple on success', () => {
    const state = freshState({ inventory: { apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0 } });
    state.player.hp = 1;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBe(3);
    expect(state.inventory.apple).toBe(0);
  });

  it('empty inventory display and Enter no-op remain safe', () => {
    const state = freshState();
    expect(inventoryEntries(state)).toEqual([]);
    toggleInventory(state);
    const turnBefore = state.turn;
    expect(() => useSelectedInventoryItem(state)).not.toThrow();
    expect(state.turn).toBe(turnBefore);
    closeInventory(state);
  });
});
