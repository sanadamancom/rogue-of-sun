import { Direction8, PlayerAction } from './types';

/**
 * Phase 14.5 UI/input overhaul key bindings (spec section 10). This
 * module is deliberately framework-agnostic (no DOM, no Phaser, no
 * setTimeout) so it can be unit tested with plain function calls and
 * fake timestamps — main.ts's MainScene is the only place that wires
 * real KeyboardEvents and Phaser's update(time, delta) loop to it.
 */

const CARDINAL_KEYS: Record<string, Direction8> = {
  w: 'N',
  arrowup: 'N',
  '8': 'N',
  numpad8: 'N',
  s: 'S',
  arrowdown: 'S',
  '2': 'S',
  numpad2: 'S',
  a: 'W',
  arrowleft: 'W',
  '4': 'W',
  numpad4: 'W',
  d: 'E',
  arrowright: 'E',
  '6': 'E',
  numpad6: 'E',
};

const DIAGONAL_KEYS: Record<string, Direction8> = {
  q: 'NW',
  '7': 'NW',
  numpad7: 'NW',
  e: 'NE',
  '9': 'NE',
  numpad9: 'NE',
  z: 'SW',
  '1': 'SW',
  numpad1: 'SW',
  c: 'SE',
  '3': 'SE',
  numpad3: 'SE',
};

const DIRECTION_KEYS: Record<string, Direction8> = { ...CARDINAL_KEYS, ...DIAGONAL_KEYS };

/** True for any key bound to a movement direction (cardinal or diagonal), used to detect direction-key input generically. */
export function directionForKey(key: string): Direction8 | null {
  return DIRECTION_KEYS[key.toLowerCase()] ?? null;
}

function isDiagonal(direction: Direction8): boolean {
  return direction === 'NW' || direction === 'NE' || direction === 'SW' || direction === 'SE';
}

export function isWaitKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === ' ' || k === 'space' || k === 'spacebar' || k === '5' || k === 'numpad5';
}

export function isConfirmKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === 'j' || k === 'enter';
}

export function isCancelKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === 'k' || k === 'backspace' || k === 'escape' || k === 'esc';
}

export function isMenuKey(key: string): boolean {
  const k = key.toLowerCase();
  return k === 'i' || k === 'escape' || k === 'esc';
}

export function isEnchantSwitchKey(key: string): boolean {
  return key.toLowerCase() === 'r';
}

/** New-seed restart key, only meaningful in the 'gameover' context (see routeKeyDown). */
export function isNewSeedKey(key: string): boolean {
  return key.toLowerCase() === 'n';
}

export function isTurnOnlyModifierKey(key: string): boolean {
  return key.toLowerCase() === 'f';
}

export type InputContext = 'field' | 'menu' | 'dialog' | 'gameover';

/**
 * A logical action the router decided to fire, distinct from
 * PlayerAction because some router actions are UI-only (open/close
 * menu, cursor move, confirm/back inside a menu) and never reach
 * processTurn.
 */
export type RouterAction =
  | { kind: 'game'; action: PlayerAction }
  | { kind: 'menu_open' }
  | { kind: 'menu_close' }
  | { kind: 'menu_cursor'; direction: Direction8 }
  | { kind: 'menu_confirm' }
  | { kind: 'menu_back' }
  | { kind: 'enchant_switch' }
  | { kind: 'gameover_restart_same' }
  | { kind: 'gameover_restart_new' }
  | { kind: 'gameover_dismiss_overlay' };

/**
 * Decides the single immediate action (if any) for one keydown event,
 * given the current input context and modifier state. Deliberately
 * stateless/pure with respect to *this* decision — repeat/dash/wait
 * continuation is handled separately by the tick functions below, since
 * those depend on elapsed time rather than a single keydown.
 *
 * context exclusivity (spec 11.1's "終了画面、レベルアップ、能力画面、
 * 各ダイアログでも入力先を一つに限定する"): 'field' is the only context
 * that can ever produce a `{ kind: 'game' }` PlayerAction; 'menu' only
 * ever produces menu_* actions; 'dialog' produces at most menu_confirm/
 * menu_back (dialogs reuse the same confirm/cancel keys); 'gameover'
 * produces at most gameover_restart_same/gameover_restart_new (the end
 * screen has no menu list to confirm/back through, so its own confirm
 * key restarts the same seed and 'n' starts a new one — see spec 3's
 * "Enter: 同じシードで再開　N: 新しいシードで開始" and Phase 03's
 * original Enter/N restart behavior, reconnected here after Phase 14.5's
 * router refactor dropped the wiring). Every context is otherwise inert
 * — no field action or menu-list navigation leaks through.
 */
