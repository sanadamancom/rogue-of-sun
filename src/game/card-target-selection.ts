import { CARD_IDS_IN_ORDER } from './card-def';
import {
  getEquipmentInstances,
  getHeldEquipmentInstances,
  isEquippedArmorCurseLocked,
  isEquippedWeaponCurseLocked,
  isWeaponOrArmorId,
} from './equipment-instance';
import { ENCHANTMENT_ITEM_IDS, ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from './item-def';
import { getDisplayedItemName, isGeneralItemIdentified } from './item-identification';
import { NORMAL_RANKS } from './equipment-loot';
import { WEAPON_DEFINITIONS } from './weapon-def';
import { ARMOR_DEFINITIONS } from './armor-def';
import { CardId, EquipmentInstance, GameState, ItemId } from './types';

/**
 * Phase 20.0d card target selection foundation. This module is the
 * single source of truth for which cards need a target-selection step
 * (currently temperance and star only — moon/sun's targets are fixed to
 * the equipped instance and never go through this module, per
 * rogue-of-sun-card-effects-spec.md), what counts as an eligible target
 * for each, and the selection state machine's pure transition functions.
 *
 * Nothing here consumes a card, identifies anything, advances the turn,
 * or applies temperance's decurse / star's transform effect — those are
 * Phase 20.5a's job, using this module's CardTargetRef as their input
 * contract (see the transaction-boundary doc comment on
 * confirmCardTargetSelection below). Selection state itself is never
 * stored on GameState (a UI-layer concern, held by the caller — e.g.
 * main.ts — exactly like `menuScreen`/`itemActionIndex` already are).
 */

/**
 * A stable reference to one selectable target, re-resolvable against
 * GameState at any later point (never a display name or list index).
 * `kind: 'equipment_instance'` distinguishes individual weapon/armor
 * copies of the same species (via EquipmentInstance.instanceId — see
 * that type's own doc comment); `kind: 'inventory_item'` covers a
 * regular stacked item (star's non-equipment candidates), where the
 * ItemId itself is sufficient identity since stacked copies are
 * interchangeable.
 */
export type CardTargetRef =
  | { kind: 'equipment_instance'; instanceId: string }
  | { kind: 'inventory_item'; itemId: ItemId };

/** The 2 cards that use this module's selection flow this phase. */
export type TargetSelectableCardId = 'temperance' | 'star';

/**
 * Type guard for TargetSelectableCardId. Exported for Phase 20.5a's
 * eventual card-use dispatch to check "does this cardId need this
 * module's selection flow at all" before calling beginCardTargetSelection
 * — not yet called from turn.ts this phase (temperance/star aren't wired
 * into applyCardUse's dispatch until 20.5a), but kept as a real exported
 * function rather than removed, since its logic (exactly which 2 cards)
 * is this module's own responsibility to define once.
 */
export function isTargetSelectableCardId(cardId: CardId): cardId is TargetSelectableCardId {
  return cardId === 'temperance' || cardId === 'star';
}

/**
 * Same check as isTargetSelectableCardId above, but taking the wider
 * ItemId type UI call sites actually have on hand (an Inventory-selected
 * item is typed ItemId, not CardId) — avoids callers needing an unsound
 * cast to satisfy isTargetSelectableCardId's CardId parameter.
 */
export function isTargetSelectableItemId(itemId: ItemId): itemId is TargetSelectableCardId {
  return itemId === 'temperance' || itemId === 'star';
}

const CARD_ID_SET: ReadonlySet<string> = new Set(CARD_IDS_IN_ORDER);

/**
 * Phase 24.4d2 star-transformation alignment: the actual "進行用item/
 * 固定品/対象外品" ids that exist in the current item roster and must
 * never be a star target or a star transform result —
 * ENCHANTMENT_ITEM_IDS's 5 one-time unlock pickups (item-def.ts;
 * category 'consumable' so they would otherwise pass the plain
 * category filter below), plus 'solar_gun' (the unique fixed weapon,
 * always-identified per item-identification.ts's
 * ALWAYS_IDENTIFIED_EQUIPMENT_IDS) and 'black_armor' (structurally
 * excluded from every other normal/reward equipment path — see
 * equipment-loot.ts's weightedArmorCandidates). Phase 20.0d originally
 * left this set empty since none of the roster carried such a flag yet
 * at that phase; Phase 24.3's catalog expansion and Phase 24.4a's
 * equipment-loot exclusions since then are what make this non-empty
 * now.
 */
const STAR_INELIGIBLE_ITEM_IDS: ReadonlySet<ItemId> = new Set<ItemId>([
  ...ENCHANTMENT_ITEM_IDS,
  'solar_gun',
  'black_armor',
]);

/**
 * Whether `itemId` is a weapon/armor species whose rank is eligible for
 * star's transform result (C/B/A only — never S/R), reusing
 * equipment-loot.ts's own NORMAL_RANKS single source of truth (Phase
 * 24.4a's "S/Rは通常生成・報酬から除外する" rule) rather than
 * duplicating a second rank-tier list. Always true for a non-equipment
 * (consumable) itemId, since rank is meaningless there.
 */
function isStarEligibleRank(itemId: ItemId): boolean {
  const def = ITEM_DEFINITIONS[itemId];
  if (def.category === 'weapon') {
    return (NORMAL_RANKS as readonly string[]).includes(WEAPON_DEFINITIONS[itemId as import('./types').WeaponId].rank);
  }
  if (def.category === 'armor') {
    return (NORMAL_RANKS as readonly string[]).includes(ARMOR_DEFINITIONS[itemId as import('./types').ArmorId].rank);
  }
  return true;
}

/**
 * Whether `cursed && curseRevealed` — temperance's core eligibility test,
 * exported standalone since it's also exactly the "already known to be
 * cursed" check other Phase 20 code (equip-lock) already implements
 * independently; kept duplicated rather than importing from turn.ts to
 * avoid a card-target-selection.ts <-> turn.ts circular import (turn.ts
 * will import from this module in Phase 20.5a).
 */
function isDiscoveredCurse(instance: EquipmentInstance): boolean {
  return instance.cursed && instance.curseRevealed;
}

/**
 * Temperance's candidate list (Phase 20.0d): every held (equipped or
 * unequipped) weapon/armor instance whose curse is cursed && curseRevealed.
 * Pure — reads GameState only, mutates nothing, consumes no RNG. Order is
 * `getEquipmentInstances`' own stable array order (instance creation
 * order), never Object-key enumeration or any seed-dependent shuffle.
 */
export function getTemperanceCandidates(state: GameState): CardTargetRef[] {
  return getHeldEquipmentInstances(state)
    // Phase 24.5b: explicit category exclusion, even though the 6
    // initial accessory species are always cursed:false (Phase 24.5a2a's
    // finalized selection) and would therefore already fail
    // isDiscoveredCurse implicitly — an explicit gate is required per
    // Phase 24.5b's exclusion design rather than relying on that
    // incidental property alone.
    .filter((instance) => isWeaponOrArmorId(instance.definitionId))
    .filter(isDiscoveredCurse)
    .map((instance): CardTargetRef => ({ kind: 'equipment_instance', instanceId: instance.instanceId }));
}

/**
 * The full list of eligible transform-target ItemIds for `itemId`'s
 * category (Phase 20.5a's actual draw pool): every ItemId in
 * ITEM_IDS_IN_ORDER's canonical order sharing `itemId`'s category,
 * excluding all 17 cards, STAR_INELIGIBLE_ITEM_IDS members, and
 * `itemId` itself. Pure item-roster question, independent of what the
 * player currently owns. hasAlternateTransformCategory below is exactly
 * `getTransformCandidatesForItem(itemId).length > 0`.
 */
export function getTransformCandidatesForItem(itemId: ItemId): ItemId[] {
  const category = ITEM_DEFINITIONS[itemId].category;
  return ITEM_IDS_IN_ORDER.filter(
    (candidateId) =>
      candidateId !== itemId &&
      !CARD_ID_SET.has(candidateId) &&
      !STAR_INELIGIBLE_ITEM_IDS.has(candidateId) &&
      ITEM_DEFINITIONS[candidateId].category === category &&
      isStarEligibleRank(candidateId),
  );
}

/**
 * Whether `itemId`'s category (consumable/weapon/armor) has at least one
 * *other* eligible ItemId in the game's full item roster — i.e. whether
 * transforming `itemId` into "a different item of the same category"
 * could ever produce a result. A card is never counted as an alternate
 * for any category. With the current 1-species ArmorId ('armor' only),
 * every armor instance therefore has 0 alternates and is excluded from
 * star's candidates by getStarCandidates below — an intentional, tested
 * consequence of the current item roster, not a bug.
 */
export function hasAlternateTransformCategory(itemId: ItemId): boolean {
  return getTransformCandidatesForItem(itemId).length > 0;
}

/**
 * Star's candidate list (Phase 20.0d): every held stacked consumable
 * (inventory count > 0) and every held weapon/armor instance, excluding
 * all 17 cards, star itself, any STAR_INELIGIBLE_ITEM_IDS member, and
 * anything whose category has no alternate transform target (see
 * hasAlternateTransformCategory). Pure — reads GameState only, mutates
 * nothing, consumes no RNG.
 */
export function getStarCandidates(state: GameState): CardTargetRef[] {
  const candidates: CardTargetRef[] = [];

  for (const itemId of ITEM_IDS_IN_ORDER) {
    if (CARD_ID_SET.has(itemId)) continue;
    if (STAR_INELIGIBLE_ITEM_IDS.has(itemId)) continue;
    const def = ITEM_DEFINITIONS[itemId];
    // Phase 24.5b: explicit accessory exclusion added alongside the
    // existing weapon/armor exclusion — accessory (like weapon/armor)
    // is tracked via equipment_instance entries below, never as a plain
    // inventory_item candidate, even though `state.inventory[itemId]`
    // is still a positive count for a held accessory (same dual-tracking
    // shape as weapon/armor).
    if (def.category === 'weapon' || def.category === 'armor' || def.category === 'accessory') continue; // handled via instances below
    const owned = state.inventory[itemId] ?? 0;
    if (owned <= 0) continue;
    if (!hasAlternateTransformCategory(itemId)) continue;
    candidates.push({ kind: 'inventory_item', itemId });
  }

  const weaponBound = isEquippedWeaponCurseLocked(state);
  const armorBound = isEquippedArmorCurseLocked(state);
  for (const instance of getHeldEquipmentInstances(state)) {
    // Phase 24.5b: explicit category exclusion — accessory instances
    // must never reach Star's transform candidates, even though the
    // rank/eligible-transform-category checks below would otherwise
    // pass for the initial 6 species (Phase 24.5a2a's finalized
    // selection is all C/B/A/S, no S-ineligible id here, and multiple
    // accessories of the same category would give a nonzero
    // hasAlternateTransformCategory result). isWeaponOrArmorId narrows
    // instance.definitionId back to WeaponId | ArmorId for every
    // subsequent line in this loop.
    if (!isWeaponOrArmorId(instance.definitionId)) continue;
    if (STAR_INELIGIBLE_ITEM_IDS.has(instance.definitionId)) continue;
    if (!isStarEligibleRank(instance.definitionId)) continue;
    if (!hasAlternateTransformCategory(instance.definitionId)) continue;
    // Phase 24.4d2: a currently-equipped instance whose discovered curse
    // locks it against ordinary equip-swap/discard/place (Phase 20.0c's
    // isEquippedWeaponCurseLocked/isEquippedArmorCurseLocked) must be
    // just as immune to star's transform — the same "この束縛は通常の
    // 解除・交換操作を拒否する" contract star must not bypass.
    if (state.equippedWeaponInstanceId === instance.instanceId && weaponBound) continue;
    if (state.equippedArmorInstanceId === instance.instanceId && armorBound) continue;
    candidates.push({ kind: 'equipment_instance', instanceId: instance.instanceId });
  }

  return candidates;
}

/** Dispatches to getTemperanceCandidates/getStarCandidates by cardId. Returns [] for any card outside this module's scope (moon/sun and every other card never reach here — see this module's doc comment). */
export function getCardTargetCandidates(state: GameState, cardId: CardId): CardTargetRef[] {
  if (cardId === 'temperance') return getTemperanceCandidates(state);
  if (cardId === 'star') return getStarCandidates(state);
  return [];
}

/**
 * Re-validates a single CardTargetRef against current GameState — used
 * both by confirmCardTargetSelection below (stale-target rejection) and
 * available for Phase 20.5a's effect resolver to re-check immediately
 * before applying its effect (defense in depth against any state change
 * between confirm and resolver execution). Recomputes the full candidate
 * list for `cardId` and checks membership, rather than re-implementing
 * the eligibility rules a second time.
 */
export function isCardTargetStillValid(state: GameState, cardId: TargetSelectableCardId, target: CardTargetRef): boolean {
  const candidates = getCardTargetCandidates(state, cardId);
  return candidates.some((c) => cardTargetRefEquals(c, target));
}

function cardTargetRefEquals(a: CardTargetRef, b: CardTargetRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'equipment_instance' && b.kind === 'equipment_instance') return a.instanceId === b.instanceId;
  if (a.kind === 'inventory_item' && b.kind === 'inventory_item') return a.itemId === b.itemId;
  return false;
}

