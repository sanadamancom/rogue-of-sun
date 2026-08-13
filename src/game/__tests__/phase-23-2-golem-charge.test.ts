import { describe, expect, it } from 'vitest';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { advanceToNextFloor } from '../state';
import { ENEMY_DEFINITIONS } from '../enemy-def';
import { getGolemChargeTelegraph } from '../telegraph';
import { EnemyActor, EnemyType, GameMap, GameState, Tile } from '../types';

// A large open room with a full-perimeter wall so charges have plenty of
// room to run in every direction, plus dedicated small layouts below for
// wall/edge-stopping tests.
function openMap(size = 20): GameMap {
  return {
    width: size,
    height: size,
    terrain: Array.from({ length: size }, () => Array.from({ length: size }, () => 'floor' as Tile)),
    rooms: [],
    exit: { x: 199, y: 199 },
  };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: openMap(),
    player: createInitialActor({ x: 10, y: 10 }, 30, 1),
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
    solarEnergy: 15,
    maxSolarEnergy: 15,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

function golemAt(x: number, y: number, id = 0): EnemyActor {
  const def = ENEMY_DEFINITIONS.golem;
  return createInitialEnemy('golem' as EnemyType, { x, y }, def.hp, def.attack, 0, id, def.defense, def.accuracy, def.evasion);
}

describe('Phase 23.2: golem charge — telegraph triggering', () => {
  it('telegraphs at distance 2 along the same row', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    const result = processTurn(state, { type: 'wait' });
    const golem = state.enemies[0];
    expect(golem.golemChargeState).toBe('telegraphed');
    expect(golem.golemChargeDirection).toBe('E');
    expect(golem.golemChargeTargetTile).toEqual({ x: 10, y: 10 });
    expect(result.events.some((e) => e.type === 'golem_charge_telegraphed')).toBe(true);
  });

  it('telegraphs at distance 5 along the same column', () => {
    const state = freshState({ enemies: [golemAt(10, 5)] });
    processTurn(state, { type: 'wait' });
    const golem = state.enemies[0];
    expect(golem.golemChargeState).toBe('telegraphed');
    expect(golem.golemChargeDirection).toBe('S');
  });

  it('attacks normally instead of telegraphing at distance 1 (adjacent)', () => {
    const state = freshState({ enemies: [golemAt(9, 10)] });
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'wait' });
    expect(state.enemies[0].golemChargeState).toBe('recovering');
    expect(state.player.hp).toBeLessThan(hpBefore);
    expect(result.events.some((e) => e.type === 'golem_charge_telegraphed')).toBe(false);
  });

  it('does not telegraph at distance 6 or beyond (falls back to chase)', () => {
    const state = freshState({ enemies: [golemAt(4, 10)] });
    const golem = state.enemies[0];
    const before = { ...golem.pos };
    processTurn(state, { type: 'wait' });
    expect(golem.golemChargeState).not.toBe('telegraphed');
    expect(golem.pos).not.toEqual(before); // chased instead
  });

  it('does not telegraph at a diagonal position, even within distance 2-5', () => {
    const state = freshState({ enemies: [golemAt(7, 7)] }); // dx=3, dy=3
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].golemChargeState).not.toBe('telegraphed');
  });

  it('does not telegraph through a wall between golem and player', () => {
    const layout = [
      '##########',
      '#........#',
      '#.G##P...#',
      '#........#',
      '##########',
    ];
    const height = layout.length;
    const width = layout[0].length;
    const terrain: Tile[][] = layout.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
    let golemPos = { x: 0, y: 0 };
    let playerPos = { x: 0, y: 0 };
    layout.forEach((row, y) => {
      row.split('').forEach((ch, x) => {
        if (ch === 'G') golemPos = { x, y };
        if (ch === 'P') playerPos = { x, y };
      });
    });
    const state = freshState({
      map: { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } },
      player: createInitialActor(playerPos, 30, 1),
      enemies: [golemAt(golemPos.x, golemPos.y)],
    });
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].golemChargeState).not.toBe('telegraphed');
  });

  it('does not telegraph through another movement-blocking enemy on the line', () => {
    const state = freshState({
      enemies: [golemAt(6, 10), createInitialEnemy('bok', { x: 8, y: 10 }, 5, 1)],
    });
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].golemChargeState).not.toBe('telegraphed');
  });

  it('telegraphs through a head-form skeleton on the line (heads never block)', () => {
    const skeletonDef = ENEMY_DEFINITIONS.skeleton;
    const head = createInitialEnemy('skeleton' as EnemyType, { x: 8, y: 10 }, 0, skeletonDef.attack, 0, 1, skeletonDef.defense, skeletonDef.accuracy, skeletonDef.evasion);
    head.skeletonForm = 'head';
    head.skeletonReviveAtTurn = 1000;
    const state = freshState({ enemies: [golemAt(6, 10), head] });
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].golemChargeState).toBe('telegraphed');
  });

  it('does not move or deal damage on the telegraph turn itself', () => {
    const state = freshState({ player: { ...createInitialActor({ x: 10, y: 10 }, 30, 1), hp: 20 }, enemies: [golemAt(8, 10)] });
    const golem = state.enemies[0];
    const before = { ...golem.pos };
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(golem.pos).toEqual(before);
    expect(state.player.hp).toBe(hpBefore + 1); // only natural regen
  });

  it('fixes direction and target tile at telegraph time', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    processTurn(state, { type: 'wait' });
    const golem = state.enemies[0];
    expect(golem.golemChargeDirection).toBe('E');
    expect(golem.golemChargeTargetTile).toEqual({ x: 10, y: 10 });
  });
});

