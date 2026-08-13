import { EnemyType, ElementId, ElementalAffinity } from './types';

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
  /**
   * Experience points awarded to the player when this species is
   * defeated (Phase 13.1 experience/level foundation). Phase 15.1 core
   * combat rebalance assigns per-species values (1 for bat/spider/bok, 2
   * for cockatrice/sword/mummy, 3 for golem/axe/kraken — see
   * docs/history/phase-15-1-core-combat-rebalance.md) instead of the
   * Phase 13.1-era flat 1 for every species; this field exists explicitly
   * per species (rather than a single shared constant) so a future phase
   * can change individual species' rewards without touching the award
   * mechanism itself.
   */
  experienceReward: number;
  /**
   * Per-element affinity, one entry per ElementId (Phase 14.1
   * five-element enchantment foundation). Required (not optional/
   * partial) so every species must explicitly declare all five
   * affinities — no implicit "undefined means neutral" fallback exists
   * anywhere in production code; see combat.ts's computeElementalDamage
   * for how this feeds the elemental-damage calculation. Every current
   * species is 'neutral' across all five elements this phase (Phase
   * 14.1 deliberately assigns no real weaknesses/resistances yet — see
   * docs/history/phase-14-1-element-foundation.md), so today's sol
   * enchant damage is unchanged from before this phase.
   */
  elementalAffinities: Record<ElementId, ElementalAffinity>;
}

