import { ItemId, RunDepthTier } from './types';

/**
 * Phase 24.6b2a1: the required (runDepthTier, progress) pair every
 * run-aware production API that needs eligibility now takes explicitly
 * — no implicit default (3/'short'/'deep'/1) exists anywhere in
 * production after this Phase, per the task's "黙示defaultを削除"
 * requirement. Callers always derive this from the actual GameState
 * (`state.runDepthTier`, `floorProgressRatio(state.floor,
 * state.totalFloors)`) or, during floor construction itself, from the
 * `RunConfig` in scope.
 */
export interface ItemAvailabilityContext {
  runDepthTier: RunDepthTier;
  progress: number;
}

/**
 * `isItemEligibleAtProgress(itemId, context.runDepthTier,
 * context.progress)` — convenience wrapper taking the bundled context
 * object instead of two positional arguments, for call sites that
 * already have an ItemAvailabilityContext on hand (equipment-loot.ts/
 * card-loot.ts/accessory-loot.ts's pre-selection candidate filters).
 */
export function isItemEligibleInContext(itemId: ItemId, context: ItemAvailabilityContext): boolean {
  return isItemEligibleAtProgress(itemId, context.runDepthTier, context.progress);
}

/**
 * Phase 24.6b2a: the coarse candidate-pool and depth-progress gate every
 * ItemId is registered under (docs/history/phase-24-6b0-depth-tier-budget-audit.md's
 * availability_model, now implemented). `minimumRunDepth` gates on the
 * run's overall tier (RunDepthTier); `unlockProgress` gates on
 * `floorProgressRatio(floor, totalFloors)` within that run — see
 * isItemEligibleAtProgress below for the combined test. `economyClass`
 * is Phase 24.6b2b's budget-design metadata only (power/sustain/
 * structural/not_applicable, per the 24.6b0 matrix) — reading it has no
 * runtime effect in this phase; see this module's own doc comment on
 * ECONOMY_CLASS_HAS_NO_RUNTIME_EFFECT below.
 */
export interface ItemAvailability {
  /** The minimum RunDepthTier a run must have for this item to ever be eligible, regardless of progress. */
  minimumRunDepth: RunDepthTier;
  /** The minimum floorProgressRatio(floor, totalFloors) within an eligible-tier run at which this item becomes eligible. Must be finite and in [0, 1]. */
  unlockProgress: number;
  /** Phase 24.6b2b budget-design classification only — see this file's module doc comment. Has no effect on eligibility or generation in this phase. */
  economyClass: 'power' | 'sustain' | 'structural' | 'not_applicable';
}

/**
 * Ordinal comparison table for RunDepthTier (task's authoritative_model.tier_order).
 * Used only by isRunDepthEligible's `>=` comparison below — never
 * exported as a general-purpose ranking utility beyond that one use.
 */
const TIER_ORDER: Readonly<Record<RunDepthTier, number>> = {
  short: 0,
  standard: 1,
  deep: 2,
};

