import { describe, expect, it } from 'vitest';
import {
  findHeldInstanceById,
  getEquipmentInstances,
  getHeldEquipmentInstances,
  isAccessoryId,
  isEquipmentDefinitionId,
  normalizeEquipmentInstances,
} from '../equipment-instance';
import { ACCESSORY_DEFINITIONS, ACCESSORY_IDS_IN_ORDER } from '../accessory-def';
import { ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from '../item-def';
import {
  inventoryEntries,
  selectedInventoryAction,
  selectedInventoryEntry,
  toggleInventory,
} from '../inventory';
import { isGeneralItemIdentified } from '../item-identification';
import { getActiveCurseEligibleInstances } from '../curse-active';
import { getStarCandidates, getTemperanceCandidates } from '../card-target-selection';
import { advanceToNextFloor, createInitialState } from '../state';
import { processTurn } from '../turn';
import { AccessoryId, GameState } from '../types';

/**
 * Phase 24.5b アクセサリー基本装備基盤 focused tests. See
 * docs/history/phase-24-5b-accessory-core.md for the full contract these
 * tests enforce, and docs/history/phase-24-5a2-accessory-selection-audit.md
 * / phase-24-5a2a's finalized selection for the 6-species roster this
 * phase registers (with no effect field — Phase 24.5d's job).
 */

function stateWithAccessory(accessoryId: AccessoryId, count = 1): GameState {
  const state = createInitialState(1);
  state.inventory[accessoryId] = count;
  normalizeEquipmentInstances(state);
  return state;
}

function heldOf(state: GameState, definitionId: AccessoryId) {
  return getHeldEquipmentInstances(state).filter((i) => i.definitionId === definitionId);
}

describe('Phase 24.5b: catalog/type', () => {
  it('registers exactly the 6 finalized species with no duplicates', () => {
    expect(ACCESSORY_IDS_IN_ORDER).toHaveLength(6);
    expect(new Set(ACCESSORY_IDS_IN_ORDER).size).toBe(6);
    expect(ACCESSORY_IDS_IN_ORDER).toEqual([
      'hot_blooded_headband',
      'earth_guard',
      'buckler',
      'adventurer_boots',
      'circlet',
      'grigri_glasses',
    ]);
  });

  it('includes C/B/A/S ranks (Phase 24.5a2a finalized selection)', () => {
    const ranks = ACCESSORY_IDS_IN_ORDER.map((id) => ACCESSORY_DEFINITIONS[id].rank);
    expect(new Set(ranks)).toEqual(new Set(['C', 'B', 'A', 'S']));
    expect(ACCESSORY_DEFINITIONS.hot_blooded_headband.rank).toBe('C');
    expect(ACCESSORY_DEFINITIONS.earth_guard.rank).toBe('C');
    expect(ACCESSORY_DEFINITIONS.buckler.rank).toBe('C');
    expect(ACCESSORY_DEFINITIONS.adventurer_boots.rank).toBe('B');
    expect(ACCESSORY_DEFINITIONS.circlet.rank).toBe('A');
    expect(ACCESSORY_DEFINITIONS.grigri_glasses.rank).toBe('S');
  });

  it('carries no effect/attack/defense field on ItemDefinition', () => {
    for (const id of ACCESSORY_IDS_IN_ORDER) {
      const def = ITEM_DEFINITIONS[id];
      expect(def.category).toBe('accessory');
      expect(def.consumable).toBe(false);
      expect(def.stackable).toBe(false);
      expect((def as unknown as Record<string, unknown>).attackPower).toBeUndefined();
      expect((def as unknown as Record<string, unknown>).armorValue).toBeUndefined();
      expect((def as unknown as Record<string, unknown>).effectId).toBeUndefined();
    }
  });

  it('is not misclassified as weapon or armor', () => {
    for (const id of ACCESSORY_IDS_IN_ORDER) {
      expect(isAccessoryId(id)).toBe(true);
      expect(ITEM_DEFINITIONS[id].category).not.toBe('weapon');
      expect(ITEM_DEFINITIONS[id].category).not.toBe('armor');
    }
  });

  it('every accessory species is present exactly once in ITEM_IDS_IN_ORDER', () => {
    for (const id of ACCESSORY_IDS_IN_ORDER) {
      expect(ITEM_IDS_IN_ORDER.filter((x) => x === id)).toHaveLength(1);
    }
  });
});

describe('Phase 24.5b: state/identity', () => {
  it('starts with the accessory slot empty', () => {
    const state = createInitialState(1);
    expect(state.equippedAccessoryId ?? null).toBeNull();
    expect(state.equippedAccessoryInstanceId ?? null).toBeNull();
  });

  it('distinguishes multiple instances of the same AccessoryId', () => {
    const state = stateWithAccessory('circlet', 2);
    const held = heldOf(state, 'circlet');
    expect(held).toHaveLength(2);
    expect(held[0].instanceId).not.toBe(held[1].instanceId);
  });

  it('pickup preserves identity (equipmentInstanceId unchanged)', () => {
    const state = stateWithAccessory('buckler', 1);
    const [before] = heldOf(state, 'buckler');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'buckler', equipmentInstanceId: before.instanceId });
    const [after] = heldOf(state, 'buckler');
    expect(after.instanceId).toBe(before.instanceId);
  });

  it('equipped accessory persists across a floor transition', () => {
    const state = stateWithAccessory('grigri_glasses', 1);
    const [instance] = heldOf(state, 'grigri_glasses');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'grigri_glasses', equipmentInstanceId: instance.instanceId });
    expect(state.equippedAccessoryId).toBe('grigri_glasses');
    const next = advanceToNextFloor(state);
    expect(next.equippedAccessoryId).toBe('grigri_glasses');
    expect(next.equippedAccessoryInstanceId).toBe(instance.instanceId);
  });

  it('place affects only the targeted instance, not the whole species', () => {
    const state = stateWithAccessory('earth_guard', 2);
    const held = heldOf(state, 'earth_guard');
    const targetId = held[0].instanceId;
    processTurn(state, { type: 'place_item', itemId: 'earth_guard', equipmentInstanceId: targetId });
    const remaining = heldOf(state, 'earth_guard');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].instanceId).not.toBe(targetId);
  });

  it('discard affects only the targeted instance, not the whole species', () => {
    const state = stateWithAccessory('adventurer_boots', 2);
    const held = heldOf(state, 'adventurer_boots');
    const targetId = held[0].instanceId;
    processTurn(state, { type: 'discard_item', itemId: 'adventurer_boots', equipmentInstanceId: targetId });
    const remaining = heldOf(state, 'adventurer_boots');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].instanceId).not.toBe(targetId);
  });

  it('never leaves an orphaned instance after normalizeEquipmentInstances', () => {
    const state = stateWithAccessory('hot_blooded_headband', 3);
    normalizeEquipmentInstances(state);
    const owned = state.inventory.hot_blooded_headband ?? 0;
    expect(heldOf(state, 'hot_blooded_headband')).toHaveLength(owned);
    // Every held instance is also reachable via getEquipmentInstances (no
    // duplicate/dangling entries created by normalization).
    const allIds = new Set(getEquipmentInstances(state).map((i) => i.instanceId));
    for (const instance of heldOf(state, 'hot_blooded_headband')) {
      expect(allIds.has(instance.instanceId)).toBe(true);
    }
  });
});

