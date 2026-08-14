import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { createEquipmentInstance } from '../equipment-instance';
import { getEffectiveAttackPower } from '../turn';
import { getPlayerSpeed } from '../ability';
import {
  getArmorEffectiveAttackBonus,
  getArmorEffectiveSpeedBonus,
  getArmorEffectiveMaxSolBonus,
  getEffectiveMaxSolarEnergy,
  getArmorElementalDamageReduction,
  isPlayerPoisonImmune,
  getArmorAggroRangeReduction,
  isSpikeMailEquipped,
  isNightOrDarkRoom,
  applyMagicRobeSolSpendRefund,
  tickBlackArmorEquippedTurn,
  BLACK_ARMOR_TURN_INTERVAL,
  MAGIC_ROBE_REFUND_THRESHOLD,
} from '../equipment-effects';
import { processTurn } from '../turn';
import { ARMOR_DEFINITIONS } from '../armor-def';
import { GameState } from '../types';

/**
 * Phase 24.3 Stage 4: 防具固有効果テスト。armor_stats / armor_elements /
 * magic_robe / skull_suit / poison_guard / dark_garb / spike_mail /
 * black_armor の各契約を検証する。
 */

function baseState(): GameState {
  return createInitialState(1);
}

describe('Phase 24.3 Stage 4: effective attack (samurai_armor / black_armor)', () => {
  it('samurai_armor adds +1 effective attack, never touching base player.attack', () => {
    const state = baseState();
    const baseAttack = state.player.attack;
    state.equippedArmorId = 'samurai_armor';
    expect(getArmorEffectiveAttackBonus(state)).toBe(1);
    expect(getEffectiveAttackPower(state)).toBe(baseAttack + 1);
    expect(state.player.attack).toBe(baseAttack);
  });

  it('black_armor adds +2 effective attack', () => {
    const state = baseState();
    state.equippedArmorId = 'black_armor';
    expect(getArmorEffectiveAttackBonus(state)).toBe(2);
  });

  it('no armor / a defense-only armor grants 0', () => {
    const state = baseState();
    expect(getArmorEffectiveAttackBonus(state)).toBe(0);
    state.equippedArmorId = 'armor';
    expect(getArmorEffectiveAttackBonus(state)).toBe(0);
  });

  it('repeated equip/unequip never accumulates a permanent base-attack change', () => {
    const state = baseState();
    const baseAttack = state.player.attack;
    for (let i = 0; i < 5; i++) {
      state.equippedArmorId = 'samurai_armor';
      getEffectiveAttackPower(state);
      state.equippedArmorId = null;
      getEffectiveAttackPower(state);
    }
    expect(state.player.attack).toBe(baseAttack);
  });
});

describe('Phase 24.3 Stage 4: effective speed (ninja_suit)', () => {
  it('ninja_suit adds +10 effective speed', () => {
    const state = baseState();
    const withoutBonus = getPlayerSpeed(state);
    state.equippedArmorId = 'ninja_suit';
    expect(getArmorEffectiveSpeedBonus(state)).toBe(10);
    expect(getPlayerSpeed(state)).toBe(withoutBonus + 10);
  });

  it('no bonus for any other armor', () => {
    const state = baseState();
    state.equippedArmorId = 'armor';
    expect(getArmorEffectiveSpeedBonus(state)).toBe(0);
  });
});

describe('Phase 24.3 Stage 4: effective max SOL (light_garb)', () => {
  it('light_garb adds +2 effective max SOL without touching base maxSolarEnergy', () => {
    const state = baseState();
    const baseMax = state.maxSolarEnergy;
    state.equippedArmorId = 'light_garb';
    expect(getArmorEffectiveMaxSolBonus(state)).toBe(2);
    expect(getEffectiveMaxSolarEnergy(state)).toBe(baseMax + 2);
    expect(state.maxSolarEnergy).toBe(baseMax);
  });

  it('equipping light_garb never itself restores SOL (no auto-heal on equip)', () => {
    const state = baseState();
    state.solarEnergy = 0;
    state.equippedArmorId = 'light_garb';
    expect(state.solarEnergy).toBe(0);
  });
});