/**
 * Display information for one candidate (Phase 20.0d UI — main.ts). Never
 * includes anything not already safe to show: an inventory_item's real
 * displayName (never a card — no card is ever a candidate here, so no
 * unidentified-name concern arises), or an equipment_instance's real
 * displayName plus refineLevel/equipped-status — never its curse status
 * (temperance's own candidates are already curseRevealed=true by
 * construction, so showing "呪われている" for temperance is not a leak;
 * star must never show curse status at all, since a cursed-but-unrevealed
 * individual could otherwise be identified purely from its presence/
 * absence of a curse note — this function simply never reads `cursed`/
 * `curseRevealed` for star's case, taking `cardId` so it knows which
 * card's convention to apply).
 */
export interface CardTargetCandidateDisplay {
  ref: CardTargetRef;
  displayName: string;
  equipped: boolean;
  refineLevel?: number;
  note?: string;
}

export function describeCardTargetCandidate(
  state: GameState,
  cardId: TargetSelectableCardId,
  ref: CardTargetRef,
): CardTargetCandidateDisplay {
  if (ref.kind === 'inventory_item') {
    return {
      ref,
      // Phase 24.4d1: routes through the shared resolver instead of the
      // raw ITEM_DEFINITIONS displayName — this was the audit's second
      // leak site (docs/history/phase-24-4d0-identification-audit.md
      // section 4.10): an unidentified ordinary consumable's true name
      // must not leak through star's candidate list either.
      displayName: getDisplayedItemName(state, ref.itemId),
      equipped: false,
    };
  }
  const instance = getEquipmentInstances(state).find((i) => i.instanceId === ref.instanceId);
  const definitionId = instance?.definitionId;
  const identified = definitionId ? isGeneralItemIdentified(state, definitionId as ItemId) : false;
  const displayName = definitionId ? getDisplayedItemName(state, definitionId as ItemId) : '（不明な装備）';
  const equipped = state.equippedWeaponInstanceId === ref.instanceId || state.equippedArmorInstanceId === ref.instanceId;
  // Phase 24.4d1: refineLevel is withheld while the definition itself is
  // unidentified (player_visible_rules.item_detail's "refineLevel...を
  // 未鑑定情報として漏らさない") — never shown for star regardless (star
  // never surfaced it before this phase either), and for temperance only
  // once the definition is identified.
  const refineLevel = identified ? instance?.refineLevel : undefined;
  // temperance's candidates are, by construction (getTemperanceCandidates),
  // always cursed && curseRevealed — safe to state as a fact, not a leak.
  const note = cardId === 'temperance' ? '呪われている' : undefined;
  return { ref, displayName, equipped, refineLevel, note };
}

