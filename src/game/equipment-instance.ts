import { ArmorId, EquipmentInstance, EquipmentRank, GameState, WeaponId } from './types';
import { WEAPON_DEFINITIONS } from './weapon-def';
import { ARMOR_DEFINITIONS } from './armor-def';

/**
 * Phase 20.0c equipment-instance foundation. This module is the single
 * source of truth for creating, looking up, and normalizing individual
 * weapon/armor instances (see types.ts's EquipmentInstance doc comment
 * for the data shape itself). It is intentionally separate from
 * weapon-def.ts/armor-def.ts (which stay per-species, unchanged) and
 * from inventory.ts (which stays count-only, unchanged) — this module
 * only adds the parallel per-individual layer, and touches neither of
 * those existing files' own responsibilities.
 *
 * Nothing here applies refineLevel to any damage/defense calculation,
 * grants any card the ability to change it, or implements curse removal
 * — those are Phase 20.5's job. This phase only establishes: stable
 * per-individual identity, the 3 per-individual attributes
 * (refineLevel/cursed/curseRevealed), and their persistence across
 * equip/unequip/floor-transition.
 */

export function isWeaponOrArmorId(id: string): id is WeaponId | ArmorId {
  return id === 'sword' || id === 'spear' || id === 'hammer' || id === 'solar_gun' || id === 'armor';
}

const VALID_RANKS: readonly EquipmentRank[] = ['C', 'B', 'A', 'S', 'R'];

/**
 * Phase 24.1: this species' default rank from WEAPON_DEFINITIONS/
 * ARMOR_DEFINITIONS — the single lookup point mintEquipmentInstance and
 * normalizeEquipmentInstances both use so a species' definition table
 * stays the one source of truth for rank, never duplicated inline.
 */
function definitionRankFor(definitionId: WeaponId | ArmorId): EquipmentRank {
  return definitionId === 'armor' ? ARMOR_DEFINITIONS.armor.rank : WEAPON_DEFINITIONS[definitionId].rank;
}

/** Whether `value` is one of the 5 valid EquipmentRank strings. */
function isValidRank(value: unknown): value is EquipmentRank {
  return typeof value === 'string' && (VALID_RANKS as readonly string[]).includes(value);
}

/**
 * Phase 20.0c provisional refine-level cap (rogue-of-sun-card-effects-spec.md's
 * "月・太陽による装備の強化上限"), shared by weapon and armor alike. A
 * single named constant — never duplicated inline — so Moon/Sun (Phase
 * 20.5b, not implemented this phase) and normalizeEquipmentInstances
 * below both read the same value. Final tuning is Phase 27's job; this
 * phase only needs a real, enforced number so refineLevel has a
 * meaningful valid range before any card can change it.
 */
export const EQUIPMENT_REFINE_LEVEL_CAP = 3;

/**
 * Phase 20.0c provisional curse chance for floor-generated weapon/armor
 * individuals only (rogue-of-sun-card-effects-spec.md's floor-generated-
 * equipment curse requirement) — a single named constant, read from
 * exactly one call site (buildFloorState's ground-item placement loop in
 * state.ts). Never applied to consumables, cards, normalization-backfilled
 * instances, or any non-floor-generation creation path — see
 * mintEquipmentInstance's `cursed` parameter, which every other creation
 * site (createEquipmentInstance) leaves at its default `false`.
 */
export const FLOOR_EQUIPMENT_CURSE_CHANCE = 0.1;

/**
 * Whether `refineLevel` is a valid (non-negative integer, at or below
 * EQUIPMENT_REFINE_LEVEL_CAP) value. Shared by normalizeEquipmentInstances
 * below and available for Moon/Sun (Phase 20.5b) to reuse for their own
 * upgrade-eligibility check, per rogue-of-sun-development-plan.md 20.0c's
 * "強化上限判定をMoonとSunから共通利用できる形にする".
 */
export function isValidRefineLevel(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= EQUIPMENT_REFINE_LEVEL_CAP;
}

/**
 * State-independent instance construction, used both by
 * createEquipmentInstance below (state-mutating wrapper, used by
 * pickup/normalization) and directly by state.ts's buildFloorState
 * (which mints floor-generated equipment instances — including their
 * curse roll — before the final GameState object literal exists, so it
 * cannot yet call the state-taking wrapper). `cursed` defaults to false
 * (every non-floor-generation creation site, including
 * createEquipmentInstance below, never passes it) — only
 * buildFloorState's ground-item loop ever passes a coin-flip result
 * here, and only for a definitionId it already knows is a weapon/armor
 * ground item.
 */
