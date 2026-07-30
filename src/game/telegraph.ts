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
