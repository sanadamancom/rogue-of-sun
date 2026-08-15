import { describe, expect, it } from 'vitest';
import {
  findHeldInstanceById,
  getEquipmentInstanceById,
  getEquipmentInstances,
  getHeldEquipmentInstances,
  normalizeEquipmentInstances,
} from '../equipment-instance';
import {
  inventoryEntries,
  selectedEquipmentInstanceId,
  selectedInventoryAction,
  selectedInventoryEntry,
  toggleInventory,
  useSelectedInventoryItem,
} from '../inventory';
import { advanceToNextFloor, createInitialState } from '../state';
import { processTurn } from '../turn';
import { GameState, EquipmentInstance } from '../types';

/**
 * Phase 24.1 equipment-instance action tests: individual selection,
 * equip/unequip transitions, place/discard identity, rank data
 * plumbing, legacy fallback compatibility, and RNG non-consumption. See
 * docs/history/phase-24-1-equipment-instance-actions.md (this phase's
 * history document) for the full contract these tests enforce.
 */

function stateWithSwordCount(count: number): GameState {
  const state = createInitialState(1);
  state.inventory.sword = count;
  normalizeEquipmentInstances(state);
  return state;
}

function stateWithArmorCount(count: number): GameState {
  const state = createInitialState(1);
  state.inventory.armor = count;
  normalizeEquipmentInstances(state);
  return state;
}

/**
 * The player's currently-held (never floor-only) EquipmentInstances of
 * one species, in stable order — filters out any unrelated instance
 * createInitialState's own floor generation may have separately minted
 * for a floor-generated ground item of the same or a different species,
 * so tests never accidentally index into an instance the test itself
 * didn't create.
 */
function heldOf(state: GameState, definitionId: 'sword' | 'armor'): EquipmentInstance[] {
  return getHeldEquipmentInstances(state).filter((i) => i.definitionId === definitionId);
}

describe('Phase 24.1: rank data foundation', () => {
  it('mint sets rank from the species definition (sword)', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    expect(instance.rank).toBe('C');
  });

  it('normalize backfills a missing/invalid rank to the species definition rank', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    // @ts-expect-error intentionally malformed for the normalize test
    instance.rank = undefined;
    normalizeEquipmentInstances(state);
    expect(instance.rank).toBe('C');
  });

  it('normalize leaves an already-valid rank untouched', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    instance.rank = 'S';
    normalizeEquipmentInstances(state);
    expect(instance.rank).toBe('S');
  });

  it('rank is not applied to combat: two swords with different ranks deal identical damage (rank data-only this phase)', () => {
    const state = stateWithSwordCount(2);
    const [a, b] = heldOf(state, 'sword');
    a.rank = 'C';
    b.rank = 'S';
    // No production combat code reads EquipmentInstance.rank at all —
    // WEAPON_DEFINITIONS[weaponId].attackPower is the sole source for
    // damage, unaffected by which individual (or its rank) is equipped.
    expect(a.rank).not.toBe(b.rank);
  });
});

describe('Phase 24.1: inventory entry per-individual display', () => {
  it('two held individuals of the same definition become two separate entries', () => {
    const state = stateWithSwordCount(2);
    const entries = inventoryEntries(state).filter((e) => e.itemId === 'sword');
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === 'equipment_instance')).toBe(true);
  });

  it('the equipped marker is set on exactly the equipped individual, not the other', () => {
    const state = stateWithSwordCount(2);
    const [first] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: first.instanceId });
    const entries = inventoryEntries(state).filter((e) => e.itemId === 'sword' && e.kind === 'equipment_instance');
    const equippedEntries = entries.filter((e) => e.kind === 'equipment_instance' && e.equipped);
    expect(equippedEntries).toHaveLength(1);
    expect(equippedEntries[0]).toMatchObject({ instanceId: first.instanceId, equipped: true });
  });

  it('entry order is deterministic across repeated calls (equipped-first, then stable array order)', () => {
    const state = stateWithSwordCount(3);
    const [, second] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: second.instanceId });
    const order1 = inventoryEntries(state)
      .filter((e) => e.kind === 'equipment_instance')
      .map((e) => (e.kind === 'equipment_instance' ? e.instanceId : ''));
    const order2 = inventoryEntries(state)
      .filter((e) => e.kind === 'equipment_instance')
      .map((e) => (e.kind === 'equipment_instance' ? e.instanceId : ''));
    expect(order1).toEqual(order2);
    expect(order1[0]).toBe(second.instanceId); // equipped one first
  });

  it('an undiscovered curse never leaks curseRevealed=true through the entry', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    instance.cursed = true; // not yet revealed
    const entry = inventoryEntries(state).find((e) => e.itemId === 'sword');
    expect(entry && entry.kind === 'equipment_instance' && entry.curseRevealed).toBe(false);
  });

  it('rank/refineLevel/curseRevealed are exposed on the entry', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    instance.refineLevel = 2;
    instance.rank = 'A';
    const entry = inventoryEntries(state).find((e) => e.itemId === 'sword');
    expect(entry).toMatchObject({ kind: 'equipment_instance', refineLevel: 2, rank: 'A' });
  });
});