describe('Phase 24.3 Stage 4: elemental reduction (mail_of_sol / dragon_scale)', () => {
  it('mail_of_sol reduces sol elemental bonus damage by 1, never other elements', () => {
    const state = baseState();
    state.equippedArmorId = 'mail_of_sol';
    expect(getArmorElementalDamageReduction(state, 'sol')).toBe(1);
    expect(getArmorElementalDamageReduction(state, 'flame')).toBe(0);
  });

  it('dragon_scale reduces flame/frost/cloud/earth, never sol', () => {
    const state = baseState();
    state.equippedArmorId = 'dragon_scale';
    for (const el of ['flame', 'frost', 'cloud', 'earth'] as const) {
      expect(getArmorElementalDamageReduction(state, el)).toBe(1);
    }
    expect(getArmorElementalDamageReduction(state, 'sol')).toBe(0);
  });

  it('no armor equipped grants no reduction', () => {
    const state = baseState();
    expect(getArmorElementalDamageReduction(state, 'flame')).toBe(0);
  });
});

describe('Phase 24.3 Stage 4: poison_guard', () => {
  it('reports immunity only while equipped', () => {
    const state = baseState();
    expect(isPlayerPoisonImmune(state)).toBe(false);
    state.equippedArmorId = 'poison_guard';
    expect(isPlayerPoisonImmune(state)).toBe(true);
  });

  it('blocks a fresh poison trap application end-to-end via processTurn', () => {
    const state = baseState();
    state.equippedArmorId = 'poison_guard';
    state.traps = [{ id: 0, pos: { x: state.player.pos.x + 1, y: state.player.pos.y }, trapType: 'poison_trap', triggered: false, revealed: false }];
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result).toBeDefined();
    expect(state.activeEffects?.some((e: any) => e.id === 'poison')).toBeFalsy();
  });
});

describe('Phase 24.3 Stage 4: skull_suit aggro range', () => {
  it('reduces AGGRO_RANGE by 2 while equipped, 0 otherwise', () => {
    const state = baseState();
    expect(getArmorAggroRangeReduction(state)).toBe(0);
    state.equippedArmorId = 'skull_suit';
    expect(getArmorAggroRangeReduction(state)).toBe(2);
  });
});

describe('Phase 24.3 Stage 4: dark_garb night override', () => {
  it('forces isNightOrDarkRoom true regardless of actual room', () => {
    const state = baseState();
    expect(isNightOrDarkRoom(state)).toBe(false);
    state.equippedArmorId = 'dark_garb';
    expect(isNightOrDarkRoom(state)).toBe(true);
  });
});

describe('Phase 24.3 Stage 4: magic_robe SOL-spend refund', () => {
  it('refunds 1 SOL per 5 cumulative spent while equipped', () => {
    const state = baseState();
    state.maxSolarEnergy = 20;
    state.solarEnergy = 0;
    state.equippedArmorId = 'magic_robe';
    const instance = createEquipmentInstance(state, 'magic_robe');
    state.equippedArmorInstanceId = instance.instanceId;
    state.inventory.magic_robe = 1;

    const refund1 = applyMagicRobeSolSpendRefund(state, 4);
    expect(refund1).toBe(0);
    const refund2 = applyMagicRobeSolSpendRefund(state, 1);
    expect(refund2).toBe(1);
    expect(state.solarEnergy).toBe(1);
  });

  it('supports multiple refunds from a single big spend', () => {
    const state = baseState();
    state.maxSolarEnergy = 20;
    state.solarEnergy = 0;
    state.equippedArmorId = 'magic_robe';
    const instance = createEquipmentInstance(state, 'magic_robe');
    state.equippedArmorInstanceId = instance.instanceId;
    state.inventory.magic_robe = 1;

    const refund = applyMagicRobeSolSpendRefund(state, MAGIC_ROBE_REFUND_THRESHOLD * 2 + 3);
    expect(refund).toBe(2);
  });

  it('never accumulates while unequipped', () => {
    const state = baseState();
    const refund = applyMagicRobeSolSpendRefund(state, 5);
    expect(refund).toBe(0);
  });

  it('preserves remainder across re-equip of the same instance', () => {
    const state = baseState();
    state.equippedArmorId = 'magic_robe';
    const instance = createEquipmentInstance(state, 'magic_robe');
    state.equippedArmorInstanceId = instance.instanceId;
    state.inventory.magic_robe = 1;
    applyMagicRobeSolSpendRefund(state, 3);
    expect(instance.effectState?.solSpentRemainder).toBe(3);
    state.equippedArmorId = null;
    state.equippedArmorId = 'magic_robe';
    state.equippedArmorInstanceId = instance.instanceId;
    applyMagicRobeSolSpendRefund(state, 2);
    expect(instance.effectState?.solSpentRemainder).toBe(0); // 3+2=5 -> refunded to 0
  });
});

