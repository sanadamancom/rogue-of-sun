import { EquipmentInstance, EquipmentRank, GameState, WeaponId } from './types';
import { WeaponDefinition } from './weapon-def';
import { getHeldEquipmentInstances } from './equipment-instance';

/**
 * Phase 24.2 太陽鍛冶コア. This module is the single source of truth for
 * the solar-forge recipe model and the pure resolve/validate logic that
 * both candidate enumeration (getSolarForgeCandidates) and the actual
 * turn.ts state-mutating apply (applySolarForge) share — per
 * implementation_requirements.core_api's "候補列挙と実際の適用で同じ判定
 * 関数を共有する". Nothing here mutates GameState; the atomic
 * consume-2/produce-1 transform itself lives in turn.ts, which is the
 * only place with a legitimate reason to mutate state.equipmentInstances/
 * state.inventory.
 *
 * A recipe's material catalog is always weapon-only, and never
 * `solar_gun` — see isForgeEligibleWeaponId below. Production's own
 * recipe registry (solar-forge-recipes.ts) is intentionally empty this
 * phase; every fixture-driven test here injects its own catalog/registry
 * instead of relying on WEAPON_DEFINITIONS having non-C ranks yet.
 */

/** Every EquipmentRank the current 27-weapon roadmap actually chains through, in ascending order — R has no further output. */
const RANK_TRANSITIONS: ReadonlyMap<EquipmentRank, EquipmentRank> = new Map([
  ['C', 'B'],
  ['B', 'A'],
  ['A', 'S'],
]);

/**
 * One太陽鍛冶レシピ: 2 input weapon definitionIds (order-independent —
 * see buildForgeRecipeKey) at a shared `inputRank`, producing exactly 1
 * `outputDefinitionId` at `outputRank`. For C→B/B→A/A→S both input ids
 * are conventionally the same species; for the S→R tier they may be 2
 * distinct S-rank species — this type imposes no such constraint itself
 * (validateForgeRecipe below is what actually enforces
 * "S→R以外の遷移を許可しない" et al.), so a future recipe table can
 * express either shape without a type change.
 */
export interface SolarForgeRecipe {
  id: string;
  inputDefinitionIds: readonly [WeaponId, WeaponId];
  inputRank: EquipmentRank;
  outputDefinitionId: WeaponId;
  outputRank: EquipmentRank;
}

/** Whether `id` is a weapon species solar-forge ever accepts as a material or produces — every WeaponId except `solar_gun` (material_rules.太陽銃は対象外). */
export function isForgeEligibleWeaponId(id: WeaponId): boolean {
  return id !== 'solar_gun';
}

/** Order-independent lookup key for a material definitionId pair. */
export function buildForgeRecipeKey(a: WeaponId, b: WeaponId): string {
  return [a, b].slice().sort().join('|');
}

/**
 * Every structural problem with `recipe` against `catalog`: solar_gun
 * involvement, a definitionId absent from `catalog`, an inputRank/
 * outputRank pair outside the fixed C→B/B→A/A→S/S→R chain (R can never
 * be an input; only S→R may combine 2 different species), or a
 * catalog-declared rank that disagrees with the recipe's own
 * `inputRank`/`outputRank`. Returns [] when the recipe is fully valid.
 * Pure; never reads GameState. Shared by validateForgeRegistry below and
 * available for a future recipe-authoring tool to reuse.
 */
