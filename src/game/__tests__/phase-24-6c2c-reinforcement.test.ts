import { describe, expect, it } from 'vitest';
import { deriveFloorSeed } from '../floor';
import { ENEMY_COUNT_BY_FLOOR } from '../mapgen';
import { getReinforcementRule } from '../reinforcement';
import { createInitialState } from '../state';
import { resolveRegularReinforcement } from '../turn';
import type { GameEvent } from '../events';

describe('Phase 24.6c2c floor seed contract', () => {
  it('keeps omitted-leg and explicit descent derivation byte-identical', () => {
    for (const seed of [0, 1, 42, 0xffffffff]) {
      for (const floor of [1, 2, 3, 26]) {
        expect(deriveFloorSeed(seed, floor, 'descent')).toBe(deriveFloorSeed(seed, floor));
      }
    }
  });

  it('derives deterministic, distinct ascent seeds', () => {
    const a = deriveFloorSeed(123456, 7, 'ascent');
    expect(a).toBe(deriveFloorSeed(123456, 7, 'ascent'));
    expect(a).not.toBe(deriveFloorSeed(123456, 7, 'descent'));
  });
});

describe('Phase 24.6c2c reinforcement rules', () => {
  it('covers every canonical depth-band boundary', () => {
    expect([1, 5, 6, 8].map(getReinforcementRule)).toEqual(
      Array(4).fill({ cadenceTurns: 100, capBonus: 2 }),
    );
    expect([9, 10, 11, 15, 16, 17].map(getReinforcementRule)).toEqual(
      Array(6).fill({ cadenceTurns: 80, capBonus: 2 }),
    );
    expect([18, 20, 21, 26].map(getReinforcementRule)).toEqual(
      Array(4).fill({ cadenceTurns: 60, capBonus: 2 }),
    );
  });

  it('spawns deterministically and leaves mutable RNG streams isolated', () => {
    const run = () => {
      const state = createInitialState(314159);
      state.floorTurn = 100;
      const combatBefore = state.combatRngState;
      const events: GameEvent[] = [];
      resolveRegularReinforcement(state, events);
      const spawned = state.enemies.find((enemy) => enemy.spawnSource === 'reinforcement');
      return { spawned: spawned && { type: spawned.type, pos: spawned.pos }, events, ordinal: state.reinforcementOrdinal, combatBefore, combatAfter: state.combatRngState };
    };
    const a = run();
    const b = run();
    expect(a).toEqual(b);
    expect(a.spawned).toBeDefined();
    expect(a.combatAfter).toBe(a.combatBefore);
  });

  it('does not spawn but advances at the cap', () => {
    const state = createInitialState(2718);
    state.floorTurn = 100;
    while (state.enemies.filter((enemy) => enemy.alive && enemy.spawnSource !== 'monster_house').length < ENEMY_COUNT_BY_FLOOR[state.floor] + 2) {
      state.enemies.push({ ...state.enemies[0], id: state.enemies.length, pos: { ...state.enemies[0].pos }, spawnSource: 'reinforcement' });
    }
    const events: GameEvent[] = [];
    resolveRegularReinforcement(state, events);
    expect(state.reinforcementOrdinal).toBe(1);
    expect(events).toEqual([]);
  });

  it('advances the ordinal when every reachable cell is occupied', () => {
    const state = createInitialState(1618);
    state.floorTurn = 100;
    let id = state.nextGroundItemId;
    for (let y = 0; y < state.map.height; y++) {
      for (let x = 0; x < state.map.width; x++) {
        state.groundItems.push({ id: id++, itemId: 'apple', pos: { x, y } });
      }
    }
    const events: GameEvent[] = [];
    resolveRegularReinforcement(state, events);
    expect(state.reinforcementOrdinal).toBe(1);
    expect(events).toEqual([]);
  });
});