describe('Phase 24.1: instance-aware equip/swap', () => {
  it('equips a specific held individual by instanceId among several', () => {
    const state = stateWithSwordCount(2);
    const [, second] = heldOf(state, 'sword');
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: second.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponInstanceId).toBe(second.instanceId);
  });

  it('swaps to a different held individual of the same definition', () => {
    const state = stateWithSwordCount(2);
    const [first, second] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: first.instanceId });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: second.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponInstanceId).toBe(second.instanceId);
    // The previously-equipped individual is still held, untouched.
    expect(getEquipmentInstanceById(state, first.instanceId)).toBeDefined();
    expect(state.inventory.sword).toBe(2);
  });

  it('rejects an equipmentInstanceId that does not match the requested species (never falls back to a different individual)', () => {
    const state = stateWithSwordCount(1);
    state.inventory.armor = 1;
    normalizeEquipmentInstances(state);
    const armorInstance = heldOf(state, 'armor')[0];
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: armorInstance.instanceId });
    expect(result.consumed).toBe(false);
    expect(state.equippedWeaponId).toBeNull();
    expect(result.events).toContainEqual({ type: 'weapon_equip_blocked', weaponId: 'sword', reason: 'invalid_instance', displayName: '未鑑定の武器' });
  });

  it('rejects an unowned/unknown equipmentInstanceId', () => {
    const state = stateWithSwordCount(1);
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: 'eq-does-not-exist' });
    expect(result.consumed).toBe(false);
    expect(state.equippedWeaponId).toBeNull();
  });

  it('rejects a floor-only (not held) equipmentInstanceId', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    // Place it on the floor: it becomes floor-only, no longer "held".
    state.groundItems.push({ id: 999, itemId: 'sword', pos: { x: 0, y: 0 }, equipmentInstanceId: instance.instanceId });
    state.inventory.sword = 0;
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: instance.instanceId });
    expect(result.consumed).toBe(false);
  });

  it('re-selecting the currently-equipped instanceId is an already-equipped no-op', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: instance.instanceId });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: instance.instanceId });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(result.events).toContainEqual({ type: 'weapon_already_equipped', weaponId: 'sword' });
  });

  it('legacy equip_weapon without equipmentInstanceId still works (backward compatibility)', () => {
    const state = stateWithSwordCount(1);
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBe('sword');
    expect(state.equippedWeaponInstanceId).not.toBeNull();
  });
});

describe('Phase 24.1: unequip', () => {
  it('unequip_weapon succeeds and consumes exactly 1 turn', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: instance.instanceId });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'unequip_weapon', equipmentInstanceId: instance.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.equippedWeaponId).toBeNull();
    expect(state.equippedWeaponInstanceId).toBeNull();
    // The individual stays held, just no longer equipped.
    expect(state.inventory.sword).toBe(1);
    expect(getEquipmentInstanceById(state, instance.instanceId)).toBeDefined();
  });

  it('unequip_armor succeeds', () => {
    const state = stateWithArmorCount(1);
    const [instance] = heldOf(state, 'armor');
    processTurn(state, { type: 'equip_armor', armorId: 'armor', equipmentInstanceId: instance.instanceId });
    const result = processTurn(state, { type: 'unequip_armor', equipmentInstanceId: instance.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.equippedArmorId).toBeNull();
    expect(state.equippedArmorInstanceId).toBeNull();
  });

  it('rejects unequipping a discovered-cursed weapon', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    instance.cursed = true;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: instance.instanceId });
    expect(instance.curseRevealed).toBe(true);
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'unequip_weapon', equipmentInstanceId: instance.instanceId });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.equippedWeaponId).toBe('sword');
    expect(result.events).toContainEqual({ type: 'weapon_unequip_blocked', reason: 'cursed' });
  });

  it('rejects unequipping a discovered-cursed armor', () => {
    const state = stateWithArmorCount(1);
    const [instance] = heldOf(state, 'armor');
    instance.cursed = true;
    processTurn(state, { type: 'equip_armor', armorId: 'armor', equipmentInstanceId: instance.instanceId });
    const result = processTurn(state, { type: 'unequip_armor', equipmentInstanceId: instance.instanceId });
    expect(result.consumed).toBe(false);
    expect(state.equippedArmorId).toBe('armor');
  });

  it('rejects a stale unequip (instanceId no longer matches the currently-equipped one)', () => {
    const state = stateWithSwordCount(2);
    const [first, second] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: first.instanceId });
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: second.instanceId });
    const turnBefore = state.turn;
    // Stale reference to the no-longer-equipped `first`.
    const result = processTurn(state, { type: 'unequip_weapon', equipmentInstanceId: first.instanceId });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.equippedWeaponInstanceId).toBe(second.instanceId);
    expect(result.events).toContainEqual({ type: 'weapon_unequip_blocked', reason: 'stale' });
  });

  it('rejects unequip when nothing is equipped', () => {
    const state = stateWithSwordCount(1);
    const result = processTurn(state, { type: 'unequip_weapon', equipmentInstanceId: 'eq-0' });
    expect(result.consumed).toBe(false);
  });
});

