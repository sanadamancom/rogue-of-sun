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
 * ントと能力IDを検証する") — so an invalid request (bad id, 0 points, or
 * the run already over) leaves `state` completely unchanged and returns
 * `success: false` with no event. Never runs while `state.phase` is not
 * 'playing' (allocation_rules's "player_dead、floor_reachedなど終了確定
 * 後は新たに割り振れない"). This is a pure non-turn state update —
 * unrelated to processTurn/PlayerAction — so it never advances state.turn,
 * never triggers enemy actions, and never touches hunger/poison/
 * regen/activeEffects.
 */
export function allocateAbilityPoint(state: GameState, ability: AbilityId): AbilityAllocationResult {
  if (state.phase !== 'playing') return failedAllocation(state);
  if (!isAbilityId(ability)) return failedAllocation(state);
  const remaining = getUnspentAbilityPoints(state);
  if (remaining < 1) return failedAllocation(state);

  const abilities = getAbilities(state);
  const previousValue = abilities[ability];
  const newValue = previousValue + 1;
  abilities[ability] = newValue;
  state.abilities = abilities;
  state.unspentAbilityPoints = remaining - 1;

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
