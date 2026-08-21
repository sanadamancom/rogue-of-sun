import { ItemId } from './types';

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
  /** Absolute floor depth of the current floor. */
  depth: number;
  /** Current run leg. */
  leg: 'descent' | 'ascent';
}

/**
 * `isItemEligibleAtProgress(itemId, context.runDepthTier,
 * context.progress)` — convenience wrapper taking the bundled context
 * object instead of two positional arguments, for call sites that
 * already have an ItemAvailabilityContext on hand (equipment-loot.ts/
 * card-loot.ts/accessory-loot.ts's pre-selection candidate filters).
 */
export function isItemEligibleInContext(itemId: ItemId, context: ItemAvailabilityContext): boolean {
  return isItemEligibleAtDepth(itemId, context.depth, context.leg);
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
  /** Absolute floor depth (1-26) at which this item first becomes eligible. */
  minimumDepth: number;
  /** Optional absolute floor depth above which this item is no longer eligible. */
  maximumDepth?: number;
  /** Optional leg restriction. Absent means eligible on both legs. */
  leg?: 'descent' | 'ascent';
  /** Phase 24.6b2b budget-design classification only — see this file's module doc comment. Has no effect on eligibility or generation in this phase. */
  economyClass: 'power' | 'sustain' | 'structural' | 'not_applicable';
}

