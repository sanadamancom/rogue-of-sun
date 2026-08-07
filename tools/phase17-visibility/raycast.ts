/**
 * Phase 17.0 comparison prototype — candidate A: "ray casting".
 * NOT used by production code. See grid.ts's header comment.
 *
 * For every tile within `radius` (Chebyshev, matching this repo's
 * existing 8-direction movement/chase distance convention), draws a
 * single integer line (Bresenham's algorithm) from the origin to that
 * tile and marks it visible only if no *other* wall tile lies strictly
 * between the origin and it. A wall tile itself is visible (you can see
 * the wall's near face) but nothing beyond it along that same line.
 *
 * This is the classic, simplest FOV approach. Its well-known weakness is
 * asymmetry: because each target tile gets its own independently-drawn
 * line, whether A can see B and whether B can see A are not guaranteed
 * to agree near diagonal wall corners — the same integer-rounding choice
 * that makes a given line "hug" one side of a corner differs depending
 * on which endpoint the line started from. It also tends to produce
 * thin, inconsistent gaps of missed tiles near corners because a single
 * line per target tile does not naturally fill the tile's full angular
 * width the way an angle-sweep does.
 */
import { Grid, Point, inBounds, isWall, chebyshevDistance } from './grid';

/** Bresenham's line algorithm: every integer grid cell from `from` to `to`, inclusive of both endpoints. */
function bresenhamLine(from: Point, to: Point): Point[] {
  const points: Point[] = [];
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return points;
}

function hasClearLineOfSight(grid: Grid, origin: Point, target: Point): boolean {
  const line = bresenhamLine(origin, target);
  // Every point strictly between origin and target must not be a wall.
  // The target itself may be a wall (its near face is visible); origin
  // is always visible by definition.
  for (let i = 1; i < line.length - 1; i++) {
    if (isWall(grid, line[i])) return false;
  }
  return true;
}

export function raycastVisibility(grid: Grid, origin: Point, radius: number): Point[] {
  const result: Point[] = [];
  for (let y = origin.y - radius; y <= origin.y + radius; y++) {
    for (let x = origin.x - radius; x <= origin.x + radius; x++) {
      const p = { x, y };
      if (!inBounds(grid, p)) continue;
      if (chebyshevDistance(origin, p) > radius) continue;
      if (hasClearLineOfSight(grid, origin, p)) result.push(p);
    }
  }
  return result;
}
