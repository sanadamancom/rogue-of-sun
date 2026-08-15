import { ArmorId, EquipmentInstance, EquipmentRank, GameState, WeaponId } from './types';
import { WEAPON_DEFINITIONS, WeaponDefinition } from './weapon-def';
import { getHeldEquipmentInstances } from './equipment-instance';
import { ARMOR_IDS_IN_ORDER } from './armor-def';
import { isGeneralItemIdentified } from './item-identification';

/** Phase 24.3: every registered armor species (was a single `=== 'armor'` check, correct only while 'armor' was the sole ArmorId). */
const ARMOR_ID_SET: ReadonlySet<string> = new Set<string>(ARMOR_IDS_IN_ORDER);
function isArmorDefinitionId(id: WeaponId | ArmorId): boolean {
  return ARMOR_ID_SET.has(id);
}

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
    isArmorDefinitionId(instanceA.definitionId) ||
    isArmorDefinitionId(instanceB.definitionId) ||
    !isForgeEligibleWeaponId(instanceA.definitionId as WeaponId) ||
    !isForgeEligibleWeaponId(instanceB.definitionId as WeaponId)
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

/**
 * Phase 24.3 太陽鍛冶レシピ (forge_lineage decision, superseding the
 * original stage_0_contract_audit "同一definitionId 2個" draft): the
 * C/B/A tier no longer requires 2 materials of the exact same
 * definitionId — any 2 held individuals sharing the same
 * WeaponDefinition.family and the same rank qualify, and the *first-
 * selected* material's own forgeNextId (weapon-def.ts) determines the
 * output; the second material's specific species is otherwise
 * irrelevant. This is deliberately NOT folded into the pre-existing
 * validateForgeMaterials/getSolarForgeCandidates/buildForgeRecipeKey
 * above — those stay byte-for-byte their Phase 24.2 selves (still
 * exact-pair, order-independent, registry-driven) so every Phase 24.2
 * fixture-injected test keeps passing unchanged. Every function below is
 * strictly additive: production's actual solar-forge action (turn.ts's
 * applySolarForge) and its candidate enumeration (Stage 5's UI) both
 * call *these* functions instead, never the original ones, for the
 * real game.
 *
 * S/R帯 stays exact-pair/order-independent as before, expressed as 3
 * ordinary SolarForgeRecipe entries in solar-forge-recipes.ts
 * (SOLAR_FORGE_RECIPES) and resolved via the pre-existing
 * findSolarForgeRecipe/buildForgeRecipeKey — no lineage logic is ever
 * consulted for an S-rank material pair.
 */

/** The rank one step above `rank` in the C->B->A->S chain, or undefined for S/R (no further C/B/A-tier lineage output exists). */
function nextLineageRank(rank: EquipmentRank): EquipmentRank | undefined {
  return RANK_TRANSITIONS.get(rank);
}

/**
 * Whether `defA`/`defB` (production WeaponDefinitions) are eligible for
 * lineage-based (family+rank, not exact-id) forging: same family, same
 * rank, that rank is C/B/A (never S — S->R is the fixed-pair registry's
 * job, never R — terminal), and `defA` (the first-selected material)
 * actually has a forgeNextId to advance to. Pure; never reads GameState.
 */
export function resolveLineageForgeOutput(
  defA: WeaponId,
  defB: WeaponId,
): { outputDefinitionId: WeaponId; outputRank: EquipmentRank } | undefined {
  const a = WEAPON_DEFINITIONS[defA];
  const b = WEAPON_DEFINITIONS[defB];
  if (!a || !b) return undefined;
  if (!a.family || !b.family || a.family !== b.family) return undefined;
  if (a.rank !== b.rank) return undefined;
  if (a.rank !== 'C' && a.rank !== 'B' && a.rank !== 'A') return undefined;
  if (!a.forgeNextId) return undefined;
  const outputRank = nextLineageRank(a.rank);
  if (!outputRank) return undefined;
  return { outputDefinitionId: a.forgeNextId, outputRank };
}

/**
 * Phase 24.3 production validation: identical instance-level checks to
 * validateForgeMaterials (duplicate/invalid/not_weapon/cursed/unsafe-
 * equipped-state), but resolves the actual recipe via, in order: (1) an
 * exact-pair match in `registry` (S->R's 3 fixed pairs, order-
 * independent, via the unmodified findSolarForgeRecipe), then (2)
 * family+rank lineage with instanceA as the first-selected material
 * (resolveLineageForgeOutput above). Never mutates anything. The single
 * function both getSolarForgeCandidatesWithLineage (enumeration) and
 * turn.ts's applySolarForge (actual apply) call, satisfying
 * implementation_requirements.core_api's "候補列挙と実際の適用で同じ判定
 * 関数を共有する" for the Phase 24.3 production forge model.
 */
