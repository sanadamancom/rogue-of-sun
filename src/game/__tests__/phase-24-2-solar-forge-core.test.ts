import { describe, expect, it } from 'vitest';
import { createInitialState, advanceToNextFloor } from '../state';
import { normalizeEquipmentInstances, getHeldEquipmentInstances } from '../equipment-instance';
import { applySolarForge } from '../turn';
import { processTurn } from '../turn';
import {
  SolarForgeRecipe,
  buildForgeRecipeKey,
  findSolarForgeRecipe,
  getSolarForgeCandidates,
  isForgeEligibleWeaponId,
  validateForgeMaterials,
  validateForgeRecipe,
  validateForgeRegistry,
} from '../solar-forge';
import { SOLAR_FORGE_RECIPES } from '../solar-forge-recipes';
import { WEAPON_DEFINITIONS, WeaponDefinition } from '../weapon-def';
import { GameState, WeaponId, EquipmentInstance } from '../types';

/**
 * Phase 24.2 太陽鍛冶コア tests: recipe resolution/validation,
 * material identity and atomicity, equipment-state carry-over, output
 * normalization, curse rejection, turn/RNG contract, and the current
 * (empty) production catalog. See
 * docs/history/phase-24-2-solar-forge-core.md for the full contract
 * these tests enforce. Every fixture below injects its own catalog/
 * registry (never mutates WEAPON_DEFINITIONS/SOLAR_FORGE_RECIPES) per
 * production_sanity's fixture-injection requirement.
 */

// --- fixture catalog: sword(C) + a hypothetical B/A/S/R chain, all
// otherwise-identical to WEAPON_DEFINITIONS.sword so combat fields never
// matter to these tests.
function fixtureWeaponDef(id: WeaponId, rank: WeaponDefinition['rank']): WeaponDefinition {
  return { ...WEAPON_DEFINITIONS.sword, id, rank };
}

const FIXTURE_CATALOG: Record<string, WeaponDefinition> = {
  sword: fixtureWeaponDef('sword', 'C'),
  spear: fixtureWeaponDef('spear', 'C'),
  fx_b: fixtureWeaponDef('fx_b' as WeaponId, 'B'),
  fx_a: fixtureWeaponDef('fx_a' as WeaponId, 'A'),
  fx_s1: fixtureWeaponDef('fx_s1' as WeaponId, 'S'),
  fx_s2: fixtureWeaponDef('fx_s2' as WeaponId, 'S'),
  fx_r: fixtureWeaponDef('fx_r' as WeaponId, 'R'),
};

const RECIPE_C_TO_B: SolarForgeRecipe = {
  id: 'fx-c-to-b',
  inputDefinitionIds: ['sword', 'sword'],
  inputRank: 'C',
  outputDefinitionId: 'fx_b' as WeaponId,
  outputRank: 'B',
};

const RECIPE_B_TO_A: SolarForgeRecipe = {
  id: 'fx-b-to-a',
  inputDefinitionIds: ['fx_b' as WeaponId, 'fx_b' as WeaponId],
  inputRank: 'B',
  outputDefinitionId: 'fx_a' as WeaponId,
  outputRank: 'A',
};

const RECIPE_A_TO_S: SolarForgeRecipe = {
  id: 'fx-a-to-s',
  inputDefinitionIds: ['fx_a' as WeaponId, 'fx_a' as WeaponId],
  inputRank: 'A',
  outputDefinitionId: 'fx_s1' as WeaponId,
  outputRank: 'S',
};

const RECIPE_S_TO_R: SolarForgeRecipe = {
  id: 'fx-s-to-r',
  inputDefinitionIds: ['fx_s1' as WeaponId, 'fx_s2' as WeaponId],
  inputRank: 'S',
  outputDefinitionId: 'fx_r' as WeaponId,
  outputRank: 'R',
};

const FULL_REGISTRY: SolarForgeRecipe[] = [RECIPE_C_TO_B, RECIPE_B_TO_A, RECIPE_A_TO_S, RECIPE_S_TO_R];

function stateWith(materials: Record<string, number>): GameState {
  const state = createInitialState(1);
  for (const [id, count] of Object.entries(materials)) {
    (state.inventory as Record<string, number>)[id] = count;
  }
  normalizeEquipmentInstances(state);
  return state;
}

function heldOf(state: GameState, definitionId: string): EquipmentInstance[] {
  return getHeldEquipmentInstances(state).filter((i) => i.definitionId === definitionId);
}

