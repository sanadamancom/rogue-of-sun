import { AccessoryId, EquipmentRank } from './types';

/**
 * Phase 24.5b アクセサリー基本装備基盤: a single accessory species' fixed
 * catalog data — mirrors WeaponDefinition/ArmorDefinition's shape
 * (id + rank only) but deliberately has no attack/defense/effectId/DP
 * field of any kind. Phase 24.5a2/24.5a2a's selection audit
 * (docs/history/phase-24-5a2-accessory-selection-audit.md) confirmed the
 * 6 initial species and their production-facing rank, but explicitly
 * deferred every effect number/threshold/condition to Phase 24.5d — this
 * module intentionally carries no effect-related field so that later
 * phase has a real place to add one without this phase inventing a
 * placeholder that would need to be redesigned.
 */
export interface AccessoryDefinition {
  id: AccessoryId;
  displayName: string;
  /** Phase 24.5a2a rank evaluation (production impact, not the original game's level) — see the selection audit's rank_evaluation section. */
  rank: EquipmentRank;
}

/**
 * Single source of truth for the 6 initially-adopted accessory species
 * (Phase 24.5a2a's finalized selection). Every id/displayName/rank here
 * matches docs/history/phase-24-5a2-accessory-selection-audit.md's
 * "正式採用案" table exactly. No 7th (R-rank) species exists this phase
 * — Phase 24.5a2a's rank_evaluation explicitly excludes R from the
 * initial roster.
 */
export const ACCESSORY_DEFINITIONS: Record<AccessoryId, AccessoryDefinition> = {
  hot_blooded_headband: { id: 'hot_blooded_headband', displayName: '熱血ハチマキ', rank: 'C' },
  earth_guard: { id: 'earth_guard', displayName: '大地の守り', rank: 'C' },
  buckler: { id: 'buckler', displayName: 'バックラー', rank: 'C' },
  adventurer_boots: { id: 'adventurer_boots', displayName: '冒険者のブーツ', rank: 'B' },
  circlet: { id: 'circlet', displayName: 'サークレット', rank: 'A' },
  grigri_glasses: { id: 'grigri_glasses', displayName: 'グリグリメガネ', rank: 'S' },
};

/** Fixed iteration order for the 6 initial accessory species — mirrors WEAPON_IDS_IN_ORDER/ARMOR_IDS_IN_ORDER's role as the single source of truth for the full roster. */
export const ACCESSORY_IDS_IN_ORDER: AccessoryId[] = [
  'hot_blooded_headband',
  'earth_guard',
  'buckler',
  'adventurer_boots',
  'circlet',
  'grigri_glasses',
];
