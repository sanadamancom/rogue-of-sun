import { describe, expect, it } from 'vitest';
import { advanceToNextFloor, createInitialState, trapCountForDepth } from '../state';

function stateAtDepth(runSeed: number, depth: number) {
  let state = createInitialState(runSeed);
  while (state.floor < depth) state = advanceToNextFloor(state);
  return state;
}

describe('Phase 24.6c3a2 trap depth connection', () => {
  it.each([
    [1, 2], [10, 2], [11, 3], [19, 3], [20, 4], [26, 4], [0, 2], [27, 4],
  ])('uses depth %i as %i trap slots', (depth, expected) => {
    expect(trapCountForDepth(depth)).toBe(expected);
  });

  it.each([[11, 3], [20, 4]])(
    'builds synthetic depth %i deterministically with %i traps',
    (depth, expected) => {
      const a = stateAtDepth(42, depth);
      const b = stateAtDepth(42, depth);
      expect(a.traps).toHaveLength(expected);
      expect(b.traps).toEqual(a.traps);
    },
  );
});
