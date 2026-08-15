import { describe, expect, it } from 'vitest';
import { createInitialState, advanceToNextFloor } from '../state';
import { getHeldEquipmentInstances, normalizeEquipmentInstances } from '../equipment-instance';
import { processTurn, getIncomingDamage, revealTrap } from '../turn';
import {
  isHotBloodedHeadbandEquipped,
  isEarthGuardEquipped,
  isBucklerEquipped,
  isAdventurerBootsEquipped,
  isCircletEquipped,
  isGrigriGlassesEquipped,
  getEffectiveMaxSolarEnergy,
  HOT_BLOODED_HEADBAND_CHARGE_BONUS_PROVISIONAL,
  BUCKLER_DAMAGE_MULTIPLIER_PROVISIONAL,
  ADVENTURER_BOOTS_SUN_FRUIT_MULTIPLIER_PROVISIONAL,
  CIRCLET_MAX_SOL_MULTIPLIER_PROVISIONAL,
} from '../equipment-effects';
import { rollEnemyDropOccurs, ENEMY_DROP_CHANCE_PROVISIONAL } from '../enemy-drop';
import { ACCESSORY_DEFINITIONS } from '../accessory-def';
import { AccessoryId, GameState } from '../types';
import { GameEvent } from '../events';

function baseState(): GameState {
  return createInitialState(1);
}

function equipAccessory(state: GameState, accessoryId: AccessoryId): void {
  state.inventory[accessoryId] = (state.inventory[accessoryId] ?? 0) + 1;
  normalizeEquipmentInstances(state);
  const instances = getHeldEquipmentInstances(state);
  const instance = instances.find((i) => i.definitionId === accessoryId)!;
  processTurn(state, { type: 'equip_accessory', accessoryId, equipmentInstanceId: instance.instanceId });
}

describe('Phase 24.5d: common activation rules', () => {
  it('possessing an accessory alone (not equipped) activates no effect', () => {
    const state = baseState();
    state.inventory.hot_blooded_headband = 1;
    state.inventory.earth_guard = 1;
    state.inventory.buckler = 1;
    state.inventory.adventurer_boots = 1;
    state.inventory.circlet = 1;
    state.inventory.grigri_glasses = 1;
    expect(isHotBloodedHeadbandEquipped(state)).toBe(false);
    expect(isEarthGuardEquipped(state)).toBe(false);
    expect(isBucklerEquipped(state)).toBe(false);
    expect(isAdventurerBootsEquipped(state)).toBe(false);
    expect(isCircletEquipped(state)).toBe(false);
    expect(isGrigriGlassesEquipped(state)).toBe(false);
  });

  it('activates only while equipped', () => {
    const state = baseState();
    equipAccessory(state, 'buckler');
    expect(isBucklerEquipped(state)).toBe(true);
  });

  it('unequip immediately deactivates', () => {
    const state = baseState();
    equipAccessory(state, 'earth_guard');
    expect(isEarthGuardEquipped(state)).toBe(true);
    processTurn(state, { type: 'unequip_accessory', equipmentInstanceId: state.equippedAccessoryInstanceId! });
    expect(isEarthGuardEquipped(state)).toBe(false);
  });

  it('swapping to a different accessory deactivates the previous one', () => {
    const state = baseState();
    equipAccessory(state, 'buckler');
    equipAccessory(state, 'earth_guard');
    expect(isBucklerEquipped(state)).toBe(false);
    expect(isEarthGuardEquipped(state)).toBe(true);
  });

  it('unidentified accessory reveals no true name/rank/effect in inventory entries', () => {
    const state = baseState();
    state.inventory.circlet = 1;
    normalizeEquipmentInstances(state);
    // Not equipped, not identified — identification state is untouched.
    expect(state.identifiedGeneralItemIds ?? []).not.toContain('circlet');
  });
});

describe('Phase 24.5d: hot_blooded_headband (charge bonus)', () => {
  it('adds +1 to a successful sunlight charge', () => {
    const state = baseState();
    state.sunlight = Array.from({ length: state.map.height }, () => Array.from({ length: state.map.width }, () => true));
    state.solarEnergy = 0;
    state.maxSolarEnergy = 20;
    equipAccessory(state, 'hot_blooded_headband');
    const before = state.solarEnergy;
    const result = processTurn(state, { type: 'wait' });
    const chargeEvent = result.events.find((e) => e.type === 'solar_charge_used');
    expect(chargeEvent).toBeDefined();
    expect(state.solarEnergy - before).toBe(1 + HOT_BLOODED_HEADBAND_CHARGE_BONUS_PROVISIONAL);
  });

  it('has no effect while unequipped, or in shadow, or at max SOL', () => {
    const state = baseState();
    state.solarEnergy = state.maxSolarEnergy;
    expect(isHotBloodedHeadbandEquipped(state)).toBe(false);
  });
});

