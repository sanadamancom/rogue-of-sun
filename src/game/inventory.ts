import { ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from './item-def';
import { getHeldEquipmentInstances, isEquipmentDefinitionId, normalizeEquipmentInstances } from './equipment-instance';
import { processTurn, TurnResult } from './turn';
import { EquipmentRank, GameState, ItemId } from './types';

/**
 * Phase 24.1: the inventory's display/selection granularity is no longer
 * uniformly per-ItemId. Consumables/cards stay a single stacked entry
 * (`kind: 'inventory_item'`, unchanged shape/behavior from before this
 * phase); weapons and armor instead get one entry per held
 * EquipmentInstance (`kind: 'equipment_instance'`), so a player holding
 * two individuals of the same species sees and can select each one
 * separately — see docs/history/phase-24-0-equipment-readiness-audit.md's
 * known_problem and phase-24-1-equipment-instance-actions.md's
 * inventory_entry_design. `GameState.inventory`'s per-species count
 * remains the sole source of truth for "how many are held"; this is
 * purely a display/selection view over it plus `equipmentInstances`,
 * never a replacement.
 */
export type InventoryEntry =
  | { kind: 'inventory_item'; itemId: ItemId; count: number }
  | {
      kind: 'equipment_instance';
      itemId: ItemId;
      instanceId: string;
      refineLevel: number;
      rank: EquipmentRank;
      cursed: boolean;
      curseRevealed: boolean;
      equipped: boolean;
    };

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
 * The inventory's current display list, in ITEM_IDS_IN_ORDER order
 * (Phase 08.2 requirement: "個数0の項目をUIへ表示しない", still honored —
 * a species with count 0 contributes no entries at all). For a
 * weapon/armor itemId, contributes one `equipment_instance` entry per
 * held individual (getHeldEquipmentInstances — equipped individual
 * first, then the rest in existing stable `equipmentInstances` array
 * order; never Object-key or RNG order). For every other itemId,
 * contributes the single pre-24.1 `inventory_item` entry unchanged.
 * Calls normalizeEquipmentInstances first so a legacy fixture that only
 * set `inventory` counts (no `equipmentInstances`) still yields exactly
 * `count` equipment_instance entries rather than silently fewer.
 */
export function inventoryEntries(state: GameState): InventoryEntry[] {
  normalizeEquipmentInstances(state);
  const entries: InventoryEntry[] = [];
  for (const itemId of ITEM_IDS_IN_ORDER) {
    const count = state.inventory[itemId] ?? 0;
    if (count <= 0) continue;
    if (isEquipmentDefinitionId(itemId)) {
      const held = getHeldEquipmentInstances(state).filter((instance) => instance.definitionId === itemId);
      for (const instance of held) {
        // Phase 24.5b: 3rd equipped check for accessory, alongside the
        // pre-existing weapon/armor pair — independent slots, never
        // simultaneously true for the same instanceId.
        const equipped =
          instance.instanceId === state.equippedWeaponInstanceId ||
          instance.instanceId === state.equippedArmorInstanceId ||
          instance.instanceId === state.equippedAccessoryInstanceId;
        entries.push({
          kind: 'equipment_instance',
          itemId,
          instanceId: instance.instanceId,
          refineLevel: instance.refineLevel,
          rank: instance.rank,
          cursed: instance.cursed,
          curseRevealed: instance.curseRevealed,
          equipped,
        });
      }
    } else {
      entries.push({ kind: 'inventory_item', itemId, count });
    }
  }
  return entries;
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
  // no stale confirmation should reappear on the next open. Phase 24.1
  // extends this to the paired equipmentInstanceId (inventory_entry_
  // design's discard_confirmation: "inventoryを閉じた場合はItemIdと
  // instanceIdの両方をclearする") so a stale instance target never
  // survives into a later confirmation either.
  state.discardConfirmItemId = null;
  state.discardConfirmEquipmentInstanceId = null;
}

/** Closes the inventory overlay (Escape). Safe to call whether or not it is open. Consumes no turn. */
export function closeInventory(state: GameState): void {
  state.inventoryOpen = false;
  state.discardConfirmItemId = null;
  state.discardConfirmEquipmentInstanceId = null;
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
    monsterHouseRevealed: false,
    events: [],
  };
}

/**
 * Returns the currently-selected InventoryEntry (its full shape,
 * including instanceId/rank/equipped for a weapon/armor entry), or null
 * if the inventory is empty. Every other selection accessor below
 * (selectedItemId, selectedEquipmentInstanceId, selectedInventoryAction)
 * is derived from this single lookup so the index-clamping logic lives
 * in exactly one place.
 */
