import { describe, expect, it } from 'vitest';
import {
  getNormalEquipmentCandidates,
  RANK_WEIGHT_PROVISIONAL,
  selectNormalEquipmentDefinition,
} from '../equipment-loot';
import { createInitialState, advanceToNextFloor } from '../state';

const S_ARMOR_IDS = ['light_garb', 'dark_garb', 'spike_mail'] as const;

describe('Phase 24.6c4d: S-armor deep loot route', () => {
  it('includes exactly the 3 S armors throughout the inclusive depth 19-26 descent window', () => {
    for (let depth = 19; depth <= 26; depth++) {
      const candidates = getNormalEquipmentCandidates('armor', 0.5, { depth, leg: 'descent' });
      const sCandidates = candidates.filter((candidate) =>
        (S_ARMOR_IDS as readonly string[]).includes(candidate.definitionId),
      );
      expect(sCandidates.map((candidate) => candidate.definitionId)).toEqual(S_ARMOR_IDS);
      expect(sCandidates.every((candidate) => candidate.weight > 0)).toBe(true);
      expect(candidates).toHaveLength(14);
      expect(candidates.map((candidate) => candidate.definitionId)).not.toContain('black_armor');
    }
  });

  it.each([18, 1])('excludes all S armors at descent depth %i', (depth) => {
    const candidates = getNormalEquipmentCandidates('armor', 0.5, { depth, leg: 'descent' });
    expect(candidates).toHaveLength(11);
    expect(candidates.some((candidate) =>
      (S_ARMOR_IDS as readonly string[]).includes(candidate.definitionId),
    )).toBe(false);
  });

  it('excludes all S armors on ascent even within the depth window', () => {
    const candidates = getNormalEquipmentCandidates('armor', 0.5, { depth: 22, leg: 'ascent' });
    expect(candidates).toHaveLength(11);
    expect(candidates.some((candidate) =>
      (S_ARMOR_IDS as readonly string[]).includes(candidate.definitionId),
    )).toBe(false);
  });

  it('can select each S armor through the actual one-call weighted draw', () => {
    const ratio = 0.5;
    const context = { depth: 26, leg: 'descent' } as const;
    const candidates = getNormalEquipmentCandidates('armor', ratio, context);
    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);

    for (const expectedId of S_ARMOR_IDS) {
      const index = candidates.findIndex((candidate) => candidate.definitionId === expectedId);
      const weightBefore = candidates.slice(0, index).reduce((sum, candidate) => sum + candidate.weight, 0);
      const roll = (weightBefore + candidates[index].weight / 2) / totalWeight;
      let calls = 0;
      const selected = selectNormalEquipmentDefinition('armor', ratio, () => {
        calls++;
        return roll;
      }, context);
      expect(selected).toBe(expectedId);
      expect(calls).toBe(1);
    }
  });

  it('keeps all 3 S armors unreachable through the default three-floor production run', () => {
    for (const seed of [1, 42, 999, 2024, 12345]) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        if (floor > 1) state = advanceToNextFloor(state);
        for (const item of state.groundItems) {
          expect(S_ARMOR_IDS as readonly string[]).not.toContain(item.itemId);
        }
      }
    }
  });

  it('uses a positive provisional flat S-rank weight', () => {
    expect(RANK_WEIGHT_PROVISIONAL.S.base).toBeGreaterThan(0);
    expect(RANK_WEIGHT_PROVISIONAL.S.slope).toBe(0);
  });
});