/**
 * Ordinal comparison table for RunDepthTier (task's authoritative_model.tier_order).
 * Used only by isRunDepthEligible's `>=` comparison below — never
 * exported as a general-purpose ranking utility beyond that one use.
 */
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
  sword: { minimumDepth: 1, economyClass: 'power' },
  short_sword: { minimumDepth: 1, economyClass: 'power' },
  flamberge: { minimumDepth: 1, economyClass: 'power' },
  magic_sword: { minimumDepth: 1, economyClass: 'power' },
  bushido_blade: { minimumDepth: 1, economyClass: 'power' },
  blood_sword: { minimumDepth: 1, economyClass: 'power' },
  solar_sword: { minimumDepth: 1, economyClass: 'power' },
  dark_sword: { minimumDepth: 1, economyClass: 'power' },
  gram: { minimumDepth: 1, economyClass: 'power' },
  spear: { minimumDepth: 5, economyClass: 'power' },
  glaive: { minimumDepth: 1, economyClass: 'power' },
  corsesca: { minimumDepth: 1, economyClass: 'power' },
  ice_glaive: { minimumDepth: 1, economyClass: 'power' },
  grand_lance: { minimumDepth: 1, economyClass: 'power' },
  blood_spear: { minimumDepth: 1, economyClass: 'power' },
  white_queen: { minimumDepth: 1, economyClass: 'power' },
  black_queen: { minimumDepth: 1, economyClass: 'power' },
  gungnir: { minimumDepth: 1, economyClass: 'power' },
  hammer: { minimumDepth: 9, economyClass: 'power' },
  basic_hammer: { minimumDepth: 1, economyClass: 'power' },
  maul: { minimumDepth: 1, economyClass: 'power' },
  silver_flail: { minimumDepth: 1, economyClass: 'power' },
  battle_axe: { minimumDepth: 1, economyClass: 'power' },
  bloody_mace: { minimumDepth: 1, economyClass: 'power' },
  dawn: { minimumDepth: 1, economyClass: 'power' },
  twilight: { minimumDepth: 1, economyClass: 'power' },
  mjolnir: { minimumDepth: 1, economyClass: 'power' },
  solar_gun: { minimumDepth: 1, economyClass: 'power' },

  // --- armor (15) ---
  armor: { minimumDepth: 1, economyClass: 'power' },
  chain_mail: { minimumDepth: 1, economyClass: 'power' },
  plate_mail: { minimumDepth: 1, economyClass: 'power' },
  samurai_armor: { minimumDepth: 1, economyClass: 'power' },
  mail_of_sol: { minimumDepth: 1, economyClass: 'power' },
  mail_of_dark: { minimumDepth: 1, economyClass: 'power' },
  dragon_scale: { minimumDepth: 1, economyClass: 'power' },
  magic_robe: { minimumDepth: 1, economyClass: 'power' },
  skull_suit: { minimumDepth: 1, economyClass: 'power' },
  poison_guard: { minimumDepth: 1, economyClass: 'power' },
  ninja_suit: { minimumDepth: 1, economyClass: 'power' },
  // light_garb/dark_garb/spike_mail: Phase 24.6c4d connects these to the
  // normal armor loot route in equipment-loot.ts, gated to the eligibility
  // window below. black_armor still has no production route; its event route
  // remains deferred to Phase 24.7, so its metadata is still inert today.
  light_garb: { minimumDepth: 19, maximumDepth: 26, leg: 'descent', economyClass: 'power' },
  dark_garb: { minimumDepth: 19, maximumDepth: 26, leg: 'descent', economyClass: 'power' },
  spike_mail: { minimumDepth: 19, maximumDepth: 26, leg: 'descent', economyClass: 'power' },
  black_armor: { minimumDepth: 19, maximumDepth: 25, leg: 'descent', economyClass: 'power' },

  // --- accessories (6) ---
  hot_blooded_headband: { minimumDepth: 1, economyClass: 'power' },
  earth_guard: { minimumDepth: 1, economyClass: 'power' },
  buckler: { minimumDepth: 1, economyClass: 'power' },
  adventurer_boots: { minimumDepth: 1, economyClass: 'power' },
  circlet: { minimumDepth: 1, economyClass: 'power' },
  grigri_glasses: { minimumDepth: 1, economyClass: 'power' },

  // --- cards (17) — all short/0; card-loot.ts's own fixed rarity weight is unchanged ---
  high_priestess: { minimumDepth: 1, economyClass: 'power' },
  empress: { minimumDepth: 1, economyClass: 'power' },
  emperor: { minimumDepth: 1, economyClass: 'power' },
  lovers: { minimumDepth: 1, economyClass: 'power' },
  chariot: { minimumDepth: 1, economyClass: 'power' },
  strength: { minimumDepth: 1, economyClass: 'power' },
  wheel_of_fortune: { minimumDepth: 1, economyClass: 'power' },
  justice: { minimumDepth: 1, economyClass: 'power' },
  hanged_man: { minimumDepth: 1, economyClass: 'power' },
  death: { minimumDepth: 1, economyClass: 'power' },
  temperance: { minimumDepth: 1, economyClass: 'power' },
  devil: { minimumDepth: 1, economyClass: 'power' },
  tower: { minimumDepth: 1, economyClass: 'power' },
  star: { minimumDepth: 1, economyClass: 'power' },
  moon: { minimumDepth: 1, economyClass: 'power' },
  sun: { minimumDepth: 1, economyClass: 'power' },
  judgement: { minimumDepth: 1, economyClass: 'power' },

  // --- consumables/enchantments (12) ---
  apple: { minimumDepth: 1, economyClass: 'sustain' },
  sun_fruit: { minimumDepth: 1, economyClass: 'sustain' },
  chocolate: { minimumDepth: 1, economyClass: 'sustain' },
  banana: { minimumDepth: 1, economyClass: 'sustain' },
  antidote: { minimumDepth: 1, economyClass: 'sustain' },
  panacea: { minimumDepth: 1, economyClass: 'sustain' },
  clairvoyance_fruit: { minimumDepth: 1, economyClass: 'structural' },
  sol_enchantment: { minimumDepth: 1, economyClass: 'power' },
  flame_enchantment: { minimumDepth: 1, economyClass: 'power' },
  frost_enchantment: { minimumDepth: 9, economyClass: 'power' },
  cloud_enchantment: { minimumDepth: 9, economyClass: 'power' },
  earth_enchantment: { minimumDepth: 18, economyClass: 'power' },
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
  if (!Number.isInteger(availability.minimumDepth) || availability.minimumDepth < 1 || availability.minimumDepth > 26) {
    throw new RangeError(`ITEM_AVAILABILITY.${itemId}.minimumDepth must be an integer within [1, 26], got ${availability.minimumDepth}`);
  }
  if (availability.maximumDepth !== undefined && (!Number.isInteger(availability.maximumDepth) || availability.maximumDepth < availability.minimumDepth || availability.maximumDepth > 26)) {
    throw new RangeError(`ITEM_AVAILABILITY.${itemId}.maximumDepth must be an integer within [minimumDepth, 26], got ${availability.maximumDepth}`);
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
export function isItemEligibleAtDepth(itemId: ItemId, depth: number, leg: 'descent' | 'ascent'): boolean {
  const availability = getItemAvailability(itemId);
  return depth >= availability.minimumDepth
    && (availability.maximumDepth === undefined || depth <= availability.maximumDepth)
    && (availability.leg === undefined || availability.leg === leg);
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
export function filterEligibleItemIds(ids: ReadonlyArray<ItemId>, depth: number, leg: 'descent' | 'ascent'): ItemId[] {
  return ids.filter((id) => isItemEligibleAtDepth(id, depth, leg));
}
