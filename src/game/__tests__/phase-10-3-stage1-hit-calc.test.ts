import { describe, expect, it } from 'vitest';
import { computeHitChance, MIN_HIT_CHANCE, MAX_HIT_CHANCE, resolvesAsHit } from '../combat';
import { mulberry32Step, rollPercent } from '../rng';

describe('computeHitChance (Phase 10.3)', () => {
  it('computes a normal in-range value with no clamping', () => {
    expect(computeHitChance(90, 5, 0)).toBe(95);
    expect(computeHitChance(90, -5, 0)).toBe(85);
    expect(computeHitChance(90, 0, 10)).toBe(80);
  });

  it('clamps to MIN_HIT_CHANCE (5) when the raw value is very low', () => {
    expect(computeHitChance(10, -20, 50)).toBe(MIN_HIT_CHANCE);
    expect(computeHitChance(0, 0, 0)).toBe(MIN_HIT_CHANCE);
  });

  it('clamps to MAX_HIT_CHANCE (95) when the raw value is very high', () => {
    expect(computeHitChance(200, 0, 0)).toBe(MAX_HIT_CHANCE);
    expect(computeHitChance(90, 20, 0)).toBe(MAX_HIT_CHANCE);
  });

  it('never returns a value outside [MIN_HIT_CHANCE, MAX_HIT_CHANCE] across a wide input sweep', () => {
    for (let acc = -50; acc <= 150; acc += 10) {
      for (let mod = -30; mod <= 30; mod += 10) {
        for (let eva = -50; eva <= 150; eva += 10) {
          const chance = computeHitChance(acc, mod, eva);
          expect(chance).toBeGreaterThanOrEqual(MIN_HIT_CHANCE);
          expect(chance).toBeLessThanOrEqual(MAX_HIT_CHANCE);
        }
      }
    }
  });
});

describe('resolvesAsHit boundary rules (Phase 10.3)', () => {
  it('a roll strictly less than hitChance is a hit', () => {
    expect(resolvesAsHit(0, 95)).toBe(true);
    expect(resolvesAsHit(94, 95)).toBe(true);
    expect(resolvesAsHit(4, 5)).toBe(true);
  });

  it('a roll equal to hitChance is a miss (not a hit)', () => {
    expect(resolvesAsHit(95, 95)).toBe(false);
    expect(resolvesAsHit(5, 5)).toBe(false);
  });

  it('a roll greater than hitChance is a miss', () => {
    expect(resolvesAsHit(99, 95)).toBe(false);
    expect(resolvesAsHit(50, 5)).toBe(false);
  });

  it('hitChance 95 hits on exactly 95 of the 100 possible roll values (0-94)', () => {
    let hits = 0;
    for (let roll = 0; roll < 100; roll++) {
      if (resolvesAsHit(roll, 95)) hits++;
    }
    expect(hits).toBe(95);
  });

  it('hitChance 5 hits on exactly 5 of the 100 possible roll values (0-4)', () => {
    let hits = 0;
    for (let roll = 0; roll < 100; roll++) {
      if (resolvesAsHit(roll, 5)) hits++;
    }
    expect(hits).toBe(5);
  });
});

describe('combat RNG stream (rng.ts, Phase 10.3)', () => {
  it('mulberry32Step is pure and deterministic: same state in, same output out', () => {
    const a = mulberry32Step(12345);
    const b = mulberry32Step(12345);
    expect(a).toEqual(b);
  });

  it('rollPercent always returns an integer in [0, 99]', () => {
    let state = 1;
    for (let i = 0; i < 500; i++) {
      const { roll, nextState } = rollPercent(state);
      expect(Number.isInteger(roll)).toBe(true);
      expect(roll).toBeGreaterThanOrEqual(0);
      expect(roll).toBeLessThanOrEqual(99);
      state = nextState;
    }
  });

  it('the same starting state produces the same sequence of rolls', () => {
    function sequence(seed: number, count: number): number[] {
      let s = seed;
      const rolls: number[] = [];
      for (let i = 0; i < count; i++) {
        const { roll, nextState } = rollPercent(s);
        rolls.push(roll);
        s = nextState;
      }
      return rolls;
    }
    expect(sequence(777, 20)).toEqual(sequence(777, 20));
  });

  it('different starting states produce different sequences (in general)', () => {
    function sequence(seed: number, count: number): number[] {
      let s = seed;
      const rolls: number[] = [];
      for (let i = 0; i < count; i++) {
        const { roll, nextState } = rollPercent(s);
        rolls.push(roll);
        s = nextState;
      }
      return rolls;
    }
    expect(sequence(1, 20)).not.toEqual(sequence(2, 20));
  });
});
