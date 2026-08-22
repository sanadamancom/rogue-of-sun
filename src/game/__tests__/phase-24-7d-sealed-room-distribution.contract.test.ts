import { expect, it } from 'vitest';
import { runSealedRoomDistributionAudit } from '../generation-audit';

it('audits sealed-room occurrence and structural attainability across seeds 1 through 1000', () => {
  let seedsWithSealedRoom = 0;
  const violations: Array<{ seed: number; violation: string }> = [];

  for (let seed = 1; seed <= 1000; seed++) {
    const result = runSealedRoomDistributionAudit(seed);
    if (result.generatedFloors.length > 0) seedsWithSealedRoom++;
    for (const violation of result.structuralViolations) violations.push({ seed, violation });
    expect(result.generatedFloors.length).toBeLessThanOrEqual(1);
    for (const floor of result.generatedFloors) {
      expect(floor.candidateRoomIndices).toContain(floor.roomIndex);
    }
  }

  const occurrenceRate = seedsWithSealedRoom / 1000;
  expect(Number.isFinite(occurrenceRate)).toBe(true);
  expect(occurrenceRate).toBeGreaterThan(0);
  expect(occurrenceRate).toBeLessThan(1);
  expect(violations).toEqual([]);
});
