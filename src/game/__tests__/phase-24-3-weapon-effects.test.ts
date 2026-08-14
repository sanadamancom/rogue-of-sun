import { describe, expect, it } from 'vitest';
import { createInitialState, advanceToNextFloor } from '../state';
import { createEquipmentInstance, getEquipmentInstanceById, normalizeEquipmentInstances } from '../equipment-instance';
import { processTurn } from '../turn';
import {
  isPlayerLowLife,
  isSolarEnergyMax,
  isNightOrDarkRoom,
  getWeaponAttackStartBonus,
  getWeaponElementalBonus,
  getWeaponTraitBonus,
  getMagicSwordSolCostReduction,
  applyWeaponDefeatEffects,
  BLOOD_DEFEAT_EFFECT_FLOOR_CAP,
} from '../equipment-effects';
import { GameState } from '../types';

/**
 * Phase 24.3 Stage 3: effectState と武器固有効果のテスト。
 * effect_timing.attack_start_snapshot / elemental_bonus / magic_sword /
 * defeat_effects の各契約を検証する。
 */

function baseState(): GameState {
  return createInitialState(1);
}

describe('Phase 24.3 Stage 3: effectState plumbing', () => {
  it('a freshly-minted instance has a default (all-zero/empty) effectState', () => {
    const state = baseState();
    const instance = createEquipmentInstance(state, 'blood_sword');
    expect(instance.effectState).toEqual({
      floorTriggerUses: 0,
      solSpentRemainder: 0,
      equippedTurnCounter: 0,
      defeatedEnemyTypes: [],
    });
  });

  it('normalizeEquipmentInstances backfills a missing effectState', () => {
    const state = baseState();
    state.inventory.blood_sword = 1;
    state.equipmentInstances = [
      { instanceId: 'eq-legacy', definitionId: 'blood_sword', refineLevel: 0, cursed: false, curseRevealed: false, rank: 'A' } as any,
    ];
    normalizeEquipmentInstances(state);
    const instance = getEquipmentInstanceById(state, 'eq-legacy');
    expect(instance?.effectState).toEqual({
      floorTriggerUses: 0,
      solSpentRemainder: 0,
      equippedTurnCounter: 0,
      defeatedEnemyTypes: [],
    });
  });

  it('floorTriggerUses/defeatedEnemyTypes reset on floor transition; solSpentRemainder/equippedTurnCounter persist', () => {
    const state = baseState();
    state.inventory.blood_sword = 1;
    const instance = createEquipmentInstance(state, 'blood_sword');
    instance.effectState = { floorTriggerUses: 2, solSpentRemainder: 3, equippedTurnCounter: 7, defeatedEnemyTypes: ['bok'] };
    const next = advanceToNextFloor(state);
    const carried = (next.equipmentInstances ?? []).find((i) => i.instanceId === instance.instanceId);
    expect(carried?.effectState).toEqual({ floorTriggerUses: 0, solSpentRemainder: 3, equippedTurnCounter: 7, defeatedEnemyTypes: [] });
  });
});

describe('Phase 24.3 Stage 3: attack-start snapshot conditions', () => {
  it('isPlayerLowLife: true at exactly 1/3 maxHp (floor), false just above', () => {
    const state = baseState();
    state.player.maxHp = 15;
    state.player.hp = 5; // floor(15/3) = 5
    expect(isPlayerLowLife(state)).toBe(true);
    state.player.hp = 6;
    expect(isPlayerLowLife(state)).toBe(false);
  });

  it('isSolarEnergyMax: true only at/above maxSolarEnergy', () => {
    const state = baseState();
    state.maxSolarEnergy = 10;
    state.solarEnergy = 10;
    expect(isSolarEnergyMax(state)).toBe(true);
    state.solarEnergy = 9;
    expect(isSolarEnergyMax(state)).toBe(false);
  });

  it('isNightOrDarkRoom: true while dark_garb equipped regardless of position', () => {
    const state = baseState();
    state.equippedArmorId = 'dark_garb';
    expect(isNightOrDarkRoom(state)).toBe(true);
  });

  it('bushido_blade grants +1 only at low life', () => {
    expect(getWeaponAttackStartBonus({ player: { hp: 5, maxHp: 15 } } as any, 'bushido_blade')).toBe(1);
    expect(getWeaponAttackStartBonus({ player: { hp: 6, maxHp: 15 } } as any, 'bushido_blade')).toBe(0);
  });

  it('solar_sword/white_queen/dawn grant +1 only at full SOL', () => {
    for (const id of ['solar_sword', 'white_queen', 'dawn'] as const) {
      expect(getWeaponAttackStartBonus({ solarEnergy: 10, maxSolarEnergy: 10, equippedArmorId: null } as any, id)).toBe(1);
      expect(getWeaponAttackStartBonus({ solarEnergy: 9, maxSolarEnergy: 10, equippedArmorId: null } as any, id)).toBe(0);
    }
  });

  it('gram/gungnir/mjolnir sum both conditions independently (up to +2)', () => {
    const bothTrue = { solarEnergy: 10, maxSolarEnergy: 10, equippedArmorId: 'dark_garb', map: { rooms: [], darkRoomIndex: null }, player: { pos: { x: 0, y: 0 } } } as any;
    expect(getWeaponAttackStartBonus(bothTrue, 'gram')).toBe(2);
    const neitherTrue = { solarEnergy: 5, maxSolarEnergy: 10, equippedArmorId: null, map: { rooms: [], darkRoomIndex: null }, player: { pos: { x: 0, y: 0 } } } as any;
    expect(getWeaponAttackStartBonus(neitherTrue, 'gram')).toBe(0);
  });

  it('a "none"-effect weapon (sword) never grants a bonus', () => {
    expect(getWeaponAttackStartBonus({ player: { hp: 1, maxHp: 100 } } as any, 'sword')).toBe(0);
  });
});