/**
 * The target-selection UI state (Phase 20.0d). Deliberately not a
 * GameState field (rogue-of-sun-development-plan.md 20.0d's "GameStateへ
 * 一時的なUI cursorを永続fieldとして追加しない") — callers (main.ts) hold
 * this the same way they already hold `menuScreen`/`itemActionIndex`.
 * `candidates` is snapshotted at `begin` time; `confirm` re-validates
 * against live GameState rather than trusting this snapshot, so a stale
 * snapshot can never smuggle an invalid target through.
 */
export interface CardTargetSelectionState {
  cardId: TargetSelectableCardId;
  candidates: CardTargetRef[];
  cursor: number;
}

/**
 * Starts target selection for `cardId`. Returns null (never entering a
 * selection state) if there are 0 eligible candidates — the caller
 * treats this as an ordinary card-use failure (rogue-of-sun-card-effects-spec.md's
 * "使用不成立として扱えること" for temperance-with-no-cursed-equipment /
 * star-with-no-valid-target), never opening a selection screen for
 * nothing. Never mutates GameState (candidate generation is pure — see
 * getCardTargetCandidates). A single eligible candidate still requires
 * an explicit confirm — never auto-selected.
 */
export function beginCardTargetSelection(state: GameState, cardId: TargetSelectableCardId): CardTargetSelectionState | null {
  const candidates = getCardTargetCandidates(state, cardId);
  if (candidates.length === 0) return null;
  return { cardId, candidates, cursor: 0 };
}

