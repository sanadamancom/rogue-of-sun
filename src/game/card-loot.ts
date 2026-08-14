import { CARD_DEFINITIONS, CARD_IDS_IN_ORDER, CardRarity } from './card-def';
import { CardId, ItemId } from './types';

/**
 * Phase 24.4c: the single source of truth for the "does this generation
 * slot become a card, and if so which one" decision, shared by all 3
 * production loot routes (normal floor generation, monsterHouse reward,
 * and Phase 24.4b's enemy-drop post-success item selection — see
 * state.ts and enemy-drop.ts, the only callers). Every function here is
 * pure (no state, no side effects) and consumes RNG only from the
 * caller-supplied stream(s), mirroring equipment-loot.ts's own
 * established pattern for the exact same reason: card selection must be
 * reusable verbatim across routes without duplicating the candidate
 * table or the weighting logic anywhere else.
 *
 * This module is intentionally a *parallel*, not a replacement, of the
 * older Phase 20.0e card-floor-drop mechanism still present in
 * item-def.ts (getCardGroundPoolForFloor / getWeightedGroundItemPoolForFloor's
 * card component / CardDefinition.lootWeight+floorDropEnabled). That
 * older mechanism only ever registered 9 of the 17 cards, staged in by
 * floor — exactly the floor-gating and partial roster this Phase's
 * producer_decisions forbids ("17種すべてを1階から候補にする" /
 * "カード固有の解禁階層を作らない"). Rather than rework that mechanism's
 * floor-staged arrays and lootWeight/floorDropEnabled fields (which
 * remain at their Phase 20.0a neutral values — floorDropEnabled: false,
 * enemyDropEnabled: false, unchanged by this Phase — so that mechanism
 * stays fully inert and never contributes a candidate), this Phase adds
 * this new module and a new CardDefinition.rarity field, and has
 * state.ts/enemy-drop.ts substitute an already-drawn non-card slot with
 * a card *after* the existing non-card draw completes unchanged — see
 * each call site's own doc comment for why this ordering leaves every
 * pre-existing RNG stream (itemCountRng, itemSelectionRng,
 * itemPlacementRng, equipmentCurseRng, equipmentDefinitionRng, and
 * enemy-drop.ts's own item/equipment/curse streams) fully untouched.
 */

/**
 * Phase 24.6/27-tunable provisional route-level weight: for every one of
 * the 3 production routes, a single generation slot is a card with
 * probability card/(card+nonCard) = 10/100 = 10%, otherwise it keeps
 * whatever the existing non-card process already produced for that slot
 * unchanged. Identical across all 3 routes today (producer_decisions'
 * route_category_weight_provisional lists the same 10/90 three times) —
 * kept as one shared constant rather than 3 duplicated ones so a future
 * per-route divergence is a single, deliberate code change rather than a
 * silent drift between 3 copies.
 */
export const CARD_ROUTE_WEIGHT_PROVISIONAL = { card: 10, nonCard: 90 } as const;

/**
 * Phase 24.6/27-tunable provisional per-rarity weight, fixed across
 * every floor and every route (producer_decisions' "カード用レアリティ
 * weightは全階層・全routeで同じ固定値を使う"). Only rarities with at
 * least one candidate card are ever included in a live draw — see
 * selectCardRarity below — so this table itself never needs a "this
 * rarity is currently empty" guard.
 */
export const CARD_RARITY_WEIGHT_PROVISIONAL: Readonly<Record<CardRarity, number>> = {
  C: 60,
  B: 30,
  A: 8,
  S: 2,
};

const ALL_RARITIES: readonly CardRarity[] = ['C', 'B', 'A', 'S'];

/** Every CardId whose CardDefinition.rarity is exactly `rarity`, in CARD_IDS_IN_ORDER's fixed display order (deterministic iteration/candidate order — never Object.keys or a Set). */
function cardIdsOfRarity(rarity: CardRarity): CardId[] {
  return CARD_IDS_IN_ORDER.filter((id) => CARD_DEFINITIONS[id].rarity === rarity);
}