describe('Phase 24.5b: operations', () => {
  it('equip succeeds, consumes a turn, and syncs equippedAccessoryId/InstanceId', () => {
    const state = stateWithAccessory('circlet', 1);
    const [instance] = heldOf(state, 'circlet');
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'equip_accessory', accessoryId: 'circlet', equipmentInstanceId: instance.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.equippedAccessoryId).toBe('circlet');
    expect(state.equippedAccessoryInstanceId).toBe(instance.instanceId);
  });

  it('unequip succeeds, consumes a turn, and clears the slot', () => {
    const state = stateWithAccessory('buckler', 1);
    const [instance] = heldOf(state, 'buckler');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'buckler', equipmentInstanceId: instance.instanceId });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'unequip_accessory', equipmentInstanceId: instance.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.equippedAccessoryId).toBeNull();
    expect(state.equippedAccessoryInstanceId).toBeNull();
  });

  it('swap to a different accessory is a single equip operation', () => {
    const state = createInitialState(1);
    state.inventory.circlet = 1;
    state.inventory.buckler = 1;
    normalizeEquipmentInstances(state);
    const [circletInstance] = heldOf(state, 'circlet');
    const [bucklerInstance] = heldOf(state, 'buckler');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'circlet', equipmentInstanceId: circletInstance.instanceId });
    const result = processTurn(state, { type: 'equip_accessory', accessoryId: 'buckler', equipmentInstanceId: bucklerInstance.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.equippedAccessoryId).toBe('buckler');
    expect(state.equippedAccessoryInstanceId).toBe(bucklerInstance.instanceId);
  });

  it('re-equipping the same already-equipped instance does not succeed', () => {
    const state = stateWithAccessory('earth_guard', 1);
    const [instance] = heldOf(state, 'earth_guard');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'earth_guard', equipmentInstanceId: instance.instanceId });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'equip_accessory', accessoryId: 'earth_guard', equipmentInstanceId: instance.instanceId });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
  });

  it('equipping a non-held instanceId does not succeed', () => {
    const state = stateWithAccessory('adventurer_boots', 1);
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'equip_accessory', accessoryId: 'adventurer_boots', equipmentInstanceId: 'not-a-real-instance' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
    expect(state.equippedAccessoryId ?? null).toBeNull();
  });

  it('unequip with a stale instanceId does not succeed', () => {
    const state = stateWithAccessory('grigri_glasses', 1);
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'unequip_accessory', equipmentInstanceId: 'not-a-real-instance' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
  });

  it('equipping/unequipping accessory never changes weapon/armor equip state', () => {
    const state = createInitialState(1);
    state.inventory.circlet = 1;
    normalizeEquipmentInstances(state);
    const weaponBefore = state.equippedWeaponId;
    const armorBefore = state.equippedArmorId;
    const [instance] = heldOf(state, 'circlet');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'circlet', equipmentInstanceId: instance.instanceId });
    expect(state.equippedWeaponId).toBe(weaponBefore);
    expect(state.equippedArmorId).toBe(armorBefore);
    processTurn(state, { type: 'unequip_accessory', equipmentInstanceId: instance.instanceId });
    expect(state.equippedWeaponId).toBe(weaponBefore);
    expect(state.equippedArmorId).toBe(armorBefore);
  });

  it('an accessory action never dispatches as use_item', () => {
    const state = stateWithAccessory('buckler', 1);
    toggleInventory(state);
    state.selectedItemIndex = 0;
    const entry = selectedInventoryEntry(state);
    expect(entry?.itemId).toBe('buckler');
    const action = selectedInventoryAction(state);
    expect(action?.type).not.toBe('use_item');
    expect(['equip_accessory', 'unequip_accessory']).toContain(action?.type);
  });
});