/** Moves the cursor by `delta`, clamped to the candidate range (never wraps out of bounds). Pure — returns a new state object, never mutates its input. */
export function moveCardTargetCursor(selection: CardTargetSelectionState, delta: number): CardTargetSelectionState {
  const max = selection.candidates.length - 1;
  const next = Math.max(0, Math.min(max, selection.cursor + delta));
  return { ...selection, cursor: next };
}

/**
 * Re-generates `selection`'s candidate list against current GameState,
 * preserving the cursor's target where possible (tracks the
 * previously-selected CardTargetRef, not the raw index, so a candidate
 * list shrinking from underneath the cursor never silently re-points it
 * at an unrelated target). Returns null if no candidates remain (caller
 * must exit selection and treat this as the "候補がなくなった場合は安全
 * に元画面へ戻る" case) — never used internally by confirm (see that
 * function's own doc comment for why it rejects instead of re-selecting
 * automatically).
 */
export function refreshCardTargetSelection(state: GameState, selection: CardTargetSelectionState): CardTargetSelectionState | null {
  const previousTarget = selection.candidates[selection.cursor];
  const candidates = getCardTargetCandidates(state, selection.cardId);
  if (candidates.length === 0) return null;
  const preservedIndex = previousTarget ? candidates.findIndex((c) => cardTargetRefEquals(c, previousTarget)) : -1;
  const cursor = preservedIndex >= 0 ? preservedIndex : Math.min(selection.cursor, candidates.length - 1);
  return { cardId: selection.cardId, candidates, cursor };
}

