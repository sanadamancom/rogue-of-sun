import { ItemId, Inventory } from './types';
import { ELEMENT_DISPLAY_NAMES, ELEMENT_GLYPHS } from './element-def';

/**
 * A single item species' shared display/inventory data (Phase 08.2
 * inventory foundation; Phase 08.3 adds the 'weapon' category; Phase 08.4
 * adds the 'armor' category; Phase 08.7 adds a third weapon, 'hammer').
 * `healAmount` only applies to consumable healing items (currently just
 * 'apple'); weapon-specific combat stats live in weapon-def.ts's
 * WEAPON_DEFINITIONS and armor-specific defensive stats live in
 * armor-def.ts's ARMOR_DEFINITIONS, both keyed by the same id, rather
 * than being duplicated here.
 */
export interface ItemDefinition {
  id: ItemId;
  displayName: string;
  /** Sprite/emoji glyph used by the loader/renderer for this item. Phase 08.2/08.3/08.4/08.5/08.7 use plain emoji glyphs in place of processed sprite assets (user-approved substitution; see docs/history/phase-08-2-inventory-and-apple-healing.md, phase-08-3-weapon-equipment-and-sword.md, phase-08-4-armor-defense-and-floor2-golem.md, phase-08-5-spear-reach-weapon.md, and phase-08-7-hammer-knockback-weapon.md). */
  glyph: string;
  category: 'consumable' | 'weapon' | 'armor';
  /** Whether using this item removes one from the inventory (true for apple, false for sword/spear/hammer/armor — equipping never consumes any of them). */
  consumable: boolean;
  /** Whether multiple copies stack into one inventory count (true for apple; false for sword/spear/hammer/armor — these are never placed more than once per relevant floor, and equipment isn't stacked). */
  stackable: boolean;
  /** HP restored by one use, before clamping to the player's maxHp. Only meaningful for consumable healing items. */
  healAmount?: number;
  /** Solar energy restored by one use, before clamping to maxSolarEnergy. Only meaningful for sun_fruit (Phase 09.1). */
  solarAmount?: number;
  /** Hunger restored by one use, before clamping to HUNGER_MAX (Phase 11.3 hunger.ts). Only meaningful for chocolate. */
  hungerAmount?: number;
}

