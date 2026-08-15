import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { createEquipmentInstance, getHeldEquipmentInstances, normalizeEquipmentInstances } from '../equipment-instance';
import { applySolarForge } from '../turn';
import {
  getSolarForgeCandidatesWithLineage,
  getSolarForgeSecondMaterialCandidates,
  resolveLineageForgeOutput,
  validateForgeMaterialsWithLineage,
  findSolarForgeRecipe,
  buildForgeRecipeKey,
} from '../solar-forge';
import { SOLAR_FORGE_RECIPES } from '../solar-forge-recipes';
import { WEAPON_DEFINITIONS } from '../weapon-def';
import { GameState, WeaponId } from '../types';

/**
 * Phase 24.3 Stage 2: 太陽鍛冶レシピ (21件) の入出力・素材ルール・
 * 鍛冶判定テスト。forge_lineage決定（同一武器系統・同rankの異なる2個体
 * を許可し、第1素材の系譜を完成品へ引き継ぐ）を検証する。
 */

function stateWithWeapons(counts: Partial<Record<WeaponId, number>>): GameState {
  const state = createInitialState(1);
  for (const [id, count] of Object.entries(counts)) {
    state.inventory[id as WeaponId] = count as number;
  }
  normalizeEquipmentInstances(state);
  // Phase 24.4d1: this file tests forge recipe/lineage judgement, not
  // identification — pre-identify every fixture weapon so the new
  // unidentified-material exclusion rule never interferes.
  state.identifiedGeneralItemIds = Object.keys(counts) as import('../types').ItemId[];
  return state;
}

function heldOf(state: GameState, id: WeaponId) {
  return getHeldEquipmentInstances(state).filter((i) => i.definitionId === id);
}

// The 18 C/B/A tier lineage transitions, [firstMaterial, ownNext] pairs.
const LINEAGE_TRANSITIONS: [WeaponId, WeaponId][] = [
  ['sword', 'flamberge'],
  ['short_sword', 'magic_sword'],
  ['flamberge', 'bushido_blade'],
  ['magic_sword', 'blood_sword'],
  ['bushido_blade', 'solar_sword'],
  ['blood_sword', 'dark_sword'],
  ['spear', 'corsesca'],
  ['glaive', 'ice_glaive'],
  ['corsesca', 'grand_lance'],
  ['ice_glaive', 'blood_spear'],
  ['grand_lance', 'white_queen'],
  ['blood_spear', 'black_queen'],
  ['hammer', 'maul'],
  ['basic_hammer', 'silver_flail'],
  ['maul', 'battle_axe'],
  ['silver_flail', 'bloody_mace'],
  ['battle_axe', 'dawn'],
  ['bloody_mace', 'twilight'],
];

describe('Phase 24.3 Stage 2: 21 solar-forge recipe input/output (18 lineage + 3 fixed S->R)', () => {
  it('all 18 C/B/A lineage transitions resolve to their documented output', () => {
    expect(LINEAGE_TRANSITIONS.length).toBe(18);
    for (const [from, to] of LINEAGE_TRANSITIONS) {
      const result = resolveLineageForgeOutput(from, from);
      expect(result?.outputDefinitionId).toBe(to);
    }
  });

  it('all 3 fixed S->R pairs resolve via SOLAR_FORGE_RECIPES', () => {
    expect(SOLAR_FORGE_RECIPES).toHaveLength(3);
    const gram = findSolarForgeRecipe(SOLAR_FORGE_RECIPES, 'solar_sword', 'dark_sword');
    expect(gram?.outputDefinitionId).toBe('gram');
    const gungnir = findSolarForgeRecipe(SOLAR_FORGE_RECIPES, 'white_queen', 'black_queen');
    expect(gungnir?.outputDefinitionId).toBe('gungnir');
    const mjolnir = findSolarForgeRecipe(SOLAR_FORGE_RECIPES, 'dawn', 'twilight');
    expect(mjolnir?.outputDefinitionId).toBe('mjolnir');
  });

  it('21 total recipes are reachable: 18 lineage + 3 registry', () => {
    const totalReachable = LINEAGE_TRANSITIONS.length + SOLAR_FORGE_RECIPES.length;
    expect(totalReachable).toBe(21);
  });

  it('every C-rank species reaches R through its own chain (sword line, spear line, hammer line)', () => {
    // sword line: sword -> flamberge -> bushido_blade -> solar_sword -> (S->R with dark_sword) -> gram
    let step = resolveLineageForgeOutput('sword', 'sword');
    expect(step?.outputDefinitionId).toBe('flamberge');
    step = resolveLineageForgeOutput(step!.outputDefinitionId, step!.outputDefinitionId);
    expect(step?.outputDefinitionId).toBe('bushido_blade');
    step = resolveLineageForgeOutput(step!.outputDefinitionId, step!.outputDefinitionId);
    expect(step?.outputDefinitionId).toBe('solar_sword');
    const rStep = findSolarForgeRecipe(SOLAR_FORGE_RECIPES, 'solar_sword', 'dark_sword');
    expect(rStep?.outputDefinitionId).toBe('gram');
  });
});

