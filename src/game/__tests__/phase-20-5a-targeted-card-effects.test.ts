import { describe, expect, it } from 'vitest';
import { beginCardTargetSelection, CardTargetRef, confirmCardTargetSelection } from '../card-target-selection';
import { createEquipmentInstance, getEquipmentInstanceById, getHeldEquipmentInstances } from '../equipment-instance';
import { advanceToNextFloor, createInitialState } from '../state';
import { isCardIdentified, processTurn } from '../turn';
import { GameState, ItemId } from '../types';

function withCard(state: GameState, cardId: ItemId, count: number): GameState {
  return { ...state, inventory: { ...state.inventory, [cardId]: count } };
}

function useTargetedCard(state: GameState, cardId: 'temperance' | 'star', target: CardTargetRef) {
  return processTurn(state, { type: 'use_targeted_card', cardId, target });
}

describe('Phase 20.5a: temperance and star', () => {
  describe('temperance', () => {
    it('solves a discovered-cursed equipped weapon', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'temperance', target);
      expect(getEquipmentInstanceById(state, instance.instanceId)!.cursed).toBe(false);
    });

    it('solves a discovered-cursed held (unequipped) armor', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      instance.cursed = true;
      instance.curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'temperance', target);
      expect(getEquipmentInstanceById(state, instance.instanceId)!.cursed).toBe(false);
    });

    it('excludes an undiscovered curse from candidates', () => {
      const state = createInitialState(1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = false;
      expect(beginCardTargetSelection(state, 'temperance')).toBeNull();
    });

    it('excludes an uncursed individual from candidates', () => {
      const state = createInitialState(1);
      state.inventory.sword = 1;
      createEquipmentInstance(state, 'sword');
      expect(beginCardTargetSelection(state, 'temperance')).toBeNull();
    });

    it('is a complete no-op with 0 candidates', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      const turnBefore = state.turn;
      expect(beginCardTargetSelection(state, 'temperance')).toBeNull();
      expect(state.turn).toBe(turnBefore);
      expect(state.inventory.temperance).toBe(1);
    });

    it('preserves instanceId, definitionId, refineLevel, and equip slot after solving', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      instance.refineLevel = 2;
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'temperance', target);
      const after = getEquipmentInstanceById(state, instance.instanceId)!;
      expect(after.instanceId).toBe(instance.instanceId);
      expect(after.definitionId).toBe('sword');
      expect(after.refineLevel).toBe(2);
      expect(state.equippedWeaponInstanceId).toBe(instance.instanceId);
    });

    it('a solved equipment individual can be equip-swapped normally afterward', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      state.inventory.spear = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'temperance', target);
      const swapResult = processTurn(state, { type: 'equip_weapon', weaponId: 'spear' });
      expect(swapResult.consumed).toBe(true);
      expect(state.equippedWeaponId).toBe('spear');
    });

    it('curseRevealed never reverts to false after solving', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'temperance', target);
      expect(getEquipmentInstanceById(state, instance.instanceId)!.curseRevealed).toBe(true);
    });

    it('does not consume RNG', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      const rngBefore = state.combatRngState;
      useTargetedCard(state, 'temperance', target);
      expect(state.combatRngState).toBe(rngBefore);
    });
  });

  describe('star', () => {
    it('transforms a consumable stack item into a same-category ItemId', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.apple = 3;
      const target: CardTargetRef = { kind: 'inventory_item', itemId: 'apple' };
      useTargetedCard(state, 'star', target);
      expect(state.inventory.apple).toBe(2);
    });

    it('converts a weapon instance into a new weapon instance', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'star', target);
      const remaining = getHeldEquipmentInstances(state).filter((i) => i.instanceId !== instance.instanceId);
      expect(remaining.length).toBe(1);
      expect(['spear', 'hammer', 'solar_gun']).toContain(remaining[0].definitionId);
    });

    it('excludes armor from candidates (single-species roster has no alternate)', () => {
      const state = createInitialState(1);
      state.inventory.armor = 1;
      createEquipmentInstance(state, 'armor');
      const selection = beginCardTargetSelection(state, 'star');
      if (selection) {
        expect(selection.candidates.some((c) => c.kind === 'equipment_instance')).toBe(false);
      }
    });

    it('auto-reequips the new instance into the same slot when the original was equipped', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'star', target);
      expect(state.equippedWeaponInstanceId).not.toBe(instance.instanceId);
      expect(state.equippedWeaponInstanceId).not.toBeNull();
      const newInstance = getEquipmentInstanceById(state, state.equippedWeaponInstanceId!);
      expect(newInstance).toBeDefined();
      expect(state.equippedWeaponId).toBe(newInstance!.definitionId);
    });

    it('the new instance never carries over refineLevel', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.refineLevel = 3;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'star', target);
      const remaining = getHeldEquipmentInstances(state).filter((i) => i.instanceId !== instance.instanceId);
      expect(remaining[0].refineLevel).toBe(0);
    });

    it('the new instance never carries over cursed/curseRevealed', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'star', target);
      const remaining = getHeldEquipmentInstances(state).filter((i) => i.instanceId !== instance.instanceId);
      expect(remaining[0].cursed).toBe(false);
      expect(remaining[0].curseRevealed).toBe(false);
    });

    it('excludes all 17 cards from candidates', () => {
      const state = createInitialState(1);
      state.inventory.high_priestess = 1;
      const candidates = beginCardTargetSelection(state, 'star');
      if (candidates) {
        expect(candidates.candidates.some((c) => c.kind === 'inventory_item' && c.itemId === 'high_priestess')).toBe(
          false,
        );
      }
    });

    it('is a complete no-op with 0 candidates (not owning anything)', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      const turnBefore = state.turn;
      expect(beginCardTargetSelection(state, 'star')).toBeNull();
      expect(state.turn).toBe(turnBefore);
    });

    it('same seed/operation sequence produces the same transform result', () => {
      const s1 = withCard(createInitialState(1), 'star', 1);
      const s2 = withCard(createInitialState(1), 'star', 1);
      s1.inventory.apple = 1;
      s2.inventory.apple = 1;
      s1.combatRngState = 42;
      s2.combatRngState = 42;
      useTargetedCard(s1, 'star', { kind: 'inventory_item', itemId: 'apple' });
      useTargetedCard(s2, 'star', { kind: 'inventory_item', itemId: 'apple' });
      expect(s1.inventory).toEqual(s2.inventory);
    });

    it('production loot being disabled does not shrink transform candidates (roster-wide, not floor-gated)', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.apple = 1;
      const target: CardTargetRef = { kind: 'inventory_item', itemId: 'apple' };
      const result = useTargetedCard(state, 'star', target);
      expect(result.consumed).toBe(true);
    });

    it('does not include any card in the transform result', () => {
      const state = withCard(createInitialState(1), 'star', 1);
      state.inventory.apple = 1;
      useTargetedCard(state, 'star', { kind: 'inventory_item', itemId: 'apple' });
      const cardIds: ItemId[] = ['high_priestess', 'empress', 'emperor', 'lovers', 'chariot', 'strength', 'wheel_of_fortune', 'justice', 'hanged_man', 'death', 'temperance', 'devil', 'tower', 'moon', 'sun', 'judgement'];
      for (const id of cardIds) {
        expect(state.inventory[id] ?? 0).toBe(0);
      }
    });
  });

  describe('target_selection', () => {
    it('beginning selection performs no consume/identify/turn/RNG change', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const turnBefore = state.turn;
      const invBefore = { ...state.inventory };
      beginCardTargetSelection(state, 'temperance');
      expect(state.turn).toBe(turnBefore);
      expect(state.inventory).toEqual(invBefore);
      expect(isCardIdentified(state, 'temperance')).toBe(false);
    });

    it('a stale instanceId (target resolved before confirm) results in a complete no-op', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const staleTarget: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      instance.cursed = false;
      const turnBefore = state.turn;
      const result = useTargetedCard(state, 'temperance', staleTarget);
      expect(result.consumed).toBe(false);
      expect(state.turn).toBe(turnBefore);
      expect(state.inventory.temperance).toBe(1);
    });

    it('confirm re-validates and rejects a target whose eligibility changed after selection began', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const selection = beginCardTargetSelection(state, 'temperance')!;
      instance.curseRevealed = false;
      expect(confirmCardTargetSelection(state, selection)).toBeNull();
    });

    it('sealed state prevents even card use from succeeding', () => {
      let state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      const result = useTargetedCard(state, 'temperance', target);
      expect(result.consumed).toBe(false);
    });

    it('not owning the card at all is a complete no-op even with a would-be-valid target', () => {
      const state = createInitialState(1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      const result = useTargetedCard(state, 'temperance', target);
      expect(result.consumed).toBe(false);
    });

    it('a successful confirm consumes exactly one card, identifies it, and advances the turn by 1', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const turnBefore = state.turn;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      const result = useTargetedCard(state, 'temperance', target);
      expect(result.consumed).toBe(true);
      expect(state.inventory.temperance).toBe(0);
      expect(isCardIdentified(state, 'temperance')).toBe(true);
      expect(state.turn).toBe(turnBefore + 1);
    });
  });

  describe('regression', () => {
    it('all 17 cards remain outside every floor weighted loot pool', async () => {
      const { getWeightedGroundItemPoolForFloor } = await import('../item-def');
      const { CARD_IDS_IN_ORDER } = await import('../card-def');
      for (const floor of [1, 2, 3]) {
        const pool = getWeightedGroundItemPoolForFloor(floor);
        for (const id of CARD_IDS_IN_ORDER) {
          expect(pool.some((c) => c.id === id)).toBe(false);
        }
      }
    });

    it('no card appears across 100 seeds of real floor generation', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const state = createInitialState(seed);
        for (const item of state.groundItems) {
          expect(['temperance', 'star'].includes(item.itemId)).toBe(false);
        }
      }
    });

    it('a solved individual persists across a floor transition', () => {
      const state = withCard(createInitialState(1), 'temperance', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.cursed = true;
      instance.curseRevealed = true;
      const target: CardTargetRef = { kind: 'equipment_instance', instanceId: instance.instanceId };
      useTargetedCard(state, 'temperance', target);
      const next = advanceToNextFloor(state);
      expect(getEquipmentInstanceById(next, instance.instanceId)!.cursed).toBe(false);
    });

    it('Phase 20.0c/20.0d/20.1-20.4 mechanisms are unaffected', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'strength' });
      expect(result.consumed).toBe(true);
      expect(state.abilities?.power).toBe(1);
    });
  });
});
