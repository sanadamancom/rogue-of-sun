import { ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from './item-def';
import { processTurn, TurnResult } from './turn';
import { GameState, ItemId } from './types';

export interface InventoryEntry {
  itemId: ItemId;
  count: number;
}

/**
 * Phase 11.1 inventory capacity: the maximum total count across every
 * regular inventory item combined (GameState.inventory's values summed),
 * not a per-slot or per-species limit. `sol_enchantment` never goes
 * through GameState.inventory (see item-def.ts's doc comment) and is
 * therefore never part of this total.
 */
export const INVENTORY_CAPACITY = 20;

/**
 * Sums every item count currently held in GameState.inventory. Pure/
 * side-effect-free so it can be reused by both the capacity check in
 * turn.ts and by tests/UI without duplicating the summation logic.
 */
export function totalInventoryCount(state: GameState): number {
  return Object.values(state.inventory).reduce((sum, count) => sum + count, 0);
}

/**
 * Whether picking up one more regular inventory item would still fit
 * within INVENTORY_CAPACITY. Pure/side-effect-free; does not mutate state
 * or itself decide what happens on failure (that remains turn.ts's
 * responsibility, so ground-item removal/event pushing stays there).
 */
export function hasInventoryCapacity(state: GameState): boolean {
  return totalInventoryCount(state) < INVENTORY_CAPACITY;
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
    // Mutual exclusion with the ability allocation overlay (P) — Phase
    // 13.2's overlay.mutual_exclusion's "inventory overlayを開くと能力
    // overlayは閉じる". See ability.ts's toggleAbilityOverlay for the
    // symmetric close on its side.
    state.abilityOverlayOpen = false;
    state.abilityConfirmPending = null;
  }
  // Phase 11.2: a pending discard confirmation never survives the
  // overlay being toggled (open or closed) — see discard_action.
  // confirmation's "所持品画面を閉じた場合は削除しない", which also means
  // no stale confirmation should reappear on the next open.
  state.discardConfirmItemId = null;
}

/** Closes the inventory overlay (Escape). Safe to call whether or not it is open. Consumes no turn. */
export function closeInventory(state: GameState): void {
  state.inventoryOpen = false;
  state.discardConfirmItemId = null;
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
    playerRegenAmount: 0,
    events: [],
  };
}

/**
 * Uses or equips the currently-selected inventory entry (Enter), routing
 * through the normal processTurn pipeline (see turn.ts's 'use_item' and
 * 'equip_weapon' handling) so a successful action runs the exact same
 * enemy-resolution/regen/floor-check sequence as any other player action.
 * Consumables (apple) are used; weapons (sword) are equipped — the
 * dispatch is based on the selected item's registered category, so both
 * share this single selection/Enter control (Phase 08.3 requirement:
 * "リンゴとソードを同じ選択処理で扱えるようにする"). Returns a no-op
 * result without throwing or consuming a turn if the inventory is empty
 * (Phase 08.2 requirement: "空の状態でEnterを押しても何も消費せず、ター
 * ンも進めない").
 */
/**
 * Determines which PlayerAction Enter would submit for the currently
 * selected inventory entry, without actually submitting it (Phase
 * 10.3.2 telemetry-correctness fix): the same category dispatch
 * useSelectedInventoryItem already does, factored out so main.ts can
 * know the action for telemetry purposes without duplicating this
 * routing logic or calling processTurn twice. Returns null for an empty
 * inventory (mirrors useSelectedInventoryItem's noopResult case).
 */
export function selectedInventoryAction(state: GameState): import('./types').PlayerAction | null {
  const entries = inventoryEntries(state);
  if (entries.length === 0) return null;
  const clampedIndex = Math.min(state.selectedItemIndex, entries.length - 1);
  const itemId = entries[clampedIndex].itemId;
  const def = ITEM_DEFINITIONS[itemId];
  if (def.category === 'weapon') {
    return { type: 'equip_weapon', weaponId: itemId as import('./types').WeaponId };
  }
  if (def.category === 'armor') {
    return { type: 'equip_armor', armorId: itemId as import('./types').ArmorId };
  }
  return { type: 'use_item', itemId };
}

/**
 * Returns the itemId of the currently-selected inventory entry, or null
 * if the inventory is empty. Unlike selectedInventoryAction, this does
 * not decide a category-based PlayerAction — used by place/discard
 * (Phase 11.2) which apply to the selected item regardless of its
 * category.
 */
export function selectedItemId(state: GameState): ItemId | null {
  const entries = inventoryEntries(state);
  if (entries.length === 0) return null;
  const clampedIndex = Math.min(state.selectedItemIndex, entries.length - 1);
  return entries[clampedIndex].itemId;
}

export function useSelectedInventoryItem(state: GameState): TurnResult {
  const action = selectedInventoryAction(state);
  if (!action) return noopResult();
  return processTurn(state, action);
}
