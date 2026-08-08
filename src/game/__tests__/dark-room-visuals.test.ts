/**
 * Phase 17.2 visibility-fix implementation_gate tests for
 * src/game/dark-room-visuals.ts (distance banding + color table). Pure
 * function tests only — main.ts's drawTerrain wiring is exercised
 * indirectly (it just looks these values up per tile), so it isn't
 * re-tested here.
 */
import { describe, expect, it } from 'vitest';
import { DARK_ROOM_FLOOR_COLOR, DARK_ROOM_WALL_COLOR, darkRoomBand } from '../dark-room-visuals';

function rgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

// Mirrors main.ts's EXPLORED_DIM_WALL_COLOR/EXPLORED_DIM_FLOOR_COLOR and
// the ordinary (non-dark) currently_visible colors, duplicated here as
// plain constants (not imported from main.ts, which isn't a testable
// module boundary) so this suite can assert the required relationships
// without depending on Phaser/Scene setup.
const EXPLORED_DIM_WALL_COLOR = 0x161616;
const EXPLORED_DIM_FLOOR_COLOR = 0x0a0a0a;
const NORMAL_VISIBLE_WALL_COLOR = 0x333333;
const NORMAL_VISIBLE_FLOOR_COLOR = 0x1c1c1c;

describe('distance: darkRoomBand', () => {
  it('distance 0 -> near', () => {
    expect(darkRoomBand(true, { x: 5, y: 5 }, { x: 5, y: 5 })).toBe('near');
  });
  it('distance 1 (orthogonal) -> near', () => {
    expect(darkRoomBand(true, { x: 5, y: 5 }, { x: 6, y: 5 })).toBe('near');
  });
  it('distance 1 (diagonal, Chebyshev) -> near', () => {
    expect(darkRoomBand(true, { x: 5, y: 5 }, { x: 6, y: 6 })).toBe('near');
  });
  it('distance 2 -> middle', () => {
    expect(darkRoomBand(true, { x: 5, y: 5 }, { x: 7, y: 5 })).toBe('middle');
  });
  it('distance 3 -> edge', () => {
    expect(darkRoomBand(true, { x: 5, y: 5 }, { x: 8, y: 5 })).toBe('edge');
  });
  it('diagonal Chebyshev boundary: dx=3,dy=1 (max=3) -> edge, not a 4th tier', () => {
    expect(darkRoomBand(true, { x: 5, y: 5 }, { x: 8, y: 6 })).toBe('edge');
  });
  it('distance 4 would not normally be reached (radius-3 FOV excludes it), but the function still returns a defined band rather than throwing', () => {
    expect(() => darkRoomBand(true, { x: 5, y: 5 }, { x: 9, y: 5 })).not.toThrow();
    expect(darkRoomBand(true, { x: 5, y: 5 }, { x: 9, y: 5 })).toBe('edge');
  });
  it('player outside the dark room always yields "outside", regardless of distance', () => {
    expect(darkRoomBand(false, { x: 5, y: 5 }, { x: 5, y: 5 })).toBe('outside');
    expect(darkRoomBand(false, { x: 0, y: 0 }, { x: 20, y: 20 })).toBe('outside');
  });
});

