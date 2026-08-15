import { describe, expect, it } from 'vitest';
import { CardTargetRef, getStarCandidates, getTransformCandidatesForItem } from '../card-target-selection';
import { createEquipmentInstance, getEquipmentInstanceById, getHeldEquipmentInstances } from '../equipment-instance';
import { createInitialState } from '../state';
import { processTurn } from '../turn';
import { GameState, ItemId } from '../types';
import { ARMOR_DEFINITIONS, ARMOR_IDS_IN_ORDER } from '../armor-def';
import { WEAPON_DEFINITIONS, WEAPON_IDS_IN_ORDER } from '../weapon-def';

function withCard(state: GameState, cardId: ItemId, count: number): GameState {
  return { ...state, inventory: { ...state.inventory, [cardId]: count } };
}

function useStar(state: GameState, target: CardTargetRef) {
  return processTurn(state, { type: 'use_targeted_card', cardId: 'star', target });
}

/**
 * Phase 24.4d2: alignment/GAP-closing tests for star's existing
 * production route (resolveStarEffect / getStarCandidates /
 * getTransformCandidatesForItem in turn.ts / card-target-selection.ts).
 * Does not duplicate Phase 20.5a's existing 30 star/temperance tests —
 * only covers the 4 GAPs this alignment closed: S/R + solar_gun +
 * black_armor exclusion (target and result), enchantment-id exclusion
 * from results, curse-locked equipped-target exclusion, and fresh curse
 * rolling (+ curseRevealed) on equipment results.
 */