describe('Phase 24.1: place identity', () => {
  it('only an unequipped individual can be placed; the equipped one is rejected even among multiple held', () => {
    const state = stateWithSwordCount(2);
    const [first, second] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: first.instanceId });
    const blocked = processTurn(state, { type: 'place_item', itemId: 'sword', equipmentInstanceId: first.instanceId });
    expect(blocked.consumed).toBe(false);
    expect(state.inventory.sword).toBe(2);

    const ok = processTurn(state, { type: 'place_item', itemId: 'sword', equipmentInstanceId: second.instanceId });
    expect(ok.consumed).toBe(true);
    expect(state.inventory.sword).toBe(1);
    const placedGroundItem = state.groundItems.find((g) => g.equipmentInstanceId === second.instanceId);
    expect(placedGroundItem).toBeDefined();
  });

  it('place preserves the exact instanceId/refineLevel/rank/cursed attributes on the GroundItem, without minting a new instance', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    instance.refineLevel = 1;
    instance.rank = 'B';
    const instanceCountBefore = getEquipmentInstances(state).length;
    processTurn(state, { type: 'place_item', itemId: 'sword', equipmentInstanceId: instance.instanceId });
    expect(getEquipmentInstances(state)).toHaveLength(instanceCountBefore);
    const ground = state.groundItems.find((g) => g.equipmentInstanceId === instance.instanceId);
    expect(ground).toBeDefined();
    const stillTracked = getEquipmentInstanceById(state, instance.instanceId);
    expect(stillTracked).toMatchObject({ refineLevel: 1, rank: 'B' });
  });

  it('re-picking up a placed individual restores the exact same instanceId and attributes', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    instance.refineLevel = 2;
    instance.rank = 'A';
    // Place directly to the player's east so a single 'move' east both
    // steps onto the tile and triggers the existing auto-pickup path
    // (turn.ts's applyPlayerAction move branch) — the same pattern
    // phase-20-0c-equipment-instance.test.ts's pickup regression test
    // uses (relies on runSeed 1's fixed floor 1 layout being open to the
    // player's immediate east, as that existing test already does).
    state.groundItems = [{ id: 0, itemId: 'sword', pos: { x: state.player.pos.x + 1, y: state.player.pos.y }, equipmentInstanceId: instance.instanceId }];
    state.nextGroundItemId = 1;
    state.inventory.sword = 0;
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.sword).toBe(1);
    const pickedUp = getEquipmentInstanceById(state, instance.instanceId);
    expect(pickedUp).toMatchObject({ instanceId: instance.instanceId, refineLevel: 2, rank: 'A' });
  });
});

describe('Phase 24.1: discard identity', () => {
  it('discards only the selected individual; a same-definition sibling is untouched', () => {
    const state = stateWithSwordCount(2);
    const [first, second] = heldOf(state, 'sword');
    const result = processTurn(state, { type: 'discard_item', itemId: 'sword', equipmentInstanceId: first.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.inventory.sword).toBe(1);
    expect(getEquipmentInstanceById(state, first.instanceId)).toBeUndefined();
    expect(getEquipmentInstanceById(state, second.instanceId)).toBeDefined();
  });

  it('rejects discarding the equipped individual even when multiple are held', () => {
    const state = stateWithSwordCount(2);
    const [first] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: first.instanceId });
    const result = processTurn(state, { type: 'discard_item', itemId: 'sword', equipmentInstanceId: first.instanceId });
    expect(result.consumed).toBe(false);
    expect(state.inventory.sword).toBe(2);
    expect(getEquipmentInstanceById(state, first.instanceId)).toBeDefined();
  });

  it('legacy discard_item without equipmentInstanceId still works and rejects when only the equipped individual exists', () => {
    const state = stateWithSwordCount(1);
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    const result = processTurn(state, { type: 'discard_item', itemId: 'sword' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.sword).toBe(1);
  });
});

