import { ItemId, Inventory } from './types';
import { ELEMENT_DISPLAY_NAMES, ELEMENT_GLYPHS } from './element-def';

/**
 * A single item species' shared display/inventory data (Phase 08.2
 * inventory foundation; Phase 08.3 adds the 'weapon' category; Phase 08.4
 * adds the 'armor' category; Phase 08.7 adds a third weapon, 'hammer').
 * `healAmount` only applies to consumable healing items (currently just
 * 'apple'); weapon-specific combat stats live in weapon-def.ts's
 * WEAPON_DEFINITIONS and armor-specific defensive stats live in
 * armor-def.ts's ARMOR_DEFINITIONS, both keyed by the same id, rather
 * than being duplicated here.
 */
export interface ItemDefinition {
  id: ItemId;
  displayName: string;
  /** Sprite/emoji glyph used by the loader/renderer for this item. Phase 08.2/08.3/08.4/08.5/08.7 use plain emoji glyphs in place of processed sprite assets (user-approved substitution; see docs/history/phase-08-2-inventory-and-apple-healing.md, phase-08-3-weapon-equipment-and-sword.md, phase-08-4-armor-defense-and-floor2-golem.md, phase-08-5-spear-reach-weapon.md, and phase-08-7-hammer-knockback-weapon.md). */
  glyph: string;
  category: 'consumable' | 'weapon' | 'armor';
  /** Whether using this item removes one from the inventory (true for apple, false for sword/spear/hammer/armor — equipping never consumes any of them). */
  consumable: boolean;
  /** Whether multiple copies stack into one inventory count (true for apple; false for sword/spear/hammer/armor — these are never placed more than once per relevant floor, and equipment isn't stacked). */
  stackable: boolean;
  /** HP restored by one use, before clamping to the player's maxHp. Only meaningful for consumable healing items. */
  healAmount?: number;
  /** Solar energy restored by one use, before clamping to maxSolarEnergy. Only meaningful for sun_fruit (Phase 09.1). */
  solarAmount?: number;
  /** Hunger restored by one use, before clamping to HUNGER_MAX (Phase 11.3 hunger.ts). Only meaningful for chocolate. */
  hungerAmount?: number;
}