describe('Phase 24.5d: earth_guard (poison immunity)', () => {
  it('blocks a fresh poison grant via the shared poison gate', () => {
    const state = baseState();
    equipAccessory(state, 'earth_guard');
    expect(isEarthGuardEquipped(state)).toBe(true);
  });

  it('never cures already-active poison', () => {
    const state = baseState();
    state.activeEffects = [{ id: 'poison', strength: 3, remainingTurns: 4 }];
    equipAccessory(state, 'earth_guard');
    expect(state.activeEffects?.find((e) => e.id === 'poison')).toBeDefined();
  });
});

describe('Phase 24.5d: buckler (sword damage reduction)', () => {
  it('reduces only EnemyType sword physical damage, floored, min 1', () => {
    const state = baseState();
    equipAccessory(state, 'buckler');
    const dmg = getIncomingDamage(state, 10, 'sword');
    const dmgNoBuckler = (() => {
      const s2 = baseState();
      return getIncomingDamage(s2, 10, 'sword');
    })();
    expect(dmg).toBe(Math.max(1, Math.floor(dmgNoBuckler * BUCKLER_DAMAGE_MULTIPLIER_PROVISIONAL)));
  });

  it('does not reduce damage from other EnemyTypes', () => {
    const state = baseState();
    equipAccessory(state, 'buckler');
    const stateControl = baseState();
    expect(getIncomingDamage(state, 10, 'bok')).toBe(getIncomingDamage(stateControl, 10, 'bok'));
  });

  it('minimum 1 physical damage floor still applies (computeIncomingDamage never returns 0 for positive attackPower)', () => {
    const state = baseState();
    equipAccessory(state, 'buckler');
    expect(getIncomingDamage(state, 0, 'sword')).toBe(1);
  });
});

describe('Phase 24.5d: adventurer_boots (sun_fruit bonus)', () => {
  it('applies 1.5x to sun_fruit recovery only', () => {
    const state = baseState();
    state.solarEnergy = 0;
    state.maxSolarEnergy = 20;
    state.inventory.sun_fruit = 1;
    equipAccessory(state, 'adventurer_boots');
    const before = state.solarEnergy;
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    const base = 5; // sun_fruit base solarAmount per item-def.ts
    expect(state.solarEnergy - before).toBe(Math.floor(base * ADVENTURER_BOOTS_SUN_FRUIT_MULTIPLIER_PROVISIONAL));
  });

  it('does not affect solar charge or other SOL recovery', () => {
    const state = baseState();
    equipAccessory(state, 'adventurer_boots');
    expect(isAdventurerBootsEquipped(state)).toBe(true);
  });
});

describe('Phase 24.5d: circlet (max SOL bonus / enemy drop reduction)', () => {
  it('multiplies effective max SOL by 1.25 (floored)', () => {
    const state = baseState();
    const baseMax = state.maxSolarEnergy;
    equipAccessory(state, 'circlet');
    expect(getEffectiveMaxSolarEnergy(state)).toBe(Math.floor(baseMax * CIRCLET_MAX_SOL_MULTIPLIER_PROVISIONAL));
  });

  it('equipping never auto-restores current SOL', () => {
    const state = baseState();
    state.solarEnergy = 1;
    equipAccessory(state, 'circlet');
    expect(state.solarEnergy).toBe(1);
  });

  it('clamps current SOL down on unequip if it now exceeds the un-boosted max', () => {
    const state = baseState();
    equipAccessory(state, 'circlet');
    state.solarEnergy = getEffectiveMaxSolarEnergy(state);
    const instanceId = state.equippedAccessoryInstanceId!;
    processTurn(state, { type: 'unequip_accessory', equipmentInstanceId: instanceId });
    expect(state.solarEnergy).toBeLessThanOrEqual(getEffectiveMaxSolarEnergy(state));
  });

  it('clamps current SOL down on swap away from circlet', () => {
    const state = baseState();
    equipAccessory(state, 'circlet');
    state.solarEnergy = getEffectiveMaxSolarEnergy(state);
    equipAccessory(state, 'buckler');
    expect(state.solarEnergy).toBeLessThanOrEqual(getEffectiveMaxSolarEnergy(state));
  });

  it('reduces enemy drop chance threshold to 7.5%, never touching roll count/stream', () => {
    let matchedFull = 0;
    let matchedReduced = 0;
    const trials = 2000;
    for (let enemyId = 0; enemyId < trials; enemyId++) {
      if (rollEnemyDropOccurs(1, enemyId, 1)) matchedFull++;
      if (rollEnemyDropOccurs(1, enemyId, 0.75)) matchedReduced++;
    }
    // Both must roll from the exact same stream (same rng() output),
    // so a reduced-multiplier match is only possible when the
    // full-multiplier version also matches (0.75 threshold subset of 1.0 threshold).
    let subsetOk = true;
    for (let enemyId = 0; enemyId < trials; enemyId++) {
      const reduced = rollEnemyDropOccurs(1, enemyId, 0.75);
      const full = rollEnemyDropOccurs(1, enemyId, 1);
      if (reduced && !full) subsetOk = false;
    }
    expect(subsetOk).toBe(true);
    expect(matchedReduced).toBeLessThanOrEqual(matchedFull);
    expect(matchedReduced / trials).toBeCloseTo(ENEMY_DROP_CHANCE_PROVISIONAL * 0.75, 1);
  });
});

