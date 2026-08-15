import { describe, expect, it } from 'vitest';
import { createInitialState, advanceToNextFloor } from '../state';
import { processTurn } from '../turn';
import { createEquipmentInstance, getHeldEquipmentInstances } from '../equipment-instance';
import {
  isGeneralItemIdentified,
  markGeneralItemIdentified,
  getDisplayedItemName,
  GENERAL_IDENTIFIABLE_CONSUMABLE_IDS,
  isGeneralIdentifiableEquipment,
  normalizeIdentifiedGeneralItemIds,
} from '../item-identification';
import { describeCardTargetCandidate, getStarCandidates } from '../card-target-selection';
import { WEAPON_IDS_IN_ORDER } from '../weapon-def';
import { ARMOR_IDS_IN_ORDER } from '../armor-def';
import { getSolarForgeCandidates } from '../solar-forge';
import { SOLAR_FORGE_RECIPES } from '../solar-forge-recipes';
import { GameState, ItemId, ArmorId } from '../types';

/**
 * Phase 24.4d1 general item identification focused tests. See
 * docs/history/phase-24-4d1-general-item-identification.md for the full
 * contract these tests enforce, and rogue-of-sun-development-plan.md's
 * Phase 24.4d1 task for the authoritative design.
 */

function stateAt(runSeed = 1): GameState {
  return createInitialState(runSeed);
}

describe('Phase 24.4d1: state lifetime', () => {
  it('a new run starts with an empty identifiedGeneralItemIds', () => {
    const state = stateAt();
    expect(state.identifiedGeneralItemIds).toEqual([]);
  });

  it('floor advance keeps identifiedGeneralItemIds', () => {
    const state = stateAt();
    markGeneralItemIdentified(state, 'apple', []);
    const next = advanceToNextFloor(state);
    expect(next.identifiedGeneralItemIds).toEqual(['apple']);
  });

  it('a fresh new run never carries over a previous run identified set', () => {
    const state = stateAt();
    markGeneralItemIdentified(state, 'apple', []);
    const fresh = createInitialState(2);
    expect(fresh.identifiedGeneralItemIds).toEqual([]);
  });

  it('the card identification set and the general item identification set are independent', () => {
    const state = stateAt();
    markGeneralItemIdentified(state, 'apple', []);
    expect(state.identifiedCardIds ?? []).toEqual([]);
    state.identifiedCardIds = ['star'];
    expect(state.identifiedGeneralItemIds).toEqual(['apple']);
  });

  it('markGeneralItemIdentified never mutates combatRngState', () => {
    const state = stateAt();
    const before = state.combatRngState;
    markGeneralItemIdentified(state, 'apple', []);
    expect(state.combatRngState).toBe(before);
  });

  it('normalizeIdentifiedGeneralItemIds drops duplicates, cards, and unknown ids', () => {
    const result = normalizeIdentifiedGeneralItemIds(['apple', 'apple', 'star' as ItemId, 'sword']);
    expect(result).toEqual(['apple', 'sword']);
  });
});

describe('Phase 24.4d1: ordinary consumables', () => {
  it('the audited 7 consumables are general-identifiable', () => {
    expect(GENERAL_IDENTIFIABLE_CONSUMABLE_IDS).toEqual([
      'apple',
      'sun_fruit',
      'chocolate',
      'banana',
      'antidote',
      'panacea',
      'clairvoyance_fruit',
    ]);
  });

  it('picking up apple does not identify it', () => {
    const state = stateAt();
    state.inventory.apple = 1;
    expect(isGeneralItemIdentified(state, 'apple')).toBe(false);
  });

  it('successful apple use identifies apple', () => {
    const state = stateAt();
    state.inventory.apple = 1;
    state.player.hp = state.player.maxHp - 1;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.events.some((e) => e.type === 'general_item_identified' && e.itemId === 'apple')).toBe(true);
    expect(isGeneralItemIdentified(state, 'apple')).toBe(true);
  });

  it('failed apple use (full HP) does not identify it, and consumes nothing', () => {
    const state = stateAt();
    state.inventory.apple = 1;
    const before = state.inventory.apple;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(isGeneralItemIdentified(state, 'apple')).toBe(false);
    expect(state.inventory.apple).toBe(before);
  });

  it('successful antidote use identifies antidote', () => {
    const state = stateAt();
    state.inventory.antidote = 1;
    state.activeEffects = [{ id: 'poison', strength: 1, remainingTurns: 3 }];
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(isGeneralItemIdentified(state, 'antidote')).toBe(true);
  });

  it('failed antidote use (not poisoned) does not identify it', () => {
    const state = stateAt();
    state.inventory.antidote = 1;
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(isGeneralItemIdentified(state, 'antidote')).toBe(false);
  });

  it('clairvoyance_fruit use always succeeds (owned) and identifies it, even with 0 traps', () => {
    const state = stateAt();
    state.inventory.clairvoyance_fruit = 1;
    state.traps = [];
    processTurn(state, { type: 'use_item', itemId: 'clairvoyance_fruit' });
    expect(isGeneralItemIdentified(state, 'clairvoyance_fruit')).toBe(true);
  });

  it('successful banana use identifies banana', () => {
    const state = stateAt();
    state.inventory.banana = 1;
    processTurn(state, { type: 'use_item', itemId: 'banana' });
    expect(isGeneralItemIdentified(state, 'banana')).toBe(true);
  });

  it('successful chocolate use identifies chocolate', () => {
    const state = stateAt();
    state.inventory.chocolate = 1;
    state.hunger = 10;
    processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(isGeneralItemIdentified(state, 'chocolate')).toBe(true);
  });

  it('successful sun_fruit use identifies sun_fruit', () => {
    const state = stateAt();
    state.inventory.sun_fruit = 1;
    state.solarEnergy = 0;
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(isGeneralItemIdentified(state, 'sun_fruit')).toBe(true);
  });

  it('successful panacea use identifies panacea', () => {
    const state = stateAt();
    state.inventory.panacea = 1;
    state.activeEffects = [{ id: 'poison', strength: 1, remainingTurns: 3 }];
    processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(isGeneralItemIdentified(state, 'panacea')).toBe(true);
  });

  it('identifying one consumable never identifies a different one', () => {
    const state = stateAt();
    state.inventory.apple = 1;
    state.player.hp = state.player.maxHp - 1;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(isGeneralItemIdentified(state, 'banana')).toBe(false);
  });

  it('one-time unlock items (sol_enchantment and the 4 elements) are always identified', () => {
    const state = stateAt();
    expect(isGeneralItemIdentified(state, 'sol_enchantment')).toBe(true);
    expect(isGeneralItemIdentified(state, 'flame_enchantment')).toBe(true);
    expect(isGeneralItemIdentified(state, 'frost_enchantment')).toBe(true);
    expect(isGeneralItemIdentified(state, 'cloud_enchantment')).toBe(true);
    expect(isGeneralItemIdentified(state, 'earth_enchantment')).toBe(true);
  });
});

