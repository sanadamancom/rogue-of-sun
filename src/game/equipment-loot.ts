import { WeaponDefinition, WeaponFamily, WEAPON_DEFINITIONS, WEAPON_IDS_IN_ORDER } from './weapon-def';
import { ARMOR_DEFINITIONS, ARMOR_IDS_IN_ORDER } from './armor-def';
import { ArmorId, EquipmentRank, WeaponId } from './types';

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
const NORMAL_RANKS: readonly ('C' | 'B' | 'A')[] = ['C', 'B', 'A'];

interface WeightedCandidate<T extends string> {
  definitionId: T;
  weight: number;
}

/** Every weapon species in `family` whose rank is C/B/A (never S/R), each with an equal per-species share of that rank's total `rankWeight` — so a family with an uneven per-rank species count (this game's are even, but future ones needn't be) still sums to the intended rank-level weight. black_armor has no weapon equivalent and is irrelevant here. */
function weightedWeaponCandidates(family: WeaponFamily, ratio: number): WeightedCandidate<WeaponId>[] {
  const bySpecies: WeaponDefinition[] = WEAPON_IDS_IN_ORDER.map((id) => WEAPON_DEFINITIONS[id]).filter(
    (def) => def.family === family && (NORMAL_RANKS as readonly string[]).includes(def.rank),
  );
  return flattenByRank(bySpecies, ratio);
}

/** Every armor species whose rank is C/B/A (never S/R) and whose id is not 'black_armor' — the sole always-on exclusion guard for black_armor's absence from normal/reward generation (producer_decisions' rank_supply: "black_armorは...通常床生成、monsterHouse報酬から必ず除外する"). */
function weightedArmorCandidates(ratio: number): WeightedCandidate<ArmorId>[] {
  const bySpecies = ARMOR_IDS_IN_ORDER.map((id) => ARMOR_DEFINITIONS[id]).filter(
    (def) => def.id !== 'black_armor' && (NORMAL_RANKS as readonly string[]).includes(def.rank),
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
 * The full flattened, ratio-weighted candidate list for `slot` — the
 * single source of truth both candidate enumeration (tests) and actual
 * selection (`selectNormalEquipmentDefinition` below) read from, so they
 * can never drift apart. Never empty: 'solar_gun' always returns exactly
 * its own 1-entry list (weight irrelevant, single candidate), and every
 * family/armor list always has at least its C-rank entries (weight
 * RANK_WEIGHT_PROVISIONAL.C.base > 0 at every ratio).
 */
export function getNormalEquipmentCandidates(slot: NormalEquipmentSlot, ratio: number): WeightedCandidate<WeaponId | ArmorId>[] {
  if (slot === 'solar_gun') return [{ definitionId: 'solar_gun', weight: 1 }];
  if (slot === 'armor') return weightedArmorCandidates(ratio);
  return weightedWeaponCandidates(slot, ratio);
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
export function selectNormalEquipmentDefinition(slot: NormalEquipmentSlot, ratio: number, rng: () => number): WeaponId | ArmorId {
  const candidates = getNormalEquipmentCandidates(slot, ratio);
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  const roll = rng();
  if (candidates.length === 0 || totalWeight <= 0) {
    // Defensive only — every real slot/ratio combination above always
    // yields at least one positive-weight candidate.
    return slot === 'solar_gun' ? 'solar_gun' : slot === 'armor' ? 'armor' : (`${slot}` as WeaponId);
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
