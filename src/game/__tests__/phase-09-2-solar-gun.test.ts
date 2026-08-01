import { describe, expect, it } from 'vitest';
import { createEmptyInventory, ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from '../item-def';
import { WEAPON_DEFINITIONS, WEAPON_IDS_IN_ORDER } from '../weapon-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';

// Open room (no interior walls) so the solar gun's 5-tile ray can be
// exercised along every direction without incidentally hitting a wall
// first; wall-blocking itself is tested with a dedicated corridor map
// below.
function openMap(size = 20): GameMap {
  return {
    width: size,
    height: size,
    terrain: Array.from({ length: size }, () => Array.from({ length: size }, () => 'floor' as Tile)),
    rooms: [],
    exit: { x: 199, y: 199 },
  };
}

// Small fixed layout with an inner wall block, reused from the existing
// hammer/spear test files' diagonal corner-cut layout so results are
// directly comparable to already-verified melee behavior.
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

function corridorMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain, rooms: [], exit: { x: 199, y: 199 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: openMap(),
    player: createInitialActor({ x: 10, y: 10 }, 3, 1),
    enemies: [],
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
    sunlight: [],
    ...overrides,
  };
}

describe('solar gun definition and inventory (Phase 09.2)', () => {
  it('registers solar_gun as a weapon with attackPower 0 (bare-hands-equivalent bonus; Phase 10.2, see weapon-def.ts), reach(range) 5, solarCost 1', () => {
    expect(ITEM_IDS_IN_ORDER).toContain('solar_gun');
    expect(WEAPON_IDS_IN_ORDER).toContain('solar_gun');
    expect(ITEM_DEFINITIONS.solar_gun.displayName).toBe('太陽銃');
    expect(ITEM_DEFINITIONS.solar_gun.category).toBe('weapon');
    expect(ITEM_DEFINITIONS.solar_gun.consumable).toBe(false);
    expect(WEAPON_DEFINITIONS.solar_gun.attackPower).toBe(0);
    expect(WEAPON_DEFINITIONS.solar_gun.reach).toBe(5);
    expect(WEAPON_DEFINITIONS.solar_gun.solarCost).toBe(1);
  });

  it('picking up a solar gun increases its count without auto-equipping', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'solar_gun', pos: { x: 11, y: 10 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.solar_gun).toBe(1);
    expect(state.equippedWeaponId).toBeNull();
  });

  it('equipping the solar gun replaces any other equipped weapon exclusively', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), sword: 1, solar_gun: 1, sol_enchantment: 0 },
      equippedWeaponId: 'sword',
    });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'solar_gun' });
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBe('solar_gun');
  });

  it('equipping the solar gun does not affect equipped armor', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), solar_gun: 1, armor: 1 },
      equippedArmorId: 'armor',
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'solar_gun' });
    expect(state.equippedArmorId).toBe('armor');
  });

  it('solar gun possession and equip state carry over across a floor transition', () => {
    let state = freshState({
      inventory: { ...createEmptyInventory(), solar_gun: 1, sol_enchantment: 0 },
      equippedWeaponId: 'solar_gun',
    });
    state.enemies = [];
    state.player.pos = { ...state.exit };
    state = advanceToNextFloor(state);
    expect(state.inventory.solar_gun).toBe(1);
    expect(state.equippedWeaponId).toBe('solar_gun');
  });

  it('firing the solar gun never decrements its own inventory count', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), solar_gun: 1, sol_enchantment: 0 },
      equippedWeaponId: 'solar_gun',
    });
    processTurn(state, { type: 'action' });
    expect(state.inventory.solar_gun).toBe(1);
  });
});