describe('Phase 24.2: recipe resolution', () => {
  it('resolves C -> B from 2 same-definitionId swords', () => {
    const recipe = findSolarForgeRecipe(FULL_REGISTRY, 'sword', 'sword');
    expect(recipe?.id).toBe('fx-c-to-b');
  });

  it('resolves B -> A and A -> S the same way', () => {
    expect(findSolarForgeRecipe(FULL_REGISTRY, 'fx_b' as WeaponId, 'fx_b' as WeaponId)?.id).toBe('fx-b-to-a');
    expect(findSolarForgeRecipe(FULL_REGISTRY, 'fx_a' as WeaponId, 'fx_a' as WeaponId)?.id).toBe('fx-a-to-s');
  });

  it('resolves S -> R from 2 distinct S definitionIds', () => {
    const recipe = findSolarForgeRecipe(FULL_REGISTRY, 'fx_s1' as WeaponId, 'fx_s2' as WeaponId);
    expect(recipe?.id).toBe('fx-s-to-r');
  });

  it('resolves identically when material order is reversed', () => {
    const forward = findSolarForgeRecipe(FULL_REGISTRY, 'fx_s1' as WeaponId, 'fx_s2' as WeaponId);
    const reversed = findSolarForgeRecipe(FULL_REGISTRY, 'fx_s2' as WeaponId, 'fx_s1' as WeaponId);
    expect(reversed).toBe(forward);
  });

  it('returns undefined when no recipe matches the pair', () => {
    expect(findSolarForgeRecipe(FULL_REGISTRY, 'sword', 'spear')).toBeUndefined();
  });

  it('validateForgeRecipe rejects an inputRank/outputRank pair outside C->B/B->A/A->S/S->R', () => {
    const bad: SolarForgeRecipe = { ...RECIPE_C_TO_B, id: 'bad', outputRank: 'A' };
    expect(validateForgeRecipe(FIXTURE_CATALOG, bad)).toContain('invalid_rank_transition');
  });

  it('validateForgeRecipe rejects R as an input rank', () => {
    const bad: SolarForgeRecipe = {
      id: 'bad-r-input',
      inputDefinitionIds: ['fx_r' as WeaponId, 'fx_r' as WeaponId],
      inputRank: 'R',
      outputDefinitionId: 'fx_r' as WeaponId,
      outputRank: 'R',
    };
    expect(validateForgeRecipe(FIXTURE_CATALOG, bad)).toContain('r_as_input');
  });

  it('validateForgeRecipe rejects an armor-style/unknown definitionId as input', () => {
    const bad: SolarForgeRecipe = {
      ...RECIPE_C_TO_B,
      id: 'bad-armor',
      inputDefinitionIds: ['armor' as WeaponId, 'sword'],
    };
    expect(validateForgeRecipe(FIXTURE_CATALOG, bad).length).toBeGreaterThan(0);
  });

  it('validateForgeRecipe rejects solar_gun as input or output', () => {
    const badInput: SolarForgeRecipe = { ...RECIPE_C_TO_B, id: 'bad-gun-in', inputDefinitionIds: ['solar_gun', 'sword'] };
    const badOutput: SolarForgeRecipe = { ...RECIPE_C_TO_B, id: 'bad-gun-out', outputDefinitionId: 'solar_gun' };
    expect(validateForgeRecipe(FIXTURE_CATALOG, badInput)).toContain('solar_gun_excluded');
    expect(validateForgeRecipe(FIXTURE_CATALOG, badOutput)).toContain('solar_gun_excluded');
  });

  it('validateForgeRegistry detects a duplicate recipe key', () => {
    const dup: SolarForgeRecipe = { ...RECIPE_C_TO_B, id: 'dup-c-to-b' };
    const errors = validateForgeRegistry(FIXTURE_CATALOG, [RECIPE_C_TO_B, dup]);
    expect(errors.some((e) => e.includes('duplicate_key'))).toBe(true);
  });
});

