import { Direction8, PlayerAction } from './types';

const KEY_TO_DIRECTION: Record<string, Direction8> = {
  w: 'N',
  s: 'S',
  a: 'W',
  d: 'E',
  arrowup: 'N',
  arrowdown: 'S',
  arrowleft: 'W',
  arrowright: 'E',
  q: 'NW',
  e: 'NE',
  z: 'SW',
  c: 'SE',
};

/**
 * Maps a lowercase key string (plus whether Shift was held) to a
 * PlayerAction, or null for keys that are not part of the valid action
 * set (ignored, does not consume a turn).
 *
 * Phase 08.6 control scheme:
 * - A direction key alone -> 'move' (updates facing, then attempts to
 *   step; movement never auto-attacks).
 * - Shift + a direction key -> 'face' (updates facing only; never moves,
 *   never consumes a turn).
 * - 'x' (with or without Shift; both are treated identically per
 *   fixed_decisions.action) -> 'action' (resolves an attack in the
 *   player's current facing direction; this phase's only action).
 * - Space -> 'wait', unaffected by Shift. Since Phase 09.3a, waiting on a
 *   sunlit tile below maxSolarEnergy also recovers 1 SOL as a side
 *   effect (see turn.ts's 'wait' handling) — there is no dedicated
 *   charge key; Phase 09.3's 'v' binding was removed.
 */
export function actionForKey(key: string, shiftKey = false): PlayerAction | null {
  const lower = key.toLowerCase();
  if (lower === ' ' || lower === 'space' || lower === 'spacebar') {
    return { type: 'wait' };
  }
  if (lower === 'x') {
    return { type: 'action' };
  }
  const direction = KEY_TO_DIRECTION[lower];
  if (direction) {
    return shiftKey ? { type: 'face', direction } : { type: 'move', direction };
  }
  return null;
}
