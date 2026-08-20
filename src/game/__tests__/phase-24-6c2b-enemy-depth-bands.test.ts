import { describe, expect, it } from 'vitest';
import {
  ENEMY_LEVEL_WEIGHTS_BY_BAND,
  getEligibleEnemySpeciesForDepth,
  getEnemyLevelBandForDepth,
  getEnemyPopulationForDepth,
} from '../enemy-depth-bands';
import { getEnemyPoolForFloor } from '../enemy-def';

describe('Phase 24.6c2b depth-eligible species weights', () => {
  it.each([
    [1, { bat: 10, bok: 10, spider: 10 }],
    [3, { bat: 10, bok: 10, spider: 10, skeleton: 8 }],
    [5, { bat: 10, bok: 10, spider: 10, skeleton: 8, sword: 8 }],
    [7, { bok: 10, spider: 10, skeleton: 8, sword: 8, cockatrice: 7 }],
    [9, { spider: 10, skeleton: 8, sword: 8, cockatrice: 7, mummy: 8 }],
    [11, { skeleton: 8, sword: 8, cockatrice: 7, mummy: 8, ghost: 6 }],
    [13, { sword: 8, cockatrice: 7, mummy: 8, ghost: 6, axe: 6 }],
    [15, { cockatrice: 7, mummy: 8, ghost: 6, axe: 6, golem: 6 }],
    [17, { mummy: 8, ghost: 6, axe: 6, golem: 6, kraken: 5 }],
    [19, { ghost: 6, axe: 6, golem: 6, kraken: 5, steps: 5 }],
    [23, { axe: 6, golem: 6, kraken: 5, steps: 5 }],
    [26, { axe: 6, golem: 6, kraken: 5, steps: 5 }],
  ] as const)('filters then normalizes at depth %i', (depth, expected) => {
    const actual = Object.fromEntries(getEligibleEnemySpeciesForDepth(depth).map(({ type, normalizedWeight }) => [type, normalizedWeight]));
    const totalWeight = Object.values(expected).reduce<number>((sum, weight) => sum + weight, 0);
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [type, weight] of Object.entries(expected)) expect(actual[type]).toBeCloseTo(weight / totalWeight, 12);
    expect(Object.values(actual).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
  });

  it('returns no candidates outside the canonical depth range', () => {
    expect(getEligibleEnemySpeciesForDepth(0)).toEqual([]);
    expect(getEligibleEnemySpeciesForDepth(27)).toEqual([]);
  });
});

describe('Phase 24.6c2b family-relative level bands', () => {
  it.each([
    ['bat', 1, 'level1'], ['bat', 2, 'level1'], ['bat', 3, 'level2'], ['bat', 4, 'level2'], ['bat', 5, 'level3'], ['bat', 6, 'level3'],
    ['sword', 5, 'level1'], ['sword', 8, 'level1'], ['sword', 9, 'level2'], ['sword', 11, 'level2'], ['sword', 12, 'level3'], ['sword', 14, 'level3'],
    ['steps', 19, 'level1'], ['steps', 21, 'level1'], ['steps', 22, 'level2'], ['steps', 24, 'level2'], ['steps', 25, 'level3'], ['steps', 26, 'level3'],
  ] as const)('%s depth %i uses %s', (type, depth, band) => {
    expect(getEnemyLevelBandForDepth(type, depth)).toEqual({ band, weights: ENEMY_LEVEL_WEIGHTS_BY_BAND[band] });
  });

  it('returns null outside a species appearance window', () => {
    expect(getEnemyLevelBandForDepth('bat', 0)).toBeNull();
    expect(getEnemyLevelBandForDepth('bat', 7)).toBeNull();
  });
});

describe('Phase 24.6c2b initial population curve', () => {
  it.each(Array.from({ length: 26 }, (_, index) => {
    const depth = index + 1;
    return [depth, depth <= 5 ? 6 : depth <= 10 ? 7 : depth <= 15 ? 8 : depth <= 20 ? 9 : 10, depth <= 8 ? 100 : depth <= 17 ? 80 : 60] as const;
  }))('returns exact values at depth %i', (depth, initialEnemyCount, reinforcementIntervalTurns) => {
    expect(getEnemyPopulationForDepth(depth)).toEqual({ initialEnemyCount, reinforcementIntervalTurns });
  });

  it.each([0, 1.5, 27])('rejects invalid depth %s', (depth) => {
    expect(() => getEnemyPopulationForDepth(depth)).toThrow(RangeError);
  });
});

describe('Phase 24.6c2b production spawn regression', () => {
  it('keeps the existing 3F cumulative 4/8/12 species schedule', () => {
    expect([1, 2, 3].map((floor) => getEnemyPoolForFloor(floor).length)).toEqual([4, 8, 12]);
  });
});
