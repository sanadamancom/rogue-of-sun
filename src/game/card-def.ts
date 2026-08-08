import { CardId } from './types';

/**
 * Phase 20.0a card definition foundation. This module is the single
 * source of truth for each of the 17 cards' *card-specific* metadata
 * (display name, use mode, target scope, effect id, loot/telemetry
 * placeholders). It is intentionally separate from item-def.ts's
 * ITEM_DEFINITIONS: cards are registered there too (as ordinary
 * `category: 'consumable'` entries, per rogue-of-sun-development-plan.md
 * 20.0a's "第4のitem categoryは追加しない") so every existing
 * item-lookup/inventory/stack code path keeps working unchanged, while
 * this file holds the data that has no equivalent on any other item
 * (useMode, targetScope, effectId, telemetryCategory, ...).
 *
 * Nothing in this file is wired into gameplay yet: no use-command
 * dispatch, no effect handlers, no automatic-trigger logic, no
 * identification/seal state, no loot registration. Every card's
 * lootWeight/floorDropEnabled/enemyDropEnabled is a neutral placeholder
 * (0/false/false) so defining a card here can never make it appear in
 * play until a later phase explicitly wires it up (see this file's
 * CARD_DEFINITIONS doc comment below and rogue-of-sun-development-plan.md
 * 20.0a's "20.0aではカードを出現させない").
 */

/** Whether a card is used from the normal inventory command, or triggers automatically (judgement only). */
export type CardUseMode = 'manual' | 'automatic';

/**
 * What a card's effect targets, at the metadata level only (no resolution
 * logic lives here — see this file's module doc comment). One member per
 * distinct target shape named across the 17 cards in
 * rogue-of-sun-card-effects-spec.md.
 */
export type CardTargetScope =
  | 'self'
  | 'current_room_enemies'
  | 'current_room_all_characters'
  | 'selected_identified_cursed_equipment'
  | 'selected_inventory_item'
  | 'equipped_armor'
  | 'equipped_weapon'
  | 'self_on_pending_death';

/**
 * Opaque effect-processing id, one per card. Deliberately a closed union
 * (not a bare string) so a typo can never silently register a card with
 * no matching effect implementation — see this file's module doc comment
 * for why no effect implementation exists yet regardless.
 */
export type CardEffectId =
  | 'increase_mind'
  | 'increase_body'
  | 'temporary_damage_reduction'
  | 'restore_sol'
  | 'increase_speed'
  | 'increase_strength'
  | 'increase_random_ability'
  | 'room_damage_from_missing_life'
  | 'swap_life_and_sol'
  | 'sacrifice_life_restore_sol'
  | 'remove_equipment_curse'
  | 'room_dark_effect'
  | 'indiscriminate_room_damage'
  | 'transform_item'
  | 'refine_equipped_armor'
  | 'refine_equipped_weapon'
  | 'prevent_death_and_restore';

/**
 * telemetry-category placeholder id. Phase 20.0a only ever registers the
 * single value `'card'` — a closed one-member union (not a bare string)
 * so a typo can never silently widen this field, mirroring how
 * CardEffectId/CardTargetScope above are closed unions rather than
 * string. No telemetry event actually reads this yet (see module doc
 * comment); adding further category values is out of this phase's scope.
 */
export type CardTelemetryCategory = 'card';

/**
 * When a manual card is treated as consumed (turn.ts has no reader of
 * this yet — see module doc comment). `effect_succeeded` covers all 16
 * manual cards (rogue-of-sun-card-effects-spec.md's per-card "使用不成立
 * とし、カードを消費せず" rules all key off effect success); judgement's
 * `trigger_succeeded` is kept as a distinct value since it is never
 * user-initiated.
 */
export type CardConsumeCondition = 'effect_succeeded' | 'trigger_succeeded';

/**
 * A single card's full data-only definition. No field here implies any
 * behavior by itself — see this file's module doc comment for what is and
 * isn't wired up in Phase 20.0a.
 */
