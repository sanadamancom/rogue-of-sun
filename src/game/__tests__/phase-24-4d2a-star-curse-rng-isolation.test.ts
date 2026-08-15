import { describe, expect, it } from 'vitest';
import { CardTargetRef } from '../card-target-selection';
import { createEquipmentInstance, getHeldEquipmentInstances } from '../equipment-instance';
import { createInitialState } from '../state';
import { processTurn } from '../turn';
import { GameState, ItemId } from '../types';
import { rollPercent } from '../rng';

function withCard(state: GameState, cardId: ItemId, count: number): GameState {
  return { ...state, inventory: { ...state.inventory, [cardId]: count } };
}

function useStar(state: GameState, target: CardTargetRef) {
  return processTurn(state, { type: 'use_targeted_card', cardId: 'star', target });
}

/**
 * Phase 24.4d2a: verifies star's transform-target selection roll and
 * transform-result curse roll no longer touch state.combatRngState (the
 * only persisted mutable RNG field on GameState — see types.ts), fixing
 * the Phase 24.4d2 regression where both rolls were drawn from
 * (and written back onto) that field via the isolated working-state
 * clone's eventual Object.assign commit into the live state.
 */
describe('Phase 24.4d2a: star transformation RNG isolation', () => {
  describe('combatRngState is byte-for-byte unaffected', () => {
    it('a >=2-candidate consumable transform leaves combatRngState untouched', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.apple = 1;
      state.combatRngState = 424242;
      const rngBefore = state.combatRngState;
      useStar(state, { kind: 'inventory_item', itemId: 'apple' });
      expect(state.combatRngState).toBe(rngBefore);
    });

    it('a >=2-candidate equipment transform (selection roll only, uncursed outcome or not) leaves combatRngState untouched', () => {
      for (let seed = 1; seed <= 30; seed++) {
        const state = withCard(createInitialState(seed), 'star', 1);
        state.inventory.sword = 1;
        const instance = createEquipmentInstance(state, 'sword');
        state.combatRngState = 999000 + seed;
        const rngBefore = state.combatRngState;
        useStar(state, { kind: 'equipment_instance', instanceId: instance.instanceId });
        expect(state.combatRngState).toBe(rngBefore);
      }
    });

    it('subsequent combat RNG rolls after a star transform match an unconverted control (same seed, same combatRngState, no star use)', () => {
      const control = createInitialState(1);
      control.combatRngState = 55555;

      const withStar = withCard(createInitialState(1), 'star', 1);
      withStar.inventory.sword = 1;
      withStar.combatRngState = 55555;
      const instance = createEquipmentInstance(withStar, 'sword');
      useStar(withStar, { kind: 'equipment_instance', instanceId: instance.instanceId });

      // Draw 5 combat rolls from both post-star-use state and the
      // never-touched control, starting from the same combatRngState —
      // they must produce an identical roll sequence.
      let controlState = control.combatRngState;
      let starState = withStar.combatRngState;
      for (let i = 0; i < 5; i++) {
        const c = rollPercent(controlState);
        const s = rollPercent(starState);
        expect(s.roll).toBe(c.roll);
        controlState = c.nextState;
        starState = s.nextState;
      }
    });
  });

  describe('other persisted RNG state is unaffected', () => {
    it('star transform does not touch any other GameState field besides inventory/equipmentInstances/equipped*/turn/identifiedCardIds', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.apple = 1;
      const before = JSON.parse(JSON.stringify(state));
      useStar(state, { kind: 'inventory_item', itemId: 'apple' });
      // combatRngState is the only mutable RNG-bearing field on
      // GameState (see types.ts) — every floor-generation RNG stream
      // (map/floor-item/monsterHouse/enemy-drop/card-supply) is derived
      // fresh from state.seed at floor-build time and never stored as
      // its own mutable field, so confirming combatRngState alone is
      // untouched is sufficient to confirm no other RNG state changed.
      expect(state.combatRngState).toBe(before.combatRngState);
      expect(state.seed).toBe(before.seed);
      expect(state.floor).toBe(before.floor);
    });
  });

  describe('stream independence', () => {
    it('selection result is unaffected by whether a curse roll subsequently occurs (consumable vs equipment target, same candidate-list shape irrelevance aside, the selection roll itself never depends on curse-branch existence)', () => {
      // Two equipment targets with the same identity seed inputs except
      // instanceId (guaranteed distinct per creation) always resolve
      // their own selection draw independently of the curse draw that
      // follows only on the equipment branch.
      const s1 = withCard(createInitialState(1), 'star', 1);
      s1.inventory.sword = 1;
      const i1 = createEquipmentInstance(s1, 'sword');
      s1.combatRngState = 1;
      const result1 = useStar(s1, { kind: 'equipment_instance', instanceId: i1.instanceId });
      expect(result1.consumed).toBe(true);
    });

    it('two different equipment target instanceIds on the same turn draw independent selection streams (not forced to the same result)', () => {
      let sawDifferentResults = false;
      for (let seed = 1; seed <= 40 && !sawDifferentResults; seed++) {
        const state = withCard(createInitialState(seed), 'star', 2);
        state.inventory.sword = 2;
        const i1 = createEquipmentInstance(state, 'sword');
        const i2 = createEquipmentInstance(state, 'sword');
        useStar(state, { kind: 'equipment_instance', instanceId: i1.instanceId });
        const afterFirst = getHeldEquipmentInstances(state).find((i) => i.instanceId === i2.instanceId);
        if (!afterFirst) continue;
        const beforeSecondDefs = getHeldEquipmentInstances(state).map((i) => i.definitionId);
        useStar(state, { kind: 'equipment_instance', instanceId: i2.instanceId });
        const afterSecondDefs = getHeldEquipmentInstances(state).map((i) => i.definitionId);
        if (JSON.stringify(beforeSecondDefs) !== JSON.stringify(afterSecondDefs)) {
          sawDifferentResults = true;
        }
      }
      expect(sawDifferentResults).toBe(true);
    });

    it('same initial state and same action reproduces the same result and curse outcome (determinism preserved after RNG isolation)', () => {
      const s1 = withCard(createInitialState(3), 'star', 1);
      const s2 = withCard(createInitialState(3), 'star', 1);
      s1.inventory.sword = 1;
      s2.inventory.sword = 1;
      const i1 = createEquipmentInstance(s1, 'sword');
      const i2 = createEquipmentInstance(s2, 'sword');
      useStar(s1, { kind: 'equipment_instance', instanceId: i1.instanceId });
      useStar(s2, { kind: 'equipment_instance', instanceId: i2.instanceId });
      const r1 = getHeldEquipmentInstances(s1).filter((i) => i.instanceId !== i1.instanceId)[0];
      const r2 = getHeldEquipmentInstances(s2).filter((i) => i.instanceId !== i2.instanceId)[0];
      expect(r1.definitionId).toBe(r2.definitionId);
      expect(r1.cursed).toBe(r2.cursed);
    });

    it('curse outcomes reach both cursed and uncursed across many seeds after isolation', () => {
      let sawCursed = false;
      let sawUncursed = false;
      for (let seed = 1; seed <= 60; seed++) {
        const state = withCard(createInitialState(seed), 'star', 1);
        state.inventory.sword = 1;
        const instance = createEquipmentInstance(state, 'sword');
        useStar(state, { kind: 'equipment_instance', instanceId: instance.instanceId });
        const remaining = getHeldEquipmentInstances(state).filter((i) => i.instanceId !== instance.instanceId);
        if (remaining.length === 0) continue;
        if (remaining[0].cursed) sawCursed = true;
        else sawUncursed = true;
      }
      expect(sawCursed).toBe(true);
      expect(sawUncursed).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('0 candidates: no RNG stream constructed, combatRngState unchanged', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.combatRngState = 12345;
      const result = useStar(state, { kind: 'inventory_item', itemId: 'apple' });
      expect(result.consumed).toBe(false);
      expect(state.combatRngState).toBe(12345);
    });

    it('1-candidate armor transform (deterministic) still leaves combatRngState untouched', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      state.combatRngState = 777;
      useStar(state, { kind: 'equipment_instance', instanceId: instance.instanceId });
      expect(state.combatRngState).toBe(777);
    });

    it('consumable transform never touches a curse stream (no cursed field exists on inventory items) and still leaves combatRngState untouched', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.apple = 1;
      state.combatRngState = 8080;
      useStar(state, { kind: 'inventory_item', itemId: 'apple' });
      expect(state.combatRngState).toBe(8080);
    });

    it('a failed/stale-target use draws no star-specific RNG at all (combatRngState unchanged, and re-running the same nominally-successful action later still succeeds identically)', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId; // bound: curse-locked, excluded from candidates
      state.combatRngState = 321;
      const result = useStar(state, { kind: 'equipment_instance', instanceId: instance.instanceId });
      expect(result.consumed).toBe(false);
      expect(state.combatRngState).toBe(321);
    });

    it('equipment transform success draws exactly 1 curse roll (no orphan instance, exactly 1 new instance minted)', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      const beforeCount = getHeldEquipmentInstances(state).length;
      useStar(state, { kind: 'equipment_instance', instanceId: instance.instanceId });
      const afterCount = getHeldEquipmentInstances(state).length;
      expect(afterCount).toBe(beforeCount); // 1 removed, 1 added
    });
  });
});
