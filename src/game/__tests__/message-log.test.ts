import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { formatEvent, formatEvents, MessageLog } from '../message-log';
import { EnemyType, GameMap, GameState, Tile, WebTile } from '../types';
import { ENEMY_DEFINITIONS } from '../enemy-def';

const TEST_LAYOUT: string[] = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function singleEnemyState(
  type: EnemyType,
  enemyPos: { x: number; y: number },
  options?: {
    playerPos?: { x: number; y: number };
    hp?: number;
    attack?: number;
    turn?: number;
    spawnTurn?: number;
    webs?: WebTile[];
  },
): GameState {
  const playerPos = options?.playerPos ?? { x: 10, y: 4 };
  const hp = options?.hp ?? 10;
  const attack = options?.attack ?? 1;
  const turn = options?.turn ?? 0;
  const spawnTurn = options?.spawnTurn ?? 0;
  return {
    map: testMap(),
    player: createInitialActor(playerPos, 20, 1),
    enemies: [createInitialEnemy(type, enemyPos, hp, attack, spawnTurn)],
    turn,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    exit: { x: 99, y: 99 },
    regenProgress: 0,
    webs: options?.webs ?? [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0 },
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
  };
}

describe('formatEvent / formatEvents', () => {
  it('renders damage and enemy display name for player_attack', () => {
    const line = formatEvent({ type: 'player_attack', enemyType: 'bok', targetId: 0, damage: 2, targetHpBefore: 2, targetHpAfter: 0 });
    expect(line).toContain(ENEMY_DEFINITIONS.bok.displayName);
    expect(line).toContain('2');
  });

  it('renders damage and enemy display name for enemy_attack', () => {
    const line = formatEvent({ type: 'enemy_attack', enemyType: 'golem', attackerId: 0, damage: 3 });
    expect(line).toContain(ENEMY_DEFINITIONS.golem.displayName);
    expect(line).toContain('3');
  });

  it('renders enemy_defeated with the correct enemy name', () => {
    const line = formatEvent({ type: 'enemy_defeated', enemyType: 'spider', targetId: 0 });
    expect(line).toContain(ENEMY_DEFINITIONS.spider.displayName);
  });

  it('formats a sequence of events in order', () => {
    const lines = formatEvents([
      { type: 'player_attack', enemyType: 'bok', targetId: 0, damage: 1, targetHpBefore: 1, targetHpAfter: 0 },
      { type: 'enemy_defeated', enemyType: 'bok', targetId: 0 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(ENEMY_DEFINITIONS.bok.displayName);
    expect(lines[1]).toContain('たおした');
  });
});

describe('MessageLog', () => {
  it('keeps only the most recent `capacity` lines, in order', () => {
    const log = new MessageLog(3);
    log.pushMany(['a', 'b', 'c', 'd', 'e']);
    expect(log.visible).toEqual(['c', 'd', 'e']);
  });

  it('preserves order for a burst of 4+ lines added in one call', () => {
    const log = new MessageLog(3);
    log.pushMany(['1', '2', '3', '4']);
    expect(log.visible).toEqual(['2', '3', '4']);
  });

  it('clears all lines', () => {
    const log = new MessageLog(3);
    log.pushMany(['a', 'b']);
    log.clear();
    expect(log.visible).toEqual([]);
  });
});

describe('processTurn events', () => {
  it('produces no events for a normal, unopposed move', () => {
    const state = singleEnemyState('bok', { x: 2, y: 1 }, { playerPos: { x: 10, y: 4 } });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events).toEqual([]);
  });

  it('produces player_attack (and enemy_defeated when applicable) for a player attack', () => {
    const state = singleEnemyState('bok', { x: 9, y: 4 }, { hp: 100, attack: 1 });
    state.player.facing = 'W';
    const result = processTurn(state, { type: 'action' });
    expect(result.events[0]).toEqual({ type: 'player_attack', enemyType: 'bok', targetId: 0, damage: 1, targetHpBefore: 100, targetHpAfter: 99 });
    expect(result.events.find((e) => e.type === 'enemy_defeated')).toBeUndefined();
  });

  it('produces player_attack followed by enemy_defeated on a killing blow', () => {
    const state = singleEnemyState('bok', { x: 9, y: 4 }, { hp: 1, attack: 5 });
    state.player.facing = 'W';
    const result = processTurn(state, { type: 'action' });
    expect(result.events).toEqual([
      { type: 'player_attack', enemyType: 'bok', targetId: 0, damage: 1, targetHpBefore: 1, targetHpAfter: 0 },
      { type: 'enemy_defeated', enemyType: 'bok', targetId: 0 },
    ]);
  });

  it('produces enemy_attack when an enemy hits the player', () => {
    const state = singleEnemyState('bok', { x: 9, y: 4 }, { attack: 2 });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events).toEqual([{ type: 'enemy_attack', enemyType: 'bok', attackerId: 0, damage: 2 }]);
  });

  it('produces player_defeated when the player dies this turn', () => {
    const state = singleEnemyState('bok', { x: 9, y: 4 }, { attack: 99 });
    state.player.hp = 1;
    const result = processTurn(state, { type: 'wait' });
    expect(result.events[result.events.length - 1]).toEqual({ type: 'player_defeated' });
  });

  it('produces enemy_recovering for golem on its resting turn', () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, { turn: 1, spawnTurn: 0 });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events).toEqual([{ type: 'enemy_recovering', enemyType: 'golem' }]);
  });

  it('produces enemy_recovering for axe on its forced-wait turn after attacking', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, { attack: 1 });
    const first = processTurn(state, { type: 'wait' });
    expect(first.events).toEqual([{ type: 'enemy_attack', enemyType: 'axe', attackerId: 0, damage: 1 }]);
    const second = processTurn(state, { type: 'wait' });
    expect(second.events).toEqual([{ type: 'enemy_recovering', enemyType: 'axe' }]);
  });

  it('produces sword_dash only when the sword actually completes a 2-tile approach', () => {
    const state = singleEnemyState('sword', { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events).toEqual([{ type: 'sword_dash', enemyType: 'sword' }]);
  });

  it('does not produce sword_dash for a normal 1-tile approach turn', () => {
    // Adjacent enough that the sword attacks on step 1 and never takes step 2.
    const state = singleEnemyState('sword', { x: 8, y: 4 }, { playerPos: { x: 10, y: 4 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'sword_dash')).toBe(false);
  });

  it('produces web_placed when a spider places a web', () => {
    const state = singleEnemyState('spider', { x: 10, y: 6 }, { playerPos: { x: 10, y: 4 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events).toEqual([{ type: 'web_placed', enemyType: 'spider' }]);
  });

  it('produces player_webbed when the player steps onto a web tile', () => {
    const state = singleEnemyState('spider', { x: 2, y: 2 }, {
      playerPos: { x: 9, y: 4 },
      webs: [{ id: 0, pos: { x: 10, y: 4 }, ownerEnemyId: 0, placedTurn: 0 }],
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events).toEqual([{ type: 'player_webbed' }]);
    expect(state.player.slowed).toBe(true);
  });

  it('produces slowed_move_cancelled on the move that consumes the slow', () => {
    const state = singleEnemyState('spider', { x: 2, y: 2 }, { playerPos: { x: 9, y: 4 } });
    state.player.slowed = true;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events).toEqual([{ type: 'slowed_move_cancelled' }]);
    expect(state.player.slowed).toBe(false);
  });

  it('does not change existing behavior results/turn progression when generating events', () => {
    const state = singleEnemyState('bok', { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 } });
    const turnBefore = state.turn;
    const posBefore = { ...state.enemies[0].pos };
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(turnBefore + 1);
    const dx = Math.abs(state.enemies[0].pos.x - posBefore.x);
    const dy = Math.abs(state.enemies[0].pos.y - posBefore.y);
    expect(dx + dy).toBe(1);
  });
});
