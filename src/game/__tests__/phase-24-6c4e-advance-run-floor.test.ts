import { describe, expect, it } from 'vitest';
import { advanceRunFloor, createInitialState } from '../state';
import type { GameState } from '../types';

const config = { totalFloors: 3, runDepthTier: 'short' as const };

function expectState(result: GameState | 'runComplete'): GameState {
  expect(result).not.toBe('runComplete');
  return result as GameState;
}

describe('Phase 24.6c4e advanceRunFloor', () => {
  it('advances to the next descent floor', () => {
    const next = expectState(advanceRunFloor(createInitialState(101, config)));
    expect(next).toMatchObject({ floor: 2, leg: 'descent', floorVisitOrdinal: 2 });
  });

  it('flips from descent to ascent at the deepest floor', () => {
    const state = createInitialState(102, config);
    state.floor = 3;
    state.floorVisitOrdinal = 3;
    const next = expectState(advanceRunFloor(state));
    expect(next).toMatchObject({ floor: 2, leg: 'ascent', floorVisitOrdinal: 4 });
  });

  it('advances an ascent floor toward the surface', () => {
    const state = createInitialState(103, config);
    state.floor = 2;
    state.leg = 'ascent';
    state.floorVisitOrdinal = 4;
    const next = expectState(advanceRunFloor(state));
    expect(next).toMatchObject({ floor: 1, leg: 'ascent', floorVisitOrdinal: 5 });
  });

  it('returns runComplete at the final ascent step', () => {
    const state = createInitialState(104, config);
    state.leg = 'ascent';
    state.floorVisitOrdinal = 5;
    expect(advanceRunFloor(state)).toBe('runComplete');
  });

  it('carries player stats, inventory, and equipped items', () => {
    const state = createInitialState(105, config);
    state.player.hp = 7;
    state.player.maxHp = 13;
    state.inventory.apple = 2;
    state.inventory.sword = 1;
    state.inventory.armor = 1;
    state.equippedWeaponId = 'sword';
    state.equippedArmorId = 'armor';

    const next = expectState(advanceRunFloor(state));
    expect(next.player).toMatchObject({ hp: 7, maxHp: 13 });
    expect(next.inventory).toMatchObject({ apple: 2, sword: 1, armor: 1 });
    expect(next).toMatchObject({ equippedWeaponId: 'sword', equippedArmorId: 'armor' });
  });
});
