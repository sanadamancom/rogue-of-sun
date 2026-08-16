import { ACCESSORY_DEFINITIONS, ACCESSORY_IDS_IN_ORDER } from './accessory-def';
import { CardId, ItemId } from './types';
import { selectCardRarity, selectCardWithinRarity } from './card-loot';
import { ItemAvailabilityContext, isItemEligibleInContext } from './item-availability';

/**
 * Phase 24.5c: the single source of truth for the "does this generation
 * slot become a card, an accessory, or stay whatever the existing
 * non-card process already produced" decision, shared by all 3
 * production loot routes (normal floor generation, monsterHouse reward,
 * enemy-drop's post-success item selection — see state.ts and
 * turn.ts/enemy-drop.ts, the only callers).
 *
 * This module extends, rather than replaces, Phase 24.4c's card-loot.ts
 * design: card's own route weight (10), rarity table, and per-rarity
 * candidate selection (resolveCardSlot, selectCardRarity,
 * selectCardWithinRarity — all in card-loot.ts) are reused completely
 * unchanged. What this module adds is the accessory side of the same
 * 3-way choice — accessory's own route weight (10, carved out of the
 * old 90% non-card space per producer_decisions' "accessory 10%は旧
 * non-card 90%から分離"), its own C/B/A/S rank table (mirroring
 * card-loot.ts's rarity table exactly, minus R — accessory never
 * generates at R), and the combined 3-way category roll
 * (rollLootCategory) that both card and accessory substitution now
 * share — a single rng() call per slot, exactly as the pre-24.5c
 * card-vs-noncard roll already was (producer_decisions' "1回の既存
 * route rollを3分岐へ拡張し、抽選回数を増やさない").
 */

/**
 * Phase 24.6-tunable provisional 3-way route weight, shared by all 3
 * routes (producer_decisions' "3経路で同じroute weightを中央集約して
 * 使う"). card:10 is numerically identical to card-loot.ts's own
 * CARD_ROUTE_WEIGHT_PROVISIONAL.card (10/100 either way — see
 * rollLootCategory's doc comment for why this keeps card's production
 * rate exactly unchanged from before this Phase). accessory:10 is the
 * newly-carved-out slice of the old nonCard:90 space; existingNonCard:80
 * is what remains for the pre-existing non-card draw.
 */
export const LOOT_ROUTE_WEIGHT_PROVISIONAL = { card: 10, accessory: 10, existingNonCard: 80 } as const;

export type LootCategory = 'card' | 'accessory' | 'non_card';

/**
 * The single combined category roll for one generation slot — replaces
 * card-loot.ts's rollIsCardSlot at every one of this module's 3 call
 * sites (card-loot.ts's own rollIsCardSlot/resolveCardSlot/
 * substituteCardSlots remain untouched and still separately unit-tested
 * — see docs/history/phase-24-5c-accessory-generation.md's "既存テスト
 * 変更" section for why no existing card-loot test needed updating).
 * Consumes exactly one rng() call, matching the pre-24.5c single-roll
 * contract. Because card occupies the same [0, 10) slice of the [0, 100)
 * range it always did, a given rng() draw resolves to 'card' under this
 * function if and only if the same draw would have resolved
 * rollIsCardSlot(rng) to true under the old 2-way roll — card's
 * production-observed rate is therefore unchanged by this Phase.
 */
export function rollLootCategory(rng: () => number): LootCategory {
  const total = LOOT_ROUTE_WEIGHT_PROVISIONAL.card + LOOT_ROUTE_WEIGHT_PROVISIONAL.accessory + LOOT_ROUTE_WEIGHT_PROVISIONAL.existingNonCard;
  const roll = rng() * total;
  if (roll < LOOT_ROUTE_WEIGHT_PROVISIONAL.card) return 'card';
  if (roll < LOOT_ROUTE_WEIGHT_PROVISIONAL.card + LOOT_ROUTE_WEIGHT_PROVISIONAL.accessory) return 'accessory';
  return 'non_card';
}

/**
 * Phase 24.6-tunable provisional per-rank weight for accessory
 * generation, fixed across every floor and every route — mirrors
 * card-loot.ts's CARD_RARITY_WEIGHT_PROVISIONAL exactly (same C60/B30/
 * A8/S2 values, per this Phase's rarity_contract). R is never a key
 * here — accessory generation never produces an R-rank individual
 * (rarity_contract's "Rは存在しない").
 */
export const ACCESSORY_RANK_WEIGHT_PROVISIONAL: Readonly<Record<'C' | 'B' | 'A' | 'S', number>> = {
  C: 60,
  B: 30,
  A: 8,
  S: 2,
};

const ALL_ACCESSORY_RANKS: readonly ('C' | 'B' | 'A' | 'S')[] = ['C', 'B', 'A', 'S'];

