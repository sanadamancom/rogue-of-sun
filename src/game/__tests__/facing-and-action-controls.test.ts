import { describe, expect, it } from 'vitest';
import { closeInventory, toggleInventory } from '../inventory';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { createInitialState, advanceToNextFloor, randomSeed } from '../state';
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
    sunlight: [],
    ...overrides,
  };
}

describe('facing (Phase 08.6)', () => {
  it('a new game starts facing south (down)', () => {
    const state = createInitialState(randomSeed());
    expect(state.player.facing).toBe('S');
  });

  it('a normal cardinal move updates facing to that direction', () => {
    const state = freshState();
    processTurn(state, { type: 'move', direction: 'N' });
    expect(state.player.facing).toBe('N');
  });

  it('a normal diagonal move updates facing to that diagonal', () => {
    const state = freshState();
    processTurn(state, { type: 'move', direction: 'SE' });
    expect(state.player.facing).toBe('SE');
  });

  it('facing still updates when the move fails due to a wall', () => {
    const state = freshState({ player: createInitialActor({ x: 1, y: 1 }, 3, 1) });
    const result = processTurn(state, { type: 'move', direction: 'W' }); // wall at x=0
    expect(result.consumed).toBe(false);
    expect(state.player.facing).toBe('W');
  });

  it('facing still updates when the move fails due to an enemy occupying the destination', () => {
    const state = freshState();
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(false);
    expect(state.player.facing).toBe('E');
  });

  it('Shift+cardinal changes facing without moving', () => {
    const state = freshState();
    const posBefore = { ...state.player.pos };
    processTurn(state, { type: 'face', direction: 'N' });
    expect(state.player.facing).toBe('N');
    expect(state.player.pos).toEqual(posBefore);
  });

  it('Shift+QEZC changes facing to the corresponding diagonal', () => {
    const state = freshState();
    processTurn(state, { type: 'face', direction: 'NW' });
    expect(state.player.facing).toBe('NW');
  });

  it('Shift+direction does not consume a turn', () => {
    const state = freshState();
    const turnBefore = state.turn;
    processTurn(state, { type: 'face', direction: 'N' });
    expect(state.turn).toBe(turnBefore);
  });

  it('Shift+direction does not let enemies act', () => {
    const state = freshState();
    const enemy = createInitialEnemy('bok', { x: 7, y: 6 }, 2, 1);
    state.enemies = [enemy];
    const posBefore = { ...enemy.pos };
    processTurn(state, { type: 'face', direction: 'N' });
    expect(enemy.pos).toEqual(posBefore);
  });

  it('facing is preserved across a floor transition', () => {
    let state = freshState();
    processTurn(state, { type: 'face', direction: 'W' });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.player.facing).toBe('W');
  });

  it('facing resets to south on a new game', () => {
    const state = createInitialState(randomSeed());
    expect(state.player.facing).toBe('S');
  });
});

describe('movement no longer auto-attacks (Phase 08.6)', () => {
  it('moves normally into an empty tile', () => {
    const state = freshState();
    const posBefore = { ...state.player.pos };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.player.pos).not.toEqual(posBefore);
  });

  it('a successful move consumes exactly 1 turn', () => {
    const state = freshState();
    const turnBefore = state.turn;
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('moving toward an enemy does not attack it', () => {
    const state = freshState();
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [enemy];
    processTurn(state, { type: 'move', direction: 'E' });
    expect(enemy.hp).toBe(2);
    expect(enemy.alive).toBe(true);
  });

  it('moving toward an enemy does not consume a turn', () => {
    const state = freshState();
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1)];
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
  });

  it('a wall move failure does not consume a turn (regression)', () => {
    const state = freshState({ player: createInitialActor({ x: 1, y: 1 }, 3, 1) });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'move', direction: 'W' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
  });

  it('diagonal corner-cutting is still forbidden for movement (regression)', () => {
    // From (2,2), moving SE toward (3,3) is blocked: (3,2) and (2,3) are
    // both wall in this layout's inner block.
    const state = freshState({ player: createInitialActor({ x: 2, y: 2 }, 3, 1) });
    const result = processTurn(state, { type: 'move', direction: 'SE' });
    expect(result.consumed).toBe(false);
  });

  it('ground item pickup on move is preserved', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.apple).toBe(1);
    expect(state.groundItems).toHaveLength(0);
  });

  it('reaching the exit with all enemies defeated still advances the floor', () => {
    const state = freshState();
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    expect(state.phase).toBe('floor_cleared');
  });
});