export function mintEquipmentInstance(
  nextInstanceId: number,
  definitionId: WeaponId | ArmorId,
  cursed = false,
): EquipmentInstance {
  return {
    instanceId: `eq-${nextInstanceId}`,
    definitionId,
    refineLevel: 0,
    cursed,
    curseRevealed: false,
    rank: definitionRankFor(definitionId),
  };
}

/** All equipment instances currently tracked, or [] if the field is absent (existing GameState fixtures predate this phase — see types.ts's GameState.equipmentInstances doc comment). Pure/side-effect-free. */
export function getEquipmentInstances(state: GameState): EquipmentInstance[] {
  return state.equipmentInstances ?? [];
}

/** The instance with this instanceId, or undefined if not present. */
export function getEquipmentInstanceById(state: GameState, instanceId: string): EquipmentInstance | undefined {
  return getEquipmentInstances(state).find((i) => i.instanceId === instanceId);
}

/**
 * Whether `instanceId` is currently sitting on the floor — referenced by
 * a `GroundItem.equipmentInstanceId` still present in `state.groundItems`.
 */
export function isEquipmentInstanceOnFloor(state: GameState, instanceId: string): boolean {
  return state.groundItems.some((g) => g.equipmentInstanceId === instanceId);
}

/**
 * Every equipment instance the player actually holds right now (Phase
 * 20.0d correction): the currently-equipped instance for each slot
 * (via equippedWeaponInstanceId/equippedArmorInstanceId, whenever it
 * resolves to a real, non-floor instance) plus, per definitionId, up to
 * `inventory[definitionId]` total held individuals — never more.
 *
 * This is deliberately NOT "every equipmentInstances entry that isn't on
 * the floor": that naive complement would also count any orphaned
 * instance beyond what `inventory` actually declares (e.g. a corrupted/
 * hand-built state, or a future bug that leaves a stale entry behind),
 * treating it as a legitimate held individual. Card target-selection
 * (temperance/star — see card-target-selection.ts) must never offer such
 * an orphan as a candidate, since it doesn't correspond to anything the
 * player can actually see or act on in their inventory. `inventory`'s
 * count is the source of truth for "how many of this species are held";
 * this function selects exactly that many instances (equipped one first,
 * then unequipped ones in existing array order), on a definitionId-by-
 * definitionId basis, and never returns more.
 *
 * For a normal, already-normalized state (normalizeEquipmentInstances
 * has run and inventory/equipmentInstances agree), this returns the same
 * set — and the same order — as the naive "not on floor" filter did,
 * changing nothing observable for correctly-formed state.
 */
export function getHeldEquipmentInstances(state: GameState): EquipmentInstance[] {
  const inventory = state.inventory ?? {};
  const heldByDefinition = new Map<WeaponId | ArmorId, EquipmentInstance[]>();
  for (const instance of getEquipmentInstances(state)) {
    if (isEquipmentInstanceOnFloor(state, instance.instanceId)) continue;
    const list = heldByDefinition.get(instance.definitionId) ?? [];
    list.push(instance);
    heldByDefinition.set(instance.definitionId, list);
  }

  const result: EquipmentInstance[] = [];
  for (const [definitionId, instances] of heldByDefinition) {
    const owned = inventory[definitionId] ?? 0;
    if (owned <= 0) continue;
    const equippedId =
      state.equippedWeaponInstanceId && definitionId === state.equippedWeaponId
        ? state.equippedWeaponInstanceId
        : state.equippedArmorInstanceId && definitionId === state.equippedArmorId
          ? state.equippedArmorInstanceId
          : null;
    const equipped = instances.find((i) => i.instanceId === equippedId);
    const unequipped = instances.filter((i) => i.instanceId !== equippedId);
    const selected: EquipmentInstance[] = [];
    if (equipped) selected.push(equipped);
    for (const instance of unequipped) {
      if (selected.length >= owned) break;
      selected.push(instance);
    }
    result.push(...selected.slice(0, owned));
  }
  return result;
}

/**
 * Phase 24.1: the held instance matching `equipmentInstanceId` exactly,
 * if it exists, is currently held (getHeldEquipmentInstances — never a
 * floor-only or orphaned instance), and its definitionId matches
 * `definitionId`. Returns undefined for any mismatch (wrong species,
 * unowned, floor-only, unknown id) — callers (turn.ts's instance-aware
 * equip/place/discard branches) treat undefined as "reject the action
 * outright", never as "fall back to a different individual" (per
 * docs/history/phase-24-1-equipment-instance-actions.md's stale-action
 * contract: an explicitly-named instanceId is never silently
 * substituted).
 */