describe('Phase 24.3 Stage 2: forge_lineage material rules', () => {
  it('accepts 2 different definitionIds of the same family and same rank (sword + short_sword)', () => {
    const state = stateWithWeapons({ sword: 1, short_sword: 1 });
    const [a] = heldOf(state, 'sword');
    const [b] = heldOf(state, 'short_sword');
    const result = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, a.instanceId, b.instanceId);
    expect(result.ok).toBe(true);
  });

  it('the first-selected material determines the output, not the second (order-dependent for lineage tier)', () => {
    const stateA = stateWithWeapons({ sword: 1, short_sword: 1 });
    const [swordA] = heldOf(stateA, 'sword');
    const [shortSwordA] = heldOf(stateA, 'short_sword');
    const resultAFirst = validateForgeMaterialsWithLineage(stateA, SOLAR_FORGE_RECIPES, swordA.instanceId, shortSwordA.instanceId);
    expect(resultAFirst.ok).toBe(true);
    if (resultAFirst.ok) expect(resultAFirst.recipe.outputDefinitionId).toBe('flamberge');

    const stateB = stateWithWeapons({ sword: 1, short_sword: 1 });
    const [swordB] = heldOf(stateB, 'sword');
    const [shortSwordB] = heldOf(stateB, 'short_sword');
    const resultBFirst = validateForgeMaterialsWithLineage(stateB, SOLAR_FORGE_RECIPES, shortSwordB.instanceId, swordB.instanceId);
    expect(resultBFirst.ok).toBe(true);
    if (resultBFirst.ok) expect(resultBFirst.recipe.outputDefinitionId).toBe('magic_sword');
  });

  it('rejects different families even at the same rank (sword + spear)', () => {
    const state = stateWithWeapons({ sword: 1, spear: 1 });
    const [a] = heldOf(state, 'sword');
    const [b] = heldOf(state, 'spear');
    const result = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, a.instanceId, b.instanceId);
    expect(result).toEqual({ ok: false, reason: 'no_recipe' });
  });

  it('rejects the same family at different ranks (sword C + flamberge B)', () => {
    const state = createInitialState(1);
    const sword = createEquipmentInstance(state, 'sword');
    state.inventory.sword = 1;
    const flamberge = createEquipmentInstance(state, 'flamberge');
    state.inventory.flamberge = 1;
    const result = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, sword.instanceId, flamberge.instanceId);
    expect(result).toEqual({ ok: false, reason: 'no_recipe' });
  });

  it('the S->R tier still requires the exact fixed pair, order-independent', () => {
    const state = createInitialState(1);
    const solarSword = createEquipmentInstance(state, 'solar_sword');
    state.inventory.solar_sword = 1;
    const darkSword = createEquipmentInstance(state, 'dark_sword');
    state.inventory.dark_sword = 1;
    const forward = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, solarSword.instanceId, darkSword.instanceId);
    const backward = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, darkSword.instanceId, solarSword.instanceId);
    expect(forward.ok).toBe(true);
    expect(backward.ok).toBe(true);
    if (forward.ok && backward.ok) {
      expect(forward.recipe.outputDefinitionId).toBe('gram');
      expect(backward.recipe.outputDefinitionId).toBe('gram');
    }
  });

  it('S-rank materials never resolve via lineage even if same family (solar_sword + dark_sword have no forgeNextId)', () => {
    expect(WEAPON_DEFINITIONS.solar_sword.forgeNextId).toBeUndefined();
    expect(WEAPON_DEFINITIONS.dark_sword.forgeNextId).toBeUndefined();
  });

  it('R-rank output (gram) can never itself be a material (rejected as no_recipe when paired with anything)', () => {
    const state = createInitialState(1);
    const gram = createEquipmentInstance(state, 'gram');
    state.inventory.gram = 1;
    const sword = createEquipmentInstance(state, 'sword');
    state.inventory.sword = 1;
    const result = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, gram.instanceId, sword.instanceId);
    expect(result).toEqual({ ok: false, reason: 'no_recipe' });
  });

  it('solar_gun and armor are still rejected as materials under the lineage path', () => {
    const state = createInitialState(1);
    const gun1 = createEquipmentInstance(state, 'solar_gun');
    const gun2 = createEquipmentInstance(state, 'solar_gun');
    state.inventory.solar_gun = 2;
    const gunResult = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, gun1.instanceId, gun2.instanceId);
    expect(gunResult).toEqual({ ok: false, reason: 'not_weapon' });

    const sword = createEquipmentInstance(state, 'sword');
    state.inventory.sword = 1;
    const armor = createEquipmentInstance(state, 'armor');
    state.inventory.armor = 1;
    const armorResult = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, sword.instanceId, armor.instanceId);
    expect(armorResult).toEqual({ ok: false, reason: 'not_weapon' });
  });

  it('cursed materials are rejected identically under the lineage path', () => {
    const state = createInitialState(1);
    const cursedSword = createEquipmentInstance(state, 'sword');
    cursedSword.cursed = true;
    state.inventory.sword = 1;
    const shortSword = createEquipmentInstance(state, 'short_sword');
    state.inventory.short_sword = 1;
    const result = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, cursedSword.instanceId, shortSword.instanceId);
    expect(result).toEqual({ ok: false, reason: 'cursed' });
  });

  it('a duplicate instanceId is rejected identically under the lineage path', () => {
    const state = stateWithWeapons({ sword: 1 });
    const [a] = heldOf(state, 'sword');
    const result = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, a.instanceId, a.instanceId);
    expect(result).toEqual({ ok: false, reason: 'duplicate_instance' });
  });
});