describe('Phase 24.2: identity and atomicity', () => {
  it('consumes exactly the 2 different-instanceId swords named, not a third sibling', () => {
    const state = stateWith({ sword: 3 });
    const [i1, i2, i3] = heldOf(state, 'sword');
    const result = applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    expect(result.consumed).toBe(true);
    expect(heldOf(state, 'sword').map((i) => i.instanceId)).toEqual([i3.instanceId]);
  });

  it('rejects a duplicate instanceId (same id specified twice)', () => {
    const state = stateWith({ sword: 2 });
    const [i1] = heldOf(state, 'sword');
    const events: import('../events').GameEvent[] = [];
    const result = applySolarForge(state, [i1.instanceId, i1.instanceId], events, [RECIPE_C_TO_B]);
    expect(result.consumed).toBe(false);
    expect(events[0]).toMatchObject({ type: 'solar_forge_failed', reason: 'duplicate_instance' });
  });

  it('rejects a nonexistent instanceId', () => {
    const state = stateWith({ sword: 2 });
    const [i1] = heldOf(state, 'sword');
    const result = applySolarForge(state, [i1.instanceId, 'eq-nonexistent'], [], [RECIPE_C_TO_B]);
    expect(result.consumed).toBe(false);
  });

  it('rejects a floor-only (not held) instanceId', () => {
    const state = stateWith({ sword: 1 });
    const held = heldOf(state, 'sword');
    // Simulate a floor-only instance: registered but not counted in inventory.
    state.equipmentInstances = state.equipmentInstances ?? [];
    const floorOnly = { instanceId: 'eq-floor-only', definitionId: 'sword' as WeaponId, refineLevel: 0, cursed: false, curseRevealed: false, rank: 'C' as const };
    state.equipmentInstances.push(floorOnly);
    state.groundItems.push({ id: 9999, itemId: 'sword', pos: { x: 0, y: 0 }, equipmentInstanceId: 'eq-floor-only' });
    const result = applySolarForge(state, [held[0].instanceId, 'eq-floor-only'], [], [RECIPE_C_TO_B]);
    expect(result.consumed).toBe(false);
  });

  it('never leaves a half-consumed state on rejection (both materials still held)', () => {
    const state = stateWith({ sword: 2 });
    const [i1] = heldOf(state, 'sword');
    const before = state.inventory.sword;
    applySolarForge(state, [i1.instanceId, i1.instanceId], [], [RECIPE_C_TO_B]);
    expect(state.inventory.sword).toBe(before);
    expect(heldOf(state, 'sword')).toHaveLength(2);
  });

  it('resolves the same output definition regardless of material order', () => {
    const stateA = stateWith({ sword: 2 });
    const [a1, a2] = heldOf(stateA, 'sword');
    const resultA = applySolarForge(stateA, [a1.instanceId, a2.instanceId], [], [RECIPE_C_TO_B]);

    const stateB = stateWith({ sword: 2 });
    const [b1, b2] = heldOf(stateB, 'sword');
    const resultB = applySolarForge(stateB, [b2.instanceId, b1.instanceId], [], [RECIPE_C_TO_B]);

    expect(resultA.consumed).toBe(true);
    expect(resultB.consumed).toBe(true);
    expect(heldOf(stateA, 'fx_b')[0].definitionId).toBe(heldOf(stateB, 'fx_b')[0].definitionId);
  });

  it('the completed output has a brand-new instanceId, never reusing a material id', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    const [output] = heldOf(state, 'fx_b');
    expect(output.instanceId).not.toBe(i1.instanceId);
    expect(output.instanceId).not.toBe(i2.instanceId);
  });
});

describe('Phase 24.2: equipment state', () => {
  it('produces an unequipped output from 2 unequipped materials', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    const [output] = heldOf(state, 'fx_b');
    expect(state.equippedWeaponInstanceId).not.toBe(output.instanceId);
  });

  it('carries the equip over when one material was the equipped weapon', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    state.equippedWeaponId = 'sword';
    state.equippedWeaponInstanceId = i1.instanceId;
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    const [output] = heldOf(state, 'fx_b');
    expect(state.equippedWeaponId).toBe('fx_b');
    expect(state.equippedWeaponInstanceId).toBe(output.instanceId);
  });

  it('never touches armor equip state', () => {
    const state = stateWith({ sword: 2, armor: 1 });
    const [armorInst] = heldOf(state, 'armor');
    state.equippedArmorId = 'armor';
    state.equippedArmorInstanceId = armorInst.instanceId;
    const [i1, i2] = heldOf(state, 'sword');
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    expect(state.equippedArmorId).toBe('armor');
    expect(state.equippedArmorInstanceId).toBe(armorInst.instanceId);
  });

  it('does not touch other unrelated weapon instances', () => {
    const state = stateWith({ sword: 2, spear: 1 });
    const [spearInst] = heldOf(state, 'spear');
    const [i1, i2] = heldOf(state, 'sword');
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    expect(heldOf(state, 'spear')).toEqual([spearInst]);
  });
});