/**
 * Confirms the currently-cursored target, re-validating it against live
 * GameState first (rogue-of-sun-development-plan.md 20.0d's "確定直前に
 * 対象が現在も有効か再検証する"). Returns the CardTargetRef on success
 * (this is the exact value Phase 20.5a's effect resolver will consume —
 * see this module's doc comment for the transaction-boundary contract:
 * confirming here never itself consumes the card, identifies anything,
 * or advances the turn; only a resolver's later success does that).
 * Returns null if the cursored target is no longer valid (e.g. it was
 * discarded or its curse was somehow cleared between selection and
 * confirm) — deliberately does NOT auto-retry against a refreshed
 * candidate list; the caller decides whether to call
 * refreshCardTargetSelection and let the player choose again, or to
 * cancel outright. This function itself never mutates GameState.
 */
export function confirmCardTargetSelection(state: GameState, selection: CardTargetSelectionState): CardTargetRef | null {
  const target = selection.candidates[selection.cursor];
  if (!target) return null;
  if (!isCardTargetStillValid(state, selection.cardId, target)) return null;
  return target;
}

// ---------------------------------------------------------------------
// Transaction boundary (Phase 20.0d correction). Separates "did the
// card's effect actually succeed against this target" from "should the
// card be consumed/identified/the turn advanced" — the latter is never
// this module's decision (see resolveCardTargetEffect's own doc comment)
// and stays entirely undone whenever the former is false.
// ---------------------------------------------------------------------

/**
 * The outcome a card-specific resolver itself returns, before this
 * module's isolation wrapper turns it into a CardTargetEffectTransaction
 * (see resolveCardTargetEffect below). `success: false` carries no
 * further data; `success: true` signals only that the resolver's own
 * effect application against its (isolated — see below) working state
 * succeeded, not that anything has been committed anywhere.
 */
export type CardTargetEffectOutcome = { success: false } | { success: true };

/**
 * A card-specific effect resolver: given an *isolated working copy* of
 * GameState (never the live state currently in play — see
 * resolveCardTargetEffect's own doc comment) and an already-confirmed,
 * already-revalidated target, attempts that card's effect (temperance's
 * decurse / star's transform) against that working copy and returns
 * whether it succeeded. A resolver may mutate `workingState` freely,
 * including on a path that ultimately returns `{ success: false }` —
 * resolveCardTargetEffect discards the entire working copy in that case,
 * so any such mutation never reaches the caller's real state. This is
 * the structural guarantee (not a convention resolver authors must
 * remember) that makes "failure never leaves any state changed" true
 * regardless of how a resolver is written.
 */
export type CardTargetEffectResolver = (workingState: GameState, target: CardTargetRef) => CardTargetEffectOutcome;