export interface CardDefinition {
  id: CardId;
  displayName: string;
  /** Shown in place of displayName/effect text while the card's species is unidentified (Phase 20.0a neutral value: the same fixed string for every card — see rogue-of-sun-development-plan.md 20.0a's phase_20_0a_neutral_values). Real per-card unidentified names are out of this phase's scope. */
  unidentifiedDisplayName: string;
  useMode: CardUseMode;
  targetScope: CardTargetScope;
  /**
   * Opaque id for whatever future usability precondition gates this
   * card's use (e.g. sealed state, no valid target). Not read or
   * enforced anywhere yet (see module doc comment) — a placeholder value
   * distinguishing "no special precondition" (`'default'`) from
   * judgement's death-triggered precondition (`'on_pending_death'`).
   */
  usableConditionId: 'default' | 'on_pending_death';
  consumeCondition: CardConsumeCondition;
  /** Turns spent on a successful use (manual: 1, judgement: 0 — see rogue-of-sun-card-effects-spec.md's automatic-card table). Not read anywhere yet. */
  turnCost: 0 | 1;
  effectId: CardEffectId;
  /** Rarity/appearance weight placeholder (Phase 20.0a neutral value: 0 for every card — see module doc comment). Real weights are Phase 20.0e's responsibility. */
  lootWeight: number;
  /** Phase 20.0a neutral value: false for every card (see module doc comment). Real floor-drop registration is Phase 20.0e's responsibility. */
  floorDropEnabled: boolean;
  /** Phase 20.0a neutral value: false for every card (see module doc comment). Enemy drop is unimplemented in production regardless (see this phase's audit). */
  enemyDropEnabled: boolean;
  /** Placeholder telemetry grouping id, shared by all 17 cards. No telemetry event actually reads this yet (see module doc comment). */
  telemetryCategory: CardTelemetryCategory;
}

/**
 * Fixed display-order id list for the 17 cards (16 manual + judgement).
 * Mirrors item-def.ts's ITEM_IDS_IN_ORDER in spirit but is kept as its
 * own array: card-def.ts must not import item-def.ts (item-def.ts
 * imports from here — see item-def.ts's own doc comment — and a
 * cross-import back would be circular).
 */
export const CARD_IDS_IN_ORDER: CardId[] = [
  'high_priestess',
  'empress',
  'emperor',
  'lovers',
  'chariot',
  'strength',
  'wheel_of_fortune',
  'justice',
  'hanged_man',
  'death',
  'temperance',
  'devil',
  'tower',
  'star',
  'moon',
  'sun',
  'judgement',
];

/** Single source of the card id <-> Japanese display name mapping (mirrors ability.ts's ABILITY_DISPLAY_NAMES pattern), reused by item-def.ts's ITEM_DEFINITIONS entries so the name exists in exactly one place. */
export const CARD_DISPLAY_NAMES: Record<CardId, string> = {
  high_priestess: '女教皇',
  empress: '女帝',
  emperor: '皇帝',
  lovers: '恋人',
  chariot: '戦車',
  strength: '力',
  wheel_of_fortune: '運命の輪',
  justice: '正義',
  hanged_man: '吊るされた男',
  death: '死神',
  temperance: '節制',
  devil: '悪魔',
  tower: '塔',
  star: '星',
  moon: '月',
  sun: '太陽',
  judgement: '審判',
};

/**
 * Shared placeholder glyph for every card (no processed sprite asset yet
 * — same provisional-emoji precedent as every other item without one; see
 * item-def.ts's `glyph` doc comment). A single shared glyph (rather than
 * per-card glyphs) is a Phase 20.0a implementation detail: cards are
 * never displayed distinguishably by glyph alone anywhere yet (unlike
 * antidote/panacea, which share a glyph but are never adjacent choices in
 * a context where that matters); real per-card glyphs are left to a later
 * phase alongside actual sprite/UI work.
 */
export const CARD_GLYPH = '🎴';

/** Neutral, not-yet-wired-up display name shown for every card while unidentified (Phase 20.0a neutral value — see CardDefinition.unidentifiedDisplayName doc comment). */
const UNIDENTIFIED_CARD_DISPLAY_NAME = '未鑑定のカード';

