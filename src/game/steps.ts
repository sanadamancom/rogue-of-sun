import { chebyshevDistance } from './visibility';
import { EnemyActor, GameMap, Vec2 } from './types';

/**
 * Phase 23.4: whether `playerPos` is within steps' detection range of
 * `enemyPos` — a pure Chebyshev-distance-1 check (fixed_spec's "感知条
 * 件は仕様どおり純粋なChebyshev距離1とする... 斜め方向の両脇が壁でも感
 * 知自体は成立する"), deliberately not corner-rule-filtered like
 * cockatrice's gaze-line legality. Used only by turn.ts's
 * resolveStepsEnemy for the hidden -> telegraphed transition.
 */
export function isStepsDetectionRange(enemyPos: Vec2, playerPos: Vec2): boolean {
  return chebyshevDistance(enemyPos, playerPos) === 1;
}

/**
 * Phase 23.4: the up-to-9 cells (center plus its 8 neighbors) a steps'
 * spike attack affects, centered on `center` — filtered to only
 * in-bounds tiles whose terrain is 'floor' (fixed_spec's "wallおよび範
 * 囲外セルには棘を生成せず、攻撃判定にも含めない"; a door/corridor tile
 * that is terrain-floor is included normally, per fixed_spec). Returned
 * in a fixed, deterministic order (row-major: y-1..y+1, x-1..x+1) so
 * every caller — range enumeration, the real hit-resolution check, and
 * telegraph rendering — enumerates identically without re-deriving the
 * order independently. Pure: never reads GameState, mutates nothing,
 * consumes no RNG.
 */
export function getStepsSpikeCells(map: GameMap, center: Vec2): Vec2[] {
  const cells: Vec2[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const pos: Vec2 = { x: center.x + dx, y: center.y + dy };
      if (pos.x < 0 || pos.y < 0 || pos.x >= map.width || pos.y >= map.height) continue;
      if (map.terrain[pos.y][pos.x] !== 'floor') continue;
      cells.push(pos);
    }
  }
  return cells;
}

/**
 * Phase 23.4: whether `enemy` (a steps) should be drawn with the
 * revealed/body sprite (steps_see.png) rather than the hidden/footprint
 * sprite (steps.png) — the single pure display-eligibility boundary
 * (fixed_spec's "表示判定をmain.ts内の複数箇所へ重複実装しない"). True
 * whenever this individual's own combat state is 'revealed', OR
 * whenever clairvoyance is active on the current floor — clairvoyance
 * never itself changes stepsState/stepsRevealTurnsRemaining (a
 * 'hidden' or 'telegraphed' steps still shows its footprint-vs-body
 * choice purely as a display override, its underlying combat state
 * machine untouched). Always false for every non-steps species. Pure:
 * takes only the two already-decided inputs, no GameState/EnemyActor[]
 * traversal, no RNG.
 */
export function shouldDisplayStepsBody(enemy: EnemyActor, clairvoyanceActive: boolean): boolean {
  if (enemy.type !== 'steps') return false;
  return enemy.stepsState === 'revealed' || clairvoyanceActive;
}
