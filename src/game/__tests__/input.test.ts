import { describe, expect, it } from 'vitest';
import { actionForKey } from '../input';

describe('input mapping', () => {
  it('maps WASD to cardinal moves', () => {
    expect(actionForKey('w')).toEqual({ type: 'move', direction: 'N' });
    expect(actionForKey('s')).toEqual({ type: 'move', direction: 'S' });
    expect(actionForKey('a')).toEqual({ type: 'move', direction: 'W' });
    expect(actionForKey('d')).toEqual({ type: 'move', direction: 'E' });
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

  it('returns null for unrelated keys', () => {
    expect(actionForKey('r')).toBeNull();
    expect(actionForKey('1')).toBeNull();
    expect(actionForKey('Tab')).toBeNull();
  });
});
