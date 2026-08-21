import { ItemId, Inventory, CardId } from './types';
import { ELEMENT_DISPLAY_NAMES, ELEMENT_GLYPHS } from './element-def';
import { CARD_DISPLAY_NAMES, CARD_GLYPH, CARD_IDS_IN_ORDER, CARD_DEFINITIONS } from './card-def';
import { filterEligibleItemIds } from './item-availability';

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
  category: 'consumable' | 'weapon' | 'armor' | 'accessory';
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
  // Phase 24.3 全装備カタログ: 14 additional armor species — see
  // armor-def.ts's ARMOR_DEFINITIONS for each species' defensive/effect
  // data.
  chain_mail: { id: 'chain_mail', displayName: 'チェインメイル', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  plate_mail: { id: 'plate_mail', displayName: 'プレートメイル', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  samurai_armor: { id: 'samurai_armor', displayName: '武者鎧', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  mail_of_sol: { id: 'mail_of_sol', displayName: 'メイルオブソル', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  mail_of_dark: { id: 'mail_of_dark', displayName: 'メイルオブダーク', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  dragon_scale: { id: 'dragon_scale', displayName: 'ドラゴンスケイル', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  magic_robe: { id: 'magic_robe', displayName: 'マジックローブ', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  skull_suit: { id: 'skull_suit', displayName: 'スカルスーツ', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  poison_guard: { id: 'poison_guard', displayName: 'ポイズンガード', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  ninja_suit: { id: 'ninja_suit', displayName: '忍装束', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  light_garb: { id: 'light_garb', displayName: '光のガーブ', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  dark_garb: { id: 'dark_garb', displayName: '闇のガーブ', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  spike_mail: { id: 'spike_mail', displayName: 'スパイクメイル', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
  black_armor: { id: 'black_armor', displayName: '黒の鎧', glyph: '🛡️', category: 'armor', consumable: false, stackable: false },
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
  // Phase 24.3 全装備カタログ: 23 additional melee weapon species (9 per
  // family minus the 3 already registered above) — see weapon-def.ts's
  // WEAPON_DEFINITIONS for each species' combat/effect data.
  short_sword: { id: 'short_sword', displayName: 'ショートソード', glyph: '🗡️', category: 'weapon', consumable: false, stackable: false },
  flamberge: { id: 'flamberge', displayName: 'フランベルジュ', glyph: '🗡️', category: 'weapon', consumable: false, stackable: false },
  magic_sword: { id: 'magic_sword', displayName: 'マジックソード', glyph: '🗡️', category: 'weapon', consumable: false, stackable: false },
  bushido_blade: { id: 'bushido_blade', displayName: '武士道ブレード', glyph: '🗡️', category: 'weapon', consumable: false, stackable: false },
  blood_sword: { id: 'blood_sword', displayName: 'ブラッドソード', glyph: '🗡️', category: 'weapon', consumable: false, stackable: false },
  solar_sword: { id: 'solar_sword', displayName: '太陽の剣', glyph: '🗡️', category: 'weapon', consumable: false, stackable: false },
  dark_sword: { id: 'dark_sword', displayName: '暗黒の剣', glyph: '🗡️', category: 'weapon', consumable: false, stackable: false },
  gram: { id: 'gram', displayName: 'グラム', glyph: '🗡️', category: 'weapon', consumable: false, stackable: false },
  glaive: { id: 'glaive', displayName: 'グレイブ', glyph: '🔱', category: 'weapon', consumable: false, stackable: false },
  corsesca: { id: 'corsesca', displayName: 'コルセスカ', glyph: '🔱', category: 'weapon', consumable: false, stackable: false },
  ice_glaive: { id: 'ice_glaive', displayName: 'アイスグレイブ', glyph: '🔱', category: 'weapon', consumable: false, stackable: false },
  grand_lance: { id: 'grand_lance', displayName: 'グランドランス', glyph: '🔱', category: 'weapon', consumable: false, stackable: false },
  blood_spear: { id: 'blood_spear', displayName: 'ブラッドスピア', glyph: '🔱', category: 'weapon', consumable: false, stackable: false },
  white_queen: { id: 'white_queen', displayName: 'ホワイトクイーン', glyph: '🔱', category: 'weapon', consumable: false, stackable: false },
  black_queen: { id: 'black_queen', displayName: 'ブラッククイーン', glyph: '🔱', category: 'weapon', consumable: false, stackable: false },
  gungnir: { id: 'gungnir', displayName: 'グングニル', glyph: '🔱', category: 'weapon', consumable: false, stackable: false },
  basic_hammer: { id: 'basic_hammer', displayName: 'ハンマー', glyph: '🔨', category: 'weapon', consumable: false, stackable: false },
  maul: { id: 'maul', displayName: 'モール', glyph: '🔨', category: 'weapon', consumable: false, stackable: false },
  silver_flail: { id: 'silver_flail', displayName: 'シルバーフレイル', glyph: '🔨', category: 'weapon', consumable: false, stackable: false },
  battle_axe: { id: 'battle_axe', displayName: 'バトルアックス', glyph: '🔨', category: 'weapon', consumable: false, stackable: false },
  bloody_mace: { id: 'bloody_mace', displayName: 'ブラッディメイス', glyph: '🔨', category: 'weapon', consumable: false, stackable: false },
  dawn: { id: 'dawn', displayName: 'あかつき', glyph: '🔨', category: 'weapon', consumable: false, stackable: false },
  twilight: { id: 'twilight', displayName: 'たそがれ', glyph: '🔨', category: 'weapon', consumable: false, stackable: false },
  mjolnir: { id: 'mjolnir', displayName: 'ミョルニル', glyph: '🔨', category: 'weapon', consumable: false, stackable: false },
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
  // Phase 20.0a card definition foundation: the 17 tarot cards, each
  // registered as an ordinary stacking consumable — same category/
  // consumable/stackable shape as apple/chocolate/banana above — per
  // rogue-of-sun-development-plan.md 20.0a's "第4のitem categoryは追加
  // しない". Deliberately excluded from ITEM_IDS_IN_ORDER and from every
  // GROUND_ITEM_POOL_FLOOR_* array below (see those declarations' doc
  // comments): defining a card here makes it a valid, lookupable
  // ItemId/ItemDefinition, but never makes it appear in the inventory
  // overlay or as a floor/enemy drop candidate — that wiring is deferred
  // to a later Phase 20 unit (20.0e for loot, a UI unit for display).
  // displayName/glyph are pulled from card-def.ts's single source of
  // truth (CARD_DISPLAY_NAMES/CARD_GLYPH) so each card's Japanese name
  // exists in exactly one place, mirroring how flame/frost/cloud/earth
  // above pull from ELEMENT_DISPLAY_NAMES/ELEMENT_GLYPHS. No healAmount/
  // solarAmount/hungerAmount is set for any card — none of the 17 cards'
  // effects are healAmount/solarAmount/hungerAmount-shaped (see
  // card-def.ts's CARD_DEFINITIONS for each card's real effectId; effect
  // resolution itself is out of this phase's scope).
  high_priestess: {
    id: 'high_priestess',
    displayName: CARD_DISPLAY_NAMES.high_priestess,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  empress: {
    id: 'empress',
    displayName: CARD_DISPLAY_NAMES.empress,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  emperor: {
    id: 'emperor',
    displayName: CARD_DISPLAY_NAMES.emperor,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  lovers: {
    id: 'lovers',
    displayName: CARD_DISPLAY_NAMES.lovers,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  chariot: {
    id: 'chariot',
    displayName: CARD_DISPLAY_NAMES.chariot,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  strength: {
    id: 'strength',
    displayName: CARD_DISPLAY_NAMES.strength,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  wheel_of_fortune: {
    id: 'wheel_of_fortune',
    displayName: CARD_DISPLAY_NAMES.wheel_of_fortune,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  justice: {
    id: 'justice',
    displayName: CARD_DISPLAY_NAMES.justice,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  hanged_man: {
    id: 'hanged_man',
    displayName: CARD_DISPLAY_NAMES.hanged_man,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  death: {
    id: 'death',
    displayName: CARD_DISPLAY_NAMES.death,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  temperance: {
    id: 'temperance',
    displayName: CARD_DISPLAY_NAMES.temperance,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  devil: {
    id: 'devil',
    displayName: CARD_DISPLAY_NAMES.devil,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  tower: {
    id: 'tower',
    displayName: CARD_DISPLAY_NAMES.tower,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  star: {
    id: 'star',
    displayName: CARD_DISPLAY_NAMES.star,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  moon: {
    id: 'moon',
    displayName: CARD_DISPLAY_NAMES.moon,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  sun: {
    id: 'sun',
    displayName: CARD_DISPLAY_NAMES.sun,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  judgement: {
    id: 'judgement',
    displayName: CARD_DISPLAY_NAMES.judgement,
    glyph: CARD_GLYPH,
    category: 'consumable',
    consumable: true,
    stackable: true,
  },
  // Phase 24.5b アクセサリー基本装備基盤: the 6 initially-adopted
  // accessory species (Phase 24.5a2a's finalized selection — see
  // accessory-def.ts's ACCESSORY_DEFINITIONS, the single source of
  // truth for rank; displayName here matches that table exactly).
  // consumable: false / stackable: false, identical to every weapon/
  // armor entry above (accessory requires an EquipmentInstance just
  // like weapon/armor — see equipment-instance.ts). No attack/defense/
  // effect field exists on ItemDefinition for any category, so no
  // placeholder is needed or added here; Phase 24.5d is where a future
  // effect-related field (if any) would be introduced.
  hot_blooded_headband: { id: 'hot_blooded_headband', displayName: '熱血ハチマキ', glyph: '✨', category: 'accessory', consumable: false, stackable: false },
  earth_guard: { id: 'earth_guard', displayName: '大地の守り', glyph: '✨', category: 'accessory', consumable: false, stackable: false },
  buckler: { id: 'buckler', displayName: 'バックラー', glyph: '✨', category: 'accessory', consumable: false, stackable: false },
  adventurer_boots: { id: 'adventurer_boots', displayName: '冒険者のブーツ', glyph: '✨', category: 'accessory', consumable: false, stackable: false },
  circlet: { id: 'circlet', displayName: 'サークレット', glyph: '✨', category: 'accessory', consumable: false, stackable: false },
  grigri_glasses: { id: 'grigri_glasses', displayName: 'グリグリメガネ', glyph: '✨', category: 'accessory', consumable: false, stackable: false },
};

/**
 * Fixed display/iteration order for items (Phase 08.2: apple; Phase 08.3
 * adds sword; Phase 08.4 adds armor; Phase 08.5 adds spear; Phase 08.7
 * adds hammer; Phase 09.1 adds sun_fruit; Phase 09.2 adds solar_gun).
 * This is the single array `inventoryEntries()` (inventory.ts) filters/
 * maps to build the actual Inventory overlay's displayed list (see
 * main.ts's use of `inventoryEntries`) — i.e. this array *is* Inventory
 * display order, not merely a naming convention. Phase 20.0a appends
 * CARD_IDS_IN_ORDER (card-def.ts) after the pre-existing 12 ids, unchanged
 * in their own relative order, so all 17 cards become displayable in the
 * Inventory overlay once held (`inventoryEntries` already filters to
 * count > 0, so an empty-handed run shows nothing new). This is
 * deliberately independent of floor-loot registration: appearing here
 * only controls whether a *held* card is shown/navigable, never whether
 * one can be found — see GROUND_ITEM_POOL_FLOOR_1/2/3_ADDITIONS below,
 * none of which include any card id.
 */
export const ITEM_IDS_IN_ORDER: ItemId[] = [
  'apple',
  'sword',
  'armor',
  'spear',
  'hammer',
  'sun_fruit',
  'solar_gun',
  // Phase 24.3 全装備カタログ: the remaining 23 melee weapon species and
  // 14 armor species, appended after the pre-existing 7 equippable/
  // consumable ids so held individuals display/equip/forge correctly —
  // never inserted into GROUND_ITEM_POOL_FLOOR_*_ADDITIONS (state.ts),
  // so normal floor generation is unaffected this phase.
  'short_sword',
  'flamberge',
  'magic_sword',
  'bushido_blade',
  'blood_sword',
  'solar_sword',
  'dark_sword',
  'gram',
  'glaive',
  'corsesca',
  'ice_glaive',
  'grand_lance',
  'blood_spear',
  'white_queen',
  'black_queen',
  'gungnir',
  'basic_hammer',
  'maul',
  'silver_flail',
  'battle_axe',
  'bloody_mace',
  'dawn',
  'twilight',
  'mjolnir',
  'chain_mail',
  'plate_mail',
  'samurai_armor',
  'mail_of_sol',
  'mail_of_dark',
  'dragon_scale',
  'magic_robe',
  'skull_suit',
  'poison_guard',
  'ninja_suit',
  'light_garb',
  'dark_garb',
  'spike_mail',
  'black_armor',
  // Phase 24.5b アクセサリー基本装備基盤: the 6 initially-adopted
  // accessory species, appended after the pre-existing weapon/armor ids
  // so held individuals display/equip correctly — never inserted into
  // GROUND_ITEM_POOL_FLOOR_*_ADDITIONS (state.ts), so normal floor
  // generation is unaffected this phase (Phase 24.5c's job).
  'hot_blooded_headband',
  'earth_guard',
  'buckler',
  'adventurer_boots',
  'circlet',
  'grigri_glasses',
  'chocolate',
  'banana',
  'antidote',
  'panacea',
  'clairvoyance_fruit',
  ...CARD_IDS_IN_ORDER,
];

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

// Phase 15.4b staged ground-item pool, Phase 24.6b2a: the flat,
// unstaged superset of every ground-item-pool slot id, in the same
// relative order the old floor1 -> floor2-additions -> floor3-addition
// concatenation always produced. getGroundItemPoolForFloor below no
// longer branches on floor === 2 / >= 3 — instead it filters this same
// fixed-order list through item-availability.ts's shared eligibility
// helper, using floorProgressRatio(floor, totalFloors) so a 10/30/99-
// floor run reaches the same candidate set at the same *progress*
// rather than at a hardcoded floor number (see item-availability.ts's
// ITEM_AVAILABILITY entries for 'spear'/'hammer'/'frost_enchantment'/
// 'cloud_enchantment'/'earth_enchantment', the only 5 with a nonzero
// unlockProgress — every other id here is unlockProgress: 0, i.e.
// eligible from floor 1 exactly as before). At totalFloors === 3, floor
// 2's progress (2/3) and floor 3's progress (1) reproduce the pre-
// 24.6b2a floor===2/floor>=3 tiers exactly, and this array's relative
// order is unchanged, so filtering it never reorders or drops/adds
// anything at any of the 3 default floors — see
// docs/history/phase-24-6b2a-item-availability.md for the full
// before/after comparison.
const GROUND_ITEM_POOL_ALL: ReadonlyArray<ItemId> = [
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
  'spear',
  'hammer',
  'frost_enchantment',
  'cloud_enchantment',
  'earth_enchantment',
];

/**
 * The full ground-item candidate pool for `floor` of a run with
 * `totalFloors` total floors and `runDepthTier` tier (Phase 24.6b2a,
 * replacing Phase 15.4b's hardcoded floor===2/floor>=3 staging — see
 * GROUND_ITEM_POOL_ALL's own doc comment above). Phase 24.6b2a1:
 * `totalFloors`/`runDepthTier` are required — no implicit default
 * exists, so a caller that forgets to pass the real run's values gets a
 * compile error rather than silently generating under an unintended
 * (3, 'short') run condition.
 */
export function getGroundItemPoolForFloor(floor: number, leg: 'descent' | 'ascent'): ItemId[] {
  return filterEligibleItemIds(GROUND_ITEM_POOL_ALL, floor, leg);
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

// Phase 20.0e weighted ground-item foundation: card floor-drop
// eligibility, cumulative by floor (same staged-pool shape as
// GROUND_ITEM_POOL_FLOOR_1/2/3_ADDITIONS above, kept as its own set of
// arrays rather than merged into those — cards are looked up by weight
// via CARD_DEFINITIONS, not the flat unweighted array those represent).
// Values are Phase 20.1/20.2/20.3's implemented 9 cards only, per
// rogue-of-sun-development-plan.md's provisional_card_table; the
// remaining 8 defined-but-not-implemented cards are deliberately absent
// from every one of these arrays regardless of their CardDefinition
// floorDropEnabled/lootWeight values (which are 0/false for all 8 — see
// card-def.ts's CARD_DEFINITIONS), so a future accidental flip of one
// card's flag alone could never make it appear without also being added
// here.
const CARD_GROUND_POOL_FLOOR_1_ADDITIONS: ReadonlyArray<CardId> = ['lovers', 'hanged_man', 'judgement'];
const CARD_GROUND_POOL_FLOOR_2_ADDITIONS: ReadonlyArray<CardId> = [
  'high_priestess',
  'empress',
  'chariot',
  'strength',
  'death',
];
const CARD_GROUND_POOL_FLOOR_3_ADDITIONS: ReadonlyArray<CardId> = ['wheel_of_fortune'];

/**
 * The full staged card candidate list for `floor` (Phase 20.0e), mirroring
 * getGroundItemPoolForFloor's cumulative floor-staging shape exactly (same
 * floor<=1/===2/>=3 tiers) but drawn from the card-specific arrays above.
 */
function getCardGroundPoolForFloor(floor: number): CardId[] {
  if (floor <= 1) return [...CARD_GROUND_POOL_FLOOR_1_ADDITIONS];
  if (floor === 2) return [...CARD_GROUND_POOL_FLOOR_1_ADDITIONS, ...CARD_GROUND_POOL_FLOOR_2_ADDITIONS];
  return [
    ...CARD_GROUND_POOL_FLOOR_1_ADDITIONS,
    ...CARD_GROUND_POOL_FLOOR_2_ADDITIONS,
    ...CARD_GROUND_POOL_FLOOR_3_ADDITIONS,
  ];
}

/** A single ground-item draw candidate paired with its relative draw weight. */
export interface WeightedGroundItemCandidate {
  id: ItemId;
  weight: number;
}

/**
 * Every pre-Phase-20 (non-card) ground item's relative weight (Phase
 * 20.0e): a flat constant applied uniformly, preserving the exact uniform
 * distribution `drawGroundItemSelection` gave every item before cards
 * existed — rogue-of-sun-development-plan.md's "既存の非カード床itemは
 * 各weight 10として相対的な均等性を維持する". Not read anywhere except
 * getWeightedGroundItemPoolForFloor below.
 */
export const BASE_GROUND_ITEM_WEIGHT = 10;

/**
 * The combined weighted candidate list for `floor` (Phase 20.0e):
 * `getGroundItemPoolForFloor(floor)`'s pre-existing non-card items (each
 * at BASE_GROUND_ITEM_WEIGHT) plus this floor's card candidates (Phase
 * 20.1/20.2/20.3's 9 implemented cards only, per
 * getCardGroundPoolForFloor above) at their own CardDefinition.lootWeight
 * — filtered to `floorDropEnabled && lootWeight > 0`, so a card with
 * either flag left at its Phase 20.0a neutral value never becomes
 * selectable regardless of whether it appears in a
 * CARD_GROUND_POOL_FLOOR_*_ADDITIONS array. `excludedIds` lets the caller
 * (state.ts) apply the same already-unlocked-enchantment exclusion it
 * already applies to the non-card pool before this function ever runs,
 * for parity with the pre-Phase-20 call site — see
 * drawWeightedGroundItemSelection's own doc comment for how the
 * within-draw enchantment non-repeat rule is preserved.
 */
export function getWeightedGroundItemPoolForFloor(
  floor: number,
  excludedIds: ReadonlySet<ItemId> | undefined,
  leg: 'descent' | 'ascent',
): WeightedGroundItemCandidate[] {
  const baseIds = getGroundItemPoolForFloor(floor, leg).filter((id) => !excludedIds?.has(id));
  const baseCandidates: WeightedGroundItemCandidate[] = baseIds.map((id) => ({
    id,
    weight: BASE_GROUND_ITEM_WEIGHT,
  }));
  const cardCandidates: WeightedGroundItemCandidate[] = getCardGroundPoolForFloor(floor)
    .filter((id) => !excludedIds?.has(id))
    .map((id) => ({ id, weight: CARD_DEFINITIONS[id].lootWeight }))
    .filter((c) => CARD_DEFINITIONS[c.id as CardId].floorDropEnabled && c.weight > 0);
  return [...baseCandidates, ...cardCandidates];
}

/**
 * Draws `count` item ids from `candidates` (Phase 20.0e), each draw
 * weighted by its own `weight` (cumulative-weight roll, same fixed-table
 * pattern as item-def.ts's drawGroundItemCount above), consuming exactly
 * one `rng()` call per draw regardless of candidate count or duplicates —
 * same RNG-consumption contract as the uniform `drawGroundItemSelection`
 * above. Preserves that function's within-draw enchantment non-repeat
 * rule unchanged: once an ENCHANTMENT_ITEM_IDS member is drawn, it is
 * removed from the working candidate list so it can never be drawn a
 * second time on the same floor, while every other id (ordinary item or
 * card) remains eligible for repeated draws.
 */
export function drawWeightedGroundItemSelection(
  count: number,
  candidates: ReadonlyArray<WeightedGroundItemCandidate>,
  rng: () => number,
): ItemId[] {
  let working = candidates.slice();
  const result: ItemId[] = [];
  for (let i = 0; i < count; i++) {
    const totalWeight = working.reduce((sum, c) => sum + c.weight, 0);
    const roll = rng() * totalWeight;
    let cumulative = 0;
    let picked = working[working.length - 1].id;
    for (const candidate of working) {
      cumulative += candidate.weight;
      if (roll < cumulative) {
        picked = candidate.id;
        break;
      }
    }
    result.push(picked);
    if (ENCHANTMENT_ITEM_IDS.includes(picked)) {
      working = working.filter((c) => c.id !== picked);
    }
  }
  return result;
}