describe('Phase 23.2: golem charge — telegraphed execution timing', () => {
  it('does not chase the player after telegraphing even if the player moves off the line', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    processTurn(state, { type: 'wait' }); // telegraph
    state.player.pos = { x: 10, y: 15 }; // well off the original line
    const golem = state.enemies[0];
    const before = { ...golem.pos };
    processTurn(state, { type: 'wait' }); // charge executes along the fixed direction
    // Charges east along the fixed direction, unrelated to the player's new position.
    expect(golem.pos.x).toBeGreaterThan(before.x);
    expect(golem.pos.y).toBe(before.y);
  });

  it('executes a reserved charge even after the player moves outside AGGRO_RANGE', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    processTurn(state, { type: 'wait' }); // telegraph
    state.player.pos = { x: 19, y: 19 }; // far outside AGGRO_RANGE (8) from the golem
    const golem = state.enemies[0];
    const before = { ...golem.pos };
    const result = processTurn(state, { type: 'wait' });
    expect(golem.pos).not.toEqual(before); // still charged
    expect(result.events.some((e) => e.type === 'golem_charge_executed')).toBe(true);
  });

  it('charges up to a maximum of 5 tiles', () => {
    const state = freshState({ player: createInitialActor({ x: 15, y: 10 }, 30, 1), enemies: [golemAt(5, 10)] });
    processTurn(state, { type: 'wait' }); // distance 10 too far for telegraph; just chase-step check first
    // Re-seed a clean telegraph-eligible scenario instead: distance 5 exactly.
    const state2 = freshState({ player: createInitialActor({ x: 15, y: 10 }, 30, 1), enemies: [golemAt(10, 10)] });
    processTurn(state2, { type: 'wait' }); // telegraph (distance 5)
    const golem = state2.enemies[0];
    const before = { ...golem.pos };
    processTurn(state2, { type: 'wait' }); // charge — stops one tile short of the player (max 5, player at distance 5)
    expect(golem.pos.x - before.x).toBeLessThanOrEqual(5);
    expect(golem.pos.x).toBeLessThan(15); // stopped short of the player's tile
  });

  it('rests exactly one turn after charging, then returns to idle', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    processTurn(state, { type: 'wait' }); // telegraph
    processTurn(state, { type: 'wait' }); // charge
    const golem = state.enemies[0];
    expect(golem.golemChargeState).toBe('recovering');
    const before = { ...golem.pos };
    processTurn(state, { type: 'wait' }); // rest
    expect(golem.pos).toEqual(before);
    expect(golem.golemChargeState).toBe('idle');
  });

  it('a single player action never advances the golem through more than one charge-cycle stage', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    processTurn(state, { type: 'wait' }); // idle -> telegraphed only
    expect(state.enemies[0].golemChargeState).toBe('telegraphed');
    processTurn(state, { type: 'wait' }); // telegraphed -> recovering only (charge happens here)
    expect(state.enemies[0].golemChargeState).toBe('recovering');
    processTurn(state, { type: 'wait' }); // recovering -> idle only
    expect(state.enemies[0].golemChargeState).toBe('idle');
  });
});

