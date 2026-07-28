import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { processTurn } from '../turn';

describe('restart', () => {
  it('returns to the initial state values after progressing the game', () => {
    let state = createInitialState();
    processTurn(state, { type: 'wait' });
    processTurn(state, { type: 'wait' });
    expect(state.turn).toBe(2);

    // Restart: replace state with a freshly created one, as done in main.ts
    // when Enter is pressed.
    state = createInitialState();
    expect(state.turn).toBe(0);
    expect(state.phase).toBe('playing');
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(state.enemy.hp).toBe(state.enemy.maxHp);
    expect(state.player.alive).toBe(true);
    expect(state.enemy.alive).toBe(true);
  });
});