describe('Phase 24.2: output normalization', () => {
  it('output definitionId/rank match the recipe', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    const [output] = heldOf(state, 'fx_b');
    expect(output.definitionId).toBe('fx_b');
    expect(output.rank).toBe('B');
  });

  it('output refineLevel is 0, cursed/curseRevealed are false regardless of material state', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    i1.refineLevel = 3;
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    const [output] = heldOf(state, 'fx_b');
    expect(output.refineLevel).toBe(0);
    expect(output.cursed).toBe(false);
    expect(output.curseRevealed).toBe(false);
  });

  it('the completed individual survives normalizeEquipmentInstances and floor carry-over', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    state.equippedWeaponId = 'sword';
    state.equippedWeaponInstanceId = i1.instanceId;
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    const [output] = heldOf(state, 'fx_b');
    const next = advanceToNextFloor(state);
    expect(next.equippedWeaponId).toBe('fx_b');
    expect(next.equippedWeaponInstanceId).toBe(output.instanceId);
    expect(heldOf(next, 'fx_b')[0].rank).toBe('B');
  });
});

describe('Phase 24.2: curse handling', () => {
  it('rejects a discovered-cursed material', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    i1.cursed = true;
    i1.curseRevealed = true;
    const events: import('../events').GameEvent[] = [];
    const result = applySolarForge(state, [i1.instanceId, i2.instanceId], events, [RECIPE_C_TO_B]);
    expect(result.consumed).toBe(false);
    expect(events[0]).toMatchObject({ type: 'solar_forge_failed', reason: 'cursed' });
  });

  it('rejects an undiscovered-cursed material identically', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    i1.cursed = true;
    i1.curseRevealed = false;
    const result = applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    expect(result.consumed).toBe(false);
  });

  it('never flips curseRevealed on a failed attempt', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    i1.cursed = true;
    i1.curseRevealed = false;
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    expect(i1.curseRevealed).toBe(false);
  });

  it('a discovered-cursed equipped material cannot be forged away to dodge the unequip curse lock', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    state.equippedWeaponId = 'sword';
    state.equippedWeaponInstanceId = i1.instanceId;
    i1.cursed = true;
    i1.curseRevealed = true;
    const result = applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    expect(result.consumed).toBe(false);
    expect(state.equippedWeaponInstanceId).toBe(i1.instanceId);
  });

  it('never falls back to a different held individual when the named one is cursed', () => {
    const state = stateWith({ sword: 3 });
    const [i1, i2, i3] = heldOf(state, 'sword');
    i1.cursed = true;
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    expect(heldOf(state, 'sword').map((i) => i.instanceId).sort()).toEqual(
      [i1.instanceId, i2.instanceId, i3.instanceId].sort(),
    );
  });
});

describe('Phase 24.2: turn and RNG contract', () => {
  it('a successful forge action consumes exactly 1 turn (full processTurn integration)', () => {
    // Temporarily inject a fixture recipe into the production registry
    // (mutable array) to exercise processTurn's real dispatch path end
    // to end, then restore it to empty immediately after — production
    // recipes stay 0-length for every other test in this file.
    SOLAR_FORGE_RECIPES.push(RECIPE_C_TO_B);
    try {
      const state = stateWith({ sword: 2 });
      const [i1, i2] = heldOf(state, 'sword');
      const before = state.turn;
      const result = processTurn(state, { type: 'solar_forge', materialInstanceIds: [i1.instanceId, i2.instanceId] });
      expect(result.consumed).toBe(true);
      expect(state.turn).toBe(before + 1);
    } finally {
      SOLAR_FORGE_RECIPES.length = 0;
    }
  });

  it('a rejected forge (no recipe) never advances the turn', () => {
    const state = stateWith({ sword: 1, spear: 1 });
    const [sword] = heldOf(state, 'sword');
    const [spear] = heldOf(state, 'spear');
    const before = state.turn;
    const result = processTurn(state, { type: 'solar_forge', materialInstanceIds: [sword.instanceId, spear.instanceId] });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(before);
  });

  it('an invalid instanceId never advances the turn', () => {
    const state = stateWith({ sword: 1 });
    const [sword] = heldOf(state, 'sword');
    const before = state.turn;
    processTurn(state, { type: 'solar_forge', materialInstanceIds: [sword.instanceId, 'eq-bogus'] });
    expect(state.turn).toBe(before);
  });

  it('success and failure alike never consume combat RNG', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    const rngBefore = state.combatRngState;
    applySolarForge(state, [i1.instanceId, i2.instanceId], [], [RECIPE_C_TO_B]);
    expect(state.combatRngState).toBe(rngBefore);

    const state2 = stateWith({ sword: 1 });
    const [only] = heldOf(state2, 'sword');
    const rngBefore2 = state2.combatRngState;
    applySolarForge(state2, [only.instanceId, 'eq-bogus'], [], [RECIPE_C_TO_B]);
    expect(state2.combatRngState).toBe(rngBefore2);
  });

  it('exactly 1 solar_forge_completed event is pushed on success', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    const events: import('../events').GameEvent[] = [];
    applySolarForge(state, [i1.instanceId, i2.instanceId], events, [RECIPE_C_TO_B]);
    expect(events.filter((e) => e.type === 'solar_forge_completed')).toHaveLength(1);
  });

  it('no solar_forge_completed event on failure or a duplicate/cancelled selection', () => {
    const state = stateWith({ sword: 1 });
    const [only] = heldOf(state, 'sword');
    const events: import('../events').GameEvent[] = [];
    applySolarForge(state, [only.instanceId, only.instanceId], events, [RECIPE_C_TO_B]);
    expect(events.some((e) => e.type === 'solar_forge_completed')).toBe(false);
  });
});