/**
 * Whether one generation slot becomes a card at all (producer_decisions'
 * "routeごとにcardとexisting_non_cardを二者択一で抽選する"). Consumes
 * exactly one rng() call. `rng` should be a stream dedicated to this
 * purpose alone (never shared with rarity/body selection or any
 * pre-existing stream) — see each call site.
 */
export function rollIsCardSlot(rng: () => number): boolean {
  const total = CARD_ROUTE_WEIGHT_PROVISIONAL.card + CARD_ROUTE_WEIGHT_PROVISIONAL.nonCard;
  return rng() * total < CARD_ROUTE_WEIGHT_PROVISIONAL.card;
}

/**
 * Draws one rarity, weighted by CARD_RARITY_WEIGHT_PROVISIONAL, among
 * only the rarities that currently have at least one candidate card
 * (producer_decisions' "候補が存在するレアリティだけを抽選対象にする" /
 * "空レアリティを引いて再抽選する方式は使わない" — this is why: an empty
 * rarity is excluded from the weighted draw itself, never drawn and
 * retried). With all 17 cards' current provisional rarity assignment
 * every one of C/B/A/S has at least one member, so this defensive filter
 * is a no-op today but keeps the function correct if a future rarity
 * reassignment ever left one empty. Consumes exactly one rng() call.
 */
export function selectCardRarity(rng: () => number): CardRarity {
  const eligible = ALL_RARITIES.filter((r) => cardIdsOfRarity(r).length > 0);
  const totalWeight = eligible.reduce((sum, r) => sum + CARD_RARITY_WEIGHT_PROVISIONAL[r], 0);
  const roll = rng() * totalWeight;
  let cumulative = 0;
  for (const r of eligible) {
    cumulative += CARD_RARITY_WEIGHT_PROVISIONAL[r];
    if (roll < cumulative) return r;
  }
  // Defensive only — floating-point edge case at roll ~= totalWeight;
  // every real rarity/weight combination above resolves in the loop.
  return eligible[eligible.length - 1];
}

/**
 * Uniform draw among every card of `rarity` (producer_decisions' "選ば
 * れたレアリティ内のカードは均等抽選する"). Consumes exactly one rng()
 * call.
 */
export function selectCardWithinRarity(rarity: CardRarity, rng: () => number): CardId {
  const candidates = cardIdsOfRarity(rarity);
  const index = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
  return candidates[index];
}

/**
 * The full per-slot card resolution: category roll, then (only if the
 * category roll says "card") rarity roll, then body roll — 3
 * independent single-purpose streams, matching producer_decisions'
 * "カードカテゴリ判定、カードレアリティ、本体選択を用途別に分離する".
 * Returns null (consuming only the one categoryRng call) when the slot
 * stays non-card, so callers know to keep whatever the existing
 * non-card process already produced for that slot.
 */
export function resolveCardSlot(
  categoryRng: () => number,
  rarityRng: () => number,
  bodyRng: () => number,
): CardId | null {
  if (!rollIsCardSlot(categoryRng)) return null;
  const rarity = selectCardRarity(rarityRng);
  return selectCardWithinRarity(rarity, bodyRng);
}

/**
 * Applies resolveCardSlot independently to every entry of `itemIds`
 * (already the result of the existing non-card draw, unchanged length
 * and unchanged non-card content) — the shared substitution pass state.ts
 * uses for both normal floor generation and monsterHouse reward, so
 * neither route duplicates this loop. Each slot's category/rarity/body
 * rolls come from the same 3 shared streams, continuing their
 * consumption order across every slot in `itemIds` in array order —
 * mirroring how equipmentDefinitionRng/equipmentCurseRng already
 * continue across both normal generation and the monsterHouse reward
 * loop in state.ts.
 */
export function substituteCardSlots(
  itemIds: ReadonlyArray<ItemId>,
  categoryRng: () => number,
  rarityRng: () => number,
  bodyRng: () => number,
): ItemId[] {
  return itemIds.map((itemId) => resolveCardSlot(categoryRng, rarityRng, bodyRng) ?? itemId);
}