/** Every AccessoryId whose ACCESSORY_DEFINITIONS rank is exactly `rank`, in ACCESSORY_IDS_IN_ORDER's fixed order (deterministic — never Object.keys/Set iteration). */
function accessoryIdsOfRank(rank: 'C' | 'B' | 'A' | 'S'): (typeof ACCESSORY_IDS_IN_ORDER)[number][] {
  return ACCESSORY_IDS_IN_ORDER.filter((id) => ACCESSORY_DEFINITIONS[id].rank === rank);
}

/**
 * Phase 24.6b2a1: every AccessoryId of `rank` that is ALSO eligible
 * under `context` -- the pre-selection candidate filter this Phase
 * replaces post-selection rejection with (same pattern as card-loot.ts's
 * eligibleCardIdsOfRarity). With every current accessory at
 * minimumRunDepth:'short'/unlockProgress:0, this returns exactly
 * `accessoryIdsOfRank(rank)` unchanged for any real context.
 */
function eligibleAccessoryIdsOfRank(rank: 'C' | 'B' | 'A' | 'S', context: ItemAvailabilityContext): (typeof ACCESSORY_IDS_IN_ORDER)[number][] {
  return accessoryIdsOfRank(rank).filter((id) => isItemEligibleInContext(id, context));
}

/**
 * Draws one rank, weighted by ACCESSORY_RANK_WEIGHT_PROVISIONAL, among
 * only the ranks that have at least one ELIGIBLE candidate accessory
 * under `context` (Phase 24.6b2a1: pre-selection filtering -- mirrors
 * card-loot.ts's selectCardRarity exactly). The existing C60/B30/A8/S2
 * weights are automatically renormalized across only the eligible
 * ranks. With the 6 initial species covering all of C/B/A/S and every
 * one at short/0, this is a no-op today. Consumes exactly one rng()
 * call.
 */
export function selectAccessoryRank(rng: () => number, context: ItemAvailabilityContext): 'C' | 'B' | 'A' | 'S' {
  const eligible = ALL_ACCESSORY_RANKS.filter((r) => eligibleAccessoryIdsOfRank(r, context).length > 0);
  const totalWeight = eligible.reduce((sum, r) => sum + ACCESSORY_RANK_WEIGHT_PROVISIONAL[r], 0);
  const roll = rng() * totalWeight;
  let cumulative = 0;
  for (const r of eligible) {
    cumulative += ACCESSORY_RANK_WEIGHT_PROVISIONAL[r];
    if (roll < cumulative) return r;
  }
  // Defensive only -- floating-point edge case at roll ~= totalWeight;
  // every real rank/weight combination above resolves in the loop.
  return eligible[eligible.length - 1];
}

/**
 * Uniform draw among every ELIGIBLE accessory of `rank` under `context`
 * (Phase 24.6b2a1: pre-selection filtering, mirrors card-loot.ts's
 * selectCardWithinRarity exactly). Consumes exactly one rng() call.
 * Caller must only pass a `rank` selectAccessoryRank(..., context)
 * itself returned for the same `context`.
 */
export function selectAccessoryWithinRank(rank: 'C' | 'B' | 'A' | 'S', rng: () => number, context: ItemAvailabilityContext): (typeof ACCESSORY_IDS_IN_ORDER)[number] {
  const candidates = eligibleAccessoryIdsOfRank(rank, context);
  if (candidates.length === 0) {
    // Phase 24.6b2a1: reachable only if a caller passes a `rank` that
    // isn't what selectAccessoryRank(..., context) would have returned
    // for the same context -- a caller bug, not a normal run condition.
    // Never a random fallback or ineligible-accessory revival.
    throw new Error(
      `selectAccessoryWithinRank: no eligible accessory of rank '${rank}' for the given context -- caller must pass a rank selectAccessoryRank returned for the same context.`,
    );
  }
  const index = Math.min(candidates.length - 1, Math.floor(rng() * candidates.length));
  return candidates[index];
}

/**
 * The full per-slot accessory resolution (rank roll, then body roll) --
 * called only when rollLootCategory has already resolved to 'accessory'
 * for this slot (the caller-shared category roll lives in
 * resolveLootSlot below, never re-rolled here). Consumes exactly 2 rng()
 * calls.
 */
function resolveAccessorySlot(rankRng: () => number, itemRng: () => number, context: ItemAvailabilityContext): (typeof ACCESSORY_IDS_IN_ORDER)[number] {
  const rank = selectAccessoryRank(rankRng, context);
  return selectAccessoryWithinRank(rank, itemRng, context);
}

export type LootSlotResolution =
  | { category: 'card'; id: CardId }
  | { category: 'accessory'; id: (typeof ACCESSORY_IDS_IN_ORDER)[number] }
  | { category: 'non_card' };