export function findHeldInstanceById(
  state: GameState,
  definitionId: WeaponId | ArmorId,
  equipmentInstanceId: string,
): EquipmentInstance | undefined {
  return getHeldEquipmentInstances(state).find(
    (i) => i.instanceId === equipmentInstanceId && i.definitionId === definitionId,
  );
}

/**
 * Phase 24.1: like findHeldInstanceById, but additionally rejects the
 * currently-equipped instance for this slot (place_item/discard_item's
 * "the equipped individual can never be placed/discarded" rule — see
 * isLastEquippedCopy's pre-24.1 species-level version in turn.ts, now
 * enforced at the individual level here).
 */
export function findHeldUnequippedInstanceById(
  state: GameState,
  definitionId: WeaponId | ArmorId,
  equipmentInstanceId: string,
  equippedInstanceId: string | null | undefined,
): EquipmentInstance | undefined {
  if (equipmentInstanceId === equippedInstanceId) return undefined;
  return findHeldInstanceById(state, definitionId, equipmentInstanceId);
}

/**
 * Mints and registers one new EquipmentInstance for `definitionId`, with
 * default attributes (refineLevel 0, cursed false, curseRevealed false —
 * never cursed; see mintEquipmentInstance's doc comment for the only
 * creation path that ever rolls a curse). Uses
 * `state.nextEquipmentInstanceId` (defaulting to 0) as a deterministic,
 * RNG-free, monotonically-incrementing counter — never `Math.random`,
 * never any gameplay PRNG stream, so instance creation never perturbs
 * combat/loot/map RNG consumption order and always produces identical
 * ids for the same sequence of creations. Mutates
 * `state.equipmentInstances`/`state.nextEquipmentInstanceId` in place and
 * returns the new instance.
 */
export function createEquipmentInstance(state: GameState, definitionId: WeaponId | ArmorId): EquipmentInstance {
  const next = state.nextEquipmentInstanceId ?? 0;
  const instance = mintEquipmentInstance(next, definitionId);
  state.nextEquipmentInstanceId = next + 1;
  if (!state.equipmentInstances) {
    state.equipmentInstances = [];
  }
  state.equipmentInstances.push(instance);
  return instance;
}

/**
 * Phase 24.2 太陽鍛冶コア: like createEquipmentInstance above, but takes
 * an explicit `rank` instead of deriving it from `definitionId`'s
 * species-default table entry — the only creation path whose rank can
 * legitimately differ from its own species' WEAPON_DEFINITIONS/
 * ARMOR_DEFINITIONS entry (a forged output's rank comes from the recipe,
 * not the input species' table row — output_rules's "definitionIdと
 * rankはレシピの出力定義に従う"). Every other attribute is identical to
 * a freshly-minted default instance (refineLevel 0, cursed false,
 * curseRevealed false — output_rules's "素材の個体状態を完成品へ暗黙継承
 * しない"). Uses the same deterministic, RNG-free
 * state.nextEquipmentInstanceId counter as createEquipmentInstance, so
 * instance ids never collide between the two creation paths.
 */
export function createEquipmentInstanceWithRank(
  state: GameState,
  definitionId: WeaponId | ArmorId,
  rank: EquipmentRank,
): EquipmentInstance {
  const next = state.nextEquipmentInstanceId ?? 0;
  // Deliberately does not call mintEquipmentInstance: that helper derives
  // rank from WEAPON_DEFINITIONS/ARMOR_DEFINITIONS via definitionRankFor,
  // which would throw for a fixture-only definitionId that has no
  // production catalog entry (exactly the shape solar-forge.ts's test
  // fixtures use) and would ignore the caller's explicit `rank` even for
  // a real one — the whole point of this function.
  const instance: EquipmentInstance = {
    instanceId: `eq-${next}`,
    definitionId,
    refineLevel: 0,
    cursed: false,
    curseRevealed: false,
    rank,
  };
  state.nextEquipmentInstanceId = next + 1;
  if (!state.equipmentInstances) {
    state.equipmentInstances = [];
  }
  state.equipmentInstances.push(instance);
  return instance;
}

/**
 * Returns one currently-unequipped instance of `definitionId` if one
 * exists among `state.equipmentInstances` (never the instance referenced
 * by `equippedInstanceId`), or undefined if none is available. Does not
 * create anything — see ensureAvailableInstanceForEquip below for the
 * create-on-demand wrapper equip actions actually use.
 */
function findUnequippedInstance(
  state: GameState,
  definitionId: WeaponId | ArmorId,
  equippedInstanceId: string | null | undefined,
): EquipmentInstance | undefined {
  return getEquipmentInstances(state).find(
    (i) => i.definitionId === definitionId && i.instanceId !== equippedInstanceId,
  );
}

