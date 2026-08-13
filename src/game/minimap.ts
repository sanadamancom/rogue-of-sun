import { TrapTile, Vec2, EnemyActor } from './types';

/**
 * One trap's minimap marker (Phase 18.2), extracted from main.ts's
 * drawMinimap so the display-eligibility/style rule can be covered by an
 * ordinary vitest test instead of only a manual/Playwright check.
 * `alpha` is the exact opacity main.ts's Graphics call already used
 * before this extraction (0.85 for revealed_untriggered's bright warning
 * mark, 0.35 for triggered_inactive's deliberately muted one) — this
 * file only names/exposes that existing choice as data, it does not
 * introduce a new visual design.
 */
export interface MinimapTrapMarker {
  pos: Vec2;
  alpha: number;
}

/** Bright warning-color alpha for a revealed_untriggered trap's minimap marker. */
export const MINIMAP_TRAP_UNTRIGGERED_ALPHA = 0.85;
/** Muted alpha for a triggered_inactive trap's minimap marker — same color, deliberately less prominent. */
export const MINIMAP_TRAP_TRIGGERED_ALPHA = 0.35;

/**
 * The minimap trap markers to draw for the *current* floor's traps only
 * (Phase 18.2 minimap rules):
 *   - `revealed=false` (hidden) traps are excluded entirely — never a
 *     marker, so nothing about their existence, type, or position leaks.
 *   - `revealed=true` traps (both revealed_untriggered and
 *     triggered_inactive) always produce a marker, regardless of
 *     exploredTiles/currently-visible/dark-room state — this function
 *     takes only `traps` as input and never reads or touches terrain,
 *     exploredTiles, or visibility data, so it cannot disclose
 *     surrounding floor/wall/room shape and cannot be made to hide a
 *     revealed trap just because the viewer's current visibility or
 *     dark-room state would otherwise dim it.
 *   - `triggered` selects `alpha` only (MINIMAP_TRAP_TRIGGERED_ALPHA vs
 *     MINIMAP_TRAP_UNTRIGGERED_ALPHA) — the two states are always
 *     distinguishable by this value; slow_trap/poison_trap deliberately
 *     produce the same marker (minimap.rules does not require
 *     distinguishing species).
 *   - Only ever reads the `traps` array passed in — since GameState.traps
 *     is rebuilt fresh per floor (buildFloorState), calling this with a
 *     newly-generated floor's `state.traps` can never surface a previous
 *     floor's markers; there is no cross-floor memory here at all.
 */
export function getMinimapTrapMarkers(traps: TrapTile[] | undefined): MinimapTrapMarker[] {
  return (traps ?? [])
    .filter((trap) => trap.revealed)
    .map((trap) => ({
      pos: trap.pos,
      alpha: trap.triggered ? MINIMAP_TRAP_TRIGGERED_ALPHA : MINIMAP_TRAP_UNTRIGGERED_ALPHA,
    }));
}

/**
 * Phase 23.4: the current floor's living steps positions to draw on the
 * minimap — but only while clairvoyance is active (`clairvoyanceActive`
 * is the sole gate; this function never reads terrain, exploredTiles,
 * or current visibility, matching getMinimapTrapMarkers' own "never
 * discloses surrounding floor/wall/room shape" contract for the same
 * reason — a location-only marker, nothing about the tiles around it).
 * Every hidden/telegraphed/revealed steps individual is included
 * identically — clairvoyance's floor-wide location reveal is
 * deliberately independent of each individual's own combat state (Phase
 * 23.4's "千里眼による可視化は表示状態だけに作用し、hidden / telegraphed
 * / revealed の戦闘状態機械を変更しない" — this function only ever reads
 * positions, never mutates or branches on stepsState). Dead steps are
 * excluded (`alive` false). Since `enemies` is rebuilt fresh per floor
 * (buildFloorState), calling this with a newly-generated floor's own
 * `state.enemies` can never surface a previous floor's markers.
 */
export function getMinimapStepsMarkers(enemies: EnemyActor[], clairvoyanceActive: boolean): Vec2[] {
  if (!clairvoyanceActive) return [];
  return enemies.filter((enemy) => enemy.type === 'steps' && enemy.alive).map((enemy) => ({ ...enemy.pos }));
}
