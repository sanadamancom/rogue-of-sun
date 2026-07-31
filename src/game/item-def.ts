import { ItemId, Inventory } from './types';

/**
 * A single item species' shared display/inventory data (Phase 08.2
 * inventory foundation; Phase 08.3 adds the 'weapon' category; Phase 08.4
 * adds the 'armor' category). `healAmount` only applies to consumable
 * healing items (currently just 'apple'); weapon-specific combat stats
 * live in weapon-def.ts's WEAPON_DEFINITIONS and armor-specific defensive
 * stats live in armor-def.ts's ARMOR_DEFINITIONS, both keyed by the same
 * id, rather than being duplicated here.
 */
export interface ItemDefinition {
  id: ItemId;
  displayName: string;
  /** Sprite/emoji glyph used by the loader/renderer for this item. Phase 08.2/08.3/08.4 use plain emoji glyphs in place of processed sprite assets (user-approved substitution; see docs/history/phase-08-2-inventory-and-apple-healing.md, phase-08-3-weapon-equipment-and-sword.md, and phase-08-4-armor-defense-and-floor2-golem.md). */
  glyph: string;
  category: 'consumable' | 'weapon' | 'armor';
  /** Whether using this item removes one from the inventory (true for apple, false for sword/armor — equipping never consumes either). */
  consumable: boolean;
  /** Whether multiple copies stack into one inventory count (true for apple; false for sword/armor — Phase 08.3/08.4 never place more than one, and equipment isn't stacked). */
  stackable: boolean;
  /** HP restored by one use, before clamping to the player's maxHp. Only meaningful for consumable healing items. */
  healAmount?: number;
}

// Single source of truth for every registered item's name, glyph, and
// inventory-display behavior. Phase 08.2 registered only 'apple'; Phase
// 08.3 added 'sword'; Phase 08.4 adds 'armor'. Future items (sun fruit,
// sun gun, spear, hammer) are expected to extend this table rather than
// add parallel ad-hoc fields elsewhere.
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
};

/** Fixed display/iteration order for items (Phase 08.2: apple; Phase 08.3 adds sword; Phase 08.4 adds armor). */
export const ITEM_IDS_IN_ORDER: ItemId[] = ['apple', 'sword', 'armor'];

/** An inventory with every registered item at count 0 (used for new-run initialization). */
export function createEmptyInventory(): Inventory {
  const inventory = {} as Inventory;
  for (const id of ITEM_IDS_IN_ORDER) {
    inventory[id] = 0;
  }
  return inventory;
}
