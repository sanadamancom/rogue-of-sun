import { ItemId, Inventory } from './types';

/**
 * A single item species' fixed data (Phase 08.2 inventory foundation).
 * `healAmount` is specific to consumable healing items; a future
 * non-healing item (weapon, armor) would simply not use that field, but no
 * subtype hierarchy is introduced yet since Phase 08.2 only ever has one
 * kind of item.
 */
export interface ItemDefinition {
  id: ItemId;
  displayName: string;
  /** Sprite/emoji glyph used by the loader/renderer for this item. Phase 08.2 uses a plain emoji glyph in place of a processed sprite asset (user-approved substitution; see docs/history/phase-08-2-inventory-and-apple-healing.md). */
  glyph: string;
  /** HP restored by one use, before clamping to the player's maxHp. */
  healAmount: number;
}

// Single source of truth for every registered item's name, glyph, and
// effect. Phase 08.2 registers only 'apple'; future items (sun fruit, sun
// gun, sword, armor) are expected to extend this table rather than add
// parallel ad-hoc fields elsewhere.
export const ITEM_DEFINITIONS: Record<ItemId, ItemDefinition> = {
  apple: {
    id: 'apple',
    displayName: 'リンゴ',
    glyph: '🍎',
    healAmount: 2,
  },
};

/** Fixed display/iteration order for items (Phase 08.2: just apple). */
export const ITEM_IDS_IN_ORDER: ItemId[] = ['apple'];

/** An inventory with every registered item at count 0 (used for new-run initialization). */
export function createEmptyInventory(): Inventory {
  const inventory = {} as Inventory;
  for (const id of ITEM_IDS_IN_ORDER) {
    inventory[id] = 0;
  }
  return inventory;
}
