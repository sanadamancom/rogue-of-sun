import { createFixedMap } from './map';
import { createInitialActor } from './turn';
import { GameState } from './types';

// Fixed starting positions for Phase 01 (both on open floor tiles).
const PLAYER_START = { x: 2, y: 1 };
const ENEMY_START = { x: 7, y: 6 };

export function createInitialState(): GameState {
  return {
    map: createFixedMap(),
    player: createInitialActor(PLAYER_START, 3, 1),
    enemy: createInitialActor(ENEMY_START, 2, 1),
    turn: 0,
    phase: 'playing',
  };
}