/** Shared telemetry-category placeholder for every card (Phase 20.0a neutral value — see CardDefinition.telemetryCategory doc comment). */
const CARD_TELEMETRY_CATEGORY: CardTelemetryCategory = 'card';

/**
 * Single source of truth for every card's Phase 20.0a metadata. All 17
 * ids (see CARD_IDS_IN_ORDER) are present with no omissions — enforced by
 * the `Record<CardId, CardDefinition>` annotation, which TypeScript
 * rejects at compile time if any CardId is missing. See this file's
 * module doc comment for what is (data only) and isn't (any behavior)
 * represented here.
 */
export const CARD_DEFINITIONS: Record<CardId, CardDefinition> = {
  high_priestess: {
    id: 'high_priestess',
    displayName: CARD_DISPLAY_NAMES.high_priestess,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'self',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'increase_mind',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  empress: {
    id: 'empress',
    displayName: CARD_DISPLAY_NAMES.empress,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'self',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'increase_body',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  emperor: {
    id: 'emperor',
    displayName: CARD_DISPLAY_NAMES.emperor,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'self',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'temporary_damage_reduction',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  lovers: {
    id: 'lovers',
    displayName: CARD_DISPLAY_NAMES.lovers,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'self',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'restore_sol',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  chariot: {
    id: 'chariot',
    displayName: CARD_DISPLAY_NAMES.chariot,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'self',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'increase_speed',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  strength: {
    id: 'strength',
    displayName: CARD_DISPLAY_NAMES.strength,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'self',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'increase_strength',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  wheel_of_fortune: {
    id: 'wheel_of_fortune',
    displayName: CARD_DISPLAY_NAMES.wheel_of_fortune,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'self',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'increase_random_ability',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  justice: {
    id: 'justice',
    displayName: CARD_DISPLAY_NAMES.justice,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'current_room_enemies',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'room_damage_from_missing_life',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  hanged_man: {
    id: 'hanged_man',
    displayName: CARD_DISPLAY_NAMES.hanged_man,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'self',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'swap_life_and_sol',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  death: {
    id: 'death',
    displayName: CARD_DISPLAY_NAMES.death,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'self',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'sacrifice_life_restore_sol',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  temperance: {
    id: 'temperance',
    displayName: CARD_DISPLAY_NAMES.temperance,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'selected_identified_cursed_equipment',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'remove_equipment_curse',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  devil: {
    id: 'devil',
    displayName: CARD_DISPLAY_NAMES.devil,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'current_room_enemies',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'room_dark_effect',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  tower: {
    id: 'tower',
    displayName: CARD_DISPLAY_NAMES.tower,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'current_room_all_characters',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'indiscriminate_room_damage',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  star: {
    id: 'star',
    displayName: CARD_DISPLAY_NAMES.star,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'selected_inventory_item',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'transform_item',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  moon: {
    id: 'moon',
    displayName: CARD_DISPLAY_NAMES.moon,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'equipped_armor',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'refine_equipped_armor',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  sun: {
    id: 'sun',
    displayName: CARD_DISPLAY_NAMES.sun,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'manual',
    targetScope: 'equipped_weapon',
    usableConditionId: 'default',
    consumeCondition: 'effect_succeeded',
    turnCost: 1,
    effectId: 'refine_equipped_weapon',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
  judgement: {
    id: 'judgement',
    displayName: CARD_DISPLAY_NAMES.judgement,
    unidentifiedDisplayName: UNIDENTIFIED_CARD_DISPLAY_NAME,
    useMode: 'automatic',
    targetScope: 'self_on_pending_death',
    usableConditionId: 'on_pending_death',
    consumeCondition: 'trigger_succeeded',
    turnCost: 0,
    effectId: 'prevent_death_and_restore',
    lootWeight: 0,
    floorDropEnabled: false,
    enemyDropEnabled: false,
    telemetryCategory: CARD_TELEMETRY_CATEGORY,
  },
};

/** Looks up a card's full Phase 20.0a definition by id. Total function (CardId is a closed union and CARD_DEFINITIONS is exhaustive), never returns undefined. */
export function getCardDefinition(id: CardId): CardDefinition {
  return CARD_DEFINITIONS[id];
}