describe('Phase 24.3 Stage 4: spike_mail', () => {
  it('reports equipped only while spike_mail is worn', () => {
    const state = baseState();
    expect(isSpikeMailEquipped(state)).toBe(false);
    state.equippedArmorId = 'spike_mail';
    expect(isSpikeMailEquipped(state)).toBe(true);
  });
});

describe('Phase 24.3 Stage 4: black_armor 20-turn LIFE drain', () => {
  it('does nothing while unequipped', () => {
    const state = baseState();
    const result = tickBlackArmorEquippedTurn(state);
    expect(result.drained).toBe(false);
  });

  it('drains 1 LIFE and resets the counter every 20th completed turn while equipped', () => {
    const state = baseState();
    state.player.hp = 15;
    state.equippedArmorId = 'black_armor';
    const instance = createEquipmentInstance(state, 'black_armor');
    state.equippedArmorInstanceId = instance.instanceId;
    state.inventory.black_armor = 1;

    for (let i = 0; i < BLACK_ARMOR_TURN_INTERVAL - 1; i++) {
      const r = tickBlackArmorEquippedTurn(state);
      expect(r.drained).toBe(false);
    }
    expect(state.player.hp).toBe(15);
    const last = tickBlackArmorEquippedTurn(state);
    expect(last.drained).toBe(true);
    expect(state.player.hp).toBe(14);
    expect(instance.effectState?.equippedTurnCounter).toBe(0);
  });

  it('counter is preserved (not reset) while unequipped, and resumes counting on re-equip', () => {
    const state = baseState();
    state.equippedArmorId = 'black_armor';
    const instance = createEquipmentInstance(state, 'black_armor');
    state.equippedArmorInstanceId = instance.instanceId;
    state.inventory.black_armor = 1;
    tickBlackArmorEquippedTurn(state);
    tickBlackArmorEquippedTurn(state);
    expect(instance.effectState?.equippedTurnCounter).toBe(2);
    state.equippedArmorId = null;
    tickBlackArmorEquippedTurn(state); // no-op while unequipped
    expect(instance.effectState?.equippedTurnCounter).toBe(2);
  });

  it('can bring LIFE to (and allow) 0', () => {
    const state = baseState();
    state.player.hp = 1;
    state.equippedArmorId = 'black_armor';
    const instance = createEquipmentInstance(state, 'black_armor');
    state.equippedArmorInstanceId = instance.instanceId;
    state.inventory.black_armor = 1;
    for (let i = 0; i < BLACK_ARMOR_TURN_INTERVAL; i++) tickBlackArmorEquippedTurn(state);
    expect(state.player.hp).toBe(0);
  });

  it('never consumes combat RNG', () => {
    const state = baseState();
    const before = state.combatRngState;
    state.equippedArmorId = 'black_armor';
    const instance = createEquipmentInstance(state, 'black_armor');
    state.equippedArmorInstanceId = instance.instanceId;
    tickBlackArmorEquippedTurn(state);
    expect(state.combatRngState).toBe(before);
  });
});

describe('Phase 24.3 Stage 4: armor catalog defense values match the equipment_catalog table', () => {
  it('spot-checks a handful of defense values', () => {
    expect(ARMOR_DEFINITIONS.chain_mail.armorValue).toBe(4);
    expect(ARMOR_DEFINITIONS.plate_mail.armorValue).toBe(7);
    expect(ARMOR_DEFINITIONS.spike_mail.armorValue).toBe(10);
    expect(ARMOR_DEFINITIONS.black_armor.armorValue).toBe(12);
  });
});
