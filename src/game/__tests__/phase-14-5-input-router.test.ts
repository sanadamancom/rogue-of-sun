import { describe, expect, it } from 'vitest';
import {
  routeKeyDown,
  directionForKey,
  isWaitKey,
  isConfirmKey,
  isCancelKey,
  isMenuKey,
  isEnchantSwitchKey,
  createRepeatTimer,
  startRepeat,
  stopRepeat,
  tickRepeat,
  LONG_PRESS_START_DELAY_MS,
  LONG_PRESS_REPEAT_INTERVAL_MS,
} from '../input-router';

describe('Phase 14.5 UI overhaul: key normalization', () => {
  it('maps WASD to cardinal directions', () => {
    expect(directionForKey('w')).toBe('N');
    expect(directionForKey('s')).toBe('S');
    expect(directionForKey('a')).toBe('W');
    expect(directionForKey('d')).toBe('E');
  });

  it('maps arrow keys to cardinal directions', () => {
    expect(directionForKey('ArrowUp')).toBe('N');
    expect(directionForKey('ArrowDown')).toBe('S');
    expect(directionForKey('ArrowLeft')).toBe('W');
    expect(directionForKey('ArrowRight')).toBe('E');
  });

  it('maps numpad 8246 to cardinal directions', () => {
    expect(directionForKey('8')).toBe('N');
    expect(directionForKey('2')).toBe('S');
    expect(directionForKey('4')).toBe('W');
    expect(directionForKey('6')).toBe('E');
  });

  it('maps QEZC to diagonal directions', () => {
    expect(directionForKey('q')).toBe('NW');
    expect(directionForKey('e')).toBe('NE');
    expect(directionForKey('z')).toBe('SW');
    expect(directionForKey('c')).toBe('SE');
  });

  it('maps numpad 7913 to diagonal directions', () => {
    expect(directionForKey('7')).toBe('NW');
    expect(directionForKey('9')).toBe('NE');
    expect(directionForKey('1')).toBe('SW');
    expect(directionForKey('3')).toBe('SE');
  });

  it('recognizes wait keys (Space, numpad5)', () => {
    expect(isWaitKey(' ')).toBe(true);
    expect(isWaitKey('Space')).toBe(true);
    expect(isWaitKey('5')).toBe(true);
    expect(isWaitKey('numpad5')).toBe(true);
    expect(isWaitKey('w')).toBe(false);
  });

  it('recognizes confirm keys (J, Enter)', () => {
    expect(isConfirmKey('j')).toBe(true);
    expect(isConfirmKey('Enter')).toBe(true);
    expect(isConfirmKey('k')).toBe(false);
  });

  it('recognizes cancel keys (K, Backspace, Esc)', () => {
    expect(isCancelKey('k')).toBe(true);
    expect(isCancelKey('Backspace')).toBe(true);
    expect(isCancelKey('Escape')).toBe(true);
    expect(isCancelKey('j')).toBe(false);
  });

  it('recognizes the menu key (I, Esc)', () => {
    expect(isMenuKey('i')).toBe(true);
    expect(isMenuKey('Escape')).toBe(true);
    expect(isMenuKey('m')).toBe(false);
  });

  it('recognizes the enchant switch key (R)', () => {
    expect(isEnchantSwitchKey('r')).toBe(true);
    expect(isEnchantSwitchKey('f')).toBe(false);
  });

  it('returns null for unrelated keys', () => {
    expect(directionForKey('p')).toBeNull();
  });
});

