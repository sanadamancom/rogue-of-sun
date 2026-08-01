import { ItemId, Inventory } from './types';

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
    healAmount: 2,
  },
  sword: {
    id: 'sword',
    displayName: 'ソード',
    glyph: '🗡️',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  armor: {
    id: 'armor',
    displayName: 'アーマー',
    glyph: '🛡️',
    category: 'armor',
    consumable: false,
    stackable: false,
  },
  spear: {
    id: 'spear',
    displayName: 'スピア',
    glyph: '🔱',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  hammer: {
    id: 'hammer',
    displayName: 'ハンマー',
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
};

/** Fixed display/iteration order for items (Phase 08.2: apple; Phase 08.3 adds sword; Phase 08.4 adds armor; Phase 08.5 adds spear; Phase 08.7 adds hammer; Phase 09.1 adds sun_fruit; Phase 09.2 adds solar_gun). */
export const ITEM_IDS_IN_ORDER: ItemId[] = ['apple', 'sword', 'armor', 'spear', 'hammer', 'sun_fruit', 'solar_gun'];

/** An inventory with every registered item at count 0 (used for new-run initialization). */
export function createEmptyInventory(): Inventory {
  const inventory = {} as Inventory;
  for (const id of ITEM_IDS_IN_ORDER) {
    inventory[id] = 0;
  }
  return inventory;
}
