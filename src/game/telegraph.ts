// phase-07-1-ranged-attack-telegraph (revised by
// phase-07-1-ranged-attack-telegraph-reticle-only): pure, side-effect-free
// accessors that derive what to highlight on the board for an enemy that
// is currently telegraphing a ranged attack (cockatrice's petrifying gaze
// or kraken's tentacle strike). Each getter returns only the single fixed
// target tile the reticle is drawn at — never the full ray/cross-area —
// so the renderer cannot show the complete hit area. The underlying
// attack-range/hit-detection functions (castGazeRay, tentacleCrossCells)
// are untouched and still exported from turn.ts for turn.ts's own use;
// this file simply no longer re-exposes their full output to the
// renderer. Nothing here reads or infers from behaviorType — each getter
// only looks at the one per-species field it cares about (gazeDirection +
// gazeTargetTile / tentacleTarget).
import { EnemyActor, GameMap, Vec2 } from './types';
import { getStepsSpikeCells } from './steps';

export interface CockatriceTelegraph {
  enemy: EnemyActor;
  /** The tile the player occupied at the moment aiming started — fixed, never re-derived from the player's current position. */
  targetTile: Vec2;
}

export interface KrakenTelegraph {
  enemy: EnemyActor;
  /** The telegraphed strike's center tile — fixed, never re-derived from the player's current position. */
  center: Vec2;
}

/**
 * Phase 23.2 golem charge redesign: mirrors CockatriceTelegraph/
 * KrakenTelegraph's shape exactly — the single fixed target tile a
 * telegraphed golem's charge is aimed at (the player's position at the
 * moment telegraphing started), never the full multi-tile charge path.
 */
export interface GolemChargeTelegraph {
  enemy: EnemyActor;
  /** The tile the player occupied when telegraphing started — fixed, never re-derived from the player's current position. */
  targetTile: Vec2;
}

/**
 * Phase 23.4: steps' fixed 3x3 spike-attack telegraph — `center` is the
 * fixed attack-origin tile (never re-derived from anyone's current
 * position), `cells` is the up-to-9 floor tiles actually affected
 * (already wall/map-edge-filtered by getStepsSpikeCells).
 */
export interface StepsTelegraph {
  enemy: EnemyActor;
  center: Vec2;
  cells: Vec2[];
}

/**
 * Returns the current petrifying-gaze telegraph target tile for `enemy`,
 * or null if it is not currently aiming — including after it has fired
 * (turn.ts clears both gazeDirection and gazeTargetTile the same turn it
 * resolves the shot, win or miss) and before it has ever aimed.
 */
export function getCockatriceTelegraph(_map: GameMap, enemy: EnemyActor): CockatriceTelegraph | null {
  if (!enemy.gazeDirection || !enemy.gazeTargetTile) return null;
  return { enemy, targetTile: enemy.gazeTargetTile };
}

/**
 * Returns the current tentacle-strike telegraph center tile for `enemy`,
 * or null if it is not currently telegraphing — including after it has
 * struck (turn.ts clears tentacleTarget the same turn it resolves the
 * strike, win or miss) and before it has ever telegraphed.
 */
export function getKrakenTelegraph(_map: GameMap, enemy: EnemyActor): KrakenTelegraph | null {
  if (!enemy.tentacleTarget) return null;
  return { enemy, center: enemy.tentacleTarget };
}

/**
 * Returns the current golem-charge telegraph target tile for `enemy`,
 * or null if it is not currently telegraphed — including after it has
 * charged (turn.ts clears both golemChargeDirection and
 * golemChargeTargetTile the same turn it executes the charge, and
 * transitions golemChargeState away from 'telegraphed') and before it
 * has ever telegraphed.
 */
export function getGolemChargeTelegraph(_map: GameMap, enemy: EnemyActor): GolemChargeTelegraph | null {
  if (enemy.golemChargeState !== 'telegraphed' || !enemy.golemChargeTargetTile) return null;
  return { enemy, targetTile: enemy.golemChargeTargetTile };
}

/**
 * Phase 23.4: steps' 3x3 spike-attack telegraph — unlike every other
 * telegraph getter above (which return a single fixed target tile),
 * this one also returns the full up-to-9 affected floor cells
 * (getStepsSpikeCells, shared with the real hit-resolution logic in
 * turn.ts), since fixed_spec explicitly requires warning the player
 * about the whole avoidable area rather than a single reticle point.
 * Returns null when `enemy` isn't a currently-telegraphed, living steps
 * with a fixed center (dead, wrong species, wrong state, or missing
 * center — defensive, shouldn't normally happen given turn.ts always
 * sets/clears both together).
 */
export function getStepsTelegraph(map: GameMap, enemy: EnemyActor): StepsTelegraph | null {
  if (enemy.type !== 'steps' || !enemy.alive) return null;
  if (enemy.stepsState !== 'telegraphed' || !enemy.stepsTelegraphCenter) return null;
  return { enemy, center: enemy.stepsTelegraphCenter, cells: getStepsSpikeCells(map, enemy.stepsTelegraphCenter) };
}
