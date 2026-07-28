import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';

describe('seed-based restart semantics', () => {
  it('same seed reproduces the same map and placement (Enter-restart equivalent)', () => {
    const a = createInitialState(2024);
    const b = createInitialState(2024);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.player.pos).toEqual(b.player.pos);
    expect(a.enemy.pos).toEqual(b.enemy.pos);
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

  it('exposes the seed on state for on-screen display', () => {
    const state = createInitialState(4242);
    expect(state.seed).toBe(4242);
  });
});
