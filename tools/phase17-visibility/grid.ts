/**
 * Phase 17.0 visibility-architecture-and-fov-comparison — comparison
 * prototype only. NOT referenced by any production entry point
 * (src/main.ts, src/game/*.ts) and NOT included in any production
 * build. Exists purely to compare candidate FOV approaches on small,
 * hand-authored fixtures ahead of a later, separate production-
 * integration decision. See docs/history/phase-17-visibility-dark-
 * areas.md for the full writeup this supports.
 *
 * No external library, dependency, or copied code is used anywhere in
 * this directory — every function here is written from scratch for
 * this comparison, using only well-known, generic algorithmic ideas
 * (Bresenham line drawing, octant-based recursive shadowcasting) that
 * predate and are independent of any specific roguelike engine or
 * library implementation.
 */

export type Cell = 'floor' | 'wall';
/** grid[y][x], matching this repository's existing GameMap.terrain convention. */
export type Grid = Cell[][];
export interface Point {
  x: number;
  y: number;
}
export interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function gridWidth(grid: Grid): number {
  return grid[0]?.length ?? 0;
}
export function gridHeight(grid: Grid): number {
  return grid.length;
}

export function inBounds(grid: Grid, p: Point): boolean {
  return p.y >= 0 && p.y < gridHeight(grid) && p.x >= 0 && p.x < gridWidth(grid);
}

export function cellAt(grid: Grid, p: Point): Cell | null {
  if (!inBounds(grid, p)) return null;
  return grid[p.y][p.x];
}

export function isWall(grid: Grid, p: Point): boolean {
  return cellAt(grid, p) === 'wall';
}

/** Parses a fixture written as an array of equal-length strings ('#'=wall, '.'=floor) into a Grid. */
export function parseGrid(rows: string[]): Grid {
  return rows.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
}

export function chebyshevDistance(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function euclideanDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointKey(p: Point): string {
  return `${p.x},${p.y}`;
}

export function sortPoints(points: Point[]): Point[] {
  return [...points].sort((a, b) => a.y - b.y || a.x - b.x);
}
