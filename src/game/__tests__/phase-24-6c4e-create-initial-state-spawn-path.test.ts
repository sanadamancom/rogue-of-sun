import { describe, expect, it } from 'vitest';
import {
  getEligibleEnemySpeciesForDepth,
  getEnemyLevelBandForDepth,
  getEnemyPopulationForDepth,
} from '../enemy-depth-bands';
import { createInitialState } from '../state';

const seeds = Array.from({ length: 50 }, (_, index) => index + 1);
const shortRunConfig = { totalFloors: 3, runDepthTier: 'short' as const };
const deepRunConfig = { totalFloors: 26, runDepthTier: 'deep' as const };

describe('Phase 24.6c4e createInitialState enemy spawn path', () => {
  it.each(seeds)('preserves legacy floor-1 species for seed %i', (seed) => {
    const bareTypes = createInitialState(seed).enemies.map(({ type }) => type);
    const explicitShortTypes = createInitialState(seed, shortRunConfig).enemies.map(({ type }) => type);

    expect(explicitShortTypes).toEqual(bareTypes);
  });

  it.each(seeds)('uses the canonical depth-1 species, levels, and population for deep seed %i', (seed) => {
    const enemies = createInitialState(seed, deepRunConfig).enemies;
    const eligibleTypes = new Set(getEligibleEnemySpeciesForDepth(1).map(({ type }) => type));

    expect(enemies).toHaveLength(getEnemyPopulationForDepth(1).initialEnemyCount);
    for (const enemy of enemies) {
      expect(eligibleTypes.has(enemy.type)).toBe(true);
      const levelBand = getEnemyLevelBandForDepth(enemy.type, 1);
      expect(levelBand).not.toBeNull();
      expect(levelBand!.weights).toEqual({ 1: 100, 2: 0, 3: 0 });
      expect(enemy.level).toBe(1);
    }
  });
});
