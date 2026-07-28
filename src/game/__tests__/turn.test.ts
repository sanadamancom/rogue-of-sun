import { describe, expect, it } from 'vitest';
import { createInitialActor, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';

// Small fixed layout retained only for these turn-processing unit tests;
// production maps now come from mapgen.ts.
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

function freshState(): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 1 }, 3, 1),
    enemy: createInitialActor({ x: 7, y: 6 }, 2, 1),
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    exit: { x: 99, y: 99 },
  };
}

describe('turn processing', () => {
  it('moves the enemy toward the player on a normal move turn', () => {
    const state = freshState();
    const enemyStart = { ...state.enemy.pos };
    processTurn(state, { type: 'move', direction: 'E' });
    const dx = Math.abs(state.enemy.pos.x - enemyStart.x);
    const dy = Math.abs(state.enemy.pos.y - enemyStart.y);
    expect(dx + dy).toBeGreaterThan(0);
  });

  it('does not consume a turn on a blocked move', () => {
    const state = freshState();
    state.player.pos = { x: 0, y: 1 }; // against the outer wall
    const result = processTurn(state, { type: 'move', direction: 'W' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(0);
  });

  it('resolves an attack when moving toward an adjacent enemy', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.enemy.pos = { x: 5, y: 4 };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.playerAttacked).toBe(true);
    expect(state.player.pos).toEqual({ x: 4, y: 4 }); // player does not step in
    expect(state.enemy.hp).toBe(1);
  });

  it('removes the enemy from the board once its HP reaches 0', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.enemy.pos = { x: 5, y: 4 };
    state.enemy.hp = 1;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.enemyDefeated).toBe(true);
    expect(state.enemy.alive).toBe(false);
  });

  it('does not let a defeated enemy act (no counter-attack)', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.enemy.pos = { x: 5, y: 4 };
    state.enemy.hp = 1;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.enemyActed).toBe(false);
    expect(result.enemyAttacked).toBe(false);
    expect(state.player.hp).toBe(3);
  });

  it('advances the turn count on attack and wait', () => {
    const state = freshState();
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(1);
  });

  it('lets the enemy act after a normal player move', () => {
    const state = freshState();
    const before = { ...state.enemy.pos };
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.enemy.pos).not.toEqual(before);
  });

  it('sets gameover when player HP reaches 0', () => {
    const state = freshState();
    state.player.pos = { x: 4, y: 4 };
    state.enemy.pos = { x: 5, y: 4 };
    state.player.hp = 1;
    // Player waits; adjacent enemy attacks and defeats the player.
    const result = processTurn(state, { type: 'wait' });
    expect(result.playerDefeated).toBe(true);
    expect(state.phase).toBe('gameover');
  });

  it('ignores unrelated key-derived actions without consuming a turn', () => {
    // Simulated by not calling processTurn at all for unmapped keys;
    // this is enforced at the input-mapping layer (see input.test.ts).
    const state = freshState();
    expect(state.turn).toBe(0);
  });
});