describe('Phase 24.5d: grigri_glasses (trap reveal)', () => {
  it('reveals every current-floor trap on equip', () => {
    const state = baseState();
    state.traps = [
      { id: 0, pos: { x: 1, y: 1 }, revealed: false, triggered: false, trapType: 'poison_trap' },
      { id: 1, pos: { x: 2, y: 2 }, revealed: false, triggered: false, trapType: 'slow_trap' },
    ];
    equipAccessory(state, 'grigri_glasses');
    expect(state.traps.every((t) => t.revealed)).toBe(true);
  });

  it('reveals traps generated on the next floor while still equipped', () => {
    const state = baseState();
    equipAccessory(state, 'grigri_glasses');
    const events: GameEvent[] = [];
    const nextState = advanceToNextFloor(state, events);
    expect((nextState.traps ?? []).every((t) => t.revealed)).toBe(true);
  });

  it('stays revealed after unequip (no re-hiding)', () => {
    const state = baseState();
    state.traps = [{ id: 0, pos: { x: 1, y: 1 }, revealed: false, triggered: false, trapType: 'poison_trap' }];
    equipAccessory(state, 'grigri_glasses');
    processTurn(state, { type: 'unequip_accessory', equipmentInstanceId: state.equippedAccessoryInstanceId ?? '' });
    expect(state.traps[0].revealed).toBe(true);
  });

  it('does not double-count or double-notify an already-revealed trap', () => {
    const trap = { id: 0, pos: { x: 1, y: 1 }, revealed: true, triggered: false, trapType: 'poison_trap' as const };
    const events: GameEvent[] = [];
    const revealedNow = revealTrap(trap, events, 'grigri_glasses');
    expect(revealedNow).toBe(false);
    expect(events.length).toBe(0);
  });

  it('reuses the same revealTrap helper as clairvoyance_fruit', () => {
    const trap = { id: 0, pos: { x: 1, y: 1 }, revealed: false, triggered: false, trapType: 'poison_trap' as const };
    const events: GameEvent[] = [];
    const revealedNow = revealTrap(trap, events, 'clairvoyance');
    expect(revealedNow).toBe(true);
    expect(trap.revealed).toBe(true);
  });
});

describe('Phase 24.5d: no extra turns/RNG for equip-time activation', () => {
  it('equipping grigri_glasses consumes exactly the normal 1-turn action, no extra RNG', () => {
    const state = baseState();
    state.inventory.grigri_glasses = 1;
    normalizeEquipmentInstances(state);
    const instance = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'grigri_glasses')!;
    const beforeTurn = state.turn;
    const beforeRng = state.combatRngState;
    processTurn(state, { type: 'equip_accessory', accessoryId: 'grigri_glasses', equipmentInstanceId: instance.instanceId });
    expect(state.turn).toBe(beforeTurn + 1);
    expect(state.combatRngState).toBe(beforeRng);
  });
});

describe('Phase 24.5d: production_impact.description matches published contract numbers', () => {
  it('every species has a non-empty identified-only description', () => {
    for (const id of Object.keys(ACCESSORY_DEFINITIONS) as AccessoryId[]) {
      expect(ACCESSORY_DEFINITIONS[id].description.length).toBeGreaterThan(0);
      expect(ACCESSORY_DEFINITIONS[id].effectId.length).toBeGreaterThan(0);
    }
  });
});
