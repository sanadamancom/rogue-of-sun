import { describe, expect, it } from 'vitest';
import { advanceToNextFloor, createInitialState } from '../state';
import { processTurn } from '../turn';
import { GameState } from '../types';
import { deriveFloorSeed } from '../floor';

/** Steps the player directly onto the exit tile without pathing (unit-level shortcut). */
function stepOntoExit(state: GameState): void {
  const exit = state.exit;
  // Place the player one tile above the exit and move south onto it; if
  // that tile isn't floor, fall back to a direct teleport + wait (turn
  // processing only cares about position/enemy state, not the path taken).
  state.player.pos = { x: exit.x, y: exit.y - 1 >= 0 ? exit.y - 1 : exit.y };
  if (state.player.pos.y === exit.y) {
    // Degenerate case (exit at row 0): teleport directly and use `wait`.
    state.player.pos = { ...exit };
    processTurn(state, { type: 'wait' });
    return;
  }
  processTurn(state, { type: 'move', direction: 'S' });
}

describe('multi-floor progression', () => {
  it('starts at floor 1 of 3', () => {
    const state = createInitialState(2780624551);
    expect(state.floor).toBe(1);
    expect(state.totalFloors).toBe(3);
  });

  it('does not advance the floor when the enemy is still alive at the exit', () => {
    const state = createInitialState(11);
    state.enemy.alive = true;
    stepOntoExit(state);
    expect(state.floor).toBe(1);
    expect(state.phase).not.toBe('victory');
  });

  it('signals floor_cleared (not victory) when floor 1 or 2 is cleared', () => {
    const state = createInitialState(11);
    state.enemy.alive = false;
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('advances floor 1 -> 2 -> 3 and only floor 3 yields victory, carrying over HP without healing', () => {
    let state = createInitialState(2780624551);
    state.player.maxHp = 3;
    state.player.hp = 2; // damaged, should not be healed by floor transitions
    state.enemy.alive = false;

    expect(state.floor).toBe(1);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(2);
    expect(state.phase).toBe('playing');
    expect(state.player.hp).toBe(2);
    expect(state.player.maxHp).toBe(3);
    // A new floor's map should use the deterministic floor seed.
    expect(state.seed).toBe(deriveFloorSeed(2780624551, 2));

    state.enemy.alive = false;
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(3);
    expect(state.player.hp).toBe(2);

    state.enemy.alive = false;
    stepOntoExit(state);
    expect(state.phase).toBe('victory');
    // Victory does not itself regenerate a floor 4.
    expect(state.floor).toBe(3);
  });

  it('defeating the enemy on floors 1 or 2 without reaching the exit does not end the run', () => {
    const state = createInitialState(22);
    state.enemy.pos = { x: state.player.pos.x + 1, y: state.player.pos.y };
    state.enemy.hp = 1;
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.enemy.alive).toBe(false);
    expect(state.phase).toBe('playing');
    expect(state.floor).toBe(1);
  });

  it('a single exit contact never advances more than one floor', () => {
    const state = createInitialState(11);
    state.enemy.alive = false;
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
    // Further turns are ignored while phase is not 'playing'.
    const before = state.turn;
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(before);
    expect(state.floor).toBe(1);
  });

  it('game over ends the run regardless of current floor', () => {
    let state = createInitialState(33);
    state.player.maxHp = 5;
    state.player.hp = 5;
    state.enemy.alive = false;
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(2);

    state.enemy.pos = { x: state.player.pos.x + 1, y: state.player.pos.y };
    state.enemy.alive = true;
    state.enemy.hp = 99;
    state.enemy.attack = 999;
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('gameover');
  });
});

describe('restart semantics across floors', () => {
  it('restarting with the same run seed reproduces the same 3-floor sequence', () => {
    const run = 2780624551;
    const seedsA = [1, 2, 3].map((f) => deriveFloorSeed(run, f));
    const seedsB = [1, 2, 3].map((f) => deriveFloorSeed(run, f));
    expect(seedsA).toEqual(seedsB);
  });

  it('a fresh run from the same runSeed starts back at floor 1 with full HP', () => {
    let state = createInitialState(44);
    state.player.hp = 1;
    state.enemy.alive = false;
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(2);
    expect(state.player.hp).toBe(1);

    const restarted = createInitialState(state.runSeed);
    expect(restarted.floor).toBe(1);
    expect(restarted.player.hp).toBe(restarted.player.maxHp);
  });
});