// Single source of truth for every registered item's name, glyph, and
// inventory-display behavior. Phase 08.2 registered only 'apple'; Phase
// 08.3 added 'sword'; Phase 08.4 added 'armor'; Phase 08.5 added 'spear';
// Phase 08.7 adds 'hammer'. Future items (sun fruit, sun gun) are
// expected to extend this table rather than add parallel ad-hoc fields
// elsewhere.
export const ITEM_DEFINITIONS: Record<ItemId, ItemDefinition> = {
  apple: {
    id: 'apple',
    displayName: 'リンゴ',
    glyph: '🍎',
    category: 'consumable',
    consumable: true,
    stackable: true,
    // Phase 10.2 combat stat/scale redesign: scaled 10x (2->20) alongside
    // player maxHp, preserving the same ~2/3-of-old-maxHp heal fraction.
    healAmount: 20,
  },
  sword: {
    id: 'sword',
    displayName: 'グラディウス',
    glyph: '🗡️',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  armor: {
    id: 'armor',
    displayName: 'クロスアーマー',
    glyph: '🛡️',
    category: 'armor',
    consumable: false,
    stackable: false,
  },
  spear: {
    id: 'spear',
    displayName: 'ショートスピア',
    glyph: '🔱',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  hammer: {
    id: 'hammer',
    displayName: 'クラブ',
    glyph: '🔨',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  sun_fruit: {
    id: 'sun_fruit',
    displayName: '太陽の実',
    // Phase 09.1: no processed sprite asset yet; 🍋 substituted per
    // user instruction, distinct from apple's 🍎.
    glyph: '🍋',
    category: 'consumable',
    consumable: true,
    stackable: true,
    solarAmount: 2,
  },
  solar_gun: {
    id: 'solar_gun',
    displayName: '太陽銃',
    glyph: '🔫',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  // Sol enchantment (Phase 10.1): a one-time unlock pickup, not a stacked
  // inventory item. Deliberately excluded from ITEM_IDS_IN_ORDER (below) so
  // it never appears in the general inventory overlay or gets counted via
  // the generic inventory[itemId]++ auto-pickup path — turn.ts's move
  // handler special-cases this id and sets GameState.solUnlocked directly
  // instead. category/consumable/stackable are unused for this id but kept
  // populated to satisfy ItemDefinition/Record<ItemId, ...> completeness.
  sol_enchantment: {
    id: 'sol_enchantment',
    displayName: 'ソル',
    glyph: '🔆',
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
  // Chocolate (Phase 11.3 hunger foundation): restores hunger, never
  // HP/SOL. Reuses the existing 'consumable' category (same UI/inventory
  // mechanism as apple/sun_fruit — category is a display grouping, not a
  // per-effect type; the effect itself is distinguished by which of
  // healAmount/solarAmount/hungerAmount is set) rather than introducing a
  // new 'food' ItemDefinition category, since nothing else needs one.
  chocolate: {
    id: 'chocolate',
    displayName: 'チョコレート',
    // Phase 11.3: no processed sprite asset yet; a plain emoji glyph is
    // used, following the same substitution precedent as sun_fruit/apple
    // (see item-def.ts's `glyph` doc comment) rather than introducing any
    // new asset-loading mechanism.
    glyph: '🍫',
    category: 'consumable',
    consumable: true,
    stackable: true,
    hungerAmount: 30,
  },
  // Banana (Phase 12.1 temporary-effect foundation): grants/refreshes the
  // 'attack_up' status effect (see effects.ts's EFFECT_DEFINITIONS) rather
  // than restoring HP/SOL/hunger directly, so it has none of
  // healAmount/solarAmount/hungerAmount set — turn.ts's applyItemUse
  // special-cases itemId === 'banana' explicitly (mirroring how chocolate
  // is special-cased via hungerAmount) rather than adding a fourth
  // ItemDefinition amount field for a single-use effect grant.
  banana: {
    id: 'banana',
    displayName: 'バナナ',
    // Phase 12.1: no processed sprite asset yet; a plain emoji glyph is
    // used, following the same substitution precedent as sun_fruit/
    // chocolate (see this file's `glyph` doc comment) rather than
    // introducing any new asset-loading mechanism, per user instruction.
    glyph: '🍌',
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  // Antidote (Phase 12.4 status-ailment removal foundation): removes
  // only the 'poison' status ailment, never HP/SOL/hunger or any other
  // effect — it has none of healAmount/solarAmount/hungerAmount set.
  // turn.ts's applyItemUse special-cases itemId === 'antidote' (mirroring
  // banana/chocolate). displayName/glyph corrected per user instruction:
  // the item is "毒消し" (not "毒消し草"), sharing the provisional 💊
  // glyph with panacea below — the two are distinguished by displayName
  // wherever both might appear (ground glyphs render identically, but
  // the inventory overlay and any hover/label always shows displayName).
  antidote: {
    id: 'antidote',
    displayName: '毒消し',
    glyph: '💊',
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  // Panacea (Phase 12.4 status-ailment removal foundation): cures every
  // currently-implemented status ailment at once (poison, movement_slow,
  // spider_web, petrification — see effects.ts's STATUS_AILMENT_IDS),
  // never attack_up (a beneficial effect, not an ailment) and never HP/
  // SOL/hunger. turn.ts's applyItemUse special-cases itemId === 'panacea'
  // exactly like antidote. Shares antidote's provisional 💊 glyph per
  // user instruction (both are placeholder icons pending real sprite
  // assets); displayName is the only reliable visual distinguisher.
  panacea: {
    id: 'panacea',
    displayName: '万能薬',
    glyph: '💊',
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  // Flame/frost/cloud/earth enchantments (Phase 14.2 five-element
  // acquisition): one-time unlock pickups, exactly like sol_enchantment
  // above — deliberately excluded from ITEM_IDS_IN_ORDER so they never
  // appear in the general inventory overlay or go through the generic
  // inventory[itemId]++ auto-pickup path; turn.ts's ground-item pickup
  // handling special-cases each of these four ids and sets the matching
  // GameState.unlockedEnchantments entry directly instead.
  // displayName/glyph come from element-def.ts's single source of truth
  // so each element's name/glyph exists in exactly one place.
  flame_enchantment: {
    id: 'flame_enchantment',
    displayName: ELEMENT_DISPLAY_NAMES.flame,
    glyph: ELEMENT_GLYPHS.flame,
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
  frost_enchantment: {
    id: 'frost_enchantment',
    displayName: ELEMENT_DISPLAY_NAMES.frost,
    glyph: ELEMENT_GLYPHS.frost,
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
  cloud_enchantment: {
    id: 'cloud_enchantment',
    displayName: ELEMENT_DISPLAY_NAMES.cloud,
    glyph: ELEMENT_GLYPHS.cloud,
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
  earth_enchantment: {
    id: 'earth_enchantment',
    displayName: ELEMENT_DISPLAY_NAMES.earth,
    glyph: ELEMENT_GLYPHS.earth,
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
};

/** Fixed display/iteration order for items (Phase 08.2: apple; Phase 08.3 adds sword; Phase 08.4 adds armor; Phase 08.5 adds spear; Phase 08.7 adds hammer; Phase 09.1 adds sun_fruit; Phase 09.2 adds solar_gun). */
export const ITEM_IDS_IN_ORDER: ItemId[] = ['apple', 'sword', 'armor', 'spear', 'hammer', 'sun_fruit', 'solar_gun', 'chocolate', 'banana', 'antidote', 'panacea'];

/** An inventory with every registered item at count 0 (used for new-run initialization). */
export function createEmptyInventory(): Inventory {
  const inventory = {} as Inventory;
  for (const id of ITEM_IDS_IN_ORDER) {
    inventory[id] = 0;
  }
  return inventory;
}
