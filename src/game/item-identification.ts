import { ITEM_DEFINITIONS } from './item-def';
import { CARD_DEFINITIONS, CARD_IDS_IN_ORDER } from './card-def';
import { ArmorId, CardId, GameState, ItemId, WeaponId } from './types';
import { GameEvent } from './events';

/**
 * Local mirror of turn.ts's isCardIdentified (same expression:
 * `(state.identifiedCardIds ?? []).includes(cardId)`), duplicated here
 * rather than imported to avoid a turn.ts <-> item-identification.ts
 * circular import (turn.ts calls markGeneralItemIdentified from this
 * module at consumable-use/equip success sites). Both read the exact
 * same GameState.identifiedCardIds field and must never diverge — see
 * types.ts's GameState.identifiedCardIds doc comment, the single source
 * of truth for the contract itself.
 */
function isCardIdentifiedLocal(state: GameState, cardId: CardId): boolean {
  return (state.identifiedCardIds ?? []).includes(cardId);
}

/**
 * Phase 24.4d1 general item identification foundation. Extends Phase
 * 20.0b/20.3's card identification pattern (`identifiedCardIds` /
 * `isCardIdentified` / `markCardIdentified` in turn.ts) to the 7
 * ordinary stacking consumables and the 27 weapon + 15 armor
 * definitions, per rogue-of-sun-development-plan.md's "Phase 20の
 * カード・装備基盤を再実装せず拡張する" directive and the Phase 24.4d0
 * readiness audit's provisional_recommendation
 * (run_shared_by_item_definition granularity for every category).
 *
 * This module owns exactly three responsibilities:
 *   1. Which ItemIds participate in general identification at all, and
 *      which are always-identified regardless of run state.
 *   2. The pure query/update boundary over
 *      `GameState.identifiedGeneralItemIds` (isGeneralItemIdentified /
 *      markGeneralItemIdentified), mirroring turn.ts's
 *      isCardIdentified/markCardIdentified exactly.
 *   3. A single shared player-visible display-name resolver
 *      (getDisplayedItemName) that every UI/log call site should use
 *      instead of duplicating its own unidentified check — covering
 *      cards (delegating to the existing card contract, unchanged),
 *      ordinary consumables, and weapon/armor definitions alike.
 *
 * Deliberately does not touch identifiedCardIds, EquipmentInstance.cursed/
 * curseRevealed, or any RNG stream (rogue-of-sun-development-plan.md
 * Phase 24.4d1 authoritative_decisions: identification never consumes
 * RNG, and body identification is a separate concern from curse
 * revelation).
 */

/**
 * The 7 ordinary stacking consumables (audit section 3: apple, sun_fruit,
 * chocolate, banana, antidote, panacea, clairvoyance_fruit) that
 * participate in general identification. Cards are excluded (they keep
 * their own existing identifiedCardIds contract unchanged); one-time
 * unlock pickups and solar_gun are excluded (always-identified — see
 * ALWAYS_IDENTIFIED_ITEM_IDS below).
 */
export const GENERAL_IDENTIFIABLE_CONSUMABLE_IDS: ReadonlyArray<ItemId> = [
  'apple',
  'sun_fruit',
  'chocolate',
  'banana',
  'antidote',
  'panacea',
  'clairvoyance_fruit',
];

/**
 * The 5 one-time unlock pickups (sol_enchantment plus the 4 other
 * elemental enchantments) that never enter Inventory and are always
 * treated as identified — rogue-of-sun-development-plan.md Phase 24.4d1
 * authoritative_decisions.special_items.one_time_unlock_items: "取得時に
 * 即時解禁される進行用取得物であり、通常使用品ではない".
 */
const ALWAYS_IDENTIFIED_ONE_TIME_UNLOCK_IDS: ReadonlySet<ItemId> = new Set<ItemId>([
  'sol_enchantment',
  'flame_enchantment',
  'frost_enchantment',
  'cloud_enchantment',
  'earth_enchantment',
]);

/**
 * solar_gun is a unique fixed weapon, not a normal random weapon
 * candidate (authoritative_decisions.special_items.solar_gun) — always
 * identified, never stored in identifiedGeneralItemIds.
 */
const ALWAYS_IDENTIFIED_EQUIPMENT_IDS: ReadonlySet<ItemId> = new Set<ItemId>(['solar_gun']);

const ALWAYS_IDENTIFIED_ITEM_IDS: ReadonlySet<ItemId> = new Set<ItemId>([
  ...ALWAYS_IDENTIFIED_ONE_TIME_UNLOCK_IDS,
  ...ALWAYS_IDENTIFIED_EQUIPMENT_IDS,
]);

/** Whether `itemId` is one of the 7 ordinary general-identifiable consumables (never a card). */
export function isGeneralIdentifiableConsumable(itemId: ItemId): boolean {
  return (GENERAL_IDENTIFIABLE_CONSUMABLE_IDS as readonly string[]).includes(itemId);
}

/**
 * Whether `itemId` is a weapon or armor definition that participates in
 * general identification (every WeaponId/ArmorId except the
 * always-identified solar_gun) — determined via ITEM_DEFINITIONS'
 * category field rather than a duplicated id list, so weapon-def.ts/
 * armor-def.ts stay the single source of truth for the roster.
 */