/**
 * Phase 24.6b2a registry: every one of the 78 ItemIds this game
 * currently defines (item-def.ts's ITEM_DEFINITIONS/ITEM_IDS_IN_ORDER),
 * each with exactly one ItemAvailability entry. Typed as
 * `Record<ItemId, ItemAvailability>` rather than a partial map so that a
 * missing, duplicate, or unknown-id entry is a *compile-time* TypeScript
 * error (missing key -> "Property '...' is missing"; duplicate object
 * literal key -> "An object literal cannot have multiple properties
 * with the same name"; extra key not in the ItemId union -> "Object
 * literal may only specify known properties") — no separate runtime
 * completeness check is needed for those three invariants.
 *
 * Phase 24.6b0's audit ("方式A") and this Phase's own out-of-scope list
 * mean every one of the 78 entries below has `minimumRunDepth: 'short'`
 * — no item is standard/deep-only yet. `unlockProgress` is 0 for every
 * item except the 5 overrides below (initial_policy), which replace the
 * pre-24.6b2a floor2/floor3 hardcoded staging
 * (GROUND_ITEM_POOL_FLOOR_2_ADDITIONS/_FLOOR_3_ADDITIONS in item-def.ts)
 * with the equivalent progress thresholds: floor 2 of 3 is
 * floorProgressRatio(2, 3) = 2/3, and floor 3 of 3 (the old ">= 3" tier)
 * is floorProgressRatio(3, 3) = 1.
 *
 * `spear`/`hammer` here are the *ground-item-pool slot* ids (see
 * equipment-loot.ts's NormalEquipmentSlot) — the only two of the 28
 * weapon ItemIds that were ever floor-staged in the first place. Every
 * other individual weapon species (short_sword, glaive, basic_hammer,
 * flamberge, ... ) is resolved *after* a slot is drawn, purely by
 * equipment-loot.ts's existing rank-weight curve (never floor-staged,
 * never gated by this registry beyond the blanket
 * minimumRunDepth:'short'/unlockProgress:0 every non-overridden item
 * gets) — per this Phase's initial_policy note "spear/hammerの上位
 * definitionは既存rank抽選を維持し、追加progress gateを付けない". The
 * same reasoning applies to every card/accessory rarity/rank tier: this
 * registry never re-implements or gates card-loot.ts's/
 * accessory-loot.ts's own rarity/rank weight tables.
 */
export const ITEM_AVAILABILITY: Readonly<Record<ItemId, ItemAvailability>> = {
  // --- weapons (28) — all short/0 except the 'spear'/'hammer' pool slots ---
  sword: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  short_sword: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  flamberge: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  magic_sword: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  bushido_blade: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  blood_sword: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  solar_sword: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  dark_sword: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  gram: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  spear: { minimumRunDepth: 'short', unlockProgress: 2 / 3, economyClass: 'power' },
  glaive: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  corsesca: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  ice_glaive: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  grand_lance: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  blood_spear: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  white_queen: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  black_queen: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  gungnir: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  hammer: { minimumRunDepth: 'short', unlockProgress: 2 / 3, economyClass: 'power' },
  basic_hammer: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  maul: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  silver_flail: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  battle_axe: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  bloody_mace: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  dawn: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  twilight: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  mjolnir: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  solar_gun: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },

  // --- armor (15) ---
  armor: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  chain_mail: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  plate_mail: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  samurai_armor: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  mail_of_sol: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  mail_of_dark: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  dragon_scale: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  magic_robe: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  skull_suit: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  poison_guard: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  ninja_suit: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  // light_garb/dark_garb/spike_mail/black_armor: no production route reaches
  // these today (24.6b0 audit's NEEDS_DESIGN_DECISION) — metadata only,
  // per this Phase's explicit "route不存在のS/R armorもmetadataだけ保持
  // し、新routeを作らない" instruction. minimumRunDepth:'short' here is
  // inert (there is no route to gate) and is not a claim these are
  // reachable.
  light_garb: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  dark_garb: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  spike_mail: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  black_armor: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },

  // --- accessories (6) ---
  hot_blooded_headband: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  earth_guard: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  buckler: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  adventurer_boots: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  circlet: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  grigri_glasses: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },

  // --- cards (17) — all short/0; card-loot.ts's own fixed rarity weight is unchanged ---
  high_priestess: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  empress: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  emperor: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  lovers: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  chariot: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  strength: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  wheel_of_fortune: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  justice: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  hanged_man: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  death: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  temperance: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  devil: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  tower: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  star: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  moon: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  sun: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  judgement: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },

  // --- consumables/enchantments (12) ---
  apple: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'sustain' },
  sun_fruit: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'sustain' },
  chocolate: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'sustain' },
  banana: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'sustain' },
  antidote: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'sustain' },
  panacea: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'sustain' },
  clairvoyance_fruit: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'structural' },
  sol_enchantment: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  flame_enchantment: { minimumRunDepth: 'short', unlockProgress: 0, economyClass: 'power' },
  frost_enchantment: { minimumRunDepth: 'short', unlockProgress: 2 / 3, economyClass: 'power' },
  cloud_enchantment: { minimumRunDepth: 'short', unlockProgress: 2 / 3, economyClass: 'power' },
  earth_enchantment: { minimumRunDepth: 'short', unlockProgress: 1, economyClass: 'power' },
};