/**
 * Returns an instance of `definitionId` suitable for a new equip action
 * to reference: an existing unequipped one if available, otherwise a
 * freshly-created default one (covers legacy/test GameState fixtures
 * that set an `inventory` count without ever populating
 * `equipmentInstances` — see normalizeEquipmentInstances for the
 * broader backfill this same gap-filling logic also underlies).
 */
export function ensureAvailableInstanceForEquip(
  state: GameState,
  definitionId: WeaponId | ArmorId,
  equippedInstanceId: string | null | undefined,
): EquipmentInstance {
  return findUnequippedInstance(state, definitionId, equippedInstanceId) ?? createEquipmentInstance(state, definitionId);
}

/**
 * Normalizes `state.equipmentInstances` in place: backfills missing
 * default instances so every weapon/armor id's `inventory` count is
 * matched by at least that many instances of that definitionId (using
 * createEquipmentInstance, so no RNG is consumed and ids stay
 * deterministic/collision-free), and corrects any malformed attribute on
 * every existing instance:
 * - non-integer or negative `refineLevel` -> 0
 * - non-boolean `cursed`/`curseRevealed` -> false
 * - the invalid `cursed: false, curseRevealed: true` combination -> curseRevealed forced false
 *
 * Never removes or duplicates an already-valid instance, and never
 * touches an instance's `instanceId`/`definitionId` once assigned.
 * Idempotent: calling this again on already-normalized state changes
 * nothing. This is the equipment-instance analogue of state.ts's
 * normalizeIdentifiedCardIds — called at the same state-construction
 * boundaries (buildFloorState/advanceToNextFloor) plus defensively
 * before equip resolution, since many existing test fixtures construct
 * a GameState literal with an `inventory` weapon/armor count but no
 * `equipmentInstances` at all.
 */
export function normalizeEquipmentInstances(state: GameState): void {
  const existing = getEquipmentInstances(state);
  for (const instance of existing) {
    if (!Number.isInteger(instance.refineLevel) || instance.refineLevel < 0) {
      instance.refineLevel = 0;
    } else if (instance.refineLevel > EQUIPMENT_REFINE_LEVEL_CAP) {
      instance.refineLevel = EQUIPMENT_REFINE_LEVEL_CAP;
    }
    if (typeof instance.cursed !== 'boolean') {
      instance.cursed = false;
    }
    if (typeof instance.curseRevealed !== 'boolean') {
      instance.curseRevealed = false;
    }
    if (!instance.cursed && instance.curseRevealed) {
      instance.curseRevealed = false;
    }
    // Phase 24.1: a missing/invalid rank (legacy fixtures predating this
    // phase, or a hand-built malformed state) normalizes to its species'
    // current definition rank — never re-derived from anything else, and
    // never touched again once valid (mirrors refineLevel/cursed's own
    // correction-only-when-malformed treatment above).
    if (!isValidRank(instance.rank)) {
      instance.rank = definitionRankFor(instance.definitionId);
    }
  }

  const inventory = state.inventory ?? {};
  for (const definitionId of Object.keys(inventory)) {
    if (!isWeaponOrArmorId(definitionId)) continue;
    const owned = inventory[definitionId] ?? 0;
    if (owned <= 0) continue;
    // Phase 24.1 correction: count only *held* instances (never a
    // floor-only instance still referenced by a GroundItem) against
    // `owned` — the pre-24.1 version counted every instance of this
    // definitionId regardless of floor status, which could under-mint
    // held individuals whenever a same-species item also happened to be
    // sitting unpicked on the current floor (e.g. a floor-generated
    // ground item not yet collected while the player already carries
    // one from a previous floor). getHeldEquipmentInstances/
    // inventoryEntries both depend on `owned` held instances actually
    // existing, so this keeps that invariant true in every case, not
    // just the common one.
    const currentHeldCount = getEquipmentInstances(state).filter(
      (i) => i.definitionId === definitionId && !isEquipmentInstanceOnFloor(state, i.instanceId),
    ).length;
    for (let i = currentHeldCount; i < owned; i++) {
      createEquipmentInstance(state, definitionId);
    }
  }

  // Phase 24.1: backfill equippedWeaponInstanceId/equippedArmorInstanceId
  // when equippedWeaponId/equippedArmorId is set but the paired instance
  // pointer is missing or stale (doesn't resolve to an instance of that
  // exact species) — this was always the documented contract (see
  // types.ts's equippedWeaponInstanceId doc comment: "this should be
  // non-null whenever equippedWeaponId is non-null in practice") but
  // was never actually enforced here before Phase 24.1, which now
  // depends on it for entry.equipped display/unequip-routing correctness
  // (inventory.ts's inventoryEntries). Picks the species' first instance
  // in existing stable array order — RNG-free, deterministic, and a
  // no-op once already valid (idempotent, like every other correction in
  // this function).
  if (state.equippedWeaponId) {
    const current = state.equippedWeaponInstanceId
      ? getEquipmentInstances(state).find(
          (i) => i.instanceId === state.equippedWeaponInstanceId && i.definitionId === state.equippedWeaponId,
        )
      : undefined;
    if (!current) {
      const fallback = getEquipmentInstances(state).find((i) => i.definitionId === state.equippedWeaponId);
      state.equippedWeaponInstanceId = fallback ? fallback.instanceId : null;
    }
  }
  if (state.equippedArmorId) {
    const current = state.equippedArmorInstanceId
      ? getEquipmentInstances(state).find(
          (i) => i.instanceId === state.equippedArmorInstanceId && i.definitionId === state.equippedArmorId,
        )
      : undefined;
    if (!current) {
      const fallback = getEquipmentInstances(state).find((i) => i.definitionId === state.equippedArmorId);
      state.equippedArmorInstanceId = fallback ? fallback.instanceId : null;
    }
  }
}