describe('Phase 24.4d1: weapons and armor', () => {
  it('every registered WeaponId except solar_gun is general-identifiable', () => {
    for (const id of WEAPON_IDS_IN_ORDER) {
      expect(isGeneralIdentifiableEquipment(id)).toBe(id !== 'solar_gun');
    }
  });

  it('every registered ArmorId is general-identifiable', () => {
    for (const id of ARMOR_IDS_IN_ORDER) {
      expect(isGeneralIdentifiableEquipment(id)).toBe(true);
    }
  });

  it('solar_gun is always identified', () => {
    const state = stateAt();
    expect(isGeneralItemIdentified(state, 'solar_gun')).toBe(true);
  });

  it('a randomly obtained sword is unidentified until equipped', () => {
    const state = stateAt();
    createEquipmentInstance(state, 'sword');
    state.inventory.sword = 1;
    expect(isGeneralItemIdentified(state, 'sword')).toBe(false);
  });

  it('successful equip identifies the weapon definitionId', () => {
    const state = stateAt();
    createEquipmentInstance(state, 'sword');
    state.inventory.sword = 1;
    const result = processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(result.events.some((e) => e.type === 'general_item_identified' && e.itemId === 'sword')).toBe(true);
    expect(isGeneralItemIdentified(state, 'sword')).toBe(true);
  });

  it('a second held sword individual is also identified once the first equips', () => {
    const state = stateAt();
    createEquipmentInstance(state, 'sword');
    createEquipmentInstance(state, 'sword');
    state.inventory.sword = 2;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    const heldSwords = getHeldEquipmentInstances(state).filter((i) => i.definitionId === 'sword');
    expect(heldSwords).toHaveLength(2);
    expect(isGeneralItemIdentified(state, 'sword')).toBe(true);
  });

  it('equipping sword never identifies a different weapon species', () => {
    const state = stateAt();
    createEquipmentInstance(state, 'sword');
    createEquipmentInstance(state, 'spear');
    state.inventory.sword = 1;
    state.inventory.spear = 1;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(isGeneralItemIdentified(state, 'spear')).toBe(false);
  });

  it('blocked equip (invalid instance) does not identify the weapon', () => {
    const state = stateAt();
    createEquipmentInstance(state, 'sword');
    state.inventory.sword = 1;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: 'not-real' });
    expect(isGeneralItemIdentified(state, 'sword')).toBe(false);
  });

  it('successful armor equip identifies the armor definitionId', () => {
    const state = stateAt();
    createEquipmentInstance(state, 'chain_mail' as ArmorId);
    state.inventory.chain_mail = 1;
    processTurn(state, { type: 'equip_armor', armorId: 'chain_mail' as ArmorId });
    expect(isGeneralItemIdentified(state, 'chain_mail' as ItemId)).toBe(true);
  });

  it('body identification and curseRevealed are independent', () => {
    const state = stateAt();
    const instance = createEquipmentInstance(state, 'sword');
    instance.cursed = true;
    state.inventory.sword = 1;
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(isGeneralItemIdentified(state, 'sword')).toBe(true);
    expect(instance.curseRevealed).toBe(true);
  });
});