/**
 * Phase 20.5a's plug-in point: maps each TargetSelectableCardId to its
 * resolver. Deliberately empty this phase — temperance's decurse and
 * star's transform are not implemented yet (rogue-of-sun-development-plan.md
 * 20.0d's explicit out-of-scope) — populated by Phase 20.5a adding
 * entries here, not by changing resolveCardTargetEffect's own logic.
 * A `Partial` record (not `Record`) precisely because "no resolver
 * registered yet" is a real, valid state this phase, not a gap to paper
 * over with a placeholder function.
 */
export const CARD_TARGET_EFFECT_RESOLVERS: Partial<Record<TargetSelectableCardId, CardTargetEffectResolver>> = {};

/** Why a CardTargetEffectTransaction failed — typed rather than a bare boolean/string, so callers (and Phase 20.5a) can branch on the specific cause without string-matching. */
export type CardTargetEffectFailureReason = 'no_resolver_registered' | 'resolver_reported_failure';

/**
 * The result of attempting `cardId`'s effect against `target`
 * (resolveCardTargetEffect below), fully separating "did it succeed" from
 * "is there anything to commit":
 * - `status: 'failure'` carries only a typed reason — no state of any
 *   kind. There is structurally nothing here a caller could commit even
 *   by mistake.
 * - `status: 'success'` carries `nextState`: a GameState that already has
 *   the resolver's effect applied, produced by mutating an isolated
 *   working copy (never the caller's live state) — see
 *   resolveCardTargetEffect's own doc comment. This `nextState` is
 *   itself still uncommitted: obtaining a success transaction does not,
 *   by itself, change anything the caller is currently using. Only a
 *   caller that explicitly assigns/merges `nextState` into its live
 *   GameState (which Phase 20.0d's main.ts flow deliberately never does
 *   — see that call site) makes the effect real; Phase 20.5a will pair a
 *   successful transaction with the same consume/identify/advance-turn
 *   commit steps every other card's finishSuccessfulCardUse already
 *   performs.
 */
export type CardTargetEffectTransaction =
  | { status: 'failure'; reason: CardTargetEffectFailureReason }
  | { status: 'success'; nextState: GameState };

/**
 * Attempts `cardId`'s registered resolver (if any) against `target`,
 * returning a fully isolated CardTargetEffectTransaction.
 *
 * Isolation: `state` (the caller's live, currently-in-play GameState) is
 * never passed to a resolver. A working copy is produced via
 * `structuredClone(state)` — safe and complete because GameState is
 * required to stay fully JSON-serializable (no Map/Set/functions/
 * circular refs — see types.ts's GameState doc comments throughout) —
 * and only that working copy is mutated. Since GameState's own
 * `combatRngState` field lives inside the cloned object, cloning state
 * also isolates the RNG stream by the same mechanism, with no separate
 * RNG-specific handling needed.
 *
 * - No resolver registered for `cardId` (current production state for
 *   both temperance and star): returns `{ status: 'failure', reason:
 *   'no_resolver_registered' }` without ever cloning `state` — there is
 *   nothing to isolate a resolver call for. This is the correct,
 *   fully-specified behavior for Phase 20.0d (no effect exists yet), not
 *   a dummy/fallback.
 * - Resolver returns `{ success: false }`: the working copy — regardless
 *   of what the resolver mutated on it — is discarded entirely; returns
 *   `{ status: 'failure', reason: 'resolver_reported_failure' }`, which
 *   carries no state.
 * - Resolver returns `{ success: true }`: returns `{ status: 'success',
 *   nextState: <the mutated working copy> }`.
 *
 * Never itself mutates `state` (the argument), never commits `nextState`
 * anywhere, never consumes a card, identifies anything, or advances the
 * turn — every one of those remains entirely the caller's decision,
 * gated on `transaction.status === 'success'` (Phase 20.5a wires this
 * into turn.ts's applyCardUse alongside finishSuccessfulCardUse).
 */
export function resolveCardTargetEffect(
  state: GameState,
  cardId: TargetSelectableCardId,
  target: CardTargetRef,
): CardTargetEffectTransaction {
  const resolver = CARD_TARGET_EFFECT_RESOLVERS[cardId];
  if (!resolver) return { status: 'failure', reason: 'no_resolver_registered' };
  const workingState = structuredClone(state);
  const outcome = resolver(workingState, target);
  if (!outcome.success) return { status: 'failure', reason: 'resolver_reported_failure' };
  return { status: 'success', nextState: workingState };
}

