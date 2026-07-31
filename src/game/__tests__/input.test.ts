import { describe, expect, it } from 'vitest';
import { actionForKey } from '../input';

describe('input mapping', () => {
  it('maps WASD to cardinal moves', () => {
    expect(actionForKey('w')).toEqual({ type: 'move', direction: 'N' });
    expect(actionForKey('s')).toEqual({ type: 'move', direction: 'S' });
    expect(actionForKey('a')).toEqual({ type: 'move', direction: 'W' });
    expect(actionForKey('d')).toEqual({ type: 'move', direction: 'E' });
  });

  it('maps arrow keys to the same cardinal moves as WASD (Phase 08.6)', () => {
    expect(actionForKey('ArrowUp')).toEqual({ type: 'move', direction: 'N' });
    expect(actionForKey('ArrowDown')).toEqual({ type: 'move', direction: 'S' });
    expect(actionForKey('ArrowLeft')).toEqual({ type: 'move', direction: 'W' });
    expect(actionForKey('ArrowRight')).toEqual({ type: 'move', direction: 'E' });
  });

  it('maps QEZC to diagonal moves', () => {
    expect(actionForKey('q')).toEqual({ type: 'move', direction: 'NW' });
    expect(actionForKey('e')).toEqual({ type: 'move', direction: 'NE' });
    expect(actionForKey('z')).toEqual({ type: 'move', direction: 'SW' });
    expect(actionForKey('c')).toEqual({ type: 'move', direction: 'SE' });
  });

  it('maps space to wait', () => {
    expect(actionForKey(' ')).toEqual({ type: 'wait' });
  });

  it('maps x to the facing action, regardless of Shift (Phase 08.6)', () => {
    expect(actionForKey('x')).toEqual({ type: 'action' });
    expect(actionForKey('X')).toEqual({ type: 'action' });
    expect(actionForKey('x', true)).toEqual({ type: 'action' });
  });

  it('Shift+direction (WASD, arrows, QEZC) maps to face instead of move (Phase 08.6)', () => {
    expect(actionForKey('w', true)).toEqual({ type: 'face', direction: 'N' });
    expect(actionForKey('a', true)).toEqual({ type: 'face', direction: 'W' });
    expect(actionForKey('s', true)).toEqual({ type: 'face', direction: 'S' });
    expect(actionForKey('d', true)).toEqual({ type: 'face', direction: 'E' });
    expect(actionForKey('ArrowUp', true)).toEqual({ type: 'face', direction: 'N' });
    expect(actionForKey('ArrowDown', true)).toEqual({ type: 'face', direction: 'S' });
    expect(actionForKey('ArrowLeft', true)).toEqual({ type: 'face', direction: 'W' });
    expect(actionForKey('ArrowRight', true)).toEqual({ type: 'face', direction: 'E' });
    expect(actionForKey('q', true)).toEqual({ type: 'face', direction: 'NW' });
    expect(actionForKey('e', true)).toEqual({ type: 'face', direction: 'NE' });
    expect(actionForKey('z', true)).toEqual({ type: 'face', direction: 'SW' });
    expect(actionForKey('c', true)).toEqual({ type: 'face', direction: 'SE' });
  });

  it('Shift does not change the wait mapping', () => {
    expect(actionForKey(' ', true)).toEqual({ type: 'wait' });
  });

  it('returns null for unrelated keys', () => {
    expect(actionForKey('r')).toBeNull();
    expect(actionForKey('1')).toBeNull();
    expect(actionForKey('Tab')).toBeNull();
  });

  it('Shift alone (no direction/x/space key) returns null', () => {
    expect(actionForKey('Shift', true)).toBeNull();
  });
});
