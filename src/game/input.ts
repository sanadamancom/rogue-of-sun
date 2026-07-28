import { Direction8, PlayerAction } from './types';

const KEY_TO_DIRECTION: Record<string, Direction8> = {
  w: 'N',
  s: 'S',
  a: 'W',
  d: 'E',
  q: 'NW',
  e: 'NE',
  z: 'SW',
  c: 'SE',
};

/**
 * Maps a lowercase key string to a PlayerAction, or null for keys that
 * are not part of the valid action set (ignored, does not consume a turn).
 */
export function actionForKey(key: string): PlayerAction | null {
  const lower = key.toLowerCase();
  if (lower === ' ' || lower === 'space' || lower === 'spacebar') {
    return { type: 'wait' };
  }
  const direction = KEY_TO_DIRECTION[lower];
  if (direction) {
    return { type: 'move', direction };
  }
  return null;
}
