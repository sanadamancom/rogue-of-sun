import { describe, expect, it } from 'vitest';
import { canMove, createFixedMap } from '../map';
import { DIRECTION_VECTORS, ALL_DIRECTIONS } from '../types';

describe('map movement', () => {
  it('produces the correct movement vector for all 8 directions', () => {
    expect(DIRECTION_VECTORS.N).toEqual({ x: 0, y: -1 });
    expect(DIRECTION_VECTORS.S).toEqual({ x: 0, y: 1 });
    expect(DIRECTION_VECTORS.E).toEqual({ x: 1, y: 0 });
    expect(DIRECTION_VECTORS.W).toEqual({ x: -1, y: 0 });
    expect(DIRECTION_VECTORS.NE).toEqual({ x: 1, y: -1 });
    expect(DIRECTION_VECTORS.NW).toEqual({ x: -1, y: -1 });
    expect(DIRECTION_VECTORS.SE).toEqual({ x: 1, y: 1 });
    expect(DIRECTION_VECTORS.SW).toEqual({ x: -1, y: 1 });
    expect(ALL_DIRECTIONS).toHaveLength(8);
  });

  it('cannot move into map-outside tiles', () => {
    const map = createFixedMap();
    expect(canMove(map, { x: 0, y: 1 }, 'W')).toBe(false);
    expect(canMove(map, { x: 0, y: 0 }, 'N')).toBe(false);
  });

  it('cannot move into wall tiles', () => {
    const map = createFixedMap();
    expect(canMove(map, { x: 2, y: 2 }, 'E')).toBe(false);
  });

  it('can move into open floor tiles', () => {
    const map = createFixedMap();
    expect(canMove(map, { x: 1, y: 1 }, 'E')).toBe(true);
  });

  it('forbids diagonal corner-cutting when an orthogonal neighbor is a wall', () => {
    const map = createFixedMap();
    expect(canMove(map, { x: 3, y: 1 }, 'SW')).toBe(false);
  });

  it('allows diagonal movement when both orthogonal neighbors are floor', () => {
    const map = createFixedMap();
    expect(canMove(map, { x: 1, y: 1 }, 'SE')).toBe(true);
  });
});
