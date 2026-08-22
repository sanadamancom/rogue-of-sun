import { describe, expect, it } from 'vitest';
import { runDescentGenerationAudit } from '../generation-audit';
import { advanceRunFloor, createInitialState } from '../state';
import type { GameState } from '../types';

const longRunConfig = { totalFloors: 26, runDepthTier: 'deep' as const };

describe('Phase 24.6c5 descent generation audit', () => {
  it('finds no generation violations for pilot run seeds 1 through 50', () => {
    const violations = [];
    for (let runSeed = 1; runSeed <= 50; runSeed++) {
      const result = runDescentGenerationAudit(runSeed);
      for (const floor of result.floors) {
        for (const violation of floor.violations) {
          violations.push({ runSeed, depth: floor.depth, violation });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it.each([1, 50])('records the complete floor visit sequence for seed %i', (runSeed) => {
    const result = runDescentGenerationAudit(runSeed);
    expect(result.floors.map((floor) => floor.floorVisitOrdinal)).toEqual(
      Array.from({ length: 26 }, (_, index) => index + 1),
    );
  });

  it('reproduces byte-identical results for the same run seed', () => {
    expect(runDescentGenerationAudit(24605)).toEqual(runDescentGenerationAudit(24605));
  });

  it('remains stuck at depth 26 while Otenco is sealed', () => {
    let state = createInitialState(24606, longRunConfig);
    for (let depth = 2; depth <= 26; depth++) {
      state = advanceRunFloor(state) as GameState;
    }

    expect(state).toMatchObject({ floor: 26, leg: 'descent', floorVisitOrdinal: 26 });
    expect(advanceRunFloor(state)).toBe(state);
  });
});