/**
 * The full per-slot loot resolution shared by all 3 production routes:
 * one shared category roll (categoryRng, exactly one rng() call,
 * replacing card-loot.ts's old rollIsCardSlot at every call site -- see
 * rollLootCategory's doc comment), then -- depending on which of the 3
 * categories that single roll picked -- either card-loot.ts's existing
 * rarity+body draw (cardRarityRng/cardBodyRng, unchanged from Phase
 * 24.4c), this module's own rank+item draw (accessoryRankRng/
 * accessoryItemRng, new Phase 24.5c), or nothing at all (categoryRng's
 * one call is the only RNG consumed for a 'non_card' slot, exactly like
 * the old rollIsCardSlot-false case). Every stream is independent and
 * purpose-specific (rng_requirements' "route/rarity/item用途間でsaltを
 * 共有しない") -- see state.ts/enemy-drop.ts's call sites for each
 * stream's own salt derivation.
 *
 * Phase 24.6b2a1: `context` is required (no implicit default) and is
 * threaded straight into selectCardRarity/selectCardWithinRarity/
 * resolveAccessorySlot -- eligibility is now enforced as a
 * PRE-selection candidate filter inside those functions (an ineligible
 * rarity/rank or ineligible individual card/accessory is excluded from
 * the weighted draw itself, with its share of that rarity/rank's weight
 * automatically redistributed across the remaining eligible members),
 * never as a post-selection rejection here. The category roll itself
 * (rollLootCategory's card10/accessory10/nonCard80 weights) is
 * completely unaffected by eligibility -- once the roll picks 'card' or
 * 'accessory', a concrete eligible id is always returned for that
 * category (never silently downgraded to 'non_card' after the fact),
 * per this Phase's authoritative_contract: "eligibilityは抽選結果の棄却
 * ではなく、抽選前candidate poolの制限" / "route weight
 * card10/accessory10/nonCard80はeligibility変更後も維持". With every
 * current card/accessory at short/0, every rarity/rank always has >=1
 * eligible member, so this Phase's behavior is a no-op relative to
 * 24.6b2a for every currently-registered id.
 */
export function resolveLootSlot(
  categoryRng: () => number,
  cardRarityRng: () => number,
  cardBodyRng: () => number,
  accessoryRankRng: () => number,
  accessoryItemRng: () => number,
  context: ItemAvailabilityContext,
): LootSlotResolution {
  const category = rollLootCategory(categoryRng);
  if (category === 'card') {
    // card-loot.ts's own rarity/body pieces (selectCardRarity/
    // selectCardWithinRarity) are called directly here -- never
    // resolveCardSlot/rollIsCardSlot, which would perform a second,
    // redundant category roll on top of rollLootCategory's own roll
    // above. This still reuses card-loot.ts's exact rarity table and
    // per-rarity candidate selection verbatim (no duplicated logic),
    // just without re-deciding "is this a card" a second time. Both
    // functions apply `context`'s eligibility filter internally before
    // their own weighted roll, so the returned cardId is always
    // eligible.
    const rarity = selectCardRarity(cardRarityRng, context);
    const cardId = selectCardWithinRarity(rarity, cardBodyRng, context);
    return { category: 'card', id: cardId };
  }
  if (category === 'accessory') {
    const accessoryId = resolveAccessorySlot(accessoryRankRng, accessoryItemRng, context);
    return { category: 'accessory', id: accessoryId };
  }
  return { category: 'non_card' };
}

/**
 * Applies resolveLootSlot independently to every entry of `itemIds`
 * (already the result of the existing non-card draw, unchanged length
 * and unchanged non-card content for every slot that stays non_card) --
 * the shared 3-way substitution pass state.ts uses for both normal
 * floor generation and monsterHouse reward, replacing Phase 24.4c's
 * substituteCardSlots at those call sites (card-loot.ts's own
 * substituteCardSlots function itself remains unchanged and untouched,
 * for its own standalone unit tests). Each slot's streams continue their
 * consumption order across every slot in `itemIds` in array order --
 * mirroring how equipmentDefinitionRng/equipmentCurseRng and card-loot's
 * own 3 streams already continue across both normal generation and the
 * monsterHouse reward loop in state.ts.
 */
export function substituteLootSlots(
  itemIds: ReadonlyArray<ItemId>,
  categoryRng: () => number,
  cardRarityRng: () => number,
  cardBodyRng: () => number,
  accessoryRankRng: () => number,
  accessoryItemRng: () => number,
  context: ItemAvailabilityContext,
): ItemId[] {
  return itemIds.map((itemId) => {
    const resolved = resolveLootSlot(categoryRng, cardRarityRng, cardBodyRng, accessoryRankRng, accessoryItemRng, context);
    return resolved.category === 'non_card' ? itemId : resolved.id;
  });
}