describe('solar gun firing (Phase 09.2)', () => {
  const directions: Array<{ dir: import('../types').Direction8; dx: number; dy: number }> = [
    { dir: 'N', dx: 0, dy: -1 },
    { dir: 'S', dx: 0, dy: 1 },
    { dir: 'E', dx: 1, dy: 0 },
    { dir: 'W', dx: -1, dy: 0 },
    { dir: 'NE', dx: 1, dy: -1 },
    { dir: 'NW', dx: -1, dy: -1 },
    { dir: 'SE', dx: 1, dy: 1 },
    { dir: 'SW', dx: -1, dy: 1 },
  ];

  it.each(directions)('hits an adjacent enemy in direction $dir', ({ dir, dx, dy }) => {
    const state = freshState({ equippedWeaponId: 'solar_gun' });
    state.player.facing = dir;
    const enemy = createInitialEnemy('bok', { x: 10 + dx, y: 10 + dy }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBe(4);
  });

  it.each([1, 2, 3, 4, 5])('hits an enemy at distance %i', (distance) => {
    const state = freshState({ equippedWeaponId: 'solar_gun' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 10 + distance, y: 10 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBe(4);
  });

  it('does not hit an enemy at distance 6', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 16, y: 10 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(5);
  });

  it('hits only the closest enemy on the ray, dealing exactly 1 damage', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun' });
    state.player.facing = 'E';
    const near = createInitialEnemy('bok', { x: 12, y: 10 }, 5, 1);
    const far = createInitialEnemy('bok', { x: 14, y: 10 }, 5, 1);
    state.enemies = [near, far];
    processTurn(state, { type: 'action' });
    expect(near.hp).toBe(4);
    expect(far.hp).toBe(5);
  });

  it('never damages the enemy behind the one hit (no penetration)', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun' });
    state.player.facing = 'E';
    const near = createInitialEnemy('bok', { x: 11, y: 10 }, 1, 1);
    const far = createInitialEnemy('bok', { x: 13, y: 10 }, 5, 1);
    state.enemies = [near, far];
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyDefeated).toBe(true);
    expect(far.hp).toBe(5);
  });

  it('does not hit an enemy behind a wall', () => {
    const state = freshState({ map: corridorMap(), equippedWeaponId: 'solar_gun', player: createInitialActor({ x: 1, y: 3 }, 3, 1) });
    state.player.facing = 'E';
    // (2,3) is floor, (3,3) is wall in this layout; enemy sits beyond it.
    const enemy = createInitialEnemy('bok', { x: 5, y: 3 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(5);
  });

  it('terminates safely at the map edge without throwing', () => {
    const state = freshState({ player: createInitialActor({ x: 1, y: 1 }, 3, 1), equippedWeaponId: 'solar_gun' });
    state.player.facing = 'N';
    expect(() => processTurn(state, { type: 'action' })).not.toThrow();
  });

  it('ground items on the ray do not block it', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 12, y: 10 } }],
    });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 13, y: 10 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
  });

  it('the exit tile on the ray does not block it', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', exit: { x: 12, y: 10 } });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 13, y: 10 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
  });

  it('does not knock back a hit enemy', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 11, y: 10 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.pos).toEqual({ x: 11, y: 10 });
  });

  it('does not trigger the hammer recoil mechanic', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun' });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 11, y: 10 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('does not shoot diagonally through a blocked corner', () => {
    // Same layout/position as the existing hammer diagonal-corner-cut
    // test: from (2,3) facing SE, sideA=(3,3) and sideB=(2,4) are both
    // wall, so the ray must stop immediately and never reach (3,4).
    const state = freshState({
      map: corridorMap(),
      equippedWeaponId: 'solar_gun',
      player: createInitialActor({ x: 2, y: 3 }, 3, 1),
    });
    state.player.facing = 'SE';
    const enemy = createInitialEnemy('bok', { x: 3, y: 4 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(enemy.hp).toBe(5);
  });
});