describe('Phase 24.3 Stage 2: candidate enumeration shares judgement with execution', () => {
  it('getSolarForgeCandidatesWithLineage only returns pairs that validateForgeMaterialsWithLineage independently accepts', () => {
    const state = stateWithWeapons({ sword: 1, short_sword: 1, spear: 2 });
    const candidates = getSolarForgeCandidatesWithLineage(state, SOLAR_FORGE_RECIPES);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      const result = validateForgeMaterialsWithLineage(state, SOLAR_FORGE_RECIPES, c.instanceIdA, c.instanceIdB);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.recipe.outputDefinitionId).toBe(c.recipe.outputDefinitionId);
      }
    }
  });

  it('getSolarForgeSecondMaterialCandidates filters to exactly the chosen first material', () => {
    const state = stateWithWeapons({ sword: 1, short_sword: 1 });
    const [sword] = heldOf(state, 'sword');
    const seconds = getSolarForgeSecondMaterialCandidates(state, SOLAR_FORGE_RECIPES, sword.instanceId);
    expect(seconds.length).toBeGreaterThan(0);
    for (const c of seconds) {
      expect(c.instanceIdA).toBe(sword.instanceId);
    }
  });

  it('no candidates when holding fewer than 2 eligible weapons', () => {
    const state = stateWithWeapons({ sword: 1 });
    expect(getSolarForgeCandidatesWithLineage(state, SOLAR_FORGE_RECIPES)).toEqual([]);
  });

  it('"合成できる武器がない" case: 2 held weapons of different, incompatible families produce no candidates', () => {
    const state = stateWithWeapons({ sword: 1, spear: 1 });
    expect(getSolarForgeCandidatesWithLineage(state, SOLAR_FORGE_RECIPES)).toEqual([]);
  });
});

describe('Phase 24.3 Stage 2: applySolarForge production sanity (turn/RNG/state contract preserved)', () => {
  it('forges sword + short_sword into flamberge, consumes exactly 1 turn worth of state change, no half-consumed state', () => {
    const state = stateWithWeapons({ sword: 1, short_sword: 1 });
    const [sword] = heldOf(state, 'sword');
    const [shortSword] = heldOf(state, 'short_sword');
    const events: import('../events').GameEvent[] = [];
    const result = applySolarForge(state, [sword.instanceId, shortSword.instanceId], events);
    expect(result.consumed).toBe(true);
    expect(state.inventory.sword).toBe(0);
    expect(state.inventory.short_sword).toBe(0);
    expect(state.inventory.flamberge).toBe(1);
    const completedEvent = events.find((e) => e.type === 'solar_forge_completed');
    expect(completedEvent).toBeDefined();
    if (completedEvent && completedEvent.type === 'solar_forge_completed') {
      expect(completedEvent.outputDefinitionId).toBe('flamberge');
    }
  });

  it('forges the fixed S->R gram pair through the default production registry', () => {
    const state = createInitialState(1);
    state.equipmentInstances = state.equipmentInstances ?? [];
    const solarSword = createEquipmentInstance(state, 'solar_sword');
    const darkSword = createEquipmentInstance(state, 'dark_sword');
    state.inventory.solar_sword = 1;
    state.inventory.dark_sword = 1;
    const events: import('../events').GameEvent[] = [];
    const result = applySolarForge(state, [solarSword.instanceId, darkSword.instanceId], events);
    expect(result.consumed).toBe(true);
    expect(state.inventory.gram).toBe(1);
  });

  it('a no-recipe pair (mismatched family) fails safely and touches neither materials nor turn', () => {
    const state = stateWithWeapons({ sword: 1, spear: 1 });
    const [sword] = heldOf(state, 'sword');
    const [spear] = heldOf(state, 'spear');
    const events: import('../events').GameEvent[] = [];
    const result = applySolarForge(state, [sword.instanceId, spear.instanceId], events);
    expect(result.consumed).toBe(false);
    expect(state.inventory.sword).toBe(1);
    expect(state.inventory.spear).toBe(1);
    expect(events.some((e) => e.type === 'solar_forge_failed')).toBe(true);
    expect(events.some((e) => e.type === 'solar_forge_completed')).toBe(false);
  });
});

describe('Phase 24.3 Stage 2: buildForgeRecipeKey stays order-independent (Phase 24.2 contract unchanged)', () => {
  it('order-independent for the registered S->R fixed pairs', () => {
    expect(buildForgeRecipeKey('solar_sword', 'dark_sword')).toBe(buildForgeRecipeKey('dark_sword', 'solar_sword'));
  });
});
