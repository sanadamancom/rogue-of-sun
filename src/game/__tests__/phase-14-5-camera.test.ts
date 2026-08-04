import { describe, expect, it } from 'vitest';
import { computeCameraWindow, isWithinCameraWindow, CAMERA_VIEW_WIDTH, CAMERA_VIEW_HEIGHT } from '../camera';

describe('Phase 14.5 UI overhaul: computeCameraWindow', () => {
  const MAP_W = 40;
  const MAP_H = 30;

  it('uses a 9x7 window by default', () => {
    const w = computeCameraWindow({ x: 20, y: 15 }, MAP_W, MAP_H);
    expect(w.width).toBe(CAMERA_VIEW_WIDTH);
    expect(w.height).toBe(CAMERA_VIEW_HEIGHT);
  });

  it('centers the player away from any edge', () => {
    const w = computeCameraWindow({ x: 20, y: 15 }, MAP_W, MAP_H);
    // 9 wide -> 4 tiles to each side of center; 7 tall -> 3 tiles each side.
    expect(w.x0).toBe(20 - 4);
    expect(w.y0).toBe(15 - 3);
  });

  it('clamps at the left edge (x=0)', () => {
    const w = computeCameraWindow({ x: 0, y: 15 }, MAP_W, MAP_H);
    expect(w.x0).toBe(0);
  });

  it('clamps at the right edge (x=mapWidth-1)', () => {
    const w = computeCameraWindow({ x: MAP_W - 1, y: 15 }, MAP_W, MAP_H);
    expect(w.x0).toBe(MAP_W - CAMERA_VIEW_WIDTH);
  });

  it('clamps at the top edge (y=0)', () => {
    const w = computeCameraWindow({ x: 20, y: 0 }, MAP_W, MAP_H);
    expect(w.y0).toBe(0);
  });

  it('clamps at the bottom edge (y=mapHeight-1)', () => {
    const w = computeCameraWindow({ x: 20, y: MAP_H - 1 }, MAP_W, MAP_H);
    expect(w.y0).toBe(MAP_H - CAMERA_VIEW_HEIGHT);
  });

  it('clamps correctly at all four corners', () => {
    const topLeft = computeCameraWindow({ x: 0, y: 0 }, MAP_W, MAP_H);
    expect(topLeft.x0).toBe(0);
    expect(topLeft.y0).toBe(0);

    const topRight = computeCameraWindow({ x: MAP_W - 1, y: 0 }, MAP_W, MAP_H);
    expect(topRight.x0).toBe(MAP_W - CAMERA_VIEW_WIDTH);
    expect(topRight.y0).toBe(0);

    const bottomLeft = computeCameraWindow({ x: 0, y: MAP_H - 1 }, MAP_W, MAP_H);
    expect(bottomLeft.x0).toBe(0);
    expect(bottomLeft.y0).toBe(MAP_H - CAMERA_VIEW_HEIGHT);

    const bottomRight = computeCameraWindow({ x: MAP_W - 1, y: MAP_H - 1 }, MAP_W, MAP_H);
    expect(bottomRight.x0).toBe(MAP_W - CAMERA_VIEW_WIDTH);
    expect(bottomRight.y0).toBe(MAP_H - CAMERA_VIEW_HEIGHT);
  });

  it('never returns a window smaller than 0 or exceeding the map bounds', () => {
    for (let x = 0; x < MAP_W; x += 3) {
      for (let y = 0; y < MAP_H; y += 3) {
        const w = computeCameraWindow({ x, y }, MAP_W, MAP_H);
        expect(w.x0).toBeGreaterThanOrEqual(0);
        expect(w.y0).toBeGreaterThanOrEqual(0);
        expect(w.x0 + w.width).toBeLessThanOrEqual(MAP_W);
        expect(w.y0 + w.height).toBeLessThanOrEqual(MAP_H);
      }
    }
  });

  it('clamps window size to the map when the map is smaller than the requested view', () => {
    const w = computeCameraWindow({ x: 2, y: 1 }, 5, 3);
    expect(w.width).toBe(5);
    expect(w.height).toBe(3);
    expect(w.x0).toBe(0);
    expect(w.y0).toBe(0);
  });

  it('does not mutate its inputs', () => {
    const pos = { x: 20, y: 15 };
    const before = { ...pos };
    computeCameraWindow(pos, MAP_W, MAP_H);
    expect(pos).toEqual(before);
  });
});

describe('Phase 14.5 UI overhaul: isWithinCameraWindow', () => {
  it('true for a tile inside the window', () => {
    const w = { x0: 5, y0: 5, width: 9, height: 7 };
    expect(isWithinCameraWindow({ x: 8, y: 8 }, w)).toBe(true);
  });

  it('true at the window edges (inclusive)', () => {
    const w = { x0: 5, y0: 5, width: 9, height: 7 };
    expect(isWithinCameraWindow({ x: 5, y: 5 }, w)).toBe(true);
    expect(isWithinCameraWindow({ x: 13, y: 11 }, w)).toBe(true);
  });

  it('false just outside the window', () => {
    const w = { x0: 5, y0: 5, width: 9, height: 7 };
    expect(isWithinCameraWindow({ x: 14, y: 8 }, w)).toBe(false);
    expect(isWithinCameraWindow({ x: 4, y: 8 }, w)).toBe(false);
    expect(isWithinCameraWindow({ x: 8, y: 12 }, w)).toBe(false);
    expect(isWithinCameraWindow({ x: 8, y: 4 }, w)).toBe(false);
  });
});
