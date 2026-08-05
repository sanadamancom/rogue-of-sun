import { GameEvent } from './events';
import { getUnspentAbilityPoints } from './progression';
import { AbilityId, AbilityValues, GameState } from './types';

/**
 * Phase 13.2 ability point allocation foundation. Deliberately never
 * reads or writes any existing combat stat (hp, maxHp, attack, defense,
 * solarEnergy, ...) — the 4 abilities defined here are purely tracked
 * numbers this phase; their real effects are Phase 13.3's job. See this
 * phase's history doc for the full out_of_scope list.
 *
 * AbilityId/AbilityValues are defined in types.ts (not here), for the
 * same reason EffectId lives in types.ts rather than effects.ts —
 * GameState needs the type without creating a circular import.
 */

/** Fixed iteration/display order for the 4 abilities, used by the overlay and by moveAbilitySelection's wraparound. */
export const ABILITY_IDS: AbilityId[] = ['body', 'mind', 'power', 'speed'];

/**
 * Single source of the ability ID <-> Japanese display name mapping
 * (ability_model.storage's "能力IDと日本語表示名の対応を1か所へ集約す
 * る") — the overlay renderer and message formatting both read from
 * here rather than each hardcoding their own copy.
 */
export const ABILITY_DISPLAY_NAMES: Record<AbilityId, string> = {
  body: 'カラダ',
  mind: 'ココロ',
  power: 'チカラ',
  speed: 'ハヤサ',
};

/** Every ability starts at 0 (ability_model.initial_values). */
export const INITIAL_ABILITY_VALUES: AbilityValues = { body: 0, mind: 0, power: 0, speed: 0 };

/**
 * Phase 13.3a: the maximum rank any single ability may reach. Chosen
 * deliberately low (10, not 20) given the current experience economy
 * grants roughly 1 unspent ability point per full run (see this phase's
 * history doc and the Phase 13.3 audit) — re-evaluated only alongside a
 * future change to experience/ability-point supply, per confirmed_spec.
 */
export const ABILITY_RANK_CAP = 10;

/** Phase 15.3 SOL/element/ability rebalance: max HP granted per body rank (15 + 2*bodyRank) — 4->2 (see docs/history/phase-15-3-sol-element-ability-rebalance.md). */
export const BODY_MAX_HP_PER_RANK = 2;

/** Phase 15.3 SOL/element/ability rebalance: max SOL granted per mind rank (15 + 2*mindRank) — 1->2. */
export const MIND_MAX_SOL_PER_RANK = 2;

/** Phase 15.3 SOL/element/ability rebalance: flat direct-attack damage bonus granted per power rank (1*powerRank) — 2->1. */
export const POWER_DAMAGE_PER_RANK = 1;

/**
 * The player's current direct-attack damage bonus from the power ability
 * (Phase 13.3a): `POWER_DAMAGE_PER_RANK * powerRank`, 0 at rank 0. Applied
 * at the single shared player-damage computation point (turn.ts's
 * applyPlayerAttackToEnemy) so every direct attack — unarmed, sword,
 * spear, hammer, and the solar gun — receives it exactly once. Never
 * applied to poison, starvation, or any other non-`applyPlayerAttackToEnemy`
 * damage source, since those paths simply never call this function.
 */
export function getPowerDamageBonus(state: GameState): number {
  return POWER_DAMAGE_PER_RANK * getAbilityValue(state, 'power');
}

/**
 * The elemental-enchantment additive-damage bonus granted by the
 * player's mind rank (Phase 15.3 SOL/element/ability rebalance):
 * floor(mindRank / 2), added on top of the fixed per-affinity value
 * (combat.ts's ELEMENTAL_AFFINITY_BONUS_DAMAGE) rather than to a
 * pre-affinity base as before. Applies identically to every element,
 * including sol — see turn.ts's applyPlayerAttackToEnemy, the single
 * call site. mind rank 1 yields 0 (no increase yet); rank 2 yields +1,
 * rank 4 yields +2, rank 6 yields +3. Pure — never mutates `state`;
 * reads only the existing mind rank via getAbilityValue (the same
 * source of truth power/body/speed already use), no new state field.
 */
export function getElementalMindBonus(state: GameState): number {
  return Math.floor(getAbilityValue(state, 'mind') / 2);
}

