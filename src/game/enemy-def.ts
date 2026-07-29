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
 * - 'placeholder': species with no finished signature AI yet
 *   (cockatrice/bat/mummy); routed to 'generic_melee' for now so they are
 *   playable placeholders rather than inert props. This indirection lives
 *   in one place (turn.ts's resolveOneEnemy) so swapping in real behavior
 *   later does not require touching spawning or rendering.
 * - 'stationary': never acts (kraken).
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
  | 'stationary';
export type MovementType = 'ground' | 'flying' | 'none';

export interface EnemyDefinition {
  id: EnemyType;
  displayName: string;
  /** Sprite sheet key used by the loader/renderer; matches the asset file stem under public/assets/sprites. */
  spriteKey: string;
  hp: number;
  attack: number;
  behaviorType: BehaviorType;
  movementType: MovementType;
  stationary: boolean;
}

// Fixed spawn/species order used whenever a floor spawns one of each
// species (see ENEMY_COUNT_PER_FLOOR in mapgen.ts). Provisional hp/attack
// values only; see docs/history for the record of this foundation pass.
export const ENEMY_DEFINITIONS: Record<EnemyType, EnemyDefinition> = {
  bok: {
    id: 'bok',
    displayName: 'ボク',
    spriteKey: 'bok_lv1',
    hp: 3,
    attack: 1,
    behaviorType: 'generic_melee',
    movementType: 'ground',
    stationary: false,
  },
  cockatrice: {
    id: 'cockatrice',
    displayName: 'コカトリス',
    spriteKey: 'cockatrice',
    hp: 3,
    attack: 1,
    behaviorType: 'placeholder',
    movementType: 'ground',
    stationary: false,
  },
  spider: {
    id: 'spider',
    displayName: 'スパイダー',
    spriteKey: 'spider',
    hp: 2,
    attack: 1,
    behaviorType: 'spider_cardinal',
    movementType: 'ground',
    stationary: false,
  },
  bat: {
    id: 'bat',
    displayName: 'コウモリ',
    spriteKey: 'bat',
    hp: 2,
    attack: 1,
    behaviorType: 'placeholder',
    movementType: 'flying',
    stationary: false,
  },
  mummy: {
    id: 'mummy',
    displayName: 'マミー',
    spriteKey: 'mummy_lv1',
    hp: 5,
    attack: 2,
    behaviorType: 'placeholder',
    movementType: 'ground',
    stationary: false,
  },
  golem: {
    id: 'golem',
    displayName: 'ゴーレム',
    spriteKey: 'claygolem',
    hp: 8,
    attack: 3,
    behaviorType: 'slow_melee',
    movementType: 'ground',
    stationary: false,
  },
  sword: {
    id: 'sword',
    displayName: 'ソード',
    spriteKey: 'sword',
    hp: 4,
    attack: 2,
    behaviorType: 'fast_melee',
    movementType: 'ground',
    stationary: false,
  },
  axe: {
    id: 'axe',
    displayName: 'アックス',
    spriteKey: 'axe',
    hp: 6,
    attack: 3,
    behaviorType: 'recovery_melee',
    movementType: 'ground',
    stationary: false,
  },
  kraken: {
    id: 'kraken',
    displayName: 'クラーケン',
    spriteKey: 'kraken',
    hp: 6,
    attack: 2,
    behaviorType: 'stationary',
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
