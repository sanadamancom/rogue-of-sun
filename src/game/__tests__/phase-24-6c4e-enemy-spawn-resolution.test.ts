import { describe, expect, it, vi } from 'vitest';
import { resolveEnemySpawnsForDepth } from '../enemy-depth-bands';

function sequenceRng(speciesRolls: number[], levelRoll: number) {
  const values = speciesRolls.flatMap((speciesRoll) => [speciesRoll, levelRoll]);
  let index = 0;
  return vi.fn(() => values[index++]);
}

describe('Phase 24.6c4e production enemy spawn resolution', () => {
  it('resolves the depth 1 boundary deterministically', () => {
    const rng = sequenceRng([0, 0.34, 0.67, 0.1, 0.5, 0.9], 0.99);

    expect(resolveEnemySpawnsForDepth(1, rng)).toEqual({
      initialEnemyCount: 6,
      spawns: [
        { type: 'bat', level: 1 },
        { type: 'bok', level: 1 },
        { type: 'spider', level: 1 },
        { type: 'bat', level: 1 },
        { type: 'bok', level: 1 },
        { type: 'spider', level: 1 },
      ],
    });
    expect(rng).toHaveBeenCalledTimes(12);
  });

  it('resolves a mid-range depth with species-relative level bands', () => {
    const rng = sequenceRng([0, 0.25, 0.5, 0.7, 0.9, 0.1, 0.4, 0.6], 0.8);

    expect(resolveEnemySpawnsForDepth(11, rng)).toEqual({
      initialEnemyCount: 8,
      spawns: [
        { type: 'skeleton', level: 3 },
        { type: 'sword', level: 2 },
        { type: 'cockatrice', level: 2 },
        { type: 'mummy', level: 1 },
        { type: 'ghost', level: 1 },
        { type: 'skeleton', level: 3 },
        { type: 'sword', level: 2 },
        { type: 'cockatrice', level: 2 },
      ],
    });
    expect(rng).toHaveBeenCalledTimes(16);
  });

  it('resolves another mid-range population tier', () => {
    const rng = sequenceRng([0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8], 0.2);

    expect(resolveEnemySpawnsForDepth(19, rng)).toEqual({
      initialEnemyCount: 9,
      spawns: [
        { type: 'ghost', level: 1 },
        { type: 'axe', level: 1 },
        { type: 'golem', level: 1 },
        { type: 'kraken', level: 1 },
        { type: 'steps', level: 1 },
        { type: 'ghost', level: 1 },
        { type: 'axe', level: 1 },
        { type: 'golem', level: 1 },
        { type: 'kraken', level: 1 },
      ],
    });
    expect(rng).toHaveBeenCalledTimes(18);
  });

  it('resolves the depth 26 boundary deterministically', () => {
    const rng = sequenceRng([0, 0.3, 0.6, 0.8, 0.2, 0.5, 0.7, 0.99, 0.1, 0.4], 0.8);

    expect(resolveEnemySpawnsForDepth(26, rng)).toEqual({
      initialEnemyCount: 10,
      spawns: [
        { type: 'axe', level: 3 },
        { type: 'golem', level: 3 },
        { type: 'kraken', level: 3 },
        { type: 'steps', level: 3 },
        { type: 'axe', level: 3 },
        { type: 'golem', level: 3 },
        { type: 'kraken', level: 3 },
        { type: 'steps', level: 3 },
        { type: 'axe', level: 3 },
        { type: 'golem', level: 3 },
      ],
    });
    expect(rng).toHaveBeenCalledTimes(20);
  });
});