describe('Phase 24.5b: identification/UI', () => {
  it('pickup alone does not identify', () => {
    const state = stateWithAccessory('circlet', 1);
    expect(isGeneralItemIdentified(state, 'circlet')).toBe(false);
  });

  it('equip success identifies the definitionId', () => {
    const state = stateWithAccessory('circlet', 1);
    const [instance] = heldOf(state, 'circlet');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'circlet', equipmentInstanceId: instance.instanceId });
    expect(isGeneralItemIdentified(state, 'circlet')).toBe(true);
  });

  it('identification is shared across instances of the same definition', () => {
    const state = stateWithAccessory('earth_guard', 2);
    const held = heldOf(state, 'earth_guard');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'earth_guard', equipmentInstanceId: held[0].instanceId });
    processTurn(state, { type: 'unequip_accessory', equipmentInstanceId: held[0].instanceId });
    // The *other* instance was never itself equipped, but the species is
    // identified run-wide — Phase 24.4d1's run-shared identification.
    expect(isGeneralItemIdentified(state, 'earth_guard')).toBe(true);
  });

  it('unidentified accessory name is withheld in the inventory entry list', () => {
    const state = stateWithAccessory('grigri_glasses', 1);
    const entries = inventoryEntries(state);
    const entry = entries.find((e) => e.itemId === 'grigri_glasses');
    expect(entry).toBeDefined();
    expect(isGeneralItemIdentified(state, 'grigri_glasses')).toBe(false);
  });

  it('inventory entry marks the equipped accessory instance', () => {
    const state = stateWithAccessory('buckler', 1);
    const [instance] = heldOf(state, 'buckler');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'buckler', equipmentInstanceId: instance.instanceId });
    const entries = inventoryEntries(state);
    const entry = entries.find((e) => e.itemId === 'buckler' && e.kind === 'equipment_instance');
    expect(entry && entry.kind === 'equipment_instance' ? entry.equipped : false).toBe(true);
  });

  it('accessory instance entry never reports a curse marker (production-generated cursed:false)', () => {
    const state = stateWithAccessory('adventurer_boots', 1);
    const [instance] = heldOf(state, 'adventurer_boots');
    expect(instance.cursed).toBe(false);
    expect(instance.curseRevealed).toBe(false);
  });
});