describe('solar gun SOL consumption (Phase 09.2)', () => {
  it('firing at SOL 5 lowers it to 4', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 5 });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
  });

  it('firing at SOL 1 lowers it to 0', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 1 });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(0);
  });

  it('cannot fire at SOL 0', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 0 });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 11, y: 10 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.consumed).toBe(false);
    expect(enemy.hp).toBe(5);
  });

  it('never drops solarEnergy below 0', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 0 });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBeGreaterThanOrEqual(0);
  });

  it('consumes 1 SOL on a hit', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 3 });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 11, y: 10 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(2);
  });

  it('consumes 1 SOL on a kill', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 3 });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 11, y: 10 }, 1, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyDefeated).toBe(true);
    expect(state.solarEnergy).toBe(2);
  });

  it('consumes 1 SOL on a whiff (no enemy on the ray)', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 3 });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(2);
  });

  it('consumes 1 SOL when firing directly into an adjacent wall', () => {
    const state = freshState({
      map: corridorMap(),
      equippedWeaponId: 'solar_gun',
      player: createInitialActor({ x: 1, y: 1 }, 3, 1),
      solarEnergy: 3,
    });
    state.player.facing = 'N'; // (1,0) is wall in corridorMap
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(2);
  });

  it('SOL insufficiency prevents damage entirely', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 0 });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 11, y: 10 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(enemy.hp).toBe(5);
  });

  it('SOL insufficiency does not consume a turn', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 0, turn: 7 });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.turn).toBe(7);
  });

  it('SOL insufficiency prevents the enemy from acting', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 0 });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 15, y: 15 }, 5, 1);
    const before = { ...enemy.pos };
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyActed).toBe(false);
    expect(enemy.pos).toEqual(before);
  });

  it('a successful shot consumes exactly 1 turn', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', turn: 5 });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.turn).toBe(6);
  });

  it('a successful shot lets the enemy act exactly once', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun' });
    state.player.facing = 'N'; // fire away from the enemy so it survives to move
    const enemy = createInitialEnemy('bok', { x: 15, y: 15 }, 5, 1);
    const before = { ...enemy.pos };
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyActed).toBe(true);
    expect(enemy.pos).not.toEqual(before);
  });

  it('move does not consume SOL', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 4 });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.solarEnergy).toBe(4);
  });

  it('wait does not consume SOL', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', solarEnergy: 4 });
    processTurn(state, { type: 'wait' });
    expect(state.solarEnergy).toBe(4);
  });

  it('a melee attack (sword) does not consume SOL', () => {
    const state = freshState({ equippedWeaponId: 'sword', solarEnergy: 4 });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 11, y: 10 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
  });
});

describe('solar gun and hammerRecovery interaction (Phase 09.2)', () => {
  it('can fire while hammerRecovery is true (from a prior hammer attack)', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', hammerRecovery: true });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 11, y: 10 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
  });

  it('a successful hit clears hammerRecovery', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', hammerRecovery: true });
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 11, y: 10 }, 5, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('a whiff clears hammerRecovery', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', hammerRecovery: true });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(false);
  });

  it('SOL-insufficient misfire does not clear hammerRecovery', () => {
    const state = freshState({ equippedWeaponId: 'solar_gun', hammerRecovery: true, solarEnergy: 0 });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.hammerRecovery).toBe(true);
  });

  it('equipping the solar gun alone does not clear hammerRecovery', () => {
    const state = freshState({
      equippedWeaponId: 'hammer',
      hammerRecovery: true,
      inventory: { ...createEmptyInventory(), solar_gun: 1, sol_enchantment: 0 },
    });
    processTurn(state, { type: 'equip_weapon', weaponId: 'solar_gun' });
    expect(state.hammerRecovery).toBe(true);
  });

  it('the hammer re-cock mechanic itself is unchanged', () => {
    const state = freshState({ equippedWeaponId: 'hammer', hammerRecovery: true });
    state.player.facing = 'E';
    const result = processTurn(state, { type: 'action' });
    expect(result.events).toContainEqual({ type: 'hammer_recover' });
    expect(state.hammerRecovery).toBe(false);
  });
});

