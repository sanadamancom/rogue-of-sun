import { ItemId, Inventory } from './types';

/**
 * A single item species' shared display/inventory data (Phase 08.2
 * inventory foundation; Phase 08.3 adds the 'weapon' category and
 * consumable/stackable flags). `healAmount` only applies to consumable
 * healing items (currently just 'apple'); weapon-specific combat stats
 * (attack power, range) live in weapon-def.ts's WEAPON_DEFINITIONS,
 * keyed by the same id, rather than being duplicated here.
 */
export interface ItemDefinition {
  id: ItemId;
  displayName: string;
  /** Sprite/emoji glyph used by the loader/renderer for this item. Phase 08.2/08.3 use plain emoji glyphs in place of processed sprite assets (user-approved substitution; see docs/history/phase-08-2-inventory-and-apple-healing.md and phase-08-3-weapon-equipment-and-sword.md). */
  glyph: string;
  category: 'consumable' | 'weapon';
  /** Whether using this item removes one from the inventory (true for apple, false for sword — equipping never consumes it). */
  consumable: boolean;
  /** Whether multiple copies stack into one inventory count (true for apple; false for sword — Phase 08.3 never places more than one, and equipment isn't stacked). */
  stackable: boolean;
  /** HP restored by one use, before clamping to the player's maxHp. Only meaningful for consumable healing items. */
  healAmount?: number;
}

// Single source of truth for every registered item's name, glyph, and
// inventory-display behavior. Phase 08.2 registered only 'apple'; Phase
// 08.3 adds 'sword'. Future items (sun fruit, sun gun, spear, hammer,
// armor) are expected to extend this table rather than add parallel
// ad-hoc fields elsewhere.
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
};

/** Fixed display/iteration order for items (Phase 08.2: apple; Phase 08.3 adds sword). */
export const ITEM_IDS_IN_ORDER: ItemId[] = ['apple', 'sword'];

/** An inventory with every registered item at count 0 (used for new-run initialization). */
export function createEmptyInventory(): Inventory {
  const inventory = {} as Inventory;
  for (const id of ITEM_IDS_IN_ORDER) {
    inventory[id] = 0;
  }
  return inventory;
}