describe('rendering_state: color table', () => {
  const bands = ['outside', 'near', 'middle', 'edge'] as const;

  it('every band has a defined wall and floor color', () => {
    for (const band of bands) {
      expect(typeof DARK_ROOM_WALL_COLOR[band]).toBe('number');
      expect(typeof DARK_ROOM_FLOOR_COLOR[band]).toBe('number');
    }
  });

  it('wall and floor are never the same color within any band (floor/wall distinguishable)', () => {
    for (const band of bands) {
      expect(DARK_ROOM_WALL_COLOR[band]).not.toBe(DARK_ROOM_FLOOR_COLOR[band]);
    }
  });

  it('no dark-room band color equals the normal (non-dark) currently_visible colors', () => {
    for (const band of bands) {
      expect(DARK_ROOM_WALL_COLOR[band]).not.toBe(NORMAL_VISIBLE_WALL_COLOR);
      expect(DARK_ROOM_FLOOR_COLOR[band]).not.toBe(NORMAL_VISIBLE_FLOOR_COLOR);
    }
  });

  it('near/middle/edge grow strictly darker in every RGB channel (monotonic darkening, near brightest)', () => {
    const nearWall = rgb(DARK_ROOM_WALL_COLOR.near);
    const middleWall = rgb(DARK_ROOM_WALL_COLOR.middle);
    const edgeWall = rgb(DARK_ROOM_WALL_COLOR.edge);
    for (let ch = 0; ch < 3; ch++) {
      expect(nearWall[ch]).toBeGreaterThan(middleWall[ch]);
      expect(middleWall[ch]).toBeGreaterThan(edgeWall[ch]);
    }

    const nearFloor = rgb(DARK_ROOM_FLOOR_COLOR.near);
    const middleFloor = rgb(DARK_ROOM_FLOOR_COLOR.middle);
    const edgeFloor = rgb(DARK_ROOM_FLOOR_COLOR.edge);
    for (let ch = 0; ch < 3; ch++) {
      expect(nearFloor[ch]).toBeGreaterThan(middleFloor[ch]);
      expect(middleFloor[ch]).toBeGreaterThan(edgeFloor[ch]);
    }
  });

  it('near is not visually identical to normal terrain (already covered above) and is not the darkest tier', () => {
    expect(DARK_ROOM_WALL_COLOR.near).not.toBe(NORMAL_VISIBLE_WALL_COLOR);
    const nearWall = rgb(DARK_ROOM_WALL_COLOR.near);
    const edgeWall = rgb(DARK_ROOM_WALL_COLOR.edge);
    expect(nearWall[0] + nearWall[1] + nearWall[2]).toBeGreaterThan(edgeWall[0] + edgeWall[1] + edgeWall[2]);
  });

  it('edge is not the same as explored_not_visible / unexplored (every RGB channel strictly brighter)', () => {
    const edgeWall = rgb(DARK_ROOM_WALL_COLOR.edge);
    const dimWall = rgb(EXPLORED_DIM_WALL_COLOR);
    for (let ch = 0; ch < 3; ch++) expect(edgeWall[ch]).toBeGreaterThan(dimWall[ch]);

    const edgeFloor = rgb(DARK_ROOM_FLOOR_COLOR.edge);
    const dimFloor = rgb(EXPLORED_DIM_FLOOR_COLOR);
    for (let ch = 0; ch < 3; ch++) expect(edgeFloor[ch]).toBeGreaterThan(dimFloor[ch]);
  });

  it('every band has a cool (blue-dominant) hue: blue channel strictly exceeds red and green', () => {
    for (const band of bands) {
      const [r, g, b] = rgb(DARK_ROOM_WALL_COLOR[band]);
      expect(b).toBeGreaterThan(r);
      expect(b).toBeGreaterThan(g);
      const [fr, fg, fb] = rgb(DARK_ROOM_FLOOR_COLOR[band]);
      expect(fb).toBeGreaterThan(fr);
      expect(fb).toBeGreaterThan(fg);
    }
  });

  it("'outside' is a distinct, viewable tier applied to dark-room tiles seen from outside (not the same as unexplored/dim)", () => {
    const outsideWall = rgb(DARK_ROOM_WALL_COLOR.outside);
    const dimWall = rgb(EXPLORED_DIM_WALL_COLOR);
    for (let ch = 0; ch < 3; ch++) expect(outsideWall[ch]).toBeGreaterThan(dimWall[ch]);
  });

  it('wall is always brighter than floor within the same band (shape stays legible)', () => {
    for (const band of bands) {
      const wall = rgb(DARK_ROOM_WALL_COLOR[band]);
      const floor = rgb(DARK_ROOM_FLOOR_COLOR[band]);
      const wallSum = wall[0] + wall[1] + wall[2];
      const floorSum = floor[0] + floor[1] + floor[2];
      expect(wallSum).toBeGreaterThan(floorSum);
    }
  });
});