export function validateForgeMaterialsWithLineage(
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
    isArmorDefinitionId(instanceA.definitionId) ||
    isArmorDefinitionId(instanceB.definitionId) ||
    !isForgeEligibleWeaponId(instanceA.definitionId as WeaponId) ||
    !isForgeEligibleWeaponId(instanceB.definitionId as WeaponId)
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
    return { ok: false, reason: 'unsafe_equipped_state' };
  }

  const exactRecipe = findSolarForgeRecipe(registry, instanceA.definitionId as WeaponId, instanceB.definitionId as WeaponId);
  if (exactRecipe) {
    return { ok: true, recipe: exactRecipe, instanceA, instanceB };
  }

  const lineage = resolveLineageForgeOutput(instanceA.definitionId as WeaponId, instanceB.definitionId as WeaponId);
  if (lineage) {
    const syntheticRecipe: SolarForgeRecipe = {
      id: `lineage:${instanceA.definitionId}+${instanceB.definitionId}`,
      inputDefinitionIds: [instanceA.definitionId as WeaponId, instanceB.definitionId as WeaponId],
      inputRank: instanceA.rank,
      outputDefinitionId: lineage.outputDefinitionId,
      outputRank: lineage.outputRank,
    };
    return { ok: true, recipe: syntheticRecipe, instanceA, instanceB };
  }

  return { ok: false, reason: 'no_recipe' };
}

/**
 * Phase 24.3 production candidate enumeration: every ordered pair of
 * currently-held, non-cursed, non-armor, forge-eligible weapon
 * instances that resolves to a real recipe via
 * validateForgeMaterialsWithLineage — ordered (not just i<j) because
 * the lineage tier's output depends on which material is "first"
 * (selection_and_ui's "1個目選択→2個目候補"). Distinct from the
 * unmodified getSolarForgeCandidates above (which stays Phase 24.2's
 * unordered, exact-pair-only behavior for its own existing tests).
 */
export function getSolarForgeCandidatesWithLineage(
  state: GameState,
  registry: readonly SolarForgeRecipe[],
): SolarForgeCandidate[] {
  const held = getHeldEquipmentInstances(state).filter(
    (i) =>
      !isArmorDefinitionId(i.definitionId) &&
      isForgeEligibleWeaponId(i.definitionId as WeaponId) &&
      !i.cursed &&
      // Phase 24.4d1: an unidentified weapon never becomes a forge
      // material candidate (authoritative_decisions.solar_forge.
      // input_rule's "未鑑定weaponは合成素材候補として成立させない").
      isGeneralItemIdentified(state, i.definitionId),
  );
  const candidates: SolarForgeCandidate[] = [];
  for (let i = 0; i < held.length; i++) {
    for (let j = 0; j < held.length; j++) {
      if (i === j) continue;
      const result = validateForgeMaterialsWithLineage(state, registry, held[i].instanceId, held[j].instanceId);
      if (result.ok) {
        candidates.push({ instanceIdA: held[i].instanceId, instanceIdB: held[j].instanceId, recipe: result.recipe });
      }
    }
  }
  return candidates;
}

/**
 * Phase 24.3 selection_and_ui: given an already-chosen first material
 * `instanceIdA`, every currently-held second-material instanceId that
 * would actually complete a recipe with it (via
 * validateForgeMaterialsWithLineage) — the exact list solar-forge UI's
 * "1個目選択→2個目候補" step shows. A thin filter over
 * getSolarForgeCandidatesWithLineage rather than a separately-
 * maintained enumeration, so the two can never drift apart.
 */
export function getSolarForgeSecondMaterialCandidates(
  state: GameState,
  registry: readonly SolarForgeRecipe[],
  instanceIdA: string,
): SolarForgeCandidate[] {
  return getSolarForgeCandidatesWithLineage(state, registry).filter((c) => c.instanceIdA === instanceIdA);
}
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
    (i) =>
      !isArmorDefinitionId(i.definitionId) &&
      isForgeEligibleWeaponId(i.definitionId as WeaponId) &&
      !i.cursed &&
      // Phase 24.4d1: an unidentified weapon never becomes a forge
      // material candidate (authoritative_decisions.solar_forge.
      // input_rule's "未鑑定weaponは合成素材候補として成立させない").
      isGeneralItemIdentified(state, i.definitionId),
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
