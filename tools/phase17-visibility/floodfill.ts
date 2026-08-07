/**
 * Phase 17.0 comparison prototype — candidate B: "permissive,
 * corner-rule-consistent flood fill". NOT used by production code. See
 * grid.ts's header comment.
 *
 * An initial implementation of this candidate attempted true recursive
 * shadowcasting (row-by-row angular-interval sweeping per octant), but a
 * hand-verified smoke test on a single-wall fixture showed it producing
 * clearly wrong results (blocking large unrelated regions of the grid
 * far from the wall) — see docs/history/phase-17-visibility-dark-
 * areas.md's section on this candidate for that finding. Rather than
 * ship an unverified, likely-buggy algorithm as a comparison baseline,
 * this candidate was replaced with a simpler approach that's easy to
 * verify correct by inspection: a breadth-first flood fill outward from
 * the origin, where a step is only allowed if it doesn't pass through a
 * blocked step — reusing this repository's *own* existing diagonal
 * corner-cutting rule (src/game/turn.ts's canMove diagonal check: a
 * diagonal step is illegal if both orthogonal cells it would cut across
 * are walls) as the permissiveness rule, rather than inventing a new
 * one. This is a member of the general "permissive FOV" family (flood
 * outward, admit a tile if *some* legal path of steps reaches it within
 * radius) rather than the angle-interval "recursive/symmetric
 * shadowcasting" family, and was chosen specifically because reusing the
 * movement engine's own corner rule gives an FOV that is visually
 * consistent with what the player can actually walk through by
 * construction, directly satisfying the comparison's "8方向移動・角抜け
 * 禁止との一貫性" criterion without needing to separately verify the two
 * systems agree.
 */
import { Grid, Point, inBounds, isWall, chebyshevDistance, pointKey } from './grid';

const DIAGONAL_STEPS: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ORTHOGONAL_STEPS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Whether stepping from `from` to `to` (one of the 8 neighbors) is a legal sight step: never through a wall corner, matching src/game/turn.ts's own diagonal move-blocking rule. */
function isLegalSightStep(grid: Grid, from: Point, to: Point): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return false;
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx !== 0 || dy !== 0) && Math.abs(dx) + Math.abs(dy) === 2) {
    // Diagonal step: both orthogonal "corner" cells must not both be walls
    // (this repo's existing canMove rule — see turn.ts).
    const cornerA = { x: from.x + dx, y: from.y };
    const cornerB = { x: from.x, y: from.y + dy };
    if (isWall(grid, cornerA) && isWall(grid, cornerB)) return false;
  }
  return true;
}

/**
 * Flood fill outward from `origin`, admitting any in-bounds tile within
 * `radius` (Chebyshev) reachable by a sequence of legal sight steps
 * (isLegalSightStep) through floor tiles. Like ray casting, a wall tile
 * itself can be the *last* step of a path (its near face is visible),
 * but the flood never continues *through* a wall tile to reach anything
 * beyond it.
 */
export function floodfillVisibility(grid: Grid, origin: Point, radius: number): Point[] {
  const visited = new Set<string>();
  visited.add(pointKey(origin));
  const queue: Point[] = [origin];

  while (queue.length > 0) {
    const current = queue.shift()!;
    // Walls terminate the flood — visible themselves, but nothing propagates further from them.
    if (isWall(grid, current) && current !== origin) continue;

    for (const [dx, dy] of [...ORTHOGONAL_STEPS, ...DIAGONAL_STEPS]) {
      const next = { x: current.x + dx, y: current.y + dy };
      if (!inBounds(grid, next)) continue;
      if (chebyshevDistance(origin, next) > radius) continue;
      const key = pointKey(next);
      if (visited.has(key)) continue;
      if (!isLegalSightStep(grid, current, next)) continue;
      visited.add(key);
      queue.push(next);
    }
  }

  return [...visited].map((key) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  });
}