describe('Phase 24.2: current production catalog', () => {
  it('the production recipe registry is empty', () => {
    expect(SOLAR_FORGE_RECIPES).toHaveLength(0);
  });

  it('no candidate pair is generated from the current 5 production definitions', () => {
    const state = createInitialState(1);
    state.inventory.sword = 2;
    state.inventory.spear = 2;
    state.inventory.hammer = 2;
    normalizeEquipmentInstances(state);
    expect(getSolarForgeCandidates(state, SOLAR_FORGE_RECIPES)).toEqual([]);
  });

  it('no B/A/S/R weapon has been added to the production catalog', () => {
    const ranks = Object.values(WEAPON_DEFINITIONS).map((def) => def.rank);
    expect(ranks.every((rank) => rank === 'C')).toBe(true);
  });

  it('a fully-empty registry is handled safely by candidate enumeration', () => {
    const state = stateWith({ sword: 4 });
    expect(getSolarForgeCandidates(state, [])).toEqual([]);
  });

  it('validateForgeMaterials against production still resolves individual rejection reasons safely', () => {
    const state = stateWith({ sword: 2 });
    const [i1, i2] = heldOf(state, 'sword');
    const result = validateForgeMaterials(state, SOLAR_FORGE_RECIPES, i1.instanceId, i2.instanceId);
    expect(result).toEqual({ ok: false, reason: 'no_recipe' });
  });
});

describe('Phase 24.2: solar_gun and armor exclusion', () => {
  it('isForgeEligibleWeaponId excludes solar_gun only', () => {
    expect(isForgeEligibleWeaponId('sword')).toBe(true);
    expect(isForgeEligibleWeaponId('solar_gun')).toBe(false);
  });

  it('rejects solar_gun as a material even with a permissive fixture registry', () => {
    const state = createInitialState(1);
    state.inventory.solar_gun = 2;
    state.inventory.sword = 1;
    normalizeEquipmentInstances(state);
    const [gun1, gun2] = heldOf(state, 'solar_gun');
    const permissive: SolarForgeRecipe = {
      id: 'fx-gun',
      inputDefinitionIds: ['solar_gun', 'solar_gun'],
      inputRank: 'C',
      outputDefinitionId: 'fx_b' as WeaponId,
      outputRank: 'B',
    };
    const result = validateForgeMaterials(state, [permissive], gun1.instanceId, gun2.instanceId);
    expect(result).toEqual({ ok: false, reason: 'not_weapon' });
  });

  it('rejects armor as a material', () => {
    const state = stateWith({ sword: 1, armor: 1 });
    const [sword] = heldOf(state, 'sword');
    const [armor] = heldOf(state, 'armor');
    const result = validateForgeMaterials(state, FULL_REGISTRY, sword.instanceId, armor.instanceId);
    expect(result).toEqual({ ok: false, reason: 'not_weapon' });
  });

  it('buildForgeRecipeKey is order-independent', () => {
    expect(buildForgeRecipeKey('sword', 'spear')).toBe(buildForgeRecipeKey('spear', 'sword'));
  });
});