describe('Phase 24.1: inventory UI selection helpers', () => {
  it('selectedInventoryAction routes to unequip_weapon when the selected entry is the equipped individual', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: instance.instanceId });
    toggleInventory(state);
    const action = selectedInventoryAction(state);
    expect(action).toEqual({ type: 'unequip_weapon', equipmentInstanceId: instance.instanceId });
  });

  it('selectedInventoryAction routes to equip_weapon with the exact instanceId when the selected entry is unequipped', () => {
    const state = stateWithSwordCount(1);
    toggleInventory(state);
    const action = selectedInventoryAction(state);
    const [instance] = heldOf(state, 'sword');
    expect(action).toEqual({ type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: instance.instanceId });
  });

  it('selectedEquipmentInstanceId returns null for a consumable entry', () => {
    const state = createInitialState(1);
    state.inventory.apple = 1;
    toggleInventory(state);
    expect(selectedEquipmentInstanceId(state)).toBeNull();
  });

  it('selectedInventoryEntry exposes the full equipment_instance shape for a weapon entry', () => {
    const state = stateWithSwordCount(1);
    toggleInventory(state);
    const entry = selectedInventoryEntry(state);
    expect(entry).toMatchObject({ kind: 'equipment_instance', itemId: 'sword', rank: 'C' });
  });

  it('useSelectedInventoryItem on the equipped entry performs a real unequip end-to-end', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: instance.instanceId });
    toggleInventory(state);
    const result = useSelectedInventoryItem(state);
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBeNull();
  });
});

describe('Phase 24.1: floor carry-over and new-run initialization', () => {
  it('equipped individual and its rank survive advanceToNextFloor', () => {
    const state = stateWithSwordCount(1);
    const [instance] = heldOf(state, 'sword');
    instance.rank = 'A';
    instance.refineLevel = 1;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: instance.instanceId });
    const nextFloor = advanceToNextFloor(state);
    expect(nextFloor.equippedWeaponInstanceId).toBe(instance.instanceId);
    const carried = getEquipmentInstanceById(nextFloor, instance.instanceId);
    expect(carried).toMatchObject({ rank: 'A', refineLevel: 1 });
  });

  it('a brand new run starts with no equipment instances and null equip state', () => {
    const state = createInitialState(42);
    expect(state.equipmentInstances ?? []).toHaveLength(0);
    expect(state.equippedWeaponInstanceId ?? null).toBeNull();
    expect(state.equippedArmorInstanceId ?? null).toBeNull();
  });
});

describe('Phase 24.1: no new RNG stream consumed', () => {
  it('equip/unequip/place/discard never advance combatRngState', () => {
    const state = stateWithSwordCount(2);
    // Isolate equipment-selection RNG from the ordinary per-turn enemy
    // pipeline (an adjacent enemy attacking back during any consumed
    // turn would also draw from combatRngState — that's expected,
    // pre-existing turn-pipeline behavior unrelated to what this test
    // checks) by removing every enemy first.
    state.enemies = [];
    const [first, second] = heldOf(state, 'sword');
    const rngBefore = state.combatRngState;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: first.instanceId });
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: second.instanceId });
    processTurn(state, { type: 'unequip_weapon', equipmentInstanceId: second.instanceId });
    processTurn(state, { type: 'place_item', itemId: 'sword', equipmentInstanceId: first.instanceId });
    processTurn(state, { type: 'discard_item', itemId: 'sword' });
    expect(state.combatRngState).toBe(rngBefore);
  });
});

describe('Phase 24.1: legacy fixture normalize (no equipmentInstances at all)', () => {
  it('a legacy fixture with only inventory counts gets exactly `count` instances backfilled', () => {
    const state = createInitialState(1);
    state.inventory.sword = 3;
    delete (state as { equipmentInstances?: unknown }).equipmentInstances;
    normalizeEquipmentInstances(state);
    expect(getEquipmentInstances(state).filter((i) => i.definitionId === 'sword')).toHaveLength(3);
  });

  it('a legacy fixture with equippedWeaponId set but no equippedWeaponInstanceId gets the pointer backfilled', () => {
    const state = createInitialState(1);
    state.inventory.sword = 1;
    state.equippedWeaponId = 'sword';
    state.equippedWeaponInstanceId = undefined;
    normalizeEquipmentInstances(state);
    expect(state.equippedWeaponInstanceId).not.toBeNull();
    expect(findHeldInstanceById(state, 'sword', state.equippedWeaponInstanceId!)).toBeDefined();
  });
});