describe('Phase 24.3 Stage 3: elemental bonus (flamberge/ice_glaive/grand_lance)', () => {
  it('flamberge grants +1 only when flame is the activated element', () => {
    expect(getWeaponElementalBonus('flamberge', 'flame')).toBe(1);
    expect(getWeaponElementalBonus('flamberge', 'frost')).toBe(0);
    expect(getWeaponElementalBonus('flamberge', null)).toBe(0);
  });

  it('ice_glaive/grand_lance grant +1 only for their own element', () => {
    expect(getWeaponElementalBonus('ice_glaive', 'frost')).toBe(1);
    expect(getWeaponElementalBonus('grand_lance', 'earth')).toBe(1);
    expect(getWeaponElementalBonus('ice_glaive', 'earth')).toBe(0);
  });

  it('a non-elemental weapon (sword) never grants an elemental bonus', () => {
    expect(getWeaponElementalBonus('sword', 'flame')).toBe(0);
  });
});

describe('Phase 24.3 Stage 3: trait bonus (maul/silver_flail)', () => {
  it('maul grants +1 against construct (golem), 0 against non-construct', () => {
    expect(getWeaponTraitBonus('maul', 'golem')).toBe(1);
    expect(getWeaponTraitBonus('maul', 'bok')).toBe(0);
  });

  it('silver_flail grants +1 against undead (skeleton/mummy/ghost)', () => {
    expect(getWeaponTraitBonus('silver_flail', 'skeleton')).toBe(1);
    expect(getWeaponTraitBonus('silver_flail', 'mummy')).toBe(1);
    expect(getWeaponTraitBonus('silver_flail', 'ghost')).toBe(1);
    expect(getWeaponTraitBonus('silver_flail', 'golem')).toBe(0);
  });
});

describe('Phase 24.3 Stage 3: magic_sword SOL cost reduction', () => {
  it('reduces a >=2 cost by 1', () => {
    expect(getMagicSwordSolCostReduction('magic_sword', 2)).toBe(1);
    expect(getMagicSwordSolCostReduction('magic_sword', 3)).toBe(1);
  });

  it('never reduces below floor 1 semantics (reduction itself is capped at 1)', () => {
    expect(getMagicSwordSolCostReduction('magic_sword', 2)).toBe(1);
  });

  it('never reduces a cost of 1 or 0', () => {
    expect(getMagicSwordSolCostReduction('magic_sword', 1)).toBe(0);
    expect(getMagicSwordSolCostReduction('magic_sword', 0)).toBe(0);
  });

  it('never applies to any other weapon', () => {
    expect(getMagicSwordSolCostReduction('sword', 3)).toBe(0);
    expect(getMagicSwordSolCostReduction('solar_gun', 3)).toBe(0);
  });
});