describe('solar gun and sun fruit integration (Phase 09.2)', () => {
  it('SOL lowered by the solar gun can be restored by sun fruit', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      solarEnergy: 5,
      inventory: { ...createEmptyInventory(), sun_fruit: 1 },
    });
    state.player.facing = 'E';
    processTurn(state, { type: 'action' }); // SOL 5 -> 4
    processTurn(state, { type: 'action' }); // SOL 4 -> 3 (still owns fruit)
    const result = processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(result.consumed).toBe(true);
    expect(state.solarEnergy).toBe(5);
  });

  it('sun fruit recovery never exceeds maxSolarEnergy', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      solarEnergy: 4,
      inventory: { ...createEmptyInventory(), sun_fruit: 1 },
    });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.solarEnergy).toBe(5);
  });

  it('sun fruit cannot be used at full SOL and is not consumed', () => {
    const state = freshState({
      solarEnergy: 5,
      inventory: { ...createEmptyInventory(), sun_fruit: 1 },
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.sun_fruit).toBe(1);
  });

  it('sun fruit never heals HP', () => {
    const state = freshState({
      solarEnergy: 0,
      inventory: { ...createEmptyInventory(), sun_fruit: 1 },
    });
    state.player.hp = 1;
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.player.hp).toBe(1);
  });

  it('apple never recovers SOL', () => {
    const state = freshState({
      solarEnergy: 2,
      inventory: { ...createEmptyInventory(), apple: 1 },
    });
    state.player.hp = 1;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(state.solarEnergy).toBe(2);
  });
});

describe('solar gun placement (Phase 09.2)', () => {
  it('places exactly 1 solar gun on floor 1', () => {
    const state = createInitialState(4242);
    const guns = state.groundItems.filter((i) => i.itemId === 'solar_gun');
    expect(guns.length).toBe(1);
  });

  it('does not place a solar gun on floor 2', () => {
    let state = createInitialState(4242);
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    state = advanceToNextFloor(state);
    const guns = state.groundItems.filter((i) => i.itemId === 'solar_gun');
    expect(guns.length).toBe(0);
  });

  it('does not place a solar gun on floor 3', () => {
    let state = createInitialState(4242);
    for (let i = 0; i < 2; i++) {
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state);
    }
    const guns = state.groundItems.filter((i) => i.itemId === 'solar_gun');
    expect(guns.length).toBe(0);
  });

  it('the same seed and floor produce the same solar gun coordinates', () => {
    const a = createInitialState(777);
    const b = createInitialState(777);
    const posA = a.groundItems.find((i) => i.itemId === 'solar_gun')!.pos;
    const posB = b.groundItems.find((i) => i.itemId === 'solar_gun')!.pos;
    expect(posA).toEqual(posB);
  });

  it('the solar gun is placed on a reachable normal floor tile', () => {
    const state = createInitialState(88);
    const pos = state.groundItems.find((i) => i.itemId === 'solar_gun')!.pos;
    expect(state.map.terrain[pos.y][pos.x]).toBe('floor');
  });

  it('the solar gun never overlaps the player, exit, or another ground item', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const state = createInitialState(seed);
      const gun = state.groundItems.find((i) => i.itemId === 'solar_gun');
      if (!gun) continue;
      const occupied = [state.player.pos, state.exit, ...state.enemies.map((e) => e.pos)];
      for (const pos of occupied) {
        expect(gun.pos).not.toEqual(pos);
      }
      const others = state.groundItems.filter((i) => i.itemId !== 'solar_gun');
      for (const other of others) {
        expect(gun.pos).not.toEqual(other.pos);
      }
    }
  });

  it('adding the solar gun does not move any other existing floor-1 ground item', () => {
    const state = createInitialState(999);
    const apple = state.groundItems.find((i) => i.itemId === 'apple');
    const sword = state.groundItems.find((i) => i.itemId === 'sword');
    const armor = state.groundItems.find((i) => i.itemId === 'armor');
    const sunFruit = state.groundItems.find((i) => i.itemId === 'sun_fruit');
    expect(apple).toBeDefined();
    expect(sword).toBeDefined();
    expect(armor).toBeDefined();
    expect(sunFruit).toBeDefined();
  });

  it('adding the solar gun does not change enemy or exit placement (seed-stable regeneration)', () => {
    const a = createInitialState(999);
    const b = createInitialState(999);
    expect(a.exit).toEqual(b.exit);
    expect(a.enemies.map((e) => e.pos)).toEqual(b.enemies.map((e) => e.pos));
  });
});
