import { WeaponDefinition, WeaponFamily, WEAPON_DEFINITIONS, WEAPON_IDS_IN_ORDER } from './weapon-def';
import { ARMOR_DEFINITIONS, ARMOR_IDS_IN_ORDER } from './armor-def';
import { ArmorId, EquipmentRank, WeaponId } from './types';
import { ItemAvailabilityContext, isItemEligibleInContext } from './item-availability';

/**
 * Phase 24.4a: connects Phase 24.3's full equipment catalog to normal
 * floor generation and monsterHouse rewards. This module is the single
 * source of truth for (1) turning (floor, totalFloors) into a
 * normalized progress ratio, and (2) turning a ground-item pool slot
 * ('sword' | 'spear' | 'hammer' | 'armor' | 'solar_gun') into an actual
 * catalog definitionId, weighted by that ratio. Both normal generation
 * and monsterHouse reward generation (state.ts) call the same
 * `selectNormalEquipmentDefinition` — no separate copy of this table
 * exists anywhere else, per the task's "同じ装備リストをstate.tsや
 * monster-house.tsへ再記述しない" contract.
 *
 * Deliberately floor-count-agnostic: nothing here special-cases
 * floor === 1/2/3 or assumes TOTAL_FLOORS === 3. A 10-floor or
 * 100-floor run reaching the same progress ratio (e.g. floor 7/10 and
 * floor 70/100, both 70%) resolves through the exact same rank-weight
 * curve — see floorProgressRatio and RANK_WEIGHT_PROVISIONAL below.
 */

/** The 5 pre-24.3 ground-item pool ids that represent an equipment "slot" to be resolved into an actual catalog definitionId. solar_gun has no family and only ever resolves to itself (single-candidate draw, Phase 23.1 stats unchanged). */
export type NormalEquipmentSlot = 'sword' | 'spear' | 'hammer' | 'armor' | 'solar_gun';

/**
 * Normalized [0, 1] depth-progress ratio, per producer_decisions'
 * floor_policy: `clamp(floor / max(1, totalFloors), 0, 1)`. Pure, no RNG.
 * totalFloors <= 0 is treated as 1 (matches `max(1, totalFloors)`).
 * floor <= 0 clamps to 0 (start-of-run, shallowest); floor > totalFloors
 * clamps to 1 (deepest) — this is what lets 7/10 and 70/100 both resolve
 * to exactly 0.7 through identical downstream logic.
 */