export function validateForgeRecipe(
  catalog: Record<string, WeaponDefinition>,
  recipe: SolarForgeRecipe,
): string[] {
  const errors: string[] = [];
  const [a, b] = recipe.inputDefinitionIds;

  if (!isForgeEligibleWeaponId(a) || !isForgeEligibleWeaponId(b) || !isForgeEligibleWeaponId(recipe.outputDefinitionId)) {
    errors.push('solar_gun_excluded');
  }

  const defA = catalog[a];
  const defB = catalog[b];
  const defOut = catalog[recipe.outputDefinitionId];
  if (!defA || !defB) {
    errors.push('unknown_input_definition');
  }
  if (!defOut) {
    errors.push('unknown_output_definition');
  }

  if (recipe.inputRank === 'R') {
    // R素材を許可しない (material_rules): R can never be consumed as input.
    errors.push('r_as_input');
  }

  const expectedOutputRank = RANK_TRANSITIONS.get(recipe.inputRank);
  if (recipe.inputRank !== 'S') {
    if (!expectedOutputRank || recipe.outputRank !== expectedOutputRank) {
      errors.push('invalid_rank_transition');
    }
  } else if (recipe.outputRank !== 'R') {
    errors.push('invalid_rank_transition');
  }

  // C..A tiers: same-species pair is the documented shape; S→R allows 2
  // distinct S species — but never require sameness here beyond what the
  // catalog itself says, only cross-check the declared inputRank matches
  // both species' actual catalog rank (recipe_model's "definitionのrank
  // と矛盾するレシピは拒否する").
  if (defA && defA.rank !== recipe.inputRank) errors.push('input_a_rank_mismatch');
  if (defB && defB.rank !== recipe.inputRank) errors.push('input_b_rank_mismatch');
  if (defOut && defOut.rank !== recipe.outputRank) errors.push('output_rank_mismatch');

  return errors;
}

/**
 * Every structural problem across `registry` as a whole: each recipe's
 * own validateForgeRecipe errors, plus duplicate recipe keys (2 recipes
 * whose buildForgeRecipeKey collide) — recipe_type.invariants's "重複
 * recipe keyと不正rank遷移を検出できる". Returns a flat list of
 * `${recipeId}: ${reason}` strings, [] when the whole registry is valid.
 */
export function validateForgeRegistry(
  catalog: Record<string, WeaponDefinition>,
  registry: readonly SolarForgeRecipe[],
): string[] {
  const errors: string[] = [];
  const seenKeys = new Map<string, string>();
  for (const recipe of registry) {
    for (const reason of validateForgeRecipe(catalog, recipe)) {
      errors.push(`${recipe.id}: ${reason}`);
    }
    const key = buildForgeRecipeKey(recipe.inputDefinitionIds[0], recipe.inputDefinitionIds[1]);
    const priorId = seenKeys.get(key);
    if (priorId) {
      errors.push(`${recipe.id}: duplicate_key_with_${priorId}`);
    } else {
      seenKeys.set(key, recipe.id);
    }
  }
  return errors;
}

/**
 * The recipe (if any) whose input pair matches `defA`/`defB` in either
 * order — recipe_model's "素材の順序を入れ替えても同じレシピとして解決
 * する". Pure; O(registry length).
 */
export function findSolarForgeRecipe(
  registry: readonly SolarForgeRecipe[],
  defA: WeaponId,
  defB: WeaponId,
): SolarForgeRecipe | undefined {
  const key = buildForgeRecipeKey(defA, defB);
  return registry.find(
    (recipe) => buildForgeRecipeKey(recipe.inputDefinitionIds[0], recipe.inputDefinitionIds[1]) === key,
  );
}

/** Why `validateForgeMaterials` rejected a candidate pair. */
export type SolarForgeRejectionReason =
  | 'duplicate_instance'
  | 'invalid_instance'
  | 'not_weapon'
  | 'cursed'
  | 'no_recipe'
  | 'unsafe_equipped_state';

export type SolarForgeValidationResult =
  | { ok: true; recipe: SolarForgeRecipe; instanceA: EquipmentInstance; instanceB: EquipmentInstance }
  | { ok: false; reason: SolarForgeRejectionReason };