// Single source of truth for every registered item's name, glyph, and
// inventory-display behavior. Phase 08.2 registered only 'apple'; Phase
// 08.3 added 'sword'; Phase 08.4 added 'armor'; Phase 08.5 added 'spear';
// Phase 08.7 adds 'hammer'. Future items (sun fruit, sun gun) are
// expected to extend this table rather than add parallel ad-hoc fields
// elsewhere.
export const ITEM_DEFINITIONS: Record<ItemId, ItemDefinition> = {
  apple: {
    id: 'apple',
    displayName: 'リンゴ',
    glyph: '🍎',
    category: 'consumable',
    consumable: true,
    stackable: true,
    // Phase 15.2 recovery/satiety/status rebalance: 20->5 (see
    // docs/history/phase-15-2-recovery-satiety-status-rebalance.md),
    // matching the Phase 15 balance draft's low-integer LIFE scale (LIFE
    // 15 basis, apple recovers 1/3 of max LIFE).
    healAmount: 5,
  },
  sword: {
    id: 'sword',
    displayName: 'グラディウス',
    glyph: '🗡️',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  armor: {
    id: 'armor',
    displayName: 'クロスアーマー',
    glyph: '🛡️',
    category: 'armor',
    consumable: false,
    stackable: false,
  },
  spear: {
    id: 'spear',
    displayName: 'ショートスピア',
    glyph: '🔱',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  hammer: {
    id: 'hammer',
    displayName: 'クラブ',
    glyph: '🔨',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  sun_fruit: {
    id: 'sun_fruit',
    displayName: '太陽の実',
    // Phase 09.1: no processed sprite asset yet; 🍋 substituted per
    // user instruction, distinct from apple's 🍎.
    glyph: '🍋',
    category: 'consumable',
    consumable: true,
    stackable: true,
    // Phase 15.3 recovery-scale rebalance: 2->5 (see docs/history/
    // phase-15-3-sol-element-ability-rebalance.md), matching max SOL 15.
    solarAmount: 5,
  },
  solar_gun: {
    id: 'solar_gun',
    displayName: '太陽銃',
    glyph: '🔫',
    category: 'weapon',
    consumable: false,
    stackable: false,
  },
  // Sol enchantment (Phase 10.1): a one-time unlock pickup, not a stacked
  // inventory item. Deliberately excluded from ITEM_IDS_IN_ORDER (below) so
  // it never appears in the general inventory overlay or gets counted via
  // the generic inventory[itemId]++ auto-pickup path — turn.ts's move
  // handler special-cases this id and sets GameState.solUnlocked directly
  // instead. category/consumable/stackable are unused for this id but kept
  // populated to satisfy ItemDefinition/Record<ItemId, ...> completeness.
  sol_enchantment: {
    id: 'sol_enchantment',
    displayName: 'ソル',
    glyph: '🔆',
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
  // Chocolate (Phase 11.3 hunger foundation): restores hunger, never
  // HP/SOL. Reuses the existing 'consumable' category (same UI/inventory
  // mechanism as apple/sun_fruit — category is a display grouping, not a
  // per-effect type; the effect itself is distinguished by which of
  // healAmount/solarAmount/hungerAmount is set) rather than introducing a
  // new 'food' ItemDefinition category, since nothing else needs one.
  chocolate: {
    id: 'chocolate',
    displayName: 'チョコレート',
    // Phase 11.3: no processed sprite asset yet; a plain emoji glyph is
    // used, following the same substitution precedent as sun_fruit/apple
    // (see item-def.ts's `glyph` doc comment) rather than introducing any
    // new asset-loading mechanism.
    glyph: '🍫',
    category: 'consumable',
    consumable: true,
    stackable: true,
    hungerAmount: 30,
  },
  // Banana (Phase 12.1 temporary-effect foundation): grants/refreshes the
  // 'attack_up' status effect (see effects.ts's EFFECT_DEFINITIONS) rather
  // than restoring HP/SOL/hunger directly, so it has none of
  // healAmount/solarAmount/hungerAmount set — turn.ts's applyItemUse
  // special-cases itemId === 'banana' explicitly (mirroring how chocolate
  // is special-cased via hungerAmount) rather than adding a fourth
  // ItemDefinition amount field for a single-use effect grant.
  banana: {
    id: 'banana',
    displayName: 'バナナ',
    // Phase 12.1: no processed sprite asset yet; a plain emoji glyph is
    // used, following the same substitution precedent as sun_fruit/
    // chocolate (see this file's `glyph` doc comment) rather than
    // introducing any new asset-loading mechanism, per user instruction.
    glyph: '🍌',
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  // Antidote (Phase 12.4 status-ailment removal foundation): removes
  // only the 'poison' status ailment, never HP/SOL/hunger or any other
  // effect — it has none of healAmount/solarAmount/hungerAmount set.
  // turn.ts's applyItemUse special-cases itemId === 'antidote' (mirroring
  // banana/chocolate). displayName/glyph corrected per user instruction:
  // the item is "毒消し" (not "毒消し草"), sharing the provisional 💊
  // glyph with panacea below — the two are distinguished by displayName
  // wherever both might appear (ground glyphs render identically, but
  // the inventory overlay and any hover/label always shows displayName).
  antidote: {
    id: 'antidote',
    displayName: '毒消し',
    glyph: '💊',
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  // Panacea (Phase 12.4 status-ailment removal foundation): cures every
  // currently-implemented status ailment at once (poison, movement_slow,
  // spider_web, petrification — see effects.ts's STATUS_AILMENT_IDS),
  // never attack_up (a beneficial effect, not an ailment) and never HP/
  // SOL/hunger. turn.ts's applyItemUse special-cases itemId === 'panacea'
  // exactly like antidote. Shares antidote's provisional 💊 glyph per
  // user instruction (both are placeholder icons pending real sprite
  // assets); displayName is the only reliable visual distinguisher.
  panacea: {
    id: 'panacea',
    displayName: '万能薬',
    glyph: '💊',
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  // Clairvoyance fruit (Phase 18.2): reveals every currently-hidden trap
  // on the floor at once (TrapTile.revealed false -> true; never touches
  // `triggered` — see turn.ts's applyClairvoyanceUse) rather than
  // restoring HP/SOL/hunger or granting a status effect, so it has none
  // of healAmount/solarAmount/hungerAmount set — turn.ts's applyItemUse
  // special-cases itemId === 'clairvoyance_fruit' (mirroring banana/
  // antidote/panacea). Ordinary stacking consumable, following the same
  // provisional-emoji-glyph precedent as every other item without a
  // processed sprite asset yet (see this file's `glyph` doc comment).
  clairvoyance_fruit: {
    id: 'clairvoyance_fruit',
    displayName: '千里眼の実',
    glyph: '🔮',
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  // Flame/frost/cloud/earth enchantments (Phase 14.2 five-element
  // acquisition): one-time unlock pickups, exactly like sol_enchantment
  // above — deliberately excluded from ITEM_IDS_IN_ORDER so they never
  // appear in the general inventory overlay or go through the generic
  // inventory[itemId]++ auto-pickup path; turn.ts's ground-item pickup
  // handling special-cases each of these four ids and sets the matching
  // GameState.unlockedEnchantments entry directly instead.
  // displayName/glyph come from element-def.ts's single source of truth
  // so each element's name/glyph exists in exactly one place.
  flame_enchantment: {
    id: 'flame_enchantment',
    displayName: ELEMENT_DISPLAY_NAMES.flame,
    glyph: ELEMENT_GLYPHS.flame,
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
  frost_enchantment: {
    id: 'frost_enchantment',
    displayName: ELEMENT_DISPLAY_NAMES.frost,
    glyph: ELEMENT_GLYPHS.frost,
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
  cloud_enchantment: {
    id: 'cloud_enchantment',
    displayName: ELEMENT_DISPLAY_NAMES.cloud,
    glyph: ELEMENT_GLYPHS.cloud,
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
  earth_enchantment: {
    id: 'earth_enchantment',
    displayName: ELEMENT_DISPLAY_NAMES.earth,
    glyph: ELEMENT_GLYPHS.earth,
    category: 'consumable',
    consumable: false,
    stackable: false,
  },
};

/** Fixed display/iteration order for items (Phase 08.2: apple; Phase 08.3 adds sword; Phase 08.4 adds armor; Phase 08.5 adds spear; Phase 08.7 adds hammer; Phase 09.1 adds sun_fruit; Phase 09.2 adds solar_gun). */
export const ITEM_IDS_IN_ORDER: ItemId[] = ['apple', 'sword', 'armor', 'spear', 'hammer', 'sun_fruit', 'solar_gun', 'chocolate', 'banana', 'antidote', 'panacea', 'clairvoyance_fruit'];

/** An inventory with every registered item at count 0 (used for new-run initialization). */
export function createEmptyInventory(): Inventory {
  const inventory = {} as Inventory;
  for (const id of ITEM_IDS_IN_ORDER) {
    inventory[id] = 0;
  }
  return inventory;
}

/**
 * Ground-item count distribution (Phase 15.4b random ground item
 * generation, replacing the previous per-item guaranteed-placement
 * system — see docs/history/phase-15-4-random-ground-items.md). Percent
 * weights out of 100 for each possible total ground-item count (2-6),
 * expected value exactly 4.0 (2*.10+3*.25+4*.30+5*.25+6*.10). Single
 * source of truth: no call site duplicates these numbers.
 */
export const GROUND_ITEM_COUNT_WEIGHTS: ReadonlyArray<{ count: number; weight: number }> = [
  { count: 2, weight: 10 },
  { count: 3, weight: 25 },
  { count: 4, weight: 30 },
  { count: 5, weight: 25 },
  { count: 6, weight: 10 },
];

/**
 * Draws one ground-item count (2-6) from GROUND_ITEM_COUNT_WEIGHTS,
 * consuming exactly one rng() call. `rng()` is expected to return a
 * value in [0, 1); the 0..99 integer roll is mapped to a count via a
 * fixed cumulative-weight table walked in GROUND_ITEM_COUNT_WEIGHTS'
 * own listed order, so the same roll always yields the same count.
 */
export function drawGroundItemCount(rng: () => number): number {
  const roll = Math.floor(rng() * 100); // 0..99
  let cumulative = 0;
  for (const { count, weight } of GROUND_ITEM_COUNT_WEIGHTS) {
    cumulative += weight;
    if (roll < cumulative) return count;
  }
  // Unreachable given weights sum to exactly 100 and roll is 0..99, but
  // kept as a defensive fallback rather than an unchecked array index.
  return GROUND_ITEM_COUNT_WEIGHTS[GROUND_ITEM_COUNT_WEIGHTS.length - 1].count;
}

/**
 * Items whose ground pickup is a one-time enchantment/attunement unlock
 * (sets a GameState boolean/record flag; see turn.ts's ground-item pickup
 * handling) rather than a stacking inventory count. Phase 15.4b's
 * generation rules treat these specially: never more than one of the
 * same enchantment id drawn per floor, and never drawn at all if the
 * carried-over GameState already has it unlocked (see
 * getAlreadyUnlockedEnchantmentItemIds in state.ts). Every other
 * registered item (including antidote/panacea, which are ordinary
 * stacking consumables) allows same-floor duplicates.
 */
export const ENCHANTMENT_ITEM_IDS: ReadonlyArray<ItemId> = [
  'sol_enchantment',
  'flame_enchantment',
  'frost_enchantment',
  'cloud_enchantment',
  'earth_enchantment',
];

// Phase 15.4b staged ground-item pool (replaces the previous per-item,
// per-floor-condition guaranteed-placement blocks in state.ts's
// buildFloorState). Cumulative: each floor's pool is the previous
// floor's pool plus that floor's own additions — an item, once staged in
// on floor N, remains a candidate on every floor >= N. Verified counts:
// floor 1 = 11, floor 2 = 15, floor 3 = 16 (every registered item).
const GROUND_ITEM_POOL_FLOOR_1: ReadonlyArray<ItemId> = [
  'apple',
  'sword',
  'armor',
  'sun_fruit',
  'solar_gun',
  'sol_enchantment',
  'chocolate',
  'banana',
  'flame_enchantment',
  'antidote',
  'panacea',
  'clairvoyance_fruit',
];
const GROUND_ITEM_POOL_FLOOR_2_ADDITIONS: ReadonlyArray<ItemId> = ['spear', 'hammer', 'frost_enchantment', 'cloud_enchantment'];
const GROUND_ITEM_POOL_FLOOR_3_ADDITIONS: ReadonlyArray<ItemId> = ['earth_enchantment'];

/**
 * The full staged ground-item candidate pool for `floor` (Phase 15.4b),
 * per GROUND_ITEM_POOL_FLOOR_1/2/3_ADDITIONS above. Floor numbers below 1
 * are treated as floor 1; floor numbers above 3 keep the full (floor-3)
 * pool, since no floor-4+ additions are defined (this game's TOTAL_FLOORS
 * is 3 — see floor.ts).
 */
export function getGroundItemPoolForFloor(floor: number): ItemId[] {
  if (floor <= 1) return [...GROUND_ITEM_POOL_FLOOR_1];
  if (floor === 2) return [...GROUND_ITEM_POOL_FLOOR_1, ...GROUND_ITEM_POOL_FLOOR_2_ADDITIONS];
  return [...GROUND_ITEM_POOL_FLOOR_1, ...GROUND_ITEM_POOL_FLOOR_2_ADDITIONS, ...GROUND_ITEM_POOL_FLOOR_3_ADDITIONS];
}

/**
 * Draws `count` item ids uniformly at random from `pool` (Phase 15.4b),
 * consuming exactly one rng() call per draw (never zero, regardless of
 * duplicates). `pool` should already have any already-unlocked
 * enchantment ids filtered out by the caller (see state.ts's
 * getAlreadyUnlockedEnchantmentItemIds) — this function itself only
 * enforces the *within-this-draw* rule: once an ENCHANTMENT_ITEM_IDS
 * member is drawn, it's removed from the working candidate list so it
 * can never be drawn a second time on the same floor, while every other
 * (ordinary/weapon/armor) id remains eligible for repeated draws. Since
 * every floor's pool has strictly more ordinary ids than the maximum
 * possible count (6), exhausting every enchantment candidate never
 * starves a later draw — ordinary ids are always available.
 */
export function drawGroundItemSelection(count: number, pool: ItemId[], rng: () => number): ItemId[] {
  let working = pool.slice();
  const result: ItemId[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor(rng() * working.length);
    const picked = working[index];
    result.push(picked);
    if (ENCHANTMENT_ITEM_IDS.includes(picked)) {
      working = working.filter((id) => id !== picked);
    }
  }
  return result;
}
