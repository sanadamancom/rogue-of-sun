import { describe, expect, it } from 'vitest';
import { generateMap } from '../mapgen';
import { deriveFloorSeed, TOTAL_FLOORS } from '../floor';

describe('multi-floor robustness (run seeds 1-100, 300 floors)', () => {
  it('generates all 300 floors successfully with no shape violations', () => {
    let successes = 0;
    let failures = 0;

    for (let runSeed = 1; runSeed <= 100; runSeed++) {
      for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        const floorSeed = deriveFloorSeed(runSeed, floor);
        const result = generateMap(floorSeed);
        if (result.ok && result.map) {
          successes++;
        } else {
          failures++;
        }
      }
    }

    expect(failures).toBe(0);
    expect(successes).toBe(100 * TOTAL_FLOORS);
  });

  it('is fully deterministic: regenerating the same 100 run seeds twice yields identical results', () => {
    const first: string[] = [];
    const second: string[] = [];

    for (let runSeed = 1; runSeed <= 100; runSeed++) {
      for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        const floorSeed = deriveFloorSeed(runSeed, floor);
        const result = generateMap(floorSeed);
        first.push(JSON.stringify(result.map?.terrain ?? null));
      }
    }
    for (let runSeed = 1; runSeed <= 100; runSeed++) {
      for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        const floorSeed = deriveFloorSeed(runSeed, floor);
        const result = generateMap(floorSeed);
        second.push(JSON.stringify(result.map?.terrain ?? null));
      }
    }

    let mismatches = 0;
    for (let i = 0; i < first.length; i++) {
      if (first[i] !== second[i]) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});
