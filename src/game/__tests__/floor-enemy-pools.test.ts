import { describe, expect, it } from 'vitest';
import { ENEMY_TYPES_IN_ORDER, getEnemyPoolForFloor } from '../enemy-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { ENEMY_COUNT_BY_FLOOR } from '../mapgen';
import { EnemyType, GameState } from '../types';

const asSet = (types: EnemyType[]) => new Set(types);

describe('floor-based enemy pools (Phase 08.1; confirmed 3-tier schedule Phase 23.6)', () => {
  it('1F is exactly the 4 newly-unlocked floor-1 species', () => {
    expect(asSet(getEnemyPoolForFloor(1))).toEqual(new Set(['bok', 'spider', 'bat', 'skeleton']));
  });

  it('2F is exactly the cumulative 8 species (floor-1 + floor-2 unlocks)', () => {
    expect(asSet(getEnemyPoolForFloor(2))).toEqual(
      new Set(['bok', 'cockatrice', 'spider', 'bat', 'mummy', 'sword', 'skeleton', 'ghost']),
    );
  });

  it('3F is the full 12-species roster', () => {
    expect(asSet(getEnemyPoolForFloor(3))).toEqual(new Set(ENEMY_TYPES_IN_ORDER));
  });

  it('4F and beyond stays the full 12-species roster', () => {
    expect(asSet(getEnemyPoolForFloor(4))).toEqual(new Set(ENEMY_TYPES_IN_ORDER));
    expect(asSet(getEnemyPoolForFloor(6))).toEqual(new Set(ENEMY_TYPES_IN_ORDER));
    expect(asSet(getEnemyPoolForFloor(50))).toEqual(new Set(ENEMY_TYPES_IN_ORDER));
  });

  it('floor 0 and below is empty (no species has a first-appearance floor <= 0)', () => {
    expect(getEnemyPoolForFloor(0)).toEqual([]);
    expect(getEnemyPoolForFloor(-1)).toEqual([]);
  });

  it('1F never includes any species unlocked from 2F onward', () => {
    const pool = getEnemyPoolForFloor(1);
    for (const type of ['cockatrice', 'mummy', 'sword', 'ghost', 'golem', 'axe', 'kraken', 'steps'] as const) {
      expect(pool).not.toContain(type);
    }
  });

  it('2F never includes any species unlocked from 3F onward', () => {
    const pool = getEnemyPoolForFloor(2);
    for (const type of ['golem', 'axe', 'kraken', 'steps'] as const) {
      expect(pool).not.toContain(type);
    }
  });

  it('each species never appears before its confirmed first-appearance floor, and always appears from it onward', () => {
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const firstFloor = [1, 2, 3].find((floor) => getEnemyPoolForFloor(floor).includes(type)) ?? Infinity;
      expect(getEnemyPoolForFloor(firstFloor - 1)).not.toContain(type);
      for (let floor = firstFloor; floor <= 6; floor++) {
        expect(getEnemyPoolForFloor(floor)).toContain(type);
      }
    }
  });

  it('is strictly cumulative: every floor\'s pool is a superset of the previous floor\'s pool (no exceptions remain — Phase 23.6 removed the floor-2 golem exception)', () => {
    for (let floor = 2; floor <= 6; floor++) {
      const prev = asSet(getEnemyPoolForFloor(floor - 1));
      const curr = asSet(getEnemyPoolForFloor(floor));
      for (const type of prev) {
        expect(curr.has(type)).toBe(true);
      }
    }
  });
});

describe('floor-based enemy pools: real generation stays within the floor pool (integration)', () => {
  const RUN_SEEDS = [1, 2, 3, 5, 8, 13, 21, 42, 100, 12345, 999999];

  it('1F generation never produces anything outside the 1F pool, across many seeds', () => {
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