export function floorProgressRatio(floor: number, totalFloors: number): number {
  const denominator = Math.max(1, totalFloors);
  const ratio = floor / denominator;
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/**
 * Provisional (Phase 24.6-tunable) per-rank weight curve, linear in
 * `ratio`. C stays constant so shallow floors never lose normal
 * equipment supply (producer_decisions' "浅い階層でも通常装備供給が消失
 * しない"); B and A both strictly increase with ratio so their combined
 * share is monotonic non-decreasing with depth ("階層が深くなるほど
 * B/A装備の選択確率が単調非減少になること"). These 3 rows are the only
 * numbers Phase 24.6 is expected to retune — nothing else in this module
 * should need to change alongside a rebalance.
 */
export const RANK_WEIGHT_PROVISIONAL: Readonly<Record<'C' | 'B' | 'A', { base: number; slope: number }>> = {
  C: { base: 5, slope: 0 },
  B: { base: 2, slope: 3 },
  A: { base: 1, slope: 4 },
};

/** `RANK_WEIGHT_PROVISIONAL[rank].base + slope * ratio`, clamped to a minimum of 0 (defensive only — every provisional base/slope above is non-negative). */
function rankWeight(rank: 'C' | 'B' | 'A', ratio: number): number {
  const { base, slope } = RANK_WEIGHT_PROVISIONAL[rank];
  return Math.max(0, base + slope * ratio);
}

/** The 3 ranks normal floor generation and monsterHouse rewards ever draw from — S/R are structurally excluded (never appear in this array), per producer_decisions' rank_supply. */
export const NORMAL_RANKS: readonly ('C' | 'B' | 'A')[] = ['C', 'B', 'A'];

interface WeightedCandidate<T extends string> {
  definitionId: T;
  weight: number;
}

/**
 * Every weapon species in `family` whose rank is C/B/A (never S/R) AND
 * eligible under `context` (Phase 24.6b2a1: pre-selection candidate
 * filtering, not post-selection rejection — an ineligible species never
 * enters `flattenByRank`'s per-rank species count at all, so its share
 * of that rank's weight is automatically redistributed across the
 * remaining eligible species of the same rank, never discarded). With
 * every current weapon species at minimumRunDepth:'short'/
 * unlockProgress:0 (item-availability.ts's ITEM_AVAILABILITY), this
 * filter is a no-op today — every species that passed the rank check
 * before also passes this eligibility check now. black_armor has no
 * weapon equivalent and is irrelevant here.
 */
function weightedWeaponCandidates(family: WeaponFamily, ratio: number, context: ItemAvailabilityContext): WeightedCandidate<WeaponId>[] {
  const bySpecies: WeaponDefinition[] = WEAPON_IDS_IN_ORDER.map((id) => WEAPON_DEFINITIONS[id]).filter(
    (def) => def.family === family && (NORMAL_RANKS as readonly string[]).includes(def.rank) && isItemEligibleInContext(def.id, context),
  );
  return flattenByRank(bySpecies, ratio);
}

/**
 * Every armor species whose rank is C/B/A (never S/R), whose id is not
 * 'black_armor' (the sole always-on exclusion guard for black_armor's
 * absence from normal/reward generation, producer_decisions' rank_supply),
 * AND eligible under `context` — same pre-selection filtering as
 * weightedWeaponCandidates above (a no-op today; every armor species is
 * short/0).
 */
function weightedArmorCandidates(ratio: number, context: ItemAvailabilityContext): WeightedCandidate<ArmorId>[] {
  const bySpecies = ARMOR_IDS_IN_ORDER.map((id) => ARMOR_DEFINITIONS[id]).filter(
    (def) => def.id !== 'black_armor' && (NORMAL_RANKS as readonly string[]).includes(def.rank) && isItemEligibleInContext(def.id, context),
  );
  return flattenByRank(bySpecies, ratio);
}

function flattenByRank<T extends { id: string; rank: EquipmentRank }>(
  species: T[],
  ratio: number,
): WeightedCandidate<T['id']>[] {
  const countByRank = new Map<string, number>();
  for (const def of species) countByRank.set(def.rank, (countByRank.get(def.rank) ?? 0) + 1);
  return species.map((def) => {
    const totalForRank = countByRank.get(def.rank) ?? 1;
    const weight = rankWeight(def.rank as 'C' | 'B' | 'A', ratio) / totalForRank;
    return { definitionId: def.id, weight };
  });
}

/**
 * The full flattened, ratio-weighted, eligibility-pre-filtered candidate
 * list for `slot` — the single source of truth both candidate
 * enumeration (tests) and actual selection
 * (`selectNormalEquipmentDefinition` below) read from, so they can never
 * drift apart. `context` (Phase 24.6b2a1, required — no implicit
 * default) is required so no production caller can silently run under
 * an unintended run condition (the task's "production呼び出し漏れが黙っ
 * て別run条件として動く" risk this Phase removes). Never empty with the
 * current item roster: 'solar_gun' always returns exactly its own
 * 1-entry list (weight irrelevant, single candidate, always short/0 —
 * see empty_candidate's metadata-validation contract), and every
 * family/armor list always has at least its C-rank entries (weight
 * RANK_WEIGHT_PROVISIONAL.C.base > 0 at every ratio, and every C-rank
 * species is short/0 today).
 */
export function getNormalEquipmentCandidates(slot: NormalEquipmentSlot, ratio: number, context: ItemAvailabilityContext): WeightedCandidate<WeaponId | ArmorId>[] {
  if (slot === 'solar_gun') return [{ definitionId: 'solar_gun', weight: 1 }];
  if (slot === 'armor') return weightedArmorCandidates(ratio, context);
  return weightedWeaponCandidates(slot, ratio, context);
}

/**
 * Resolves a ground-item pool equipment slot into an actual catalog
 * definitionId, consuming exactly one `rng()` call regardless of
 * candidate-list size (a single flattened weighted draw, per
 * implementation's rng_and_determinism contract) — never more, never
 * fewer, so this never perturbs any other stream's consumption order or
 * count. Falls back to the first candidate (defensive only) if `rng()`
 * returns 1 or the weight total is somehow non-positive, so this can
 * never throw on an empty/malformed candidate list.
 */
export function selectNormalEquipmentDefinition(slot: NormalEquipmentSlot, ratio: number, rng: () => number, context: ItemAvailabilityContext): WeaponId | ArmorId {
  const candidates = getNormalEquipmentCandidates(slot, ratio, context);
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  const roll = rng();
  if (candidates.length === 0 || totalWeight <= 0) {
    // Phase 24.6b2a1: an empty/non-positive-weight candidate list here
    // means the item-availability.ts registry (or a future rank-curve
    // change) has made an entire slot/rank/family ineligible for this
    // context — a metadata configuration bug, not a normal run
    // condition (task's empty_candidate contract: "metadata不整合時だけ
    // 明示的invariant error" — never a silent random fallback, revival
    // of an ineligible item, or a different-category re-draw). Throws
    // before consuming `roll` for anything, so this never perturbs the
    // caller's RNG stream in an inconsistent way relative to a
    // successful draw (both paths consume exactly the one `rng()` call
    // already made above).
    throw new Error(
      `selectNormalEquipmentDefinition: no eligible equipment candidates for slot '${slot}' at depth ${context.depth}, leg '${context.leg}' — this indicates an item-availability.ts metadata configuration error, not a normal run state.`,
    );
  }
  let threshold = roll * totalWeight;
  for (const candidate of candidates) {
    threshold -= candidate.weight;
    if (threshold < 0) return candidate.definitionId;
  }
  return candidates[candidates.length - 1].definitionId;
}

/** True for exactly the 5 ground-item pool ids normal generation/monsterHouse rewards resolve through this module ('sword' | 'spear' | 'hammer' | 'armor' | 'solar_gun') — every other equipment definitionId (e.g. 'flamberge', 'black_armor') is a resolved *output*, never a pool-slot input. */
export function isNormalEquipmentSlot(id: string): id is NormalEquipmentSlot {
  return id === 'sword' || id === 'spear' || id === 'hammer' || id === 'armor' || id === 'solar_gun';
}