/**
 * Every `unlockProgress` above is validated to be finite and within
 * [0, 1] at module load time (task's `validation` requirement) — a
 * malformed entry throws immediately on import rather than silently
 * producing wrong eligibility results later. `minimumRunDepth` is
 * validated to be one of the 3 known RunDepthTier values ("未知tierを
 * 黙って許容しない") — TIER_ORDER's own Record type already makes an
 * unknown string a TypeScript compile error for any literal in the
 * registry above, so this loop is a defensive runtime backstop (e.g.
 * against a future non-literal/computed entry) rather than the primary
 * enforcement mechanism.
 */
for (const [itemId, availability] of Object.entries(ITEM_AVAILABILITY)) {
  if (!Number.isFinite(availability.unlockProgress) || availability.unlockProgress < 0 || availability.unlockProgress > 1) {
    throw new RangeError(`ITEM_AVAILABILITY.${itemId}.unlockProgress must be finite and within [0, 1], got ${availability.unlockProgress}`);
  }
  if (!(availability.minimumRunDepth in TIER_ORDER)) {
    throw new RangeError(`ITEM_AVAILABILITY.${itemId}.minimumRunDepth is not a known RunDepthTier, got ${availability.minimumRunDepth}`);
  }
}

/** Looks up `itemId`'s registered ItemAvailability. Every ItemId has exactly one entry (see ITEM_AVAILABILITY's own doc comment on why this can never be undefined for a real ItemId). */
export function getItemAvailability(itemId: ItemId): ItemAvailability {
  return ITEM_AVAILABILITY[itemId];
}

/**
 * `TIER_ORDER[runDepthTier] >= TIER_ORDER[minimumRunDepth]` (task's
 * authoritative_model.eligibility, tier half). Pure, no RNG.
 */
export function isRunDepthEligible(runDepthTier: RunDepthTier, minimumRunDepth: RunDepthTier): boolean {
  return TIER_ORDER[runDepthTier] >= TIER_ORDER[minimumRunDepth];
}

/**
 * The full combined eligibility test (task's authoritative_model.eligibility):
 * `itemId`'s registered tier is reachable from `runDepthTier` AND
 * `progress` has reached `itemId`'s registered unlockProgress. No
 * `maximumProgress` exists (deliberately, per 24.6b0's audit — nothing
 * ever becomes ineligible again at higher progress). Pure, no RNG —
 * consumes nothing from any stream.
 */
export function isItemEligibleAtProgress(itemId: ItemId, runDepthTier: RunDepthTier, progress: number): boolean {
  const availability = getItemAvailability(itemId);
  return isRunDepthEligible(runDepthTier, availability.minimumRunDepth) && progress >= availability.unlockProgress;
}

/**
 * Filters `ids` down to only the eligible ones, preserving `ids`' own
 * relative order (never re-sorted, never deduplicated beyond whatever
 * `ids` itself already was) — every one of this Phase's 3 production
 * routes (normal floor, monsterHouse reward, enemy drop) and the Star
 * transform candidate list depend on this order preservation to keep
 * their own existing candidate-array ordering contracts unchanged. Pure,
 * no RNG.
 */
export function filterEligibleItemIds(ids: ReadonlyArray<ItemId>, runDepthTier: RunDepthTier, progress: number): ItemId[] {
  return ids.filter((id) => isItemEligibleAtProgress(id, runDepthTier, progress));
}
