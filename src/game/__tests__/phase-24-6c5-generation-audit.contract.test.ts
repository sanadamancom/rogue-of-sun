import { expect, it } from 'vitest';
import { runAscentGenerationAudit, runDescentGenerationAudit } from '../generation-audit';

it('finds no layer A generation violations across seeds 1 through 1000', () => {
  const violations = [];

  for (let runSeed = 1; runSeed <= 1000; runSeed++) {
    const descent = runDescentGenerationAudit(runSeed);
    const ascent = runAscentGenerationAudit(runSeed);

    for (const [leg, result] of [
      ['descent', descent],
      ['ascent', ascent],
    ] as const) {
      for (const floor of result.floors) {
        for (const violation of floor.violations) {
          violations.push({ runSeed, leg, depth: floor.depth, violation });
        }
      }
    }
  }

  expect(violations).toEqual([]);
}, 300_000);