export function isGeneralIdentifiableEquipment(itemId: ItemId): boolean {
  if (ALWAYS_IDENTIFIED_EQUIPMENT_IDS.has(itemId)) return false;
  const category = ITEM_DEFINITIONS[itemId]?.category;
  return category === 'weapon' || category === 'armor';
}

/**
 * Whether `itemId` participates in general identification tracking at
 * all (consumable or equipment side) — false for cards (own contract),
 * false for always-identified ids (never need tracking).
 */
export function isGeneralIdentifiableItem(itemId: ItemId): boolean {
  return isGeneralIdentifiableConsumable(itemId) || isGeneralIdentifiableEquipment(itemId);
}

/**
 * Normalizes a possibly-absent/possibly-corrupted `identifiedGeneralItemIds`
 * value into a clean, deduplicated array containing only recognized,
 * trackable ids, preserving first-seen order — the general-item mirror
 * of state.ts's normalizeIdentifiedCardIds.
 */
export function normalizeIdentifiedGeneralItemIds(value: ItemId[] | undefined): ItemId[] {
  if (!value) return [];
  const seen = new Set<ItemId>();
  const result: ItemId[] = [];
  for (const id of value) {
    if (isGeneralIdentifiableItem(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * Whether `itemId`'s definition has been identified this run. Always
 * true for always-identified ids (solar_gun, the 5 one-time unlocks) and
 * for any itemId outside general identification's scope (e.g. a card —
 * callers needing card-specific behavior should use isCardIdentified
 * directly; this always-true fallback exists so a caller that doesn't
 * know/care about category never has to special-case cards itself).
 * Mirrors turn.ts's isCardIdentified exactly for the trackable case.
 */
export function isGeneralItemIdentified(state: GameState, itemId: ItemId): boolean {
  if (ALWAYS_IDENTIFIED_ITEM_IDS.has(itemId)) return true;
  if (!isGeneralIdentifiableItem(itemId)) return true;
  return (state.identifiedGeneralItemIds ?? []).includes(itemId);
}

/**
 * Marks `itemId`'s definition identified if not already (no-op, no event,
 * for always-identified ids or ids outside general identification's
 * scope). Mirrors turn.ts's markCardIdentified exactly: idempotent, one
 * 'general_item_identified' event on the first successful call for a
 * given itemId, never a duplicate. definitionId granularity for weapon/
 * armor (identifying one instance identifies every held/future instance
 * of the same species this run — authoritative_decisions.
 * identification_granularity.weapons_and_armor).
 */
export function markGeneralItemIdentified(
  state: GameState,
  itemId: ItemId,
  events: GameEvent[],
): void {
  if (ALWAYS_IDENTIFIED_ITEM_IDS.has(itemId)) return;
  if (!isGeneralIdentifiableItem(itemId)) return;
  const ids = state.identifiedGeneralItemIds ?? [];
  if (ids.includes(itemId)) return;
  state.identifiedGeneralItemIds = [...ids, itemId];
  events.push({ type: 'general_item_identified', itemId });
}

/** Fixed generic display names shown for an unidentified item, by category (authoritative_decisions.generic_names). */
const GENERIC_CONSUMABLE_NAME = '未鑑定の消耗品';
const GENERIC_WEAPON_NAME = '未鑑定の武器';
const GENERIC_ARMOR_NAME = '未鑑定の防具';

/**
 * The single shared player-visible display-name resolver for any ItemId
 * (card or otherwise). Every UI/log call site should use this instead of
 * duplicating its own unidentified check (implementation.core's "各UIや
 * ログに個別の未鑑定判定を複製しない"). Reuses the existing card
 * contract unchanged (isCardIdentified / CARD_DEFINITIONS.
 * unidentifiedDisplayName) for cards, and general identification for
 * everything else. Internal ids (Inventory keys, EquipmentInstance.
 * definitionId, event payloads) are never affected by this function —
 * it only governs what string is shown to the player.
 */
export function getDisplayedItemName(state: GameState, itemId: ItemId): string {
  if ((CARD_IDS_IN_ORDER as readonly string[]).includes(itemId)) {
    const cardId = itemId as CardId;
    if (!isCardIdentifiedLocal(state, cardId)) {
      return CARD_DEFINITIONS[cardId].unidentifiedDisplayName;
    }
    return ITEM_DEFINITIONS[itemId].displayName;
  }
  if (isGeneralItemIdentified(state, itemId)) {
    return ITEM_DEFINITIONS[itemId].displayName;
  }
  const category = ITEM_DEFINITIONS[itemId].category;
  if (category === 'weapon') return GENERIC_WEAPON_NAME;
  if (category === 'armor') return GENERIC_ARMOR_NAME;
  return GENERIC_CONSUMABLE_NAME;
}

/** Convenience alias taking a WeaponId/ArmorId definitionId directly (EquipmentInstance call sites), same resolver underneath. */
export function getDisplayedEquipmentName(state: GameState, definitionId: WeaponId | ArmorId): string {
  return getDisplayedItemName(state, definitionId as ItemId);
}