// Fixed spawn/species order used whenever a floor spawns one of each
// species (see ENEMY_COUNT_PER_FLOOR in mapgen.ts). Phase 15.1 core
// combat rebalance lowers hp/attack to the Phase 15 balance draft's
// low-integer Lv1 values (see docs/history/phase-15-1-core-combat-
// rebalance.md for the full old/new table); defense (golem/kraken only)
// is unchanged from Phase 10.2.
export const ENEMY_DEFINITIONS: Record<EnemyType, EnemyDefinition> = {
  bok: {
    id: 'bok',
    displayName: 'ボク',
    spriteKey: 'bok_lv1',
    hp: 6,
    // Phase 16 early-game combat/space rebalance lowers bok's attack from 6
    // to 3 (attack was the sole source of the reported 6 real-damage hit at
    // initial player defense 0 — see docs/history/phase-16-early-game-
    // balance.md), so a fresh player's first bok hit now costs half as much
    // LIFE. Only bok's own attack changes; hp/defense/accuracy/evasion and
    // every other species' attack are untouched.
    attack: 3,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'generic_melee',
    movementType: 'ground',
    stationary: false,
    experienceReward: 1,
    // Phase 14.4 enemy affinities: bok is treated as the same family as
    // the ghoul enemy from the source material, which carries a sol
    // weakness there — see docs/history/phase-14-4-enemy-affinities.md
    // for the full table and basis for every current species.
    elementalAffinities: { sol: 'weak', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  },
  cockatrice: {
    id: 'cockatrice',
    displayName: 'コカトリス',
    spriteKey: 'cockatrice',
    hp: 8,
    attack: 7,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'cockatrice_gaze',
    movementType: 'ground',
    stationary: false,
    experienceReward: 2,
    // Phase 14.4 enemy affinities: source-material cockatrice carries an
    // earth weakness — see docs/history/phase-14-4-enemy-affinities.md.
    elementalAffinities: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'weak' },
  },
  spider: {
    id: 'spider',
    displayName: 'スパイダー',
    spriteKey: 'spider',
    hp: 5,
    attack: 5,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'spider_cardinal',
    movementType: 'ground',
    stationary: false,
    experienceReward: 1,
    // Phase 14.4 enemy affinities: source material shows no elemental
    // weakness for spider — kept as all-neutral, not removed from the
    // roster. See docs/history/phase-14-4-enemy-affinities.md.
    elementalAffinities: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  },
  bat: {
    id: 'bat',
    displayName: 'コウモリ',
    spriteKey: 'bat',
    hp: 4,
    attack: 4,
    defense: 0,
    accuracy: 90,
    evasion: 10,
    behaviorType: 'bat_retreat',
    movementType: 'flying',
    stationary: false,
    experienceReward: 1,
    // Phase 14.4 enemy affinities: source material shows no elemental
    // weakness for bat — all-neutral. See docs/history/phase-14-4-
    // enemy-affinities.md.
    elementalAffinities: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  },
  mummy: {
    id: 'mummy',
    displayName: 'マミー',
    spriteKey: 'mummy_lv1',
    hp: 10,
    attack: 9,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'mummy_shamble',
    movementType: 'ground',
    stationary: false,
    experienceReward: 2,
    // Phase 14.4 enemy affinities: follows the original-title mummy's
    // flame weakness (not the sequel's sol weakness — see docs/history/
    // phase-14-4-enemy-affinities.md for the basis).
    elementalAffinities: { sol: 'neutral', flame: 'weak', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  },
  golem: {
    id: 'golem',
    displayName: 'ゴーレム',
    spriteKey: 'claygolem',
    hp: 10,
    attack: 12,
    defense: 1,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'slow_melee',
    movementType: 'ground',
    stationary: false,
    experienceReward: 3,
    // Phase 14.4 enemy affinities: golem corresponds to the source
    // material's clay golem, which carries a cloud weakness — see
    // docs/history/phase-14-4-enemy-affinities.md.
    elementalAffinities: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'weak', earth: 'neutral' },
  },
  sword: {
    id: 'sword',
    displayName: 'ソード',
    spriteKey: 'sword',
    hp: 9,
    attack: 8,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'fast_melee',
    movementType: 'ground',
    stationary: false,
    experienceReward: 2,
    // Phase 14.4 enemy affinities: source material's weakness for sword
    // is a weapon-category weakness, not an elemental one — deliberately
    // not replaced with an elemental weakness. See docs/history/
    // phase-14-4-enemy-affinities.md.
    elementalAffinities: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  },
  axe: {
    id: 'axe',
    displayName: 'アックス',
    spriteKey: 'axe',
    hp: 12,
    attack: 12,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'recovery_melee',
    movementType: 'ground',
    stationary: false,
    experienceReward: 3,
    // Phase 14.4 enemy affinities: source material's weakness for axe is
    // a weapon-category/attack-method weakness, not elemental —
    // deliberately not replaced. See docs/history/phase-14-4-enemy-
    // affinities.md.
    elementalAffinities: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  },
  kraken: {
    id: 'kraken',
    displayName: 'クラーケン',
    spriteKey: 'kraken',
    hp: 12,
    attack: 10,
    defense: 1,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'kraken_tentacle',
    movementType: 'none',
    stationary: true,
    experienceReward: 3,
    // Phase 14.4 enemy affinities: kraken is treated as the source
    // material's octopus-equivalent enemy, which carries a flame
    // weakness — see docs/history/phase-14-4-enemy-affinities.md.
    elementalAffinities: { sol: 'neutral', flame: 'weak', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  },
  skeleton: {
    id: 'skeleton',
    displayName: 'スケルトン',
    spriteKey: 'skeleton',
    hp: 6,
    attack: 5,
    defense: 0,
    accuracy: 90,
    evasion: 0,
    behaviorType: 'generic_melee',
    movementType: 'ground',
    stationary: false,
    experienceReward: 2,
    // Phase 23.1 (revised from Phase 23.0's initial frost-weakness
    // draft): skeleton deliberately carries no elemental weakness or
    // resistance at all — its species-defining trait is not affinity
    // strength but the body/head state machine itself (any activated
    // element, regardless of which, fully defeats it; a plain
    // unenchanted hit only knocks it down to a head — see turn.ts's
    // defeatEnemyIfNeeded). Kept all-neutral exactly like spider/bat so
    // this species doesn't silently gain or lose damage from any
    // particular element choice.
    elementalAffinities: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' },
  },
};

// Fixed order used to assign one of each species per floor (Phase 06
// foundation: ENEMY_COUNT_PER_FLOOR equals the roster size, so this order
// also fixes each species' index in state.enemies).
// Phase 23.1: 'skeleton' appended at the end (never inserted in the
// middle) so every pre-existing index-based lookup against this array
// (e.g. enemy-roster-foundation.test.ts's roster-preview ordering
// check) keeps matching the original 9 species at their original
// indices; only the array's length and its final entry change.
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
  'skeleton',
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
  // Phase 23.1 Stage 4: skeleton's provisional normal first-appearance
  // floor. This is a genuine, intended change to getEnemyPoolForFloor's
  // output for floor 3 and beyond (one more candidate species than
  // before this phase) — not an accidental side effect.
  skeleton: 3,
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