export function routeKeyDown(
  context: InputContext,
  key: string,
  modifiers: { shiftKey: boolean; ctrlKey: boolean; fHeld: boolean },
): RouterAction | null {
  const direction = directionForKey(key);

  if (context === 'menu') {
    if (direction && !isDiagonal(direction)) return { kind: 'menu_cursor', direction };
    if (isConfirmKey(key)) return { kind: 'menu_confirm' };
    if (isCancelKey(key)) return { kind: 'menu_back' };
    if (isMenuKey(key)) return { kind: 'menu_close' };
    // Space is never menu-confirm (spec 10.2: "Spaceはメニュー決定へ
    // 割り当てない。通常プレイの待機との誤爆を避ける."), so isWaitKey is
    // intentionally not checked here.
    return null;
  }

  if (context === 'gameover') {
    // Restart keys (spec: "Enter: 同じシードで再開　N: 新しいシードで開始")
    // take priority over the generic confirm/cancel routing dialogs share,
    // since the end screen has no menu list to confirm/back through.
    if (isConfirmKey(key)) return { kind: 'gameover_restart_same' };
    if (isNewSeedKey(key)) return { kind: 'gameover_restart_new' };
    // Escape/Backspace only dismisses the DOM end-screen overlay so the
    // underlying canvas (and its Enter/N restart handling, unaffected by
    // the overlay's visibility) can be inspected directly — it never
    // changes game state or phase.
    if (isCancelKey(key)) return { kind: 'gameover_dismiss_overlay' };
    return null;
  }

  if (context === 'dialog') {
    if (isConfirmKey(key)) return { kind: 'menu_confirm' };
    if (isCancelKey(key)) return { kind: 'menu_back' };
    return null;
  }

  // context === 'field'
  if (isMenuKey(key)) return { kind: 'menu_open' };
  if (isEnchantSwitchKey(key)) return { kind: 'enchant_switch' };

  if (direction) {
    // F+direction: turn only, never moves, never consumes a turn (spec
    // 11.5). Takes priority over Shift/Ctrl if somehow held
    // simultaneously, since it's the most restrictive/explicit combo.
    if (modifiers.fHeld) {
      return { kind: 'game', action: { type: 'face', direction } };
    }
    // Ctrl+direction: diagonal-lock. Cardinal directions are ignored
    // entirely while Ctrl is held (spec 11.4: "上下左右方向は行動せず
    // 無視する"); only diagonal directions move.
    if (modifiers.ctrlKey) {
      if (!isDiagonal(direction)) return null;
      return { kind: 'game', action: { type: 'move', direction } };
    }
    // Shift+direction starts a dash — the initial step is an ordinary
    // move (dash continuation is driven by tickDash, not here).
    return { kind: 'game', action: { type: 'move', direction } };
  }

  if (isConfirmKey(key)) return { kind: 'game', action: { type: 'action' } };
  if (isWaitKey(key)) return { kind: 'game', action: { type: 'wait' } };

  return null;
}

// ---------------------------------------------------------------------
// Long-press repeat (movement) and held-key continuation (dash, wait)
// ---------------------------------------------------------------------

/** Spec 11.2's provisional timing constants, kept as named constants so a later playtest pass can retune them in one place. */
export const LONG_PRESS_START_DELAY_MS = 180;
export const LONG_PRESS_REPEAT_INTERVAL_MS = 90;

export interface RepeatTimer {
  /** Identity of what's being held (a Direction8 string, or 'wait'); null when nothing is held. */
  heldKey: string | null;
  /** Timestamp (ms) the key was first pressed down. */
  pressedAt: number;
  /** Timestamp (ms) the most recent repeat fired at (or pressedAt if none yet). */
  lastFiredAt: number;
}

export function createRepeatTimer(): RepeatTimer {
  return { heldKey: null, pressedAt: 0, lastFiredAt: 0 };
}

/** Starts (or restarts, if a different key) tracking a held key for long-press repeat, at time `now`. */
export function startRepeat(heldKey: string, now: number): RepeatTimer {
  return { heldKey, pressedAt: now, lastFiredAt: now };
}

export function stopRepeat(): RepeatTimer {
  return createRepeatTimer();
}

/**
 * Given a repeat timer and the current time, returns whether a repeat
 * should fire now, and (if so) the timer updated to reflect that firing.
 * Pure — the caller is responsible for actually dispatching the action
 * and for stopping the timer when its own stop conditions are met (wall,
 * dash-stop conditions, key released, menu opened, etc. — this function
 * only knows about elapsed time).
 */
export function tickRepeat(timer: RepeatTimer, now: number): { shouldFire: boolean; timer: RepeatTimer } {
  if (timer.heldKey === null) return { shouldFire: false, timer };
  const sinceFirstPress = now - timer.pressedAt;
  if (sinceFirstPress < LONG_PRESS_START_DELAY_MS) return { shouldFire: false, timer };
  const sinceLastFire = now - timer.lastFiredAt;
  const intervalSinceStart = timer.lastFiredAt === timer.pressedAt ? LONG_PRESS_START_DELAY_MS : LONG_PRESS_REPEAT_INTERVAL_MS;
  if (sinceLastFire < intervalSinceStart) return { shouldFire: false, timer };
  return { shouldFire: true, timer: { ...timer, lastFiredAt: now } };
}