/**
 * Phase 13.3b speed/action-gauge scheduler: the player's baseline speed
 * (rank 0, 1:1 with every enemy at ENEMY_BASE_SPEED — see turn.ts's
 * resolveEnemiesAction) and the flat bonus granted per speed rank.
 * 100 + 10*rank yields the confirmed_spec milestones rank5=150 (1.5x)
 * and rank10=200 (2x) exactly.
 */
export const PLAYER_BASE_SPEED = 100;
export const SPEED_PER_RANK = 10;

/**
 * The player's current speed (Phase 13.3b): `PLAYER_BASE_SPEED +
 * SPEED_PER_RANK * speedRank`. A pure getter — never stores a separate
 * "current speed" field on GameState, so there is nothing to keep in
 * sync with the speed ability rank; every reader (turn.ts's
 * resolveEnemiesAction) always derives it fresh from the current rank.
 * Never mutates `state`.
 */
export function getPlayerSpeed(state: GameState): number {
  return PLAYER_BASE_SPEED + SPEED_PER_RANK * getAbilityValue(state, 'speed');
}

function isAbilityId(value: unknown): value is AbilityId {
  return value === 'body' || value === 'mind' || value === 'power' || value === 'speed';
}

/**
 * The 4 abilities' current values, defaulting to all-zero when the field
 * is absent — like progression.ts's getLevel/getExperience, so existing
 * GameState object literals across the test suite remain valid without
 * every one of them being updated. Never returns a live reference into
 * `state.abilities` (a fresh copy), so a caller can never mutate GameState
 * by mutating this return value.
 */
export function getAbilities(state: GameState): AbilityValues {
  return state.abilities ? { ...state.abilities } : { ...INITIAL_ABILITY_VALUES };
}

/** The current value of one ability, defaulting to 0 when absent. */
export function getAbilityValue(state: GameState, ability: AbilityId): number {
  return getAbilities(state)[ability];
}

/** Result of an allocateAbilityPoint call — success or failure, both without throwing. */
export interface AbilityAllocationResult {
  success: boolean;
  ability: AbilityId | null;
  abilityDisplayName: string | null;
  previousValue: number;
  newValue: number;
  remainingAbilityPoints: number;
  events: GameEvent[];
}

function failedAllocation(state: GameState): AbilityAllocationResult {
  return {
    success: false,
    ability: null,
    abilityDisplayName: null,
    previousValue: 0,
    newValue: 0,
    remainingAbilityPoints: getUnspentAbilityPoints(state),
    events: [],
  };
}

/**
 * Spends exactly 1 unspent ability point on `ability`, incrementing only
 * that ability and decrementing unspentAbilityPoints by 1
 * (ability_model.invariant). Validates both the ability id and the
 * available point count itself — never trusts the caller (UI) to have
 * already checked (allocation_core.requirements's "core側でも未使用ポイ
 * ントと能力IDを検証する") — so an invalid request (bad id, 0 points, the
 * run already over, or the ability already at ABILITY_RANK_CAP — Phase
 * 13.3a) leaves `state` completely unchanged and returns `success: false`
 * with no event. Never runs while `state.phase` is not 'playing'
 * (allocation_rules's "player_dead、floor_reachedなど終了確定後は新たに
 * 割り振れない"). This is a pure non-turn state update — unrelated to
 * processTurn/PlayerAction — so it never advances state.turn, never
 * triggers enemy actions, and never touches hunger/poison/regen/
 * activeEffects.
 *
 * Phase 13.3a side effects on success: 'body' increases both
 * state.player.maxHp and state.player.hp by BODY_MAX_HP_PER_RANK (current
 * HP clamped to the new max, so a already-full-HP player stays exactly
 * full); 'mind' does the same to state.maxSolarEnergy/state.solarEnergy
 * by MIND_MAX_SOL_PER_RANK. 'power' has no direct state side effect here
 * — its bonus is derived on demand by getPowerDamageBonus at the single
 * shared damage-computation point, never stored redundantly, so there is
 * no way for it to be double-applied. Phase 13.3b adds 'speed': every
 * EnemyActor's actionGauge is reset to 0 (see turn.ts's
 * resolveEnemiesAction for how actionGauge is otherwise accumulated) —
 * speed itself has no separately-stored "current speed" field; it is
 * always derived fresh from the rank via getPlayerSpeed. Every one of
 * these side effects only ever fires once per successful call, in
 * lockstep with the single rank increment above — never separately
 * recomputed from scratch elsewhere (state.ts's floor-transition
 * carry-over already preserves the already-updated maxHp/maxSolarEnergy
 * values as opaque numbers, exactly like every other player stat), so
 * initialization and allocation can never double-count the same rank's
 * effect.
 */