/**
 * A successful card-target effect, still awaiting commit (Phase 20.0d
 * correction): the exact `cardId`/`target` that produced it, plus the
 * resolver's effect-applied `nextState` (from a successful
 * CardTargetEffectTransaction — see resolveCardTargetEffect). This is a
 * *runtime-only* handoff value: it is never a GameState field, never
 * part of any save payload, and carries no schemaVersion implications —
 * the caller (main.ts) holds it exactly the way it already holds
 * `menuScreen`/`cardTargetSelection`, as a private controller field, not
 * game state. Constructing one does not commit `nextState` anywhere;
 * only a caller that later assigns it into the live GameState (which
 * Phase 20.0d's main.ts deliberately never does — see that call site)
 * makes the effect real. Phase 20.5a is what pairs a prepared effect
 * with the same consume/identify/advance-turn commit steps every other
 * card's finishSuccessfulCardUse already performs.
 */
export interface PreparedCardTargetEffect {
  cardId: TargetSelectableCardId;
  target: CardTargetRef;
  nextState: GameState;
}

/**
 * Converts a successful CardTargetEffectTransaction into a
 * PreparedCardTargetEffect, or null for a failure transaction (there is
 * nothing to prepare — a failure carries no state, per
 * CardTargetEffectTransaction's own doc comment). Pure: never mutates
 * `transaction.nextState`, never touches any live GameState, never
 * commits anything.
 */
export function toPreparedCardTargetEffect(
  cardId: TargetSelectableCardId,
  target: CardTargetRef,
  transaction: CardTargetEffectTransaction,
): PreparedCardTargetEffect | null {
  if (transaction.status !== 'success') return null;
  return { cardId, target, nextState: transaction.nextState };
}

/**
 * Encapsulated lifecycle for a single pending card-target effect (Phase
 * 20.0d correction). This is the single production boundary main.ts
 * actually calls — never a duplicate/reimplemented copy in a test file —
 * so its private storage can only ever be reached through this class's
 * own methods: `setFromTransaction` (store — a failure transaction
 * clears rather than stores), `clear` (used identically by starting a
 * new selection, cancel, a stale-target rejection, and run restart —
 * one shared clearing path, not four separate ones), and `peek`/`take`
 * (read access — `peek` never removes the value, `take` removes and
 * returns it in one step for a future commit consumer).
 *
 * Nothing in this class ever touches GameState, consumes RNG, or commits
 * `nextState` anywhere; it only holds/releases the value. Phase 20.0d's
 * main.ts never calls `take()` (CARD_TARGET_EFFECT_RESOLVERS is empty,
 * so `peek()` is always null in normal play regardless) — `take()` exists
 * for Phase 20.5a's eventual commit step.
 */
export class PendingCardTargetEffectHolder {
  private pending: PreparedCardTargetEffect | null = null;

  /** Read-only view of the current pending effect (or null), without consuming it. Never mutates anything. */
  peek(): PreparedCardTargetEffect | null {
    return this.pending;
  }

  /**
   * Removes and returns the current pending effect (or null if there is
   * none), in one atomic step — so a caller can never `peek()` a value
   * and then race against something else clearing it before acting on
   * it. This class itself never calls `take()`; it exists for a future
   * commit consumer (Phase 20.5a) to use.
   */
  take(): PreparedCardTargetEffect | null {
    const value = this.pending;
    this.pending = null;
    return value;
  }

  /**
   * Records the outcome of a just-resolved CardTargetEffectTransaction
   * for `cardId`/`target`: a success transaction becomes the new pending
   * effect (replacing any previous one — there is only ever one pending
   * effect at a time); a failure transaction clears the holder outright
   * (rogue-of-sun-development-plan.md 20.0d's "failureでは既存pendingを
   * 確実に消去する"), never leaving a stale prior pending value behind.
   */
  setFromTransaction(cardId: TargetSelectableCardId, target: CardTargetRef, transaction: CardTargetEffectTransaction): void {
    this.pending = toPreparedCardTargetEffect(cardId, target, transaction);
  }

  /**
   * Clears any pending effect. The single shared clearing path used by
   * every lifecycle event that must never carry a stale pending effect
   * forward: beginning a new target selection, cancel, a stale-target
   * rejection with or without remaining candidates, and a run restart.
   */
  clear(): void {
    this.pending = null;
  }
}