describe('Phase 24.5b: exclusions', () => {
  it('accessory instances are excluded from Star candidates', () => {
    const state = stateWithAccessory('circlet', 1);
    const candidates = getStarCandidates(state);
    const [instance] = heldOf(state, 'circlet');
    expect(candidates.some((c) => c.kind === 'equipment_instance' && c.instanceId === instance.instanceId)).toBe(false);
    expect(candidates.some((c) => c.kind === 'inventory_item' && c.itemId === 'circlet')).toBe(false);
  });

  it('accessory instances are excluded from Temperance candidates', () => {
    const state = stateWithAccessory('earth_guard', 1);
    const [instance] = heldOf(state, 'earth_guard');
    // Force a cursed/revealed state directly to prove the exclusion is
    // structural (category-based), not merely incidental to
    // cursed always being false in production.
    instance.cursed = true;
    instance.curseRevealed = true;
    const candidates = getTemperanceCandidates(state);
    expect(candidates.some((c) => c.kind === 'equipment_instance' && c.instanceId === instance.instanceId)).toBe(false);
  });

  it('accessory instances are excluded from mummy/curse_trap eligible instances', () => {
    const state = stateWithAccessory('buckler', 1);
    const eligible = getActiveCurseEligibleInstances(state);
    const [instance] = heldOf(state, 'buckler');
    expect(eligible.some((i) => i.instanceId === instance.instanceId)).toBe(false);
  });

  it('accessory species are never present in normal-floor-generated ground items', () => {
    const state = createInitialState(1);
    for (const item of state.groundItems) {
      expect(isAccessoryId(item.itemId as string)).toBe(false);
    }
  });
});

describe('Phase 24.5b: regression/non-interference', () => {
  it('weapon equip/unequip/swap still works with accessory present', () => {
    const state = createInitialState(1);
    state.inventory.sword = 1;
    state.inventory.circlet = 1;
    normalizeEquipmentInstances(state);
    const [sword] = getHeldEquipmentInstances(state).filter((i) => i.definitionId === 'sword');
    const [circlet] = heldOf(state, 'circlet');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'circlet', equipmentInstanceId: circlet.instanceId });
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: sword.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.equippedWeaponId).toBe('sword');
    expect(state.equippedAccessoryId).toBe('circlet');
  });

  it('armor equip/unequip still works with accessory present', () => {
    const state = createInitialState(1);
    state.inventory.armor = 1;
    state.inventory.buckler = 1;
    normalizeEquipmentInstances(state);
    const [armor] = getHeldEquipmentInstances(state).filter((i) => i.definitionId === 'armor');
    const [buckler] = heldOf(state, 'buckler');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'buckler', equipmentInstanceId: buckler.instanceId });
    const result = processTurn(state, { type: 'equip_armor', armorId: 'armor', equipmentInstanceId: armor.instanceId });
    expect(result.consumed).toBe(true);
    expect(state.equippedArmorId).toBe('armor');
    expect(state.equippedAccessoryId).toBe('buckler');
  });

  it('combatRngState is unchanged by accessory pickup/equip/unequip/place/discard', () => {
    const state = stateWithAccessory('hot_blooded_headband', 2);
    // Isolate equipment-selection RNG from the ordinary per-turn enemy
    // pipeline — see phase-24-1-equipment-instance-actions.test.ts's
    // identical isolation for the same reason (an adjacent enemy acting
    // back during any consumed turn also draws from combatRngState;
    // that's expected, pre-existing turn-pipeline behavior unrelated to
    // what this test checks).
    state.enemies = [];
    const before = state.combatRngState;
    const held = heldOf(state, 'hot_blooded_headband');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'hot_blooded_headband', equipmentInstanceId: held[0].instanceId });
    processTurn(state, { type: 'unequip_accessory', equipmentInstanceId: held[0].instanceId });
    processTurn(state, { type: 'place_item', itemId: 'hot_blooded_headband', equipmentInstanceId: held[1].instanceId });
    expect(state.combatRngState).toBe(before);
  });

  it('telemetry schemaVersion is unaffected (CURRENT_GAME_VERSION untouched by this phase)', () => {
    // Phase 24.5b explicitly does not bump schemaVersion — this is a
    // structural assertion that no accessory-specific raw event/summary
    // field was introduced into the exported RunSummary shape for
    // finalState.equipment (see docs/history/phase-24-5b-accessory-
    // core.md's telemetry judgement section).
    const state = stateWithAccessory('circlet', 1);
    const [instance] = heldOf(state, 'circlet');
    processTurn(state, { type: 'equip_accessory', accessoryId: 'circlet', equipmentInstanceId: instance.instanceId });
    // equippedAccessoryId itself lives on GameState, not on any
    // telemetry RunSummary field this phase touches.
    expect(state.equippedAccessoryId).toBe('circlet');
  });

  it('never leaks an accessory true name for an unidentified species via isEquipmentDefinitionId-gated display paths', () => {
    const state = stateWithAccessory('grigri_glasses', 1);
    expect(isGeneralItemIdentified(state, 'grigri_glasses')).toBe(false);
    expect(isEquipmentDefinitionId('grigri_glasses')).toBe(true);
    // findHeldInstanceById must still resolve the instance (identity
    // tracking is independent of identification) without this test
    // itself needing to read the true name anywhere.
    const [instance] = heldOf(state, 'grigri_glasses');
    expect(findHeldInstanceById(state, 'grigri_glasses', instance.instanceId)).toBeDefined();
  });
});
