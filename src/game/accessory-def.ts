import { AccessoryId, EquipmentRank } from './types';

/**
 * Phase 24.5d: the 6 initial accessory species' unique-effect identifier.
 * One id per species (1:1 with AccessoryId this phase — no species
 * shares an effect and no species has more than one), dispatched from
 * equipment-effects.ts the same way WeaponDefinition.effectId/
 * ArmorDefinition.effectId are — never a per-call-site AccessoryId
 * comparison.
 */
export type AccessoryEffectId =
  | 'hot_blooded_headband_charge_bonus'
  | 'earth_guard_poison_immunity'
  | 'buckler_sword_damage_reduction'
  | 'adventurer_boots_sun_fruit_bonus'
  | 'circlet_max_sol_bonus'
  | 'grigri_glasses_trap_reveal';

/**
 * Phase 24.5b アクセサリー基本装備基盤: a single accessory species' fixed
 * catalog data — mirrors WeaponDefinition/ArmorDefinition's shape
 * (id + rank only) but deliberately has no attack/defense/effectId/DP
 * field of any kind. Phase 24.5a2/24.5a2a's selection audit
 * (docs/history/phase-24-5a2-accessory-selection-audit.md) confirmed the
 * 6 initial species and their production-facing rank, but explicitly
 * deferred every effect number/threshold/condition to Phase 24.5d.
 *
 * Phase 24.5d adds effectId (dispatch key, mirrors weapon/armor) and
 * description (identified-only display text — see ui.detail in the
 * phase 24.5d task spec). Both are new, additive fields; no existing
 * field's meaning changes.
 */
export interface AccessoryDefinition {
  id: AccessoryId;
  displayName: string;
  /** Phase 24.5a2a rank evaluation (production impact, not the original game's level) — see the selection audit's rank_evaluation section. */
  rank: EquipmentRank;
  /** Phase 24.5d: this species' unique-effect dispatch key — see equipment-effects.ts for every effect's actual implementation. */
  effectId: AccessoryEffectId;
  /** Phase 24.5d: identified-only effect description shown in the inventory detail pane (ui.detail.identified) — never shown while the species is unidentified (ui.detail.unidentified). Numbers here must match the production constants in equipment-effects.ts exactly (definitions.constraints' "表示用descriptionとproduction計算値を別々に重複定義しない" — this string is the single display copy, not a second source of truth for the number itself). */
  description: string;
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
  hot_blooded_headband: {
    id: 'hot_blooded_headband',
    displayName: '熱血ハチマキ',
    rank: 'C',
    effectId: 'hot_blooded_headband_charge_bonus',
    description: '日向での太陽チャージ量+1',
  },
  earth_guard: {
    id: 'earth_guard',
    displayName: '大地の守り',
    rank: 'C',
    effectId: 'earth_guard_poison_immunity',
    description: '新たな毒を受け付けない',
  },
  buckler: {
    id: 'buckler',
    displayName: 'バックラー',
    rank: 'C',
    effectId: 'buckler_sword_damage_reduction',
    description: '剣タイプの敵からの物理ダメージを25%軽減',
  },
  adventurer_boots: {
    id: 'adventurer_boots',
    displayName: '冒険者のブーツ',
    rank: 'B',
    effectId: 'adventurer_boots_sun_fruit_bonus',
    description: '天陽の実のSOL回復量が1.5倍',
  },
  circlet: {
    id: 'circlet',
    displayName: 'サークレット',
    rank: 'A',
    effectId: 'circlet_max_sol_bonus',
    description: '最大SOLが1.25倍。敵ドロップ率が低下する',
  },
  grigri_glasses: {
    id: 'grigri_glasses',
    displayName: 'グリグリメガネ',
    rank: 'S',
    effectId: 'grigri_glasses_trap_reveal',
    description: 'このフロアの罠をすべて発見する',
  },
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