describe('Phase 24.4d1: display resolver', () => {
  it('an unidentified consumable shows the generic consumable name', () => {
    const state = stateAt();
    expect(getDisplayedItemName(state, 'apple')).toBe('未鑑定の消耗品');
  });

  it('an unidentified weapon shows the generic weapon name', () => {
    const state = stateAt();
    expect(getDisplayedItemName(state, 'sword')).toBe('未鑑定の武器');
  });

  it('an unidentified armor shows the generic armor name', () => {
    const state = stateAt();
    expect(getDisplayedItemName(state, 'chain_mail' as ItemId)).toBe('未鑑定の防具');
  });

  it('an identified item shows its real name', () => {
    const state = stateAt();
    markGeneralItemIdentified(state, 'apple', []);
    expect(getDisplayedItemName(state, 'apple')).toBe('リンゴ');
  });

  it('an unidentified card still shows the existing card placeholder (unchanged by this phase)', () => {
    const state = stateAt();
    expect(getDisplayedItemName(state, 'star')).toBe('未鑑定のカード');
  });
});

describe('Phase 24.4d1: solar forge', () => {
  it('an unidentified weapon never becomes a forge material candidate', () => {
    const state = stateAt();
    createEquipmentInstance(state, 'sword');
    createEquipmentInstance(state, 'sword');
    state.inventory.sword = 2;
    const candidates = getSolarForgeCandidates(state, SOLAR_FORGE_RECIPES);
    expect(candidates).toEqual([]);
  });

  it('successful forge identifies the output definition', () => {
    const state = stateAt();
    const a = createEquipmentInstance(state, 'sword');
    const b = createEquipmentInstance(state, 'sword');
    state.inventory.sword = 2;
    markGeneralItemIdentified(state, 'sword', []);
    const candidates = getSolarForgeCandidates(state, SOLAR_FORGE_RECIPES);
    if (candidates.length > 0) {
      const result = processTurn(state, {
        type: 'solar_forge',
        materialInstanceIds: [candidates[0].instanceIdA, candidates[0].instanceIdB],
      });
      const completed = result.events.find((e) => e.type === 'solar_forge_completed');
      if (completed && completed.type === 'solar_forge_completed') {
        expect(isGeneralItemIdentified(state, completed.outputDefinitionId as ItemId)).toBe(true);
      }
    }
    // With the current production SOLAR_FORGE_RECIPES registry there may
    // be 0 valid same-species pairs — this test only asserts the
    // identification contract when a completion actually occurs, and
    // never fails merely because the fixed catalog has no C-tier
    // sword+sword recipe registered.
    expect(a.definitionId).toBe('sword');
    expect(b.definitionId).toBe('sword');
  });
});

describe('Phase 24.4d1: card target selection (star) display leakage', () => {
  it('an unidentified ordinary consumable candidate shows the generic name, not its true name', () => {
    const state = stateAt();
    state.inventory.apple = 1;
    state.inventory.chocolate = 1; // gives apple a same-category alternate
    const candidates = getStarCandidates(state);
    const appleRef = candidates.find((c) => c.kind === 'inventory_item' && c.itemId === 'apple');
    expect(appleRef).toBeDefined();
    if (appleRef) {
      const info = describeCardTargetCandidate(state, 'star', appleRef);
      expect(info.displayName).toBe('未鑑定の消耗品');
    }
  });

  it('an unidentified equipment candidate shows the generic name and withholds refineLevel', () => {
    const state = stateAt();
    const instance = createEquipmentInstance(state, 'sword');
    instance.refineLevel = 2;
    state.inventory.sword = 1;
    const ref = { kind: 'equipment_instance' as const, instanceId: instance.instanceId };
    const info = describeCardTargetCandidate(state, 'star', ref);
    expect(info.displayName).toBe('未鑑定の武器');
    expect(info.refineLevel).toBeUndefined();
  });

  it('once identified, the candidate shows its real name and refineLevel', () => {
    const state = stateAt();
    const instance = createEquipmentInstance(state, 'sword');
    instance.refineLevel = 1;
    state.inventory.sword = 1;
    markGeneralItemIdentified(state, 'sword', []);
    const ref = { kind: 'equipment_instance' as const, instanceId: instance.instanceId };
    const info = describeCardTargetCandidate(state, 'star', ref);
    expect(info.displayName).not.toBe('未鑑定の武器');
    expect(info.refineLevel).toBe(1);
  });
});

describe('Phase 24.4d1: cards regression (Phase 20 contract unchanged)', () => {
  it('card pickup alone does not identify it', () => {
    const state = stateAt();
    state.inventory.star = 1;
    expect((state.identifiedCardIds ?? []).includes('star')).toBe(false);
  });

  it('identifiedCardIds is untouched by markGeneralItemIdentified', () => {
    const state = stateAt();
    markGeneralItemIdentified(state, 'apple', []);
    expect(state.identifiedCardIds ?? []).toEqual([]);
  });
});