export function allocateAbilityPoint(state: GameState, ability: AbilityId): AbilityAllocationResult {
  if (state.phase !== 'playing') return failedAllocation(state);
  if (!isAbilityId(ability)) return failedAllocation(state);
  const remaining = getUnspentAbilityPoints(state);
  if (remaining < 1) return failedAllocation(state);

  const abilities = getAbilities(state);
  const previousValue = abilities[ability];
  if (previousValue >= ABILITY_RANK_CAP) return failedAllocation(state);
  const newValue = previousValue + 1;
  abilities[ability] = newValue;
  state.abilities = abilities;
  state.unspentAbilityPoints = remaining - 1;

  if (ability === 'body') {
    state.player.maxHp += BODY_MAX_HP_PER_RANK;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + BODY_MAX_HP_PER_RANK);
  } else if (ability === 'mind') {
    // Phase 15.3 SOL/element/ability rebalance: mind allocation only
    // raises maxSolarEnergy — current SOL is deliberately never restored
    // here (current_sol_recovery_on_allocate: 0), unlike body's current-
    // LIFE restoration above. Increasing maxSolarEnergy can never push
    // current solarEnergy above it, so no clamp is needed either.
    state.maxSolarEnergy += MIND_MAX_SOL_PER_RANK;
  } else if (ability === 'speed') {
    // Phase 13.3b: a speed-rank change alters what "actionGauge >=
    // playerSpeed" means for every enemy (the same absolute gauge value
    // now represents a different fraction of the new threshold), so every
    // enemy's actionGauge — not just living ones, per confirmed_spec's
    // "生存敵だけでなく配列内の全EnemyActorを0へ揃えてよい" — is reset to
    // 0 the instant a speed allocation actually succeeds. Never touched
    // by body/mind/power allocations, a cancelled confirmation, a
    // rejected (0-point/rank-10/invalid-id) request, or the overlay
    // opening/closing/selection moving.
    for (const enemy of state.enemies) {
      enemy.actionGauge = 0;
    }
  }

  const abilityDisplayName = ABILITY_DISPLAY_NAMES[ability];
  const event: GameEvent = {
    type: 'ability_point_spent',
    ability,
    abilityDisplayName,
    previousValue,
    newValue,
    remainingAbilityPoints: state.unspentAbilityPoints,
  };

  return {
    success: true,
    ability,
    abilityDisplayName,
    previousValue,
    newValue,
    remainingAbilityPoints: state.unspentAbilityPoints,
    events: [event],
  };
}

// ---------------------------------------------------------------------
// Overlay state (non-turn UI concerns) — mirrors inventory.ts's
// toggle/close/moveSelection pattern so main.ts's key handling stays
// consistent between the two overlays.
// ---------------------------------------------------------------------

/**
 * Opens/closes the ability allocation overlay (P). A no-op while the game
 * is not in 'playing' phase (overlay.visibility.prohibited). Opening
 * always resets the selection to the first ability, clears any pending
 * confirmation, and closes the inventory overlay if it was open
 * (overlay.mutual_exclusion's "能力overlayを開くとinventory overlayは閉
 * じる"). Consumes no turn.
 */
export function toggleAbilityOverlay(state: GameState): void {
  if (state.phase !== 'playing') return;
  state.abilityOverlayOpen = !state.abilityOverlayOpen;
  if (state.abilityOverlayOpen) {
    state.selectedAbilityIndex = 0;
    state.abilityConfirmPending = null;
    state.abilityConfirmChoice = 'no';
    // Mutual exclusion with the inventory overlay (Tab) — see
    // inventory.ts's toggleInventory for the symmetric close on its side.
    state.inventoryOpen = false;
    state.discardConfirmItemId = null;
  } else {
    state.abilityConfirmPending = null;
  }
}

/** Closes the ability overlay (Esc). Safe to call whether or not it is open. Consumes no turn. */
export function closeAbilityOverlay(state: GameState): void {
  state.abilityOverlayOpen = false;
  state.abilityConfirmPending = null;
}