/**
 * Returns the instanceId of one currently-unequipped instance of
 * `definitionId` (never the instance referenced by `equippedInstanceId`),
 * without removing it from `state.equipmentInstances` — used by
 * place_item, where the item leaves `inventory` but its individual must
 * remain tracked (still "on the floor", not destroyed) so re-picking it
 * up later restores the exact same instance rather than minting a new
 * one. Contrast with removeUnequippedInstance below, which discard_item
 * uses for a genuine, permanent removal.
 */
export function findUnequippedInstanceId(
  state: GameState,
  definitionId: WeaponId | ArmorId,
  equippedInstanceId: string | null | undefined,
): string | undefined {
  return getEquipmentInstances(state).find((i) => i.definitionId === definitionId && i.instanceId !== equippedInstanceId)
    ?.instanceId;
}

/**
 * Removes exactly the instance matching `instanceId` from
 * `state.equipmentInstances`, if present — used by discard_item's
 * Phase 24.1 instance-aware path (the caller, turn.ts's
 * resolveEquipmentTargetForRemoval, has already verified this instance
 * is held and unequipped before calling). A no-op if the id isn't found
 * (defensive; should not happen given the caller's prior validation).
 */
export function removeInstanceById(state: GameState, instanceId: string): void {
  const instances = getEquipmentInstances(state);
  const index = instances.findIndex((i) => i.instanceId === instanceId);
  if (index >= 0) {
    instances.splice(index, 1);
  }
}

/**
 * Removes exactly one currently-unequipped instance of `definitionId`
 * from `state.equipmentInstances` (never the instance referenced by
 * `equippedInstanceId`), if one exists — used by discard_item for
 * weapon/armor ids, where the item is destroyed entirely (never used by
 * place_item — see findUnequippedInstanceId above for that case, which
 * keeps the instance tracked instead). A no-op if none is found (e.g. a
 * legacy fixture with no instances yet — normalizeEquipmentInstances
 * elsewhere is what backfills those, not this function).
 */
export function removeUnequippedInstance(
  state: GameState,
  definitionId: WeaponId | ArmorId,
  equippedInstanceId: string | null | undefined,
): string | null {
  const instances = getEquipmentInstances(state);
  const index = instances.findIndex((i) => i.definitionId === definitionId && i.instanceId !== equippedInstanceId);
  if (index >= 0) {
    const [removed] = instances.splice(index, 1);
    return removed.instanceId;
  }
  return null;
}

/** Whether the currently-equipped weapon instance is a discovered curse (blocks equip-swap/discard/place per Phase 20.0c curse-lock rules). */
export function isEquippedWeaponCurseLocked(state: GameState): boolean {
  if (!state.equippedWeaponInstanceId) return false;
  const instance = getEquipmentInstanceById(state, state.equippedWeaponInstanceId);
  return instance ? instance.cursed && instance.curseRevealed : false;
}

/** Whether the currently-equipped armor instance is a discovered curse (blocks equip-swap/discard/place per Phase 20.0c curse-lock rules). */
export function isEquippedArmorCurseLocked(state: GameState): boolean {
  if (!state.equippedArmorInstanceId) return false;
  const instance = getEquipmentInstanceById(state, state.equippedArmorInstanceId);
  return instance ? instance.cursed && instance.curseRevealed : false;
}
