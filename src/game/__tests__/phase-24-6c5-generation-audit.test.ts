import { describe, expect, it } from 'vitest';
import { deriveFloorSeed } from '../floor';
import {
  auditReinforcementCadenceCandidates,
  runAscentGenerationAudit,
  runDescentGenerationAudit,
} from '../generation-audit';
import { advanceRunFloor, buildFloorState, createInitialState } from '../state';
import type { GameState } from '../types';

const longRunConfig = { totalFloors: 26, runDepthTier: 'deep' as const };

describe('Phase 24.6c5 reinforcement cadence candidate audit', () => {
  it('finds no reinforcement violations on both legs across seeds 1 through 50', () => {
    const violations = [];
    for (let runSeed = 1; runSeed <= 50; runSeed++) {
      for (const result of [runDescentGenerationAudit(runSeed), runAscentGenerationAudit(runSeed)]) {
        for (const floor of result.floors) {
          for (const violation of floor.violations) {
            if (violation.includes('reinforcement')) {
              violations.push({ runSeed, depth: floor.depth, violation });
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('reports a canonical cadence mismatch with the depth and both cadence values', () => {
    const violations = auditReinforcementCadenceCandidates(
      24610,
      9,
      'descent',
      () => ({ cadenceTurns: 81, capBonus: 2 }),
    );

    expect(violations).toContain('depth 9 reinforcement cadence is 81 turns; expected 80 turns');
  });
});

describe('Phase 24.6c5 enemy drop candidate audit', () => {
  it('finds no enemy drop candidate violations on both legs across seeds 1 through 50', () => {
    const violations = [];
    for (let runSeed = 1; runSeed <= 50; runSeed++) {
      for (const result of [runDescentGenerationAudit(runSeed), runAscentGenerationAudit(runSeed)]) {
        for (const floor of result.floors) {
          for (const violation of floor.violations) {
            if (violation.includes('enemy drop candidate')) {
              violations.push({ runSeed, depth: floor.depth, violation });
            }
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('Phase 24.6c5 descent generation audit', () => {
  it('finds no map-determinism or normal-item violations across seeds 1 through 50', () => {
    const violations = [];
    for (let runSeed = 1; runSeed <= 50; runSeed++) {
      for (const floor of runDescentGenerationAudit(runSeed).floors) {
        for (const violation of floor.violations) {
          if (
            violation.includes('regenerat') ||
            violation.includes('byte-identical') ||
            violation.includes('normal ground item')
          ) {
            violations.push({ runSeed, depth: floor.depth, violation });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('finds no enemy-spawn violations across all depths for seeds 1 through 50', () => {
    const enemySpawnViolations = [];
    for (let runSeed = 1; runSeed <= 50; runSeed++) {
      for (const floor of runDescentGenerationAudit(runSeed).floors) {
        for (const violation of floor.violations) {
          if (violation.includes('enemy')) {
            enemySpawnViolations.push({ runSeed, depth: floor.depth, violation });
          }
        }
      }
    }

    expect(enemySpawnViolations).toEqual([]);
  });

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

describe('Phase 24.6c5 ascent generation audit', () => {
  it('finds no generation violations for pilot run seeds 1 through 50', () => {
    const violations = [];
    for (let runSeed = 1; runSeed <= 50; runSeed++) {
      for (const floor of runAscentGenerationAudit(runSeed).floors) {
        for (const violation of floor.violations) {
          violations.push({ runSeed, depth: floor.depth, violation });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('completes the full descent and rescued ascent route', () => {
    const runSeed = 24607;
    let state = createInitialState(runSeed, longRunConfig);
    for (let depth = 2; depth <= 26; depth++) {
      state = advanceRunFloor(state) as GameState;
    }

    state = buildFloorState(runSeed, 25, state.turn, 27, longRunConfig, undefined, undefined, undefined, 'ascent', 'depth');
    expect(state).toMatchObject({ floor: 25, leg: 'ascent', floorVisitOrdinal: 27 });
    for (let depth = 24; depth >= 1; depth--) {
      state = advanceRunFloor(state) as GameState;
      expect(state).toMatchObject({ floor: depth, leg: 'ascent', floorVisitOrdinal: 52 - depth });
    }
    expect(advanceRunFloor(state)).toBe('runComplete');
  });

  it('uses distinct descent and ascent seed streams at the same depth', () => {
    const runSeed = 24608;
    const depth = 12;
    expect(deriveFloorSeed(runSeed, depth, 'ascent')).not.toBe(deriveFloorSeed(runSeed, depth, 'descent'));

    const descent = buildFloorState(runSeed, depth, 0, depth, longRunConfig, undefined, undefined, undefined, 'descent', 'depth');
    const ascent = buildFloorState(runSeed, depth, 0, 52 - depth, longRunConfig, undefined, undefined, undefined, 'ascent', 'depth');
    expect(ascent).not.toEqual(descent);
  });

  it('reproduces byte-identical results for the same run seed', () => {
    expect(runAscentGenerationAudit(24609)).toEqual(runAscentGenerationAudit(24609));
  });
});
