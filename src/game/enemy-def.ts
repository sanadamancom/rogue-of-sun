import { EnemyType } from './types';

/**
 * behaviorType: AI dispatch key used by turn.ts.
 *
 * - 'generic_melee': bok's 8-direction chase-and-attack (baseline; also the
 *   temporary fallback for 'placeholder' species below).
 * - 'spider_cardinal': spider's 4-direction-only chase-and-attack.
 * - 'slow_melee' (golem, Phase enemy-behavior-01): acts every other enemy
 *   turn (its very first enemy turn on a floor is always an acting turn),
 *   waiting in place — even if adjacent to the player — on its off turns.
 * - 'fast_melee' (sword, Phase enemy-behavior-01): attacks immediately if
 *   already adjacent; otherwise attempts up to 2 steps toward the player in
 *   one enemy turn, re-evaluating the board after each step, attacking (and
 *   stopping) only if it becomes adjacent after the first step — becoming
 *   adjacent only after the second step does not trigger an attack that
 *   turn.
 * - 'recovery_melee' (axe, Phase enemy-behavior-01): attacks normally, but
 *   the enemy turn immediately following an attack is always a forced wait
 *   (no movement, no attack) via the `recovering` per-enemy flag, after
 *   which it returns to normal behavior. Moving without attacking never
 *   triggers recovery.
 * - 'placeholder': reserved fallback for any future species with no
 *   finished signature AI yet; routed to 'generic_melee' so such a species
 *   would be a playable placeholder rather than an inert prop. No current
 *   species uses this (every roster species now has a finished
 *   behaviorType as of phase-06-cockatrice-petrifying-gaze). This
 *   indirection lives in one place (turn.ts's resolveOneEnemy) so wiring
 *   in real behavior for a future species does not require touching
 *   spawning or rendering.
 * - 'bat_retreat' (bat, Phase 06 enemy-behavior-06): behaves exactly like
 *   bok (8-direction chase/attack) until it lands a melee attack; on its
 *   next enemy turn it then tries a single step to an adjacent tile that
 *   strictly increases its Chebyshev distance to the player instead of
 *   acting normally, falling back to normal behavior that same turn if no
 *   such tile exists.
 * - 'mummy_shamble' (mummy, Phase 06 phase-06-mummy-shambling-movement):
 *   behaves exactly like bok (8-direction chase/attack) except that after
 *   it successfully takes a chase step (moves), its next enemy turn is
 *   spent resting in place instead of acting (no movement, no attack, even
 *   if adjacent to the player). A successful attack never triggers rest,
 *   so while adjacent to the player it attacks every turn without pause.
 * - 'cockatrice_gaze' (cockatrice, Phase 06 phase-06-cockatrice-petrifying-gaze):
 *   if aimed (gazeDirection set), fires its petrifying gaze along that
 *   fixed stored direction this turn regardless of adjacency (an aimed
 *   shot is never replaced by a melee attack). Otherwise, attacks like bok
 *   if adjacent; failing that, aims (no movement/attack that turn) if the
 *   player is on an unobstructed 2-5 tile line along one of the 8
 *   directions, storing that direction; otherwise falls back to a normal
 *   chase step.
 * - 'kraken_tentacle' (kraken, Phase 06 phase-06-kraken-telegraphed-tentacle-strike):
 *   never moves, on any turn, for any reason, and never makes a normal
 *   melee attack even when adjacent. If already telegraphing
 *   (tentacleTarget set), strikes the orthogonal cross centered on that
 *   fixed stored coordinate this turn (never re-centered on the player's
 *   possibly-new position), then clears the field. Otherwise, if the
 *   player is within Chebyshev distance 1-5 (line of sight not required —
 *   this is a ground-based area attack, not a beam), telegraphs by
 *   storing the player's current coordinate (no other action that turn).
 *   Otherwise waits with no event.
 * - 'stationary': a stricter no-op fallback that never acts at all (no
 *   species currently uses this — kraken now has its own behaviorType
 *   above — but it remains available for any future purely-inert
 *   species).
 *
 * movementType is descriptive metadata for future phases (e.g. bat's
 * flying/wall-crossing movement); movement logic does not yet branch on it.
 */
export type BehaviorType =
  | 'generic_melee'
  | 'spider_cardinal'
  | 'slow_melee'
  | 'fast_melee'
  | 'recovery_melee'
  | 'placeholder'
  | 'bat_retreat'
  | 'mummy_shamble'
  | 'cockatrice_gaze'
  | 'kraken_tentacle'
  | 'stationary';
export type MovementType = 'ground' | 'flying' | 'none';

export interface EnemyDefinition {
  id: EnemyType;
  displayName: string;
  /** Sprite sheet key used by the loader/renderer; matches the asset file stem under public/assets/sprites. */
  spriteKey: string;
  hp: number;
  attack: number;
  /**
   * Flat defense (Phase 10.2 combat stat/scale redesign), subtracted from
   * the player's outgoing attack before it's applied — see combat.ts's
   * computeAttackDamage. 0 for every species except golem and kraken (1
   * each): both are already singled out elsewhere in the codebase as
   * "heavy/fixed-type" (see turn.ts's tryKnockback, which exempts exactly
   * these two from knockback), so giving them the roster's only nonzero
   * defense is a minimal, already-established-by-the-code distinction
   * rather than an arbitrary new one. See docs/history/phase-10-2-combat
   * -stat-scale-redesign.md for the resulting hit-count comparison (a
   * small, explicitly accepted deviation from exact old/new hit-count
   * parity for these two species only).
   */
  defense: number;
  /**
   * Integer-percent chance this species' own attacks land (Phase 10.3
   * accuracy/evasion foundation) — see combat.ts's computeHitChance.
   * 90 for every current species (initial_values baseline); a future
   * species could differ.
   */
  accuracy: number;
  /**
   * Integer-percent reduction to an attacker's hit chance against this
   * species (Phase 10.3) — see combat.ts's computeHitChance. 0 for every
   * species except bat (10): bat is the roster's only "hard to hit"
   * species this phase (golem's comparatively low evasion is expressed
   * as 0, per confirmed_design's initial_values).
   */
  evasion: number;
  behaviorType: BehaviorType;
  movementType: MovementType;
  stationary: boolean;
}

