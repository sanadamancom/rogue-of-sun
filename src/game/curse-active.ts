import { createRng } from './mapgen';
import { getHeldEquipmentInstances, isWeaponOrArmorId } from './equipment-instance';
import { NORMAL_RANKS } from './equipment-loot';
import { ArmorId, EnemyLevel, EquipmentInstance, GameState, TrapType, WeaponId } from './types';

/**
 * Phase 24.4e1 能動的な呪い付与経路: shared eligibility/RNG plumbing for
 * mummy's on-hit curse and curse_trap's on-trigger curse. Deliberately a
 * standalone module (mirrors enemy-drop.ts/card-loot.ts's own
 * separation) so turn.ts's dispatch sites and state.ts's trap-generation
 * site both call the same pure functions rather than duplicating
 * eligibility/RNG logic inline. Nothing here mutates GameState directly
 * except the two `apply*Curse` functions, which are the sole places that
 * write `cursed`/`curseRevealed` for this Phase's 2 new routes — every
 * other function is a pure query or a fresh single-use RNG stream
 * constructor, exactly like enemy-drop.ts's own createEnemyDropRng
 * pattern.
 */

/**
 * Phase 24.4e1 authoritative_curse_model.shared_eligibility: species/rank
 * ids that active curse (mummy/curse_trap) may never target, even though
 * they'd otherwise pass the plain rank filter below (solar_gun is rank
 * 'C', so NORMAL_RANKS alone would not exclude it — this set is the
 * explicit exclusion the task requires; black_armor is rank 'R' and
 * already excluded by the rank filter, but is named here too so the
 * exclusion list is self-documenting and doesn't rely solely on rank
 * data staying what it is today).
 */
const ACTIVE_CURSE_INELIGIBLE_IDS: ReadonlySet<WeaponId | ArmorId> = new Set<WeaponId | ArmorId>([
  'solar_gun',
  'black_armor',
]);

/**
 * The full pool of equipment instances mummy's on-hit curse and
 * curse_trap's on-trigger curse may draw from: every currently-held
 * (equipped or unequipped — getHeldEquipmentInstances already excludes
 * ground-only/stale/orphaned instances) weapon/armor instance that is
 * not already cursed, whose rank is C/B/A (never S/R — reuses
 * equipment-loot.ts's NORMAL_RANKS, the same single source of truth
 * Star's own eligibility check already uses), and whose definitionId is
 * not in ACTIVE_CURSE_INELIGIBLE_IDS. Callers narrow this further by
 * scope (mummy: equipped-only; curse_trap: every held instance) — this
 * function itself makes no equipped/unequipped distinction, per
 * shared_eligibility.rule's "mummyとcurse_trapで同じeligibility helperを
 * 再利用する". Pure — reads GameState only, consumes no RNG, mutates
 * nothing.
 */
export function getActiveCurseEligibleInstances(state: GameState): EquipmentInstance[] {
  return getHeldEquipmentInstances(state).filter(
    (instance) =>
      // Phase 24.5b: explicit category exclusion — accessory instances
      // must never reach mummy/curse_trap's eligible pool, even though
      // the 6 initial species are cursed:false and rank C/B/A/S (S is
      // outside NORMAL_RANKS, but C/B/A ones would otherwise pass every
      // remaining filter below incidentally). isWeaponOrArmorId narrows
      // instance.definitionId back to WeaponId | ArmorId for
      // ACTIVE_CURSE_INELIGIBLE_IDS.has below.
      isWeaponOrArmorId(instance.definitionId) &&
      !instance.cursed &&
      (NORMAL_RANKS as readonly string[]).includes(instance.rank) &&
      !ACTIVE_CURSE_INELIGIBLE_IDS.has(instance.definitionId),
  );
}

/**
 * Normalizes a candidate list into a stable, equipmentInstanceId-sorted
 * order before any RNG-based index selection — per rng_design.rules'
 * "対象候補はequipmentInstanceIdによる安定順序へ正規化してからindex選択
 * する". `getHeldEquipmentInstances`/`getActiveCurseEligibleInstances`
 * already return a deterministic array order (instance creation order),
 * but that order is a function of *when* each instance was minted, not
 * of instanceId itself — this normalization step is what makes the
 * final selection's index meaning independent of mint history, matching
 * every other purpose-specific RNG stream in this codebase (e.g.
 * enemy-drop.ts's canonical ITEM_IDS_IN_ORDER draw order) rather than
 * relying on array-insertion order as an implicit contract.
 */
function sortByInstanceId(instances: readonly EquipmentInstance[]): EquipmentInstance[] {
  return [...instances].sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
}

/**
 * Phase 24.4e1-tunable provisional per-hit curse chance for mummy's
 * on-hit curse (10%, per rogue-of-sun-development-plan_.md's
 * provisional_chance) — a single named constant, distinct from
 * equipment-instance.ts's FLOOR_EQUIPMENT_CURSE_CHANCE (a different
 * purpose: generation-time curse odds, not an on-hit active-application
 * odds) even though both currently happen to be 0.1. Final tuning is
 * Phase 24.6/27's job, per this module's own history doc.
 */
export const MUMMY_CURSE_CHANCE_PROVISIONAL = 0.1;

const MUMMY_CURSE_CHANCE_BY_LEVEL: Readonly<Record<EnemyLevel, number>> = {
  1: MUMMY_CURSE_CHANCE_PROVISIONAL,
  2: 0.15,
  3: 0.2,
};