/**
 * Moves the selected ability by `delta` (+1 = ArrowDown/S, -1 =
 * ArrowUp/W), wrapping within the fixed 4-ability list (unlike
 * inventory's variable-length entries, this list is always exactly
 * ABILITY_IDS.length long). Consumes no turn. No-op while a confirmation
 * is pending (selection is locked during confirmation, per
 * overlay.controls not listing selection movement among the confirmation
 * controls).
 */
export function moveAbilitySelection(state: GameState, delta: number): void {
  if (state.abilityConfirmPending) return;
  const count = ABILITY_IDS.length;
  const current = state.selectedAbilityIndex ?? 0;
  state.selectedAbilityIndex = ((current + delta) % count + count) % count;
}

/** The currently selected ability id (overlay.controls.selection). */
export function selectedAbilityId(state: GameState): AbilityId {
  const index = state.selectedAbilityIndex ?? 0;
  return ABILITY_IDS[((index % ABILITY_IDS.length) + ABILITY_IDS.length) % ABILITY_IDS.length];
}

/**
 * Enters the confirmation state for the currently selected ability
 * (Enter, overlay.controls.confirmation). A no-op when there are 0
 * unspent ability points (overlay.disabled_state's "Enterを押しても確認
 * 状態へ移らない") — this is a UI-state-only guard; allocateAbilityPoint
 * re-validates independently regardless. Initial confirmation choice is
 * always "いいえ" (confirmation_text/controls.confirmation's "初期選択
 * は「いいえ」とする").
 */
export function openAbilityConfirm(state: GameState): void {
  if (getUnspentAbilityPoints(state) < 1) return;
  state.abilityConfirmPending = selectedAbilityId(state);
  state.abilityConfirmChoice = 'no';
}

/** Flips the confirmation's はい/いいえ choice (ArrowLeft/ArrowRight/A/D). No-op when no confirmation is pending. */
export function toggleAbilityConfirmChoice(state: GameState): void {
  if (!state.abilityConfirmPending) return;
  state.abilityConfirmChoice = state.abilityConfirmChoice === 'yes' ? 'no' : 'yes';
}

/**
 * Cancels the pending confirmation without allocating anything (Esc while
 * confirming) — closes only the confirmation, not the whole overlay
 * (overlay.controls.confirmation's "Escで割り振らず確認状態だけを閉じ
 * る").
 */
export function cancelAbilityConfirm(state: GameState): void {
  state.abilityConfirmPending = null;
}

/** Result of resolving a pending confirmation via resolveAbilityConfirm. */
export interface AbilityConfirmResolution {
  /** Whether an actual allocation was attempted (choice was "はい"). False for "いいえ" or when nothing was pending. */
  attempted: boolean;
  allocation: AbilityAllocationResult | null;
}

/**
 * Resolves the pending confirmation (Enter while confirming,
 * overlay.controls.confirmation's "Enterで選択を確定する"): if the
 * current choice is "いいえ", simply closes the confirmation with no
 * state change and no event (allocation_rules/invalid_result). If "はい",
 * calls allocateAbilityPoint for the pending ability. Either way, the
 * confirmation is cleared afterward and the overlay itself stays open
 * (allocation_rules's "割り振り後もoverlayを開いたままにし、続けて操作
 * できる"). A no-op (attempted: false) when no confirmation was pending,
 * guarding against a stray Enter reaching this after the confirmation was
 * already resolved/cancelled in the same input cycle.
 */
export function resolveAbilityConfirm(state: GameState): AbilityConfirmResolution {
  const pending = state.abilityConfirmPending;
  if (!pending) return { attempted: false, allocation: null };

  if (state.abilityConfirmChoice !== 'yes') {
    state.abilityConfirmPending = null;
    return { attempted: false, allocation: null };
  }

  state.abilityConfirmPending = null;
  const allocation = allocateAbilityPoint(state, pending);
  return { attempted: true, allocation };
}

// ---------------------------------------------------------------------
// Ability effect display (Phase 13.3c) — pure, PhaserやDOMに依存しない
// formatters so the overlay can show each ability's actual effect and
// its value after the next rank, without ever re-implementing the
// effect formulas themselves. Every current value below reads the same
// already-authoritative source allocateAbilityPoint itself writes to
// (state.player.maxHp / state.maxSolarEnergy) or the same shared getter
// turn.ts's combat code calls (getPowerDamageBonus / getPlayerSpeed) —
// no duplicate formula exists anywhere in this section.
// ---------------------------------------------------------------------

