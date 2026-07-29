import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';

describe('seed-based restart semantics', () => {
  it('same seed reproduces the same map and placement (Enter-restart equivalent)', () => {
    const a = createInitialState(2024);
    const b = createInitialState(2024);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.player.pos).toEqual(b.player.pos);
    expect(a.enemies.map((e) => e.pos)).toEqual(b.enemies.map((e) => e.pos));
    expect(a.exit).toEqual(b.exit);
    expect(a.seed).toBe(b.seed);
  });

  it('a different seed produces a different map or placement (N-restart equivalent)', () => {
    const a = createInitialState(2024);
    const b = createInitialState(99999);
    const identical =
      JSON.stringify(a.map.terrain) === JSON.stringify(b.map.terrain) &&
      JSON.stringify(a.player.pos) === JSON.stringify(b.player.pos) &&
      JSON.stringify(a.exit) === JSON.stringify(b.exit);
    expect(identical).toBe(false);
  });

  it('exposes the run seed and derived floor seed on state for on-screen display', () => {
    // As of Phase 03, `seed` is the *floor* seed (derived from runSeed and
    // floor number), not the run seed itself; `runSeed` identifies the run.
    const state = createInitialState(4242);
    expect(state.runSeed).toBe(4242);
    expect(typeof state.seed).toBe('number');
  });
});