// Fixed spawn/species order used whenever a floor spawns one of each
// species (see ENEMY_COUNT_PER_FLOOR in mapgen.ts). Phase 10.2 combat
// stat/scale redesign: hp/attack values are the Phase 08/09-era
// provisional numbers scaled up roughly 10x (see the history doc for the
// full old/new table and rationale); defense is new this phase.
export const ENEMY_DEFINITIONS: Record<EnemyType, EnemyDefinition> = {
  bok: {
    id: 'bok',
    displayName: 'ボク',
    spriteKey: 'bok_lv1',
    hp: 30,
    attack: 10,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'generic_melee',
    movementType: 'ground',
    stationary: false,
  },
  cockatrice: {
    id: 'cockatrice',
    displayName: 'コカトリス',
    spriteKey: 'cockatrice',
    hp: 30,
    attack: 10,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'cockatrice_gaze',
    movementType: 'ground',
    stationary: false,
  },
  spider: {
    id: 'spider',
    displayName: 'スパイダー',
    spriteKey: 'spider',
    hp: 20,
    attack: 10,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'spider_cardinal',
    movementType: 'ground',
    stationary: false,
  },
  bat: {
    id: 'bat',
    displayName: 'コウモリ',
    spriteKey: 'bat',
    hp: 20,
    attack: 10,
    defense: 0,
    accuracy: 90,
    evasion: 10,
    behaviorType: 'bat_retreat',
    movementType: 'flying',
    stationary: false,
  },
  mummy: {
    id: 'mummy',
    displayName: 'マミー',
    spriteKey: 'mummy_lv1',
    hp: 50,
    attack: 20,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'mummy_shamble',
    movementType: 'ground',
    stationary: false,
  },
  golem: {
    id: 'golem',
    displayName: 'ゴーレム',
    spriteKey: 'claygolem',
    hp: 40,
    attack: 30,
    defense: 1,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'slow_melee',
    movementType: 'ground',
    stationary: false,
  },
  sword: {
    id: 'sword',
    displayName: 'ソード',
    spriteKey: 'sword',
    hp: 40,
    attack: 20,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'fast_melee',
    movementType: 'ground',
    stationary: false,
  },
  axe: {
    id: 'axe',
    displayName: 'アックス',
    spriteKey: 'axe',
    hp: 60,
    attack: 20,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'recovery_melee',
    movementType: 'ground',
    stationary: false,
  },
  kraken: {
    id: 'kraken',
    displayName: 'クラーケン',
    spriteKey: 'kraken',
    hp: 60,
    attack: 20,
    defense: 1,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'kraken_tentacle',
    movementType: 'none',
    stationary: true,
  },
};

// Fixed order used to assign one of each species per floor (Phase 06
// foundation: ENEMY_COUNT_PER_FLOOR equals the roster size, so this order
// also fixes each species' index in state.enemies).
export const ENEMY_TYPES_IN_ORDER: EnemyType[] = [
  'bok',
  'cockatrice',
  'spider',
  'bat',
  'mummy',
  'golem',
  'sword',
  'axe',
  'kraken',
];

/**
 * Floor number (1-indexed) on which each species first becomes a normal
 * spawn candidate (Phase 08.1 floor-based enemy pools). A species is a
 * candidate on this floor and every floor after it (cumulative unlock).
 */
export const ENEMY_FIRST_APPEARANCE_FLOOR: Record<EnemyType, number> = {
  bok: 1,
  bat: 1,
  spider: 2,
  cockatrice: 3,
  mummy: 3,
  sword: 4,
  axe: 4,
  golem: 5,
  kraken: 5,
};

/**
 * Returns the read-only set of species eligible to spawn as a normal enemy
 * on the given floor, per ENEMY_FIRST_APPEARANCE_FLOOR's cumulative unlock
 * schedule (floor 1 = bok/bat only; floor 5 and beyond = the full 9-species
 * roster). Order follows ENEMY_TYPES_IN_ORDER. Does not affect species
 * count, weighting, or the underlying seeded RNG selection mechanism —
 * callers still draw uniformly at random from the returned array.
 *
 * Phase 08.4 exception: floor 2 additionally includes 'golem' as a
 * candidate (so a threatening enemy is reachable early, right after armor
 * becomes available), without changing golem's normal first-appearance
 * floor (5) used by every other floor's cumulative calculation above —
 * floor 3 and floor 4's candidate sets are therefore unaffected by this
 * exception, per must_preserve. This is deliberately a floor-specific
 * addition, not a change to ENEMY_FIRST_APPEARANCE_FLOOR itself.
 */
export function getEnemyPoolForFloor(floor: number): EnemyType[] {
  const pool = ENEMY_TYPES_IN_ORDER.filter(
    (type) => ENEMY_FIRST_APPEARANCE_FLOOR[type] <= floor,
  );
  if (floor === 2 && !pool.includes('golem')) {
    pool.push('golem');
  }
  return pool;
}
