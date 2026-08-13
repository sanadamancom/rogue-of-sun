import { describe, expect, it } from 'vitest';
import { ENEMY_TYPES_IN_ORDER, getEnemyPoolForFloor } from '../enemy-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { ENEMY_COUNT_BY_FLOOR } from '../mapgen';
import { EnemyType, GameState } from '../types';

const asSet = (types: EnemyType[]) => new Set(types);

describe('floor-based enemy pools (Phase 08.1)', () => {
  it('1F is exactly bok and bat', () => {
    expect(asSet(getEnemyPoolForFloor(1))).toEqual(new Set(['bok', 'bat']));
  });

  it('2F is exactly bok, bat, spider, plus golem as a Phase 08.4 floor-2 exception', () => {
    expect(asSet(getEnemyPoolForFloor(2))).toEqual(new Set(['bok', 'bat', 'spider', 'golem']));
  });

  it('3F is exactly bok, bat, spider, cockatrice, mummy, skeleton, ghost', () => {
    // Phase 23.1 Stage 4: skeleton's provisional normal first-appearance
    // floor is 3 (ENEMY_FIRST_APPEARANCE_FLOOR.skeleton); Phase 23.3
    // adds ghost with the same provisional floor 3 — both are intended
    // pool-composition changes from before their respective phases.
    expect(asSet(getEnemyPoolForFloor(3))).toEqual(
      new Set(['bok', 'bat', 'spider', 'cockatrice', 'mummy', 'skeleton', 'ghost']),
    );
  });

  it('4F is exactly bok, bat, spider, cockatrice, mummy, skeleton, ghost, sword, axe', () => {
    expect(asSet(getEnemyPoolForFloor(4))).toEqual(
      new Set(['bok', 'bat', 'spider', 'cockatrice', 'mummy', 'skeleton', 'ghost', 'sword', 'axe']),
    );
  });

  it('5F is the full 11-species roster', () => {
    expect(asSet(getEnemyPoolForFloor(5))).toEqual(new Set(ENEMY_TYPES_IN_ORDER));
  });

  it('6F and beyond stays the full 11-species roster', () => {
    expect(asSet(getEnemyPoolForFloor(6))).toEqual(new Set(ENEMY_TYPES_IN_ORDER));
    expect(asSet(getEnemyPoolForFloor(50))).toEqual(new Set(ENEMY_TYPES_IN_ORDER));
  });

  it('1F never includes any species unlocked from 2F onward', () => {
    const pool = getEnemyPoolForFloor(1);
    for (const type of ['spider', 'cockatrice', 'mummy', 'skeleton', 'ghost', 'sword', 'axe', 'golem', 'kraken'] as const) {
      expect(pool).not.toContain(type);
    }
  });

  it('2F never includes any species unlocked from 3F onward (golem is excepted, see Phase 08.4)', () => {
    const pool = getEnemyPoolForFloor(2);
    for (const type of ['cockatrice', 'mummy', 'skeleton', 'ghost', 'sword', 'axe', 'kraken'] as const) {
      expect(pool).not.toContain(type);
    }
  });

  it('3F never includes any species unlocked from 4F onward', () => {
    const pool = getEnemyPoolForFloor(3);
    for (const type of ['sword', 'axe', 'golem', 'kraken'] as const) {
      expect(pool).not.toContain(type);
    }
  });

  it('4F never includes golem or kraken', () => {
    const pool = getEnemyPoolForFloor(4);
    expect(pool).not.toContain('golem');
    expect(pool).not.toContain('kraken');
  });

  it(
    'is cumulative: every floor\'s pool is a superset of the previous floor\'s pool ' +
      '(except across the Phase 08.4 floor-2 golem exception, which is deliberately ' +
      'not part of the cumulative unlock chain)',
    () => {
      for (let floor = 2; floor <= 6; floor++) {
        const prev = asSet(getEnemyPoolForFloor(floor - 1));
        const curr = asSet(getEnemyPoolForFloor(floor));
        for (const type of prev) {
          if (floor - 1 === 2 && type === 'golem') continue; // floor-2-only exception
          expect(curr.has(type)).toBe(true);
        }
      }
    },
  );
});

describe('floor-based enemy pools: real generation stays within the floor pool (integration)', () => {
  const RUN_SEEDS = [1, 2, 3, 5, 8, 13, 21, 42, 100, 12345, 999999];

  it('1F generation never produces anything but bok/bat, across many seeds', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      expect(state.floor).toBe(1);
      const pool = getEnemyPoolForFloor(1);
      for (const enemy of state.enemies) {
        expect(pool).toContain(enemy.type);
      }
    }
  });

  it('advancing to 2F and 3F never produces an unlocked-later species, across many seeds', () => {
    for (const runSeed of RUN_SEEDS) {
      let state: GameState = createInitialState(runSeed);
      for (let targetFloor = 2; targetFloor <= 3; targetFloor++) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        // Re-derive via advanceToNextFloor directly rather than relying on
        // processTurn's exit-trigger, keeping this test focused on species
        // pools rather than exit-detection mechanics (covered elsewhere).
        state = advanceToNextFloor(state);
        expect(state.floor).toBe(targetFloor);
        const pool = getEnemyPoolForFloor(targetFloor);
        for (const enemy of state.enemies) {
          expect(pool).toContain(enemy.type);
        }
      }
    }
  });

  it('same seed and same floor reproduce the same enemy species composition (determinism preserved)', () => {
    for (const runSeed of [7, 2780624551]) {
      const a = createInitialState(runSeed);
      const b = createInitialState(runSeed);
      expect(a.enemies.map((e) => e.type)).toEqual(b.enemies.map((e) => e.type));
      expect(a.enemies.map((e) => e.pos)).toEqual(b.enemies.map((e) => e.pos));
    }
  });

  it('enemy count per floor matches ENEMY_COUNT_BY_FLOOR (Phase 15.5, previously a flat 2)', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      expect(state.enemies).toHaveLength(ENEMY_COUNT_BY_FLOOR[state.floor]);
    }
  });

  it('does not change placement/positions determinism (species pool restriction uses its own RNG stream)', () => {
    const a = createInitialState(2780624551);
    const b = createInitialState(2780624551);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.enemies.map((e) => e.pos)).toEqual(b.enemies.map((e) => e.pos));
  });
});
