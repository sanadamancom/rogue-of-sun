import { describe, expect, it } from 'vitest';
import { createEquipmentInstance, EQUIPMENT_REFINE_LEVEL_CAP, getEquipmentInstanceById } from '../equipment-instance';
import { advanceToNextFloor, createInitialState } from '../state';
import { isCardIdentified, processTurn } from '../turn';
import { GameState, ItemId } from '../types';

function withCard(state: GameState, cardId: ItemId, count: number): GameState {
  return { ...state, inventory: { ...state.inventory, [cardId]: count } };
}

describe('Phase 20.5b: moon and sun', () => {
  describe('moon', () => {
    it('raises the equipped weapon instance\'s refineLevel by 1', () => {
      const state = withCard(createInitialState(1), 'moon', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      processTurn(state, { type: 'use_item', itemId: 'moon' });
      expect(getEquipmentInstanceById(state, instance.instanceId)!.refineLevel).toBe(1);
    });

    it('never exceeds EQUIPMENT_REFINE_LEVEL_CAP (use fails outright once reached)', () => {
      const state = withCard(createInitialState(1), 'moon', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.refineLevel = EQUIPMENT_REFINE_LEVEL_CAP;
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      processTurn(state, { type: 'use_item', itemId: 'moon' });
      expect(getEquipmentInstanceById(state, instance.instanceId)!.refineLevel).toBe(EQUIPMENT_REFINE_LEVEL_CAP);
    });

    it('is a complete no-op (no consume/identify/turn/RNG) once the equipped instance is at the cap — rogue-of-sun-card-effects-spec.md\'s "強化上限に達した装備は対象にできない...使用不成立とする"', () => {
      const state = withCard(createInitialState(1), 'moon', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      instance.refineLevel = EQUIPMENT_REFINE_LEVEL_CAP;
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      const turnBefore = state.turn;
      const rngBefore = state.combatRngState;
      const result = processTurn(state, { type: 'use_item', itemId: 'moon' });
      expect(result.consumed).toBe(false);
      expect(state.inventory.moon).toBe(1);
      expect(isCardIdentified(state, 'moon')).toBe(false);
      expect(state.turn).toBe(turnBefore);
      expect(state.combatRngState).toBe(rngBefore);
    });

    it('fails outright when no weapon is equipped', () => {
      const state = withCard(createInitialState(1), 'moon', 1);
      const turnBefore = state.turn;
      const result = processTurn(state, { type: 'use_item', itemId: 'moon' });
      expect(result.consumed).toBe(false);
      expect(state.inventory.moon).toBe(1);
      expect(state.turn).toBe(turnBefore);
      expect(isCardIdentified(state, 'moon')).toBe(false);
    });

    it('never affects armor', () => {
      const state = withCard(createInitialState(1), 'moon', 1);
      state.inventory.sword = 1;
      state.inventory.armor = 1;
      const weapon = createEquipmentInstance(state, 'sword');
      const armor = createEquipmentInstance(state, 'armor');
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = weapon.instanceId;
      state.equippedArmorId = 'armor';
      state.equippedArmorInstanceId = armor.instanceId;
      processTurn(state, { type: 'use_item', itemId: 'moon' });
      expect(getEquipmentInstanceById(state, armor.instanceId)!.refineLevel).toBe(0);
    });

    it('is unusable while sealed', () => {
      let state = withCard(createInitialState(1), 'moon', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const result = processTurn(state, { type: 'use_item', itemId: 'moon' });
      expect(result.consumed).toBe(false);
      expect(getEquipmentInstanceById(state, instance.instanceId)!.refineLevel).toBe(0);
    });

    it('does not use the target-selection UI flow (never appears as a candidate there)', async () => {
      const { getCardTargetCandidates, isTargetSelectableCardId } = await import('../card-target-selection');
      expect(isTargetSelectableCardId('moon' as never)).toBe(false);
      const state = createInitialState(1);
      expect(getCardTargetCandidates(state, 'moon')).toEqual([]);
    });

    it('does not consume RNG', () => {
      const state = withCard(createInitialState(1), 'moon', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'moon' });
      expect(state.combatRngState).toBe(rngBefore);
    });

    it('persists across a floor transition', () => {
      const state = withCard(createInitialState(1), 'moon', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      processTurn(state, { type: 'use_item', itemId: 'moon' });
      const next = advanceToNextFloor(state);
      expect(getEquipmentInstanceById(next, instance.instanceId)!.refineLevel).toBe(1);
    });
  });

  describe('sun', () => {
    it('raises the equipped armor instance\'s refineLevel by 1', () => {
      const state = withCard(createInitialState(1), 'sun', 1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      state.equippedArmorId = 'armor';
      state.equippedArmorInstanceId = instance.instanceId;
      processTurn(state, { type: 'use_item', itemId: 'sun' });
      expect(getEquipmentInstanceById(state, instance.instanceId)!.refineLevel).toBe(1);
    });

    it('never exceeds EQUIPMENT_REFINE_LEVEL_CAP (use fails outright once reached)', () => {
      const state = withCard(createInitialState(1), 'sun', 1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      instance.refineLevel = EQUIPMENT_REFINE_LEVEL_CAP;
      state.equippedArmorId = 'armor';
      state.equippedArmorInstanceId = instance.instanceId;
      processTurn(state, { type: 'use_item', itemId: 'sun' });
      expect(getEquipmentInstanceById(state, instance.instanceId)!.refineLevel).toBe(EQUIPMENT_REFINE_LEVEL_CAP);
    });

    it('is a complete no-op (no consume/identify/turn/RNG) once the equipped instance is at the cap', () => {
      const state = withCard(createInitialState(1), 'sun', 1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      instance.refineLevel = EQUIPMENT_REFINE_LEVEL_CAP;
      state.equippedArmorId = 'armor';
      state.equippedArmorInstanceId = instance.instanceId;
      const turnBefore = state.turn;
      const rngBefore = state.combatRngState;
      const result = processTurn(state, { type: 'use_item', itemId: 'sun' });
      expect(result.consumed).toBe(false);
      expect(state.inventory.sun).toBe(1);
      expect(isCardIdentified(state, 'sun')).toBe(false);
      expect(state.turn).toBe(turnBefore);
      expect(state.combatRngState).toBe(rngBefore);
    });

    it('fails outright when no armor is equipped', () => {
      const state = withCard(createInitialState(1), 'sun', 1);
      const turnBefore = state.turn;
      const result = processTurn(state, { type: 'use_item', itemId: 'sun' });
      expect(result.consumed).toBe(false);
      expect(state.turn).toBe(turnBefore);
    });

    it('never affects weapon', () => {
      const state = withCard(createInitialState(1), 'sun', 1);
      state.inventory.sword = 1;
      state.inventory.armor = 1;
      const weapon = createEquipmentInstance(state, 'sword');
      const armor = createEquipmentInstance(state, 'armor');
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = weapon.instanceId;
      state.equippedArmorId = 'armor';
      state.equippedArmorInstanceId = armor.instanceId;
      processTurn(state, { type: 'use_item', itemId: 'sun' });
      expect(getEquipmentInstanceById(state, weapon.instanceId)!.refineLevel).toBe(0);
    });

    it('is unusable while sealed', () => {
      let state = withCard(createInitialState(1), 'sun', 1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      state.equippedArmorId = 'armor';
      state.equippedArmorInstanceId = instance.instanceId;
      state = { ...state, activeEffects: [{ id: 'sealed', strength: 0, remainingTurns: 5 }] };
      const result = processTurn(state, { type: 'use_item', itemId: 'sun' });
      expect(result.consumed).toBe(false);
    });

    it('does not use the target-selection UI flow', async () => {
      const { getCardTargetCandidates } = await import('../card-target-selection');
      const state = createInitialState(1);
      expect(getCardTargetCandidates(state, 'sun')).toEqual([]);
    });

    it('does not consume RNG', () => {
      const state = withCard(createInitialState(1), 'sun', 1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      state.equippedArmorId = 'armor';
      state.equippedArmorInstanceId = instance.instanceId;
      const rngBefore = state.combatRngState;
      processTurn(state, { type: 'use_item', itemId: 'sun' });
      expect(state.combatRngState).toBe(rngBefore);
    });

    it('persists across a floor transition', () => {
      const state = withCard(createInitialState(1), 'sun', 1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      state.equippedArmorId = 'armor';
      state.equippedArmorInstanceId = instance.instanceId;
      processTurn(state, { type: 'use_item', itemId: 'sun' });
      const next = advanceToNextFloor(state);
      expect(getEquipmentInstanceById(next, instance.instanceId)!.refineLevel).toBe(1);
    });
  });

  describe('combat_integration', () => {
    it('moon\'s weapon refineLevel increases actual attack power via getPlayerWeaponBonus', async () => {
      const { getEffectiveAttackPower } = await import('../turn');
      const state = withCard(createInitialState(1), 'moon', 1);
      state.inventory.sword = 1;
      const instance = createEquipmentInstance(state, 'sword');
      state.equippedWeaponId = 'sword';
      state.equippedWeaponInstanceId = instance.instanceId;
      const before = getEffectiveAttackPower(state);
      processTurn(state, { type: 'use_item', itemId: 'moon' });
      expect(getEffectiveAttackPower(state)).toBeGreaterThan(before);
    });

    it('sun\'s armor refineLevel increases actual defense via getEffectiveArmorValue', async () => {
      const { getEffectivePlayerDefense } = await import('../turn');
      const state = withCard(createInitialState(1), 'sun', 1);
      state.inventory.armor = 1;
      const instance = createEquipmentInstance(state, 'armor');
      state.equippedArmorId = 'armor';
      state.equippedArmorInstanceId = instance.instanceId;
      const before = getEffectivePlayerDefense(state);
      processTurn(state, { type: 'use_item', itemId: 'sun' });
      expect(getEffectivePlayerDefense(state)).toBeGreaterThan(before);
    });

    it('an unrefined (refineLevel 0) weapon/armor contributes no extra bonus beyond the base value', async () => {
      const { getEffectiveAttackPower, getEffectivePlayerDefense } = await import('../turn');
      const weaponState = createInitialState(1);
      weaponState.inventory.sword = 1;
      const weaponInstance = createEquipmentInstance(weaponState, 'sword');
      weaponState.equippedWeaponId = 'sword';
      weaponState.equippedWeaponInstanceId = weaponInstance.instanceId;
      const noInstanceState = createInitialState(1);
      noInstanceState.equippedWeaponId = 'sword';
      expect(getEffectiveAttackPower(weaponState)).toBe(getEffectiveAttackPower(noInstanceState));

      const armorState = createInitialState(1);
      armorState.inventory.armor = 1;
      const armorInstance = createEquipmentInstance(armorState, 'armor');
      armorState.equippedArmorId = 'armor';
      armorState.equippedArmorInstanceId = armorInstance.instanceId;
      const noArmorInstanceState = createInitialState(1);
      noArmorInstanceState.equippedArmorId = 'armor';
      expect(getEffectivePlayerDefense(armorState)).toBe(getEffectivePlayerDefense(noArmorInstanceState));
    });
  });

  describe('regression', () => {
    it('all 17 cards remain outside every floor weighted loot pool', async () => {
      const { getWeightedGroundItemPoolForFloor } = await import('../item-def');
      const { CARD_IDS_IN_ORDER } = await import('../card-def');
      for (const floor of [1, 2, 3]) {
        const pool = getWeightedGroundItemPoolForFloor(floor, undefined, 'descent');
        for (const id of CARD_IDS_IN_ORDER) {
          expect(pool.some((c) => c.id === id)).toBe(false);
        }
      }
    });

    it('no card appears across 100 seeds of real floor generation', () => {
      for (let seed = 1; seed <= 100; seed++) {
        const state = createInitialState(seed);
        for (const item of state.groundItems) {
          expect(['moon', 'sun'].includes(item.itemId)).toBe(false);
        }
      }
    });

    it('Phase 20.0c/20.0d/20.1-20.5a mechanisms are unaffected', () => {
      const state = withCard(createInitialState(1), 'strength', 1);
      const result = processTurn(state, { type: 'use_item', itemId: 'strength' });
      expect(result.consumed).toBe(true);
      expect(state.abilities?.power).toBe(1);
    });
  });
});