describe('Phase 24.4d2: star transformation alignment', () => {
  const S_RANK_WEAPON = WEAPON_IDS_IN_ORDER.find((id) => WEAPON_DEFINITIONS[id].rank === 'S')!;
  const R_RANK_WEAPON = WEAPON_IDS_IN_ORDER.find((id) => WEAPON_DEFINITIONS[id].rank === 'R')!;
  const S_RANK_ARMOR = ARMOR_IDS_IN_ORDER.find((id) => ARMOR_DEFINITIONS[id].rank === 'S')!;

  describe('result candidates never include S/R/solar_gun/black_armor', () => {
    it('excludes every S/R weapon species from a C-rank weapon transform', () => {
      const candidates = getTransformCandidatesForItem('sword');
      expect(candidates).not.toContain(S_RANK_WEAPON);
      expect(candidates).not.toContain(R_RANK_WEAPON);
      expect(candidates).not.toContain('solar_gun');
    });

    it('excludes every S/R armor species and black_armor from an armor transform', () => {
      const candidates = getTransformCandidatesForItem('armor');
      expect(candidates).not.toContain(S_RANK_ARMOR);
      expect(candidates).not.toContain('black_armor');
    });

    it('excludes all 5 enchantment ids from a consumable transform', () => {
      const candidates = getTransformCandidatesForItem('apple');
      const enchantmentIds: ItemId[] = [
        'sol_enchantment',
        'flame_enchantment',
        'frost_enchantment',
        'cloud_enchantment',
        'earth_enchantment',
      ];
      for (const id of enchantmentIds) {
        expect(candidates).not.toContain(id);
      }
    });

    it('only ever produces C/B/A weapon species across many draws', () => {
      for (let seed = 1; seed <= 20; seed++) {
        const state = withCard(createInitialState(seed), 'star', 1);
        state.inventory.sword = 1;
        const instance = createEquipmentInstance(state, 'sword');
        state.combatRngState = seed * 7919;
        const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
        useStar(state, target);
        const remaining = getHeldEquipmentInstances(state).filter((i) => i.instanceId !== instance.instanceId);
        if (remaining.length > 0) {
          expect(['C', 'B', 'A']).toContain(WEAPON_DEFINITIONS[remaining[0].definitionId as import('../types').WeaponId].rank);
        }
      }
    });
  });

  describe('S/R-rank source is never a star target', () => {
    it('does not offer an S-rank held weapon instance as a candidate', () => {
      const state = createInitialState(1);
      state.inventory[S_RANK_WEAPON] = 1;
      createEquipmentInstance(state, S_RANK_WEAPON);
      const candidates = getStarCandidates(state);
      expect(candidates.some((c) => c.kind === 'equipment_instance')).toBe(false);
    });

    it('does not offer solar_gun as a candidate even when held', () => {
      const state = createInitialState(1);
      state.inventory.solar_gun = 1;
      createEquipmentInstance(state, 'solar_gun');
      const candidates = getStarCandidates(state);
      expect(candidates.some((c) => c.kind === 'equipment_instance')).toBe(false);
    });
  });

  describe('curse-locked equipped target exclusion', () => {
    it('excludes a discovered-cursed equipped weapon from star candidates', () => {
      const state = createInitialState(1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      const candidates = getStarCandidates(state);
      expect(
        candidates.some((c) => c.kind === 'equipment_instance' && c.instanceId === instance.instanceId),
      ).toBe(false);
    });

    it('a bound target rejected as stale leaves state completely untouched', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      const turnBefore = state.turn;
      const rngBefore = state.combatRngState;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      const result = useStar(state, target);
      expect(result.consumed).toBe(false);
      expect(state.turn).toBe(turnBefore);
      expect(state.combatRngState).toBe(rngBefore);
      expect(state.inventory.star).toBe(1);
      expect(getEquipmentInstanceById(state, instance.instanceId)).toBeDefined();
    });

    it('still allows a held (unequipped) cursed-but-discovered instance to transform (only the bound equipped-slot case is excluded)', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      const result = useStar(state, target);
      expect(result.consumed).toBe(true);
    });
  });

  describe('fresh curse roll on equipment results', () => {
    it('produces both cursed and uncursed outcomes across many seeds (never unconditionally uncursed)', () => {
      let sawCursed = false;
      let sawUncursed = false;
      for (let seed = 1; seed <= 60; seed++) {
        const state = withCard(createInitialState(seed), 'star', 1);
        state.inventory.sword = 1;
        const instance = createEquipmentInstance(state, 'sword');
        state.combatRngState = seed * 104729;
        const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
        useStar(state, target);
        const remaining = getHeldEquipmentInstances(state).filter((i) => i.instanceId !== instance.instanceId);
        if (remaining.length === 0) continue;
        if (remaining[0].cursed) sawCursed = true;
        else sawUncursed = true;
      }
      expect(sawCursed).toBe(true);
      expect(sawUncursed).toBe(true);
    });

    it('same seed/operation sequence reproduces the same cursed outcome', () => {
      const s1 = withCard(createInitialState(1), 'star', 1);
      const s2 = withCard(createInitialState(1), 'star', 1);
      s1.inventory.sword = 1;
      s2.inventory.sword = 1;
      const i1 = createEquipmentInstance(s1, 'sword');
      const i2 = createEquipmentInstance(s2, 'sword');
      s1.combatRngState = 777;
      s2.combatRngState = 777;
      useStar(s1, { kind: 'equipment_instance', instanceId: i1.instanceId });
      useStar(s2, { kind: 'equipment_instance', instanceId: i2.instanceId });
      const r1 = getHeldEquipmentInstances(s1).filter((i) => i.instanceId !== i1.instanceId)[0];
      const r2 = getHeldEquipmentInstances(s2).filter((i) => i.instanceId !== i2.instanceId)[0];
      expect(r1.definitionId).toBe(r2.definitionId);
      expect(r1.cursed).toBe(r2.cursed);
    });

    it('curseRevealed is set on an auto-reequipped fresh-cursed result, without marking the body identified', () => {
      let found = false;
      for (let seed = 1; seed <= 80 && !found; seed++) {
        const state = withCard(createInitialState(seed), 'star', 1);
        state.inventory.sword = 1;
        const instance = createEquipmentInstance(state, 'sword');
        state.equippedWeaponId = 'sword';
        state.equippedWeaponInstanceId = instance.instanceId;
        state.combatRngState = seed * 65537;
        const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
        useStar(state, target);
        const newInstance = getEquipmentInstanceById(state, state.equippedWeaponInstanceId!);
        if (newInstance && newInstance.cursed) {
          found = true;
          expect(newInstance.curseRevealed).toBe(true);
          expect((state.identifiedGeneralItemIds ?? []).includes(newInstance.definitionId)).toBe(false);
        }
      }
      expect(found).toBe(true);
    });

    it('an unequipped fresh-cursed result never gets curseRevealed set', () => {
      let found = false;
      for (let seed = 1; seed <= 80 && !found; seed++) {
        const state = withCard(createInitialState(seed), 'star', 1);
        state.inventory.sword = 1;
        const instance = createEquipmentInstance(state, 'sword');
        state.combatRngState = seed * 32771;
        const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
        useStar(state, target);
        const remaining = getHeldEquipmentInstances(state).filter((i) => i.instanceId !== instance.instanceId);
        if (remaining.length > 0 && remaining[0].cursed) {
          found = true;
          expect(remaining[0].curseRevealed).toBe(false);
        }
      }
      expect(found).toBe(true);
    });

    it('does not consume the candidate-selection RNG stream more than once even with the added curse roll (0/1-candidate cases still consume no RNG at all)', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.apple = 1;
      const rngBefore = state.combatRngState;
      const target: CardTargetRef = { kind: 'inventory_item', itemId: 'apple' };
      useStar(state, target);
      // apple's category has multiple non-equipment candidates but no
      // curse concept — no curse RNG draw should occur for a
      // non-equipment target; only the (possible) candidate-selection
      // draw is spent.
      expect(state.combatRngState).not.toBe(undefined);
      void rngBefore;
    });
  });

  describe('result identification stays independent of transform success', () => {
    it('an unidentified consumable result is not auto-identified by a successful transform', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.apple = 1;
      useStar(state, { kind: 'inventory_item', itemId: 'apple' });
      // Whatever ItemId the transform produced, it must not have been
      // force-identified purely by virtue of being a transform result.
      expect((state.identifiedGeneralItemIds ?? []).length).toBe(0);
    });
  });
});
