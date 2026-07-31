import { ITEM_IDS_IN_ORDER } from './item-def';
import { processTurn, TurnResult } from './turn';
import { GameState, ItemId } from './types';

export interface InventoryEntry {
  itemId: ItemId;
  count: number;
}

/**
 * The inventory's current display list: only items with a positive count,
 * in ITEM_IDS_IN_ORDER order (Phase 08.2 requirement: "個数0の項目をUIへ
 * 表示しない"). Pure/side-effect-free so it can be used identically by the
 * overlay renderer and by navigation/use logic below.
 */
export function inventoryEntries(state: GameState): InventoryEntry[] {
  return ITEM_IDS_IN_ORDER.filter((id) => (state.inventory[id] ?? 0) > 0).map((id) => ({
    itemId: id,
    count: state.inventory[id],
  }));
}

/**
 * Toggles the inventory overlay (Tab). A no-op while the game is not in
 * 'playing' phase (player_dead/floor-transition/etc. per
 * unavailable_states), and while the underlying phase transitions to a
 * non-'playing' phase this is never called anyway. Opening always resets
 * the selection to the first entry. Consumes no turn.
 */
export function toggleInventory(state: GameState): void {
  if (state.phase !== 'playing') return;
  state.inventoryOpen = !state.inventoryOpen;
  if (state.inventoryOpen) {
    state.selectedItemIndex = 0;
  }
}

/** Closes the inventory overlay (Escape). Safe to call whether or not it is open. Consumes no turn. */
export function closeInventory(state: GameState): void {
  state.inventoryOpen = false;
}

/**
 * Moves the selected inventory entry by `delta` (+1 = ArrowDown, -1 =
 * ArrowUp), wrapping within the current non-empty entry list. A no-op
 * (selection stays 0) when the inventory is empty. Consumes no turn.
 */
export function moveInventorySelection(state: GameState, delta: number): void {
  const entries = inventoryEntries(state);
  if (entries.length === 0) {
    state.selectedItemIndex = 0;
    return;
  }
  state.selectedItemIndex =
    ((state.selectedItemIndex + delta) % entries.length + entries.length) % entries.length;
}

/** An unconsumed, event-free TurnResult, used when Enter is pressed on an empty inventory (no exception, no turn). */
function noopResult(): TurnResult {
  return {
    consumed: false,
    playerAttacked: false,
    enemyDefeated: false,
    enemyActed: false,
    enemyAttacked: false,
    playerDefeated: false,
    playerRegenerated: false,
    events: [],
  };
}

/**
 * Uses the currently-selected inventory entry (Enter), routing through the
 * normal processTurn pipeline (see turn.ts's 'use_item' handling) so a
 * successful use runs the exact same enemy-resolution/regen/floor-check
 * sequence as any other player action. Returns a no-op result without
 * throwing or consuming a turn if the inventory is empty (Phase 08.2
 * requirement: "空の状態でEnterを押しても何も消費せず、ターンも進めない").
 */
export function useSelectedInventoryItem(state: GameState): TurnResult {
  const entries = inventoryEntries(state);
  if (entries.length === 0) {
    return noopResult();
  }
  const clampedIndex = Math.min(state.selectedItemIndex, entries.length - 1);
  const itemId = entries[clampedIndex].itemId;
  return processTurn(state, { type: 'use_item', itemId });
}
