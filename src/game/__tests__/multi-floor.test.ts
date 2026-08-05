import { describe, expect, it } from 'vitest';
import { advanceToNextFloor, createInitialState } from '../state';
import { processTurn } from '../turn';
import { GameState } from '../types';
import { deriveFloorSeed } from '../floor';
import { ENEMY_COUNT_BY_FLOOR } from '../mapgen';

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

function killAllEnemies(state: GameState): void {
  state.enemies.forEach((enemy) => {
    enemy.alive = false;
  });
}

describe('multi-floor progression', () => {
  it('starts at floor 1 of 3', () => {
    const state = createInitialState(2780624551);
    expect(state.floor).toBe(1);
    expect(state.totalFloors).toBe(3);
  });

  it('does not advance the floor when any enemy is still alive at the exit', () => {
    const state = createInitialState(11);
    stepOntoExit(state);
    expect(state.floor).toBe(1);
    expect(state.phase).not.toBe('victory');
  });

  it('does not advance the floor when only one of two enemies has been defeated', () => {
    const state = createInitialState(11);
    state.enemies[0].alive = false;
    stepOntoExit(state);
    expect(state.floor).toBe(1);
    expect(state.phase).toBe('playing');
  });

  it('signals floor_cleared (not victory) when floor 1 or 2 is cleared', () => {
    const state = createInitialState(11);
    killAllEnemies(state);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('advances floor 1 -> 2 -> 3 and only floor 3 yields victory, carrying over HP without healing', () => {
    let state = createInitialState(2780624551);
    state.player.maxHp = 3;
    state.player.hp = 2; // damaged, should not be healed by floor transitions
    killAllEnemies(state);

    expect(state.floor).toBe(1);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(2);
    expect(state.phase).toBe('playing');
    expect(state.player.hp).toBe(2);
    expect(state.player.maxHp).toBe(3);
    expect(state.enemies).toHaveLength(ENEMY_COUNT_BY_FLOOR[2]); // Phase 15.5
    expect(state.enemies.every((e) => e.alive)).toBe(true);
    // A new floor's map should use the deterministic floor seed.
    expect(state.seed).toBe(deriveFloorSeed(2780624551, 2));

    killAllEnemies(state);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(3);
    expect(state.player.hp).toBe(2);

    killAllEnemies(state);
    stepOntoExit(state);
    expect(state.phase).toBe('victory');
    // Victory does not itself regenerate a floor 4.
    expect(state.floor).toBe(3);
  });

  it('defeating both enemies on floors 1 or 2 without reaching the exit does not end the run', () => {
    const state = createInitialState(22);
    state.enemies[0].pos = { x: state.player.pos.x + 1, y: state.player.pos.y };
    state.enemies[0].hp = 1;
    state.enemies[1].pos = { x: 0, y: 0 };
    state.player.facing = 'E';
    processTurn(state, { type: 'action' });
    expect(state.enemies[0].alive).toBe(false);
    expect(state.phase).toBe('playing');
    expect(state.floor).toBe(1);
  });

  it('a single exit contact never advances more than one floor', () => {
    const state = createInitialState(11);
    killAllEnemies(state);
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
    killAllEnemies(state);
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(2);

    state.enemies[0].pos = { x: state.player.pos.x + 1, y: state.player.pos.y };
    state.enemies[0].alive = true;
    state.enemies[0].hp = 99;
    state.enemies[0].attack = 999;
    state.enemies[1].pos = { x: 0, y: 0 };
    // Phase 10.3 accuracy/evasion foundation: force a low, verified-safe
    // combat roll so this enemy's attack is guaranteed to land — this
    // test is about gameover-on-any-floor, not about the hit/miss system
    // itself.
    state.combatRngState = 0;
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('gameover');
  });

  it('generates a fresh set of living enemies on the next floor (Phase 15.5: 7 on floor 2, not 2)', () => {
    let state = createInitialState(2780624551);
    killAllEnemies(state);
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    expect(state.enemies).toHaveLength(ENEMY_COUNT_BY_FLOOR[2]);
    expect(state.enemies.every((e) => e.alive)).toBe(true);
  });

  it('carries current HP and regenProgress to the next floor without an immediate heal', () => {
    let state = createInitialState(2780624551);
    state.player.maxHp = 5;
    state.player.hp = 2;
    state.regenProgress = 3;
    killAllEnemies(state);
    // stepOntoExit itself consumes one counted action, advancing regenProgress by 1.
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    expect(state.player.hp).toBe(2);
    expect(state.regenProgress).toBe(4);
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
    killAllEnemies(state);
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(2);
    expect(state.player.hp).toBe(1);

    const restarted = createInitialState(state.runSeed);
    expect(restarted.floor).toBe(1);
    expect(restarted.player.hp).toBe(restarted.player.maxHp);
    expect(restarted.regenProgress).toBe(0);
  });
});