export function selectedInventoryEntry(state: GameState): InventoryEntry | null {
  const entries = inventoryEntries(state);
  if (entries.length === 0) return null;
  const clampedIndex = Math.min(state.selectedItemIndex, entries.length - 1);
  return entries[clampedIndex];
}

/**
 * Determines which PlayerAction Enter would submit for the currently
 * selected inventory entry, without actually submitting it (Phase
 * 10.3.2 telemetry-correctness fix): the same category dispatch
 * useSelectedInventoryItem already does, factored out so main.ts can
 * know the action for telemetry purposes without duplicating this
 * routing logic or calling processTurn twice. Returns null for an empty
 * inventory (mirrors useSelectedInventoryItem's noopResult case).
 *
 * Phase 24.1: for an `equipment_instance` entry, routes to
 * `unequip_weapon`/`unequip_armor` (with that exact instanceId) when the
 * entry is already the equipped one, or to `equip_weapon`/`equip_armor`
 * (with that exact instanceId) otherwise — inventory_entry_design's
 * "現在装備中の個体を選択して通常の装備操作を確定した場合、equipではなく
 * 対応するunequip actionを送る". A plain `inventory_item` entry (every
 * consumable/card, and defensively any weapon/armor species that
 * somehow has no tracked instance) keeps the pre-24.1 category dispatch.
 */
export function selectedInventoryAction(state: GameState): import('./types').PlayerAction | null {
  const entry = selectedInventoryEntry(state);
  if (!entry) return null;

  if (entry.kind === 'equipment_instance') {
    const def = ITEM_DEFINITIONS[entry.itemId];
    if (def.category === 'weapon') {
      const weaponId = entry.itemId as import('./types').WeaponId;
      return entry.equipped
        ? { type: 'unequip_weapon', equipmentInstanceId: entry.instanceId }
        : { type: 'equip_weapon', weaponId, equipmentInstanceId: entry.instanceId };
    }
    if (def.category === 'armor') {
      const armorId = entry.itemId as import('./types').ArmorId;
      return entry.equipped
        ? { type: 'unequip_armor', equipmentInstanceId: entry.instanceId }
        : { type: 'equip_armor', armorId, equipmentInstanceId: entry.instanceId };
    }
    // Phase 24.5b: accessory branch, identical shape to weapon/armor
    // above — see turn.ts's applyAccessoryEquip/applyAccessoryUnequip.
    if (def.category === 'accessory') {
      const accessoryId = entry.itemId as import('./types').AccessoryId;
      return entry.equipped
        ? { type: 'unequip_accessory', equipmentInstanceId: entry.instanceId }
        : { type: 'equip_accessory', accessoryId, equipmentInstanceId: entry.instanceId };
    }
  }

  const def = ITEM_DEFINITIONS[entry.itemId];
  if (def.category === 'weapon') {
    return { type: 'equip_weapon', weaponId: entry.itemId as import('./types').WeaponId };
  }
  if (def.category === 'armor') {
    return { type: 'equip_armor', armorId: entry.itemId as import('./types').ArmorId };
  }
  // Phase 24.5b: defensive fallback mirroring weapon/armor above — same
  // "somehow has no tracked instance" case, now extended to accessory.
  if (def.category === 'accessory') {
    return { type: 'equip_accessory', accessoryId: entry.itemId as import('./types').AccessoryId };
  }
  return { type: 'use_item', itemId: entry.itemId };
}

/**
 * Returns the itemId of the currently-selected inventory entry, or null
 * if the inventory is empty. Unlike selectedInventoryAction, this does
 * not decide a category-based PlayerAction — used by place/discard
 * (Phase 11.2) which apply to the selected item regardless of its
 * category.
 */
export function selectedItemId(state: GameState): ItemId | null {
  return selectedInventoryEntry(state)?.itemId ?? null;
}

/**
 * Phase 24.1: the equipmentInstanceId of the currently-selected entry, or
 * null when the inventory is empty or the selected entry is a plain
 * `inventory_item` (consumable/card). Used by main.ts to thread the
 * exact selected individual into place_item/discard_item actions instead
 * of relying on turn.ts's legacy first-unequipped-individual fallback.
 */
export function selectedEquipmentInstanceId(state: GameState): string | null {
  const entry = selectedInventoryEntry(state);
  return entry && entry.kind === 'equipment_instance' ? entry.instanceId : null;
}

export function useSelectedInventoryItem(state: GameState): TurnResult {
  const action = selectedInventoryAction(state);
  if (!action) return noopResult();
  return processTurn(state, action);
}
