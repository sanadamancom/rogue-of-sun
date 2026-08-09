import { ArmorId, EquipmentInstance, GameState, WeaponId } from './types';

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
  }

  const inventory = state.inventory ?? {};
  for (const definitionId of Object.keys(inventory)) {
    if (!isWeaponOrArmorId(definitionId)) continue;
    const owned = inventory[definitionId] ?? 0;
    if (owned <= 0) continue;
    const currentCount = getEquipmentInstances(state).filter((i) => i.definitionId === definitionId).length;
    for (let i = currentCount; i < owned; i++) {
      createEquipmentInstance(state, definitionId);
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