/** One ability's current effect value and its value after spending one more point (null once ABILITY_RANK_CAP is reached). */
export interface AbilityEffectDisplay {
  ability: AbilityId;
  atRankCap: boolean;
  currentValue: number;
  nextValue: number | null;
}

/**
 * Computes `ability`'s current effect value and, unless already at
 * ABILITY_RANK_CAP, the value it would become after one more successful
 * allocation — both derived from the exact same per-rank constants
 * allocateAbilityPoint itself applies (BODY_MAX_HP_PER_RANK/
 * MIND_MAX_SOL_PER_RANK/POWER_DAMAGE_PER_RANK/SPEED_PER_RANK), so the
 * overlay can never drift out of sync with the real effect. Pure — never
 * mutates `state`.
 */
export function getAbilityEffectDisplay(state: GameState, ability: AbilityId): AbilityEffectDisplay {
  const rank = getAbilityValue(state, ability);
  const atRankCap = rank >= ABILITY_RANK_CAP;
  switch (ability) {
    case 'body': {
      const currentValue = state.player.maxHp;
      return { ability, atRankCap, currentValue, nextValue: atRankCap ? null : currentValue + BODY_MAX_HP_PER_RANK };
    }
    case 'mind': {
      const currentValue = state.maxSolarEnergy;
      return { ability, atRankCap, currentValue, nextValue: atRankCap ? null : currentValue + MIND_MAX_SOL_PER_RANK };
    }
    case 'power': {
      const currentValue = getPowerDamageBonus(state);
      return { ability, atRankCap, currentValue, nextValue: atRankCap ? null : currentValue + POWER_DAMAGE_PER_RANK };
    }
    case 'speed': {
      const currentValue = getPlayerSpeed(state);
      return { ability, atRankCap, currentValue, nextValue: atRankCap ? null : currentValue + SPEED_PER_RANK };
    }
  }
}

/**
 * Formats `ability`'s effect line for the overlay (Phase 13.3c): one
 * short Japanese line showing the current value and — unless at
 * ABILITY_RANK_CAP — the value after the next allocation. speed's
 * wording is deliberately "敵の行動頻度低下" (lower enemy action
 * frequency), never anything implying the player acts more often or
 * moves faster (ability_overlay.display_requirements.speed's "「プレイ
 * ヤーの行動回数増加」と誤解させる表現を使用しない" / implementation_
 * constraints's "移動距離を増やす効果ではない"). power's wording names
 * every weapon category the bonus applies to, including the solar gun.
 * Available even at 0 unspent ability points (overlay.disabled_state
 * only disables *allocating*, never viewing current effect values).
 */
export function formatAbilityEffectLine(state: GameState, ability: AbilityId): string {
  const d = getAbilityEffectDisplay(state, ability);
  switch (ability) {
    case 'body':
      return d.atRankCap ? `HP${d.currentValue}（上限）` : `HP${d.currentValue}→${d.nextValue}（+${BODY_MAX_HP_PER_RANK}回復）`;
    case 'mind': {
      // Phase 15.3 SOL/element/ability rebalance: mind no longer restores
      // current SOL on allocation (only maxSolarEnergy increases), so the
      // wording never implies a "+N回復" the way body's line does. Instead
      // this documents the floor(mindRank/2) elemental-damage bonus rule
      // explicitly (step_7's "ココロの説明に「2ポイントごとに属性追加+1」
      // を明記する") alongside its current value.
      const elementBonus = getElementalMindBonus(state);
      return d.atRankCap
        ? `SOL${d.currentValue}（上限）／属性追加+${elementBonus}`
        : `SOL${d.currentValue}→${d.nextValue}（2ポイントごとに属性追加+1、現在+${elementBonus}）`;
    }
    case 'power':
      return d.atRankCap ? `攻撃+${d.currentValue}（上限）` : `攻撃+${d.currentValue}→+${d.nextValue}（全武器・太陽銃）`;
    case 'speed':
      return d.atRankCap ? `速度${d.currentValue}（上限）` : `速度${d.currentValue}→${d.nextValue}（敵の頻度低下）`;
  }
}