describe('Phase 14.5 UI overhaul: routeKeyDown (field context)', () => {
  const noMods = { shiftKey: false, ctrlKey: false, fHeld: false };

  it('plain direction key -> move', () => {
    const result = routeKeyDown('field', 'w', noMods);
    expect(result).toEqual({ kind: 'game', action: { type: 'move', direction: 'N' } });
  });

  it('Shift+direction -> move (dash continuation handled separately)', () => {
    const result = routeKeyDown('field', 'w', { ...noMods, shiftKey: true });
    expect(result).toEqual({ kind: 'game', action: { type: 'move', direction: 'N' } });
  });

  it('Ctrl+diagonal -> move', () => {
    const result = routeKeyDown('field', 'q', { ...noMods, ctrlKey: true });
    expect(result).toEqual({ kind: 'game', action: { type: 'move', direction: 'NW' } });
  });

  it('Ctrl+cardinal -> ignored (null), per diagonal-lock semantics', () => {
    const result = routeKeyDown('field', 'w', { ...noMods, ctrlKey: true });
    expect(result).toBeNull();
  });

  it('F+direction -> face only, never move', () => {
    const result = routeKeyDown('field', 'w', { ...noMods, fHeld: true });
    expect(result).toEqual({ kind: 'game', action: { type: 'face', direction: 'N' } });
  });

  it('F held takes priority over Ctrl held simultaneously', () => {
    const result = routeKeyDown('field', 'q', { ...noMods, fHeld: true, ctrlKey: true });
    expect(result).toEqual({ kind: 'game', action: { type: 'face', direction: 'NW' } });
  });

  it('J/Enter -> attack action', () => {
    expect(routeKeyDown('field', 'j', noMods)).toEqual({ kind: 'game', action: { type: 'action' } });
    expect(routeKeyDown('field', 'Enter', noMods)).toEqual({ kind: 'game', action: { type: 'action' } });
  });

  it('Space -> wait action', () => {
    expect(routeKeyDown('field', ' ', noMods)).toEqual({ kind: 'game', action: { type: 'wait' } });
  });

  it('I/Esc -> menu_open', () => {
    expect(routeKeyDown('field', 'i', noMods)).toEqual({ kind: 'menu_open' });
    expect(routeKeyDown('field', 'Escape', noMods)).toEqual({ kind: 'menu_open' });
  });

  it('R -> enchant_switch', () => {
    expect(routeKeyDown('field', 'r', noMods)).toEqual({ kind: 'enchant_switch' });
  });

  it('unrelated keys -> null', () => {
    expect(routeKeyDown('field', 'p', noMods)).toBeNull();
  });
});

describe('Phase 14.5 UI overhaul: routeKeyDown (menu context)', () => {
  const noMods = { shiftKey: false, ctrlKey: false, fHeld: false };

  it('cardinal direction -> menu_cursor', () => {
    expect(routeKeyDown('menu', 'w', noMods)).toEqual({ kind: 'menu_cursor', direction: 'N' });
  });

  it('diagonal direction -> not routed as menu_cursor (only cardinal cursor movement)', () => {
    expect(routeKeyDown('menu', 'q', noMods)).toBeNull();
  });

  it('J/Enter -> menu_confirm', () => {
    expect(routeKeyDown('menu', 'j', noMods)).toEqual({ kind: 'menu_confirm' });
  });

  it('K/Backspace -> menu_back', () => {
    expect(routeKeyDown('menu', 'k', noMods)).toEqual({ kind: 'menu_back' });
  });

  it('Esc -> menu_back (not menu_close, since Esc is also the cancel key)', () => {
    // Esc is checked as isCancelKey before isMenuKey in menu context, so
    // at any menu depth, Esc backs out one level; the caller (main.ts)
    // treats menu_back at the top level as equivalent to closing.
    expect(routeKeyDown('menu', 'Escape', noMods)).toEqual({ kind: 'menu_back' });
  });

  it('I -> menu_close', () => {
    expect(routeKeyDown('menu', 'i', noMods)).toEqual({ kind: 'menu_close' });
  });

  it('Space is never menu_confirm (avoids the field-wait key clashing)', () => {
    expect(routeKeyDown('menu', ' ', noMods)).toBeNull();
  });

  it('field-only actions (attack/wait/enchant-switch keys other than space) do not leak into menu routing', () => {
    expect(routeKeyDown('menu', 'r', noMods)).toBeNull();
  });
});