describe('X action (Phase 08.6)', () => {
  it('attacks the enemy in the current facing direction', () => {
    const state = freshState();
    state.player.facing = 'E';
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1);
    state.enemies = [enemy];
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(enemy.hp).toBe(4);
  });

  it('never moves the player, whether it hits or whiffs', () => {
    const hitState = freshState();
    hitState.player.facing = 'E';
    hitState.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1)];
    const posBefore1 = { ...hitState.player.pos };
    processTurn(hitState, { type: 'action' });
    expect(hitState.player.pos).toEqual(posBefore1);

    const missState = freshState();
    missState.player.facing = 'E';
    const posBefore2 = { ...missState.player.pos };
    processTurn(missState, { type: 'action' });
    expect(missState.player.pos).toEqual(posBefore2);
  });

  it('does not change facing', () => {
    const state = freshState();
    state.player.facing = 'N';
    processTurn(state, { type: 'action' });
    expect(state.player.facing).toBe('N');
  });

  it('whiffs (no target) when nothing is within reach in the facing direction', () => {
    const state = freshState();
    state.player.facing = 'E'; // nothing east
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(false);
    expect(result.consumed).toBe(true);
  });

  it('a whiff still consumes exactly 1 turn', () => {
    const state = freshState();
    state.player.facing = 'E';
    const turnBefore = state.turn;
    processTurn(state, { type: 'action' });
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('a whiff still lets an enemy act once afterward', () => {
    const state = freshState();
    state.player.facing = 'N'; // nothing north
    const enemy = createInitialEnemy('bok', { x: 7, y: 6 }, 2, 1);
    state.enemies = [enemy];
    const posBefore = { ...enemy.pos };
    const result = processTurn(state, { type: 'action' });
    expect(result.enemyActed).toBe(true);
    const moved = enemy.pos.x !== posBefore.x || enemy.pos.y !== posBefore.y;
    expect(moved).toBe(true);
  });

  it('a whiff emits a player_whiff event', () => {
    const state = freshState();
    state.player.facing = 'E';
    const result = processTurn(state, { type: 'action' });
    expect(result.events).toContainEqual({ type: 'player_whiff' });
  });

  it('X is rejected while the inventory overlay is open', () => {
    const state = freshState();
    state.player.facing = 'E';
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1)];
    toggleInventory(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.consumed).toBe(false);
    expect(state.enemies[0].hp).toBe(5);
    closeInventory(state);
  });

  it('X is rejected once the game has ended (gameover)', () => {
    const state = freshState({ phase: 'gameover' });
    state.player.facing = 'E';
    state.enemies = [createInitialEnemy('bok', { x: 3, y: 1 }, 5, 1)];
    const result = processTurn(state, { type: 'action' });
    expect(result.consumed).toBe(false);
    expect(state.enemies[0].hp).toBe(5);
  });
});

describe('input isolation and turn-consumption regressions (Phase 08.6)', () => {
  it('inventory open blocks move, face, action, and wait alike', () => {
    const state = freshState();
    toggleInventory(state);
    const turnBefore = state.turn;
    expect(processTurn(state, { type: 'move', direction: 'E' }).consumed).toBe(false);
    expect(processTurn(state, { type: 'face', direction: 'E' }).consumed).toBe(false);
    expect(processTurn(state, { type: 'action' }).consumed).toBe(false);
    expect(processTurn(state, { type: 'wait' }).consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    closeInventory(state);
  });

  it('Space wait is unaffected and still consumes exactly 1 turn', () => {
    const state = freshState();
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('armor 0-damage handling is unaffected by the new action type (regression)', () => {
    const state = freshState({ equippedArmorId: 'armor' });
    const bok = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    state.enemies = [bok];
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore);
  });
});
