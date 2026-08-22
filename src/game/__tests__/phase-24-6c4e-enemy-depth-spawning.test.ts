import { describe, expect, it } from 'vitest';
import { ENEMY_DEFINITIONS } from '../enemy-def';
import {
  getEligibleEnemySpeciesForDepth,
  getEnemyLevelBandForDepth,
  getEnemyPopulationForDepth,
} from '../enemy-depth-bands';
import { advanceRunFloor, advanceToNextFloor, createInitialState } from '../state';
import type { GameState } from '../types';

const longRunConfig = { totalFloors: 26, runDepthTier: 'deep' as const };

function buildRunFloor(seed: number, depth: number): GameState {
  const state = createInitialState(seed, longRunConfig);
  state.floor = depth - 1;
  state.floorVisitOrdinal = depth - 1;
  const result = advanceRunFloor(state);
  expect(result).not.toBe('runComplete');
  return result as GameState;
}

describe('Phase 24.6c4e depth-driven production enemy spawning', () => {
  it.each([1, 6, 11, 17, 22, 26])(
    'respects population, appearance windows, and level bands at depth %i',
    (depth) => {
      // advanceRunFloor constructs a new floor, so depth 1 is represented by
      // an ascent transition from depth 2 while the other probes descend.
      const state = depth === 1
        ? (() => {
          const current = createInitialState(91001, longRunConfig);
          current.floor = 2;
          current.leg = 'ascent';
          current.floorVisitOrdinal = 50;
          return advanceRunFloor(current) as GameState;
        })()
        : buildRunFloor(91000 + depth, depth);
      const normalEnemies = state.enemies.filter((enemy) => enemy.spawnSource === 'normal');
      const eligible = new Set(getEligibleEnemySpeciesForDepth(depth).map(({ type }) => type));

      expect(normalEnemies).toHaveLength(getEnemyPopulationForDepth(depth).initialEnemyCount);
      for (const enemy of normalEnemies) {
        expect(eligible.has(enemy.type)).toBe(true);
        const band = getEnemyLevelBandForDepth(enemy.type, depth);
        expect(band).not.toBeNull();
        expect(band!.weights[enemy.level]).toBeGreaterThan(0);

        const stats = ENEMY_DEFINITIONS[enemy.type];
        if (enemy.level > 1) {
          expect(enemy.maxHp).toBeGreaterThan(stats.hp);
          expect(enemy.attack).toBeGreaterThan(stats.attack);
        }
      }
    },
  );

  it('is deterministic for the same run seed and transition', () => {
    const first = buildRunFloor(123456, 22);
    const second = buildRunFloor(123456, 22);
    const roster = (state: GameState) => state.enemies
      .filter((enemy) => enemy.spawnSource === 'normal')
      .map(({ type, level, pos, hp, attack }) => ({ type, level, pos, hp, attack }));

    expect(roster(first)).toEqual(roster(second));
  });

  it('leaves the legacy three-floor production path at its old counts and level 1', () => {
    let state = createInitialState(24680);
    for (const expectedCount of [6, 7, 8]) {
      const normalEnemies = state.enemies.filter((enemy) => enemy.spawnSource === 'normal');
      expect(normalEnemies).toHaveLength(expectedCount);
      expect(normalEnemies.every((enemy) => enemy.level === 1)).toBe(true);
      if (state.floor < 3) state = advanceToNextFloor(state);
    }
  });
});