describe('Phase 14.5 UI overhaul: routeKeyDown (dialog / gameover context)', () => {
  const noMods = { shiftKey: false, ctrlKey: false, fHeld: false };

  it('dialog: only confirm and cancel are routed', () => {
    expect(routeKeyDown('dialog', 'j', noMods)).toEqual({ kind: 'menu_confirm' });
    expect(routeKeyDown('dialog', 'k', noMods)).toEqual({ kind: 'menu_back' });
    expect(routeKeyDown('dialog', 'w', noMods)).toBeNull();
    expect(routeKeyDown('dialog', ' ', noMods)).toBeNull();
  });

  it('gameover: Enter/j restarts the same seed, N starts a new seed, Escape dismisses the overlay only, no field or menu actions leak through (playtest-blocking fix)', () => {
    expect(routeKeyDown('gameover', 'j', noMods)).toEqual({ kind: 'gameover_restart_same' });
    expect(routeKeyDown('gameover', 'Enter', noMods)).toEqual({ kind: 'gameover_restart_same' });
    expect(routeKeyDown('gameover', 'n', noMods)).toEqual({ kind: 'gameover_restart_new' });
    expect(routeKeyDown('gameover', 'N', noMods)).toEqual({ kind: 'gameover_restart_new' });
    expect(routeKeyDown('gameover', 'Escape', noMods)).toEqual({ kind: 'gameover_dismiss_overlay' });
    expect(routeKeyDown('gameover', 'k', noMods)).toEqual({ kind: 'gameover_dismiss_overlay' });
    expect(routeKeyDown('gameover', 'w', noMods)).toBeNull();
    expect(routeKeyDown('gameover', 'i', noMods)).toBeNull();
  });
});

describe('Phase 14.5 UI overhaul: repeat timer (long-press movement/dash/wait)', () => {
  it('does not fire before the start delay has elapsed', () => {
    const timer = startRepeat('N', 1000);
    const { shouldFire } = tickRepeat(timer, 1000 + LONG_PRESS_START_DELAY_MS - 1);
    expect(shouldFire).toBe(false);
  });

  it('fires exactly at the start delay', () => {
    const timer = startRepeat('N', 1000);
    const { shouldFire } = tickRepeat(timer, 1000 + LONG_PRESS_START_DELAY_MS);
    expect(shouldFire).toBe(true);
  });

  it('does not fire again until the repeat interval has elapsed after the first repeat', () => {
    let timer = startRepeat('N', 1000);
    const first = tickRepeat(timer, 1000 + LONG_PRESS_START_DELAY_MS);
    expect(first.shouldFire).toBe(true);
    timer = first.timer;
    const tooSoon = tickRepeat(timer, 1000 + LONG_PRESS_START_DELAY_MS + LONG_PRESS_REPEAT_INTERVAL_MS - 1);
    expect(tooSoon.shouldFire).toBe(false);
  });

  it('fires repeatedly at the interval cadence after the first repeat', () => {
    let timer = startRepeat('N', 1000);
    let now = 1000 + LONG_PRESS_START_DELAY_MS;
    const r1 = tickRepeat(timer, now);
    expect(r1.shouldFire).toBe(true);
    timer = r1.timer;

    now += LONG_PRESS_REPEAT_INTERVAL_MS;
    const r2 = tickRepeat(timer, now);
    expect(r2.shouldFire).toBe(true);
    timer = r2.timer;

    now += LONG_PRESS_REPEAT_INTERVAL_MS;
    const r3 = tickRepeat(timer, now);
    expect(r3.shouldFire).toBe(true);
  });

  it('a fresh (never-started) timer never fires', () => {
    const timer = createRepeatTimer();
    const { shouldFire } = tickRepeat(timer, 999999);
    expect(shouldFire).toBe(false);
  });

  it('stopRepeat resets to a non-firing state', () => {
    let timer = startRepeat('N', 1000);
    timer = stopRepeat();
    const { shouldFire } = tickRepeat(timer, 1000 + 100000);
    expect(shouldFire).toBe(false);
  });

  it('does not mutate the timer object passed in (pure)', () => {
    const timer = startRepeat('N', 1000);
    const before = { ...timer };
    tickRepeat(timer, 1000 + LONG_PRESS_START_DELAY_MS);
    expect(timer).toEqual(before);
  });
});