describe('Phase 23.2: golem charge — collision', () => {
  function corridorState(layout: string[], golemPos: { x: number; y: number }, playerPos: { x: number; y: number }, extraEnemies: EnemyActor[] = []): GameState {
    const height = layout.length;
    const width = layout[0].length;
    const terrain: Tile[][] = layout.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
    return freshState({
      map: { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } },
      player: createInitialActor(playerPos, 30, 1),
      enemies: [golemAt(golemPos.x, golemPos.y), ...extraEnemies],
    });
  }

  it('stops at a wall instead of entering it', () => {
    const layout = ['##########', '#........#', '#.G....#.#', '#........#', '##########'];
    // Golem at (2,2), wall at (7,2); player far below the line so no accidental telegraph toward it this test.
    const state = corridorState(layout, { x: 2, y: 2 }, { x: 5, y: 3 });
    const golem = state.enemies[0];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 6, y: 2 };
    processTurn(state, { type: 'wait' });
    expect(state.map.terrain[golem.pos.y][golem.pos.x]).toBe('floor');
    expect(golem.pos.x).toBeLessThan(7);
  });

  it('stays in place if the very first step is already blocked', () => {
    const layout = ['#####', '#.G#.', '#####'];
    const state = corridorState(layout, { x: 2, y: 1 }, { x: 4, y: 1 });
    const golem = state.enemies[0];
    const before = { ...golem.pos };
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 3, y: 1 };
    processTurn(state, { type: 'wait' });
    expect(golem.pos).toEqual(before);
  });

  it('stops before another living blocking enemy, dealing no damage and not moving it', () => {
    const state = freshState({
      player: createInitialActor({ x: 19, y: 10 }, 30, 1),
      enemies: [golemAt(5, 10), createInitialEnemy('bok', { x: 8, y: 10 }, 5, 1)],
    });
    const golem = state.enemies[0];
    const blocker = state.enemies[1];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 19, y: 10 };
    const blockerHpBefore = blocker.hp;
    const blockerPosBefore = { ...blocker.pos };
    processTurn(state, { type: 'wait' });
    expect(golem.pos.x).toBeLessThan(blocker.pos.x);
    expect(blocker.hp).toBe(blockerHpBefore);
    expect(blocker.pos).toEqual(blockerPosBefore);
  });

  it('passes through a head-form skeleton without damaging it', () => {
    const skeletonDef = ENEMY_DEFINITIONS.skeleton;
    const head = createInitialEnemy('skeleton' as EnemyType, { x: 7, y: 10 }, 0, skeletonDef.attack, 0, 1, skeletonDef.defense, skeletonDef.accuracy, skeletonDef.evasion);
    head.skeletonForm = 'head';
    head.skeletonReviveAtTurn = 1000;
    const state = freshState({
      player: createInitialActor({ x: 19, y: 10 }, 30, 1),
      enemies: [golemAt(5, 10), head],
    });
    const golem = state.enemies[0];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 19, y: 10 };
    processTurn(state, { type: 'wait' });
    // Charged past (or onto/through) the head's original x, at least
    // reaching it, and never damaged it.
    expect(golem.pos.x).toBeGreaterThanOrEqual(7);
    expect(head.hp).toBe(0);
    expect(head.skeletonForm).toBe('head');
  });

  it('stops one tile short of the player and attempts exactly one attack', () => {
    const state = freshState({ enemies: [golemAt(6, 10)] }); // player at (10,10), distance 4
    const golem = state.enemies[0];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 10, y: 10 };
    const result = processTurn(state, { type: 'wait' });
    expect(golem.pos).toEqual({ x: 9, y: 10 });
    const attackEvents = result.events.filter((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed');
    expect(attackEvents).toHaveLength(1);
  });

  it('never knocks back the player on a successful charge hit', () => {
    const state = freshState({ combatRngState: 0, enemies: [golemAt(6, 10)] });
    const golem = state.enemies[0];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 10, y: 10 };
    const before = { ...state.player.pos };
    processTurn(state, { type: 'wait' });
    expect(state.player.pos).toEqual(before);
  });

  it('never deals more than one hit\'s worth of damage in a single charge', () => {
    const state = freshState({ enemies: [golemAt(6, 10)] });
    const golem = state.enemies[0];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 10, y: 10 };
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    const golemAttack = ENEMY_DEFINITIONS.golem.attack;
    // At most one hit's worth of damage (could be 0 on a miss, or offset by +1 regen).
    expect(state.player.hp).toBeGreaterThanOrEqual(hpBefore - golemAttack);
  });

  it('passes through ground items, traps, webs, and the exit tile without interacting with them', () => {
    const state = freshState({
      player: createInitialActor({ x: 19, y: 10 }, 30, 1),
      exit: { x: 8, y: 10 },
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 7, y: 10 } }],
      webs: [{ id: 0, pos: { x: 9, y: 10 }, ownerEnemyId: 99, placedTurn: 0 }],
      traps: [{ id: 0, pos: { x: 6, y: 10 }, revealed: true, triggered: false, trapType: 'poison_trap' }],
      enemies: [golemAt(5, 10)],
    });
    const golem = state.enemies[0];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 19, y: 10 };
    processTurn(state, { type: 'wait' });
    expect(golem.pos.x).toBeGreaterThan(5); // moved through the item/web/trap tiles unimpeded
    expect(state.groundItems).toHaveLength(1); // untouched
    expect(state.traps![0].triggered).toBe(false); // golem never triggers traps
  });
});