/** Phase 24.6c3b1: per-instance enemy level scaling for mummy's on-hit curse. */
export function getMummyCurseChance(level: EnemyLevel): number {
  return MUMMY_CURSE_CHANCE_BY_LEVEL[level];
}

/**
 * Phase 24.4e1 curse_trap's type-selection weights (out of 100), applied
 * at every depth-keyed trap-generation slot (2-4; state.ts). The first
 * two slots replaced their previous hardcoded 'slow_trap'/'poison_trap'
 * literals; later slots use the same weighted draw. Provisional values
 * per the task's producer_decisions; final tuning is Phase 24.6/27's job.
 */
export const TRAP_TYPE_WEIGHTS: Readonly<Record<TrapType, number>> = {
  slow_trap: 45,
  poison_trap: 45,
  curse_trap: 10,
};

/**
 * Draws one TrapType from TRAP_TYPE_WEIGHTS (45/45/10, out of 100),
 * consuming exactly one rng() call. Bucket order (slow_trap, then
 * poison_trap, then curse_trap) is fixed and arbitrary but stable, so
 * the same roll always maps to the same type regardless of call
 * context.
 */
export function selectTrapType(rng: () => number): TrapType {
  const roll = rng() * 100;
  if (roll < TRAP_TYPE_WEIGHTS.slow_trap) return 'slow_trap';
  if (roll < TRAP_TYPE_WEIGHTS.slow_trap + TRAP_TYPE_WEIGHTS.poison_trap) return 'poison_trap';
  return 'curse_trap';
}

// Phase 24.4e1 rng_design.salts: 3 independent purpose-specific salts,
// each combined with (state.seed, state.floor, state.turn) plus a
// route-specific stable identity (EnemyActor.id for mummy, TrapTile.id
// for curse_trap) — mirrors turn.ts's own deriveStarTransformSeed/
// enemy-drop.ts's deriveEnemyDropSeed pattern (own XOR constant per
// purpose, no persisted RNG state, a fresh single-use stream per call).
// chance and target always use different salts (rng_design.rules'
// "chanceとtargetで別saltを使う"), so a chance roll's outcome never
// perturbs what a target roll would have drawn, and vice versa.
const MUMMY_CURSE_CHANCE_SALT = 0xf1a6c273;
const MUMMY_CURSE_TARGET_SALT = 0x8d3e7b91;
const CURSE_TRAP_TARGET_SALT = 0x4c9f21d6;

/**
 * Combines state.seed/floor/turn (so the same actor id on a different
 * floor or turn never collides with a prior draw — same reasoning as
 * turn.ts's deriveStarTransformSeed) with a route-specific stable
 * identity number (EnemyActor.id for mummy, TrapTile.id for curse_trap)
 * and a purpose-specific salt, into a single uint32 seed. Pure
 * arithmetic — no RNG consumed by this function itself, and no new
 * mutable field is ever added to GameState (every stream this module
 * creates is derived fresh per call, never stored).
 */
function deriveActiveCurseSeed(state: GameState, identityId: number, salt: number): number {
  const base =
    ((state.seed >>> 0) ^
      Math.imul(state.floor + 1, 0x9e3779b1) ^
      Math.imul(state.turn + 1, 0x85ebca6b) ^
      Math.imul(identityId + 1, 0xc2b2ae35)) >>>
    0;
  return ((base ^ salt) >>> 0);
}

/** A fresh, single-use RNG stream for mummy's chance roll — never stored. */
export function createMummyCurseChanceRng(state: GameState, enemyId: number): () => number {
  return createRng(deriveActiveCurseSeed(state, enemyId, MUMMY_CURSE_CHANCE_SALT));
}

/** A fresh, single-use RNG stream for mummy's target-selection roll — never stored. Only ever constructed when 2+ eligible equipped instances exist (rng_design.rules' "候補1件ではtarget streamを生成しない"). */
export function createMummyCurseTargetRng(state: GameState, enemyId: number): () => number {
  return createRng(deriveActiveCurseSeed(state, enemyId, MUMMY_CURSE_TARGET_SALT));
}

/** A fresh, single-use RNG stream for curse_trap's target-selection roll — never stored. Only ever constructed when 2+ eligible held instances exist. */
export function createCurseTrapTargetRng(state: GameState, trapId: number): () => number {
  return createRng(deriveActiveCurseSeed(state, trapId, CURSE_TRAP_TARGET_SALT));
}

/**
 * Selects exactly one instance from `candidates` (already known
 * non-empty by every caller) using `rng`, after normalizing to a stable
 * instanceId order (sortByInstanceId above). Callers are responsible for
 * never invoking this — and never even constructing `rng` — when
 * `candidates.length` is 0 or 1 (rng_design.rules' "候補0件ではchance
 * streamも生成しない" / "候補1件ではtarget streamを生成しない"); this
 * function itself has no length-based short-circuit so that contract
 * stays visibly the caller's responsibility, matching Star's own
 * resolveStarEffect (2+-candidate branch only reads its selectionRng).
 */
export function selectActiveCurseTarget(candidates: readonly EquipmentInstance[], rng: () => number): EquipmentInstance {
  const sorted = sortByInstanceId(candidates);
  const index = Math.min(sorted.length - 1, Math.floor(rng() * sorted.length));
  return sorted[index];
}