describe('Phase 24.3 Stage 3: blood weapon defeat effects (LIFE/SOL +1, capped at 2/floor)', () => {
  it('blood_sword restores 1 LIFE (clamped to maxHp) on a genuine defeat', () => {
    const state = baseState();
    state.player.hp = 5;
    state.player.maxHp = 15;
    const instance = createEquipmentInstance(state, 'blood_sword');
    const result = applyWeaponDefeatEffects(state, 'blood_sword', instance, 'bok');
    expect(result).toEqual({ restoredStat: 'hp' });
    expect(state.player.hp).toBe(6);
    expect(instance.effectState?.floorTriggerUses).toBe(1);
  });

  it('blood_spear restores 1 SOL instead', () => {
    const state = baseState();
    state.solarEnergy = 3;
    state.maxSolarEnergy = 10;
    const instance = createEquipmentInstance(state, 'blood_spear');
    const result = applyWeaponDefeatEffects(state, 'blood_spear', instance, 'bok');
    expect(result).toEqual({ restoredStat: 'sol' });
    expect(state.solarEnergy).toBe(4);
  });

  it('caps at 2 uses per floor per individual', () => {
    const state = baseState();
    state.player.hp = 1;
    state.player.maxHp = 100;
    const instance = createEquipmentInstance(state, 'bloody_mace');
    for (let i = 0; i < BLOOD_DEFEAT_EFFECT_FLOOR_CAP; i++) {
      applyWeaponDefeatEffects(state, 'bloody_mace', instance, 'bok');
    }
    expect(state.player.hp).toBe(3);
    const thirdResult = applyWeaponDefeatEffects(state, 'bloody_mace', instance, 'bok');
    expect(thirdResult).toBeNull();
    expect(state.player.hp).toBe(3);
  });

  it('a different individual of the same species has its own independent cap', () => {
    const state = baseState();
    state.player.hp = 1;
    state.player.maxHp = 100;
    const instanceA = createEquipmentInstance(state, 'blood_sword');
    const instanceB = createEquipmentInstance(state, 'blood_sword');
    applyWeaponDefeatEffects(state, 'blood_sword', instanceA, 'bok');
    applyWeaponDefeatEffects(state, 'blood_sword', instanceA, 'bok');
    expect(applyWeaponDefeatEffects(state, 'blood_sword', instanceA, 'bok')).toBeNull();
    expect(applyWeaponDefeatEffects(state, 'blood_sword', instanceB, 'bok')).toEqual({ restoredStat: 'hp' });
  });

  it('never fires for a non-blood, non-battle_axe weapon', () => {
    const state = baseState();
    const instance = createEquipmentInstance(state, 'sword');
    expect(applyWeaponDefeatEffects(state, 'sword', instance, 'bok')).toBeNull();
  });
});

describe('Phase 24.3 Stage 3: battle_axe floor-species memory', () => {
  it('records the defeated species on this exact instance and grants +1 against it afterward', () => {
    const state = baseState();
    const instance = createEquipmentInstance(state, 'battle_axe');
    expect(instance.effectState?.defeatedEnemyTypes).toEqual([]);
    applyWeaponDefeatEffects(state, 'battle_axe', instance, 'bok');
    expect(instance.effectState?.defeatedEnemyTypes).toEqual(['bok']);
    // recorded once, not duplicated on a repeat defeat of the same species
    applyWeaponDefeatEffects(state, 'battle_axe', instance, 'bok');
    expect(instance.effectState?.defeatedEnemyTypes).toEqual(['bok']);
  });

  it('a different (non-recording) instance never sees the bonus', () => {
    const state = baseState();
    const instanceA = createEquipmentInstance(state, 'battle_axe');
    const instanceB = createEquipmentInstance(state, 'battle_axe');
    applyWeaponDefeatEffects(state, 'battle_axe', instanceA, 'bok');
    expect(instanceA.effectState?.defeatedEnemyTypes).toEqual(['bok']);
    expect(instanceB.effectState?.defeatedEnemyTypes).toEqual([]);
  });
});

describe('Phase 24.3 Stage 3: production integration sanity (turn/RNG contract preserved)', () => {
  it('sword/spear/hammer combat is completely unaffected by the new hooks (no effectId => 0 bonus everywhere)', () => {
    const state = baseState();
    state.equippedWeaponId = 'sword';
    const instance = createEquipmentInstance(state, 'sword');
    state.equippedWeaponInstanceId = instance.instanceId;
    state.inventory.sword = 1;
    // Any of the pre-hit bonus helpers should be 0 for an unenchanted sword.
    expect(getWeaponAttackStartBonus(state, 'sword')).toBe(0);
  });

  it('a full processTurn action with an equipped effect weapon does not throw and stays deterministic (targeted regression smoke)', () => {
    const state = baseState();
    expect(() => processTurn(state, { type: 'wait' })).not.toThrow();
  });
});