describe('Phase 23.2: golem charge — multiple golems, monsterHouse, floor transitions, determinism', () => {
  it('tracks each golem\'s charge state independently', () => {
    const state = freshState({
      enemies: [golemAt(8, 10, 0), golemAt(10, 8, 1)],
    });
    processTurn(state, { type: 'wait' });
    // golem 0: distance 2 east -> telegraphed. golem 1: distance 2 north -> telegraphed too, but independently.
    expect(state.enemies[0].golemChargeDirection).toBe('E');
    expect(state.enemies[1].golemChargeDirection).toBe('S');
  });

  it('a golem defeated while telegraphed never executes its charge', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    const golem = state.enemies[0];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 10, y: 10 };
    golem.hp = 0;
    golem.alive = false;
    const before = { ...golem.pos };
    processTurn(state, { type: 'wait' });
    expect(golem.pos).toEqual(before); // dead enemies never act
  });

  it('a monster-house-spawned golem follows the identical state machine', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    state.enemies[0].spawnSource = 'monster_house';
    const result = processTurn(state, { type: 'wait' });
    expect(state.enemies[0].golemChargeState).toBe('telegraphed');
    expect(result.events.some((e) => e.type === 'golem_charge_telegraphed')).toBe(true);
  });

  it('does not carry telegraph/recovery state across a floor transition', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    state.enemies[0].golemChargeState = 'telegraphed';
    state.enemies[0].golemChargeDirection = 'E';
    state.enemies[0].golemChargeTargetTile = { x: 10, y: 10 };
    state.player.pos = { ...state.exit };
    const next = advanceToNextFloor(state);
    for (const enemy of next.enemies) {
      expect(enemy.golemChargeState).toBeUndefined();
      expect(enemy.golemChargeDirection).toBeUndefined();
      expect(enemy.golemChargeTargetTile).toBeUndefined();
    }
  });

  it('produces identical results from the same state and RNG across two independent runs', () => {
    const build = () => freshState({ enemies: [golemAt(8, 10)] });
    const a = build();
    const b = build();
    processTurn(a, { type: 'wait' });
    processTurn(b, { type: 'wait' });
    expect(a.enemies[0]).toEqual(b.enemies[0]);
    expect(a.combatRngState).toBe(b.combatRngState);
  });

  it('getGolemChargeTelegraph and spriteKey-equivalent state flip together with golemChargeState', () => {
    const state = freshState({ enemies: [golemAt(8, 10)] });
    const golem = state.enemies[0];
    expect(getGolemChargeTelegraph(state.map, golem)).toBeNull();
    processTurn(state, { type: 'wait' }); // telegraph
    const telegraph = getGolemChargeTelegraph(state.map, golem);
    expect(telegraph).not.toBeNull();
    expect(telegraph!.targetTile).toEqual({ x: 10, y: 10 });
    processTurn(state, { type: 'wait' }); // charge -> recovering
    expect(getGolemChargeTelegraph(state.map, golem)).toBeNull();
  });
});