/**
 * The single shared validation path getSolarForgeCandidates and
 * turn.ts's applySolarForge both call: resolves `instanceIdA`/
 * `instanceIdB` against currently-held weapon instances, rejects a
 * duplicate id, an id that isn't a currently-held weapon individual
 * (armor, solar_gun, floor-only, unowned, unknown — all collapse to
 * `not_weapon`/`invalid_instance`), a cursed individual (discovered or
 * not — curse_rules's "判明・未判明を問わず素材にできない"), a pair with
 * no matching recipe in `registry`, or the structurally-impossible case
 * of both named instances resolving to the single equipped weapon slot
 * (output_rules's "不正状態では安全に拒否する"). Never mutates anything;
 * never itself reveals whether a rejection was curse-caused beyond the
 * generic `cursed` reason (curse_rules's "失敗ログは呪いを断定しない汎用
 * 文言にする" is message-log.ts's job, not this function's).
 */
export function validateForgeMaterials(
  state: GameState,
  registry: readonly SolarForgeRecipe[],
  instanceIdA: string,
  instanceIdB: string,
): SolarForgeValidationResult {
  if (instanceIdA === instanceIdB) {
    return { ok: false, reason: 'duplicate_instance' };
  }

  const held = getHeldEquipmentInstances(state);
  const instanceA = held.find((i) => i.instanceId === instanceIdA);
  const instanceB = held.find((i) => i.instanceId === instanceIdB);
  if (!instanceA || !instanceB) {
    return { ok: false, reason: 'invalid_instance' };
  }

  if (
    !isForgeEligibleWeaponId(instanceA.definitionId as WeaponId) ||
    !isForgeEligibleWeaponId(instanceB.definitionId as WeaponId) ||
    instanceA.definitionId === 'armor' ||
    instanceB.definitionId === 'armor'
  ) {
    return { ok: false, reason: 'not_weapon' };
  }

  if (instanceA.cursed || instanceB.cursed) {
    return { ok: false, reason: 'cursed' };
  }

  const equippedCount = [instanceA, instanceB].filter(
    (i) => i.instanceId === state.equippedWeaponInstanceId,
  ).length;
  if (equippedCount > 1) {
    // Structurally unreachable given instanceId uniqueness, but guarded
    // defensively per output_rules's "不正状態では安全に拒否する".
    return { ok: false, reason: 'unsafe_equipped_state' };
  }

  const recipe = findSolarForgeRecipe(registry, instanceA.definitionId as WeaponId, instanceB.definitionId as WeaponId);
  if (!recipe) {
    return { ok: false, reason: 'no_recipe' };
  }

  return { ok: true, recipe, instanceA, instanceB };
}

/** One enumerable candidate pair: 2 held instanceIds plus the recipe they'd resolve to. */
export interface SolarForgeCandidate {
  instanceIdA: string;
  instanceIdB: string;
  recipe: SolarForgeRecipe;
}

/**
 * Every currently-held weapon instance pair (unordered, each pair listed
 * once) that resolves to a real recipe in `registry` right now —
 * selection_and_ui's minimal "1個目選択→2個目候補選択" boundary reads
 * this same list. With an empty production registry this always returns
 * [] (current_content/production_sanity's "候補なし状態を安全に扱える
 * こと"). Never mutates state; internally reuses validateForgeMaterials
 * so a candidate this function returns is guaranteed to pass validation
 * again unless the underlying state changed in between (selection_and_ui's
 * "選択中に個体が消失・変化した場合、実行時に再検証して拒否する" is what
 * that later re-validation call covers).
 */
export function getSolarForgeCandidates(
  state: GameState,
  registry: readonly SolarForgeRecipe[],
): SolarForgeCandidate[] {
  if (registry.length === 0) return [];
  const held = getHeldEquipmentInstances(state).filter(
    (i) => i.definitionId !== 'armor' && isForgeEligibleWeaponId(i.definitionId as WeaponId) && !i.cursed,
  );
  const candidates: SolarForgeCandidate[] = [];
  for (let i = 0; i < held.length; i++) {
    for (let j = i + 1; j < held.length; j++) {
      const result = validateForgeMaterials(state, registry, held[i].instanceId, held[j].instanceId);
      if (result.ok) {
        candidates.push({ instanceIdA: held[i].instanceId, instanceIdB: held[j].instanceId, recipe: result.recipe });
      }
    }
  }
  return candidates;
}
