import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_CONFIG } from '../floor';
import { buildFloorState, createInitialState } from '../state';
import type { GameState } from '../types';

type Carry = NonNullable<Parameters<typeof buildFloorState>[5]>;

function carryFrom(state: GameState, foodDroughtFloors: number): Carry {
  return {
    hp: state.player.hp,
    maxHp: state.player.maxHp,
    attack: state.player.attack,
    defense: state.player.defense,
    accuracy: state.player.accuracy,
    evasion: state.player.evasion,
    regenProgress: state.regenProgress,
    inventory: state.inventory,
    equippedWeaponId: state.equippedWeaponId,
    equippedArmorId: state.equippedArmorId,
    facing: state.player.facing,
    solarEnergy: state.solarEnergy,
    maxSolarEnergy: state.maxSolarEnergy,
    solUnlocked: state.solUnlocked,
    selectedEnchantment: state.selectedEnchantment,
    unlockedEnchantments: state.unlockedEnchantments,
    combatRngState: state.combatRngState,
    hunger: state.hunger!,
    hungerDecreaseProgress: state.hungerDecreaseProgress!,
    starvationProgress: state.starvationProgress!,
    poisonTickProgress: state.poisonTickProgress!,
    foodDroughtFloors,
    hungerLowWarned: state.hungerLowWarned!,
    hungerZeroWarned: state.hungerZeroWarned!,
    activeEffects: state.activeEffects!,
    level: state.level!,
    experience: state.experience!,
    unspentAbilityPoints: state.unspentAbilityPoints!,
    abilities: state.abilities!,
    identifiedCardIds: state.identifiedCardIds!,
    identifiedGeneralItemIds: state.identifiedGeneralItemIds!,
    equipmentInstances: state.equipmentInstances!,
    nextEquipmentInstanceId: state.nextEquipmentInstanceId!,
    equippedWeaponInstanceId: state.equippedWeaponInstanceId!,
    equippedArmorInstanceId: state.equippedArmorInstanceId!,
    equippedAccessoryId: state.equippedAccessoryId,
    equippedAccessoryInstanceId: state.equippedAccessoryInstanceId,
  };
}

function build(seed: number, leg: GameState['leg'], carry?: Carry): GameState {
  return buildFloorState(seed, 18, 0, 1, DEFAULT_RUN_CONFIG, carry, undefined, undefined, leg);
}

describe('Phase 24.6c4c descent-only normal floor loot', () => {
  it('suppresses ascent loot and monster houses without suppressing normal hazards', () => {
    let fixture: { descent: GameState; ascent: GameState } | undefined;
    for (let seed = 1; seed <= 20_000; seed += 1) {
      const descent = build(seed, 'descent');
      const ascent = build(seed, 'ascent');
      if (descent.groundItems.length >= 2 && ascent.map.darkRoomIndex != null && (ascent.traps?.length ?? 0) > 0) {
        fixture = { descent, ascent };
        break;
      }
    }
    expect(fixture).toBeDefined();

    const { descent, ascent } = fixture!;
    expect(descent.groundItems.length).toBeGreaterThan(0);
    expect(ascent.groundItems).toEqual([]);
    expect(ascent.map.monsterHouse).toBeNull();
    expect(ascent.enemies.some((enemy) => enemy.spawnSource === 'normal')).toBe(true);
    expect(ascent.traps?.length ?? 0).toBeGreaterThan(0);
    expect(ascent.map.darkRoomIndex).not.toBeNull();
    expect(ascent.seed).not.toBe(descent.seed);
    expect(ascent.map.terrain).not.toEqual(descent.map.terrain);
  });

  it('holds the incoming food-drought counter unchanged on ascent', () => {
    const initial = createInitialState(7123);
    const ascent = build(7123, 'ascent', carryFrom(initial, 4));

    expect(ascent.groundItems).toEqual([]);
    expect(ascent.foodDroughtFloors).toBe(4);
  });
});
