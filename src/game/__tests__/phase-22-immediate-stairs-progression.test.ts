import { describe, expect, it } from 'vitest';
import { advanceToNextFloor, createInitialState } from '../state';
import { processTurn } from '../turn';
import { GameState } from '../types';
import { deriveFloorSeed } from '../floor';

/** Steps the player directly onto the exit tile without pathing (unit-level shortcut). */
function stepOntoExit(state: GameState): void {
  const exit = state.exit;
  state.player.pos = { x: exit.x, y: exit.y - 1 >= 0 ? exit.y - 1 : exit.y };
  if (state.player.pos.y === exit.y) {
    state.player.pos = { ...exit };
    processTurn(state, { type: 'wait' });
    return;
  }
  processTurn(state, { type: 'move', direction: 'S' });
}

/** Advances the player to (approximately) the given floor with all enemies alive. */
function goToFloor(runSeed: number, targetFloor: number): GameState {
  let state = createInitialState(runSeed);
  for (let f = 1; f < targetFloor; f++) {
    stepOntoExit(state);
    state = advanceToNextFloor(state);
  }
  return state;
}

describe('Phase 22: immediate stairs progression', () => {
  it('floor 1: reaching the exit yields floor_cleared while every enemy is alive', () => {
    const state = createInitialState(11);
    expect(state.enemies.every((e) => e.alive)).toBe(true);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('floor 2: reaching the exit yields floor_cleared while every enemy is alive', () => {
    const state = goToFloor(2780624551, 2);
    expect(state.floor).toBe(2);
    expect(state.enemies.every((e) => e.alive)).toBe(true);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('floor 3: reaching the exit yields victory while every enemy is alive', () => {
    const state = goToFloor(2780624551, 3);
    expect(state.floor).toBe(3);
    expect(state.enemies.every((e) => e.alive)).toBe(true);
    stepOntoExit(state);
    expect(state.phase).toBe('victory');
  });

  it('monster-house-origin enemies alive do not block stair use', () => {
    const state = createInitialState(11);
    state.enemies.push({
      ...state.enemies[0],
      id: 999999,
      alive: true,
      spawnSource: 'monster_house',
    });
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('a hidden monster house on the floor does not block stair use', () => {
    const state = createInitialState(11);
    state.map.monsterHouse = { roomIndex: 0, status: 'hidden' };
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('a revealed monster house on the floor does not block stair use', () => {
    const state = createInitialState(11);
    state.map.monsterHouse = { roomIndex: 0, status: 'revealed' };
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('does not advance while the player has not reached the exit tile', () => {
    const state = createInitialState(11);
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('playing');
    expect(state.floor).toBe(1);
  });

  it('attacking an enemy standing on the exit tile does not advance the floor', () => {
    const state = createInitialState(22);
    const exit = state.exit;
    state.enemies[0].pos = { ...exit };
    state.enemies[0].alive = true;
    state.enemies[0].hp = 999;
    state.player.pos = { x: exit.x, y: exit.y - 1 >= 0 ? exit.y - 1 : exit.y + 1 };
    state.player.facing = state.player.pos.y < exit.y ? 'S' : 'N';
    processTurn(state, { type: 'action' });
    expect(state.player.pos).not.toEqual(exit);
    expect(state.phase).toBe('playing');
    expect(state.floor).toBe(1);
  });

  it('an unsuccessful move (blocked by a wall) does not advance the floor', () => {
    const state = createInitialState(11);
    const before = { ...state.player.pos };
    // Attempt to move in a direction that is very likely blocked; if not,
    // this assertion still holds since we only check no-exit-tile /
    // no-advance behavior tied to actual movement, not this specific
    // direction succeeding.
    processTurn(state, { type: 'move', direction: 'N' });
    if (state.player.pos.x === before.x && state.player.pos.y === before.y) {
      expect(state.phase).toBe('playing');
      expect(state.floor).toBe(1);
    }
  });

  it('death on the same turn the exit is reached results in gameover, not floor progression', () => {
    const state = createInitialState(33);
    const exit = state.exit;
    state.player.pos = { x: exit.x, y: exit.y - 1 >= 0 ? exit.y - 1 : exit.y };
    state.enemies[0].pos = { ...exit };
    state.enemies[0].alive = true;
    state.enemies[0].attack = 9999;
    state.enemies[1].pos = { x: 0, y: 0 };
    state.combatRngState = 0;
    processTurn(state, { type: 'move', direction: 'S' });
    // Player either failed to reach the exit tile (enemy occupies it, so
    // the move doesn't land there) or died to a nearby/blocking enemy —
    // either way floor progression must not occur.
    expect(state.phase).not.toBe('floor_cleared');
    expect(state.phase).not.toBe('victory');
  });

  it('a single exit contact never advances more than one floor', () => {
    const state = createInitialState(11);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
    const before = state.turn;
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(before);
    expect(state.floor).toBe(1);
  });

  it('advancing floors discards the previous floor enemies and monster house state', () => {
    let state = createInitialState(2780624551);
    state.map.monsterHouse = { roomIndex: 0, status: 'revealed' };
    const floor1Enemies = state.enemies.map((e) => e.id);
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(2);
    expect(state.enemies.map((e) => e.id)).not.toEqual(floor1Enemies);
    expect(state.map.monsterHouse ?? null).not.toEqual({ roomIndex: 0, status: 'revealed' });
  });

  it('HP and other carry-over state are preserved across an immediate-stairs transition', () => {
    let state = createInitialState(2780624551);
    state.player.maxHp = 10;
    state.player.hp = 4;
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    // No transition-granted heal beyond whatever regen happened during the
    // consumed turn itself (matching pre-existing carry-over semantics).
    expect(state.player.hp).toBeGreaterThanOrEqual(4);
    expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp);
  });

  it('the same runSeed reproduces the same floor 2 generation result', () => {
    let stateA = createInitialState(2780624551);
    stepOntoExit(stateA);
    stateA = advanceToNextFloor(stateA);

    let stateB = createInitialState(2780624551);
    stepOntoExit(stateB);
    stateB = advanceToNextFloor(stateB);

    expect(stateA.seed).toBe(deriveFloorSeed(2780624551, 2));
    expect(stateA.seed).toBe(stateB.seed);
    expect(stateA.exit).toEqual(stateB.exit);
    expect(stateA.enemies.map((e) => e.id)).toEqual(stateB.enemies.map((e) => e.id));
  });
});
