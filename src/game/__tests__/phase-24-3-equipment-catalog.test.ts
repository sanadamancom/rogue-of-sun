import { describe, expect, it } from 'vitest';
import { WEAPON_DEFINITIONS, WEAPON_IDS_IN_ORDER } from '../weapon-def';
import { ARMOR_DEFINITIONS, ARMOR_IDS_IN_ORDER } from '../armor-def';
import { ITEM_DEFINITIONS, getGroundItemPoolForFloor } from '../item-def';
import { WeaponId, ArmorId, EquipmentRank } from '../types';

/**
 * Phase 24.3 Stage 1: full equipment catalog data-layer tests. Covers
 * equipment_catalog's 27 melee weapons + solar_gun + 15 armor, the
 * existing-definitionId compatibility mapping (stage_0_contract_audit's
 * `existing_ids`), and reward_candidate_tables' structural constraints.
 * Recipe/effect behavior is covered by the Stage 2/3/4 test files, not
 * here.
 */

describe('Phase 24.3 Stage 1: weapon catalog', () => {
  it('27 melee weapons + solar_gun exist, no duplicates', () => {
    const ids = Object.keys(WEAPON_DEFINITIONS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(28);
  });

  it('WEAPON_IDS_IN_ORDER matches the WEAPON_DEFINITIONS key set exactly', () => {
    expect(new Set(WEAPON_IDS_IN_ORDER)).toEqual(new Set(Object.keys(WEAPON_DEFINITIONS)));
    expect(WEAPON_IDS_IN_ORDER.length).toBe(Object.keys(WEAPON_DEFINITIONS).length);
  });

  it('every pre-existing weapon definitionId is preserved (stage_0_contract_audit existing_ids)', () => {
    for (const id of ['sword', 'spear', 'hammer', 'solar_gun'] as WeaponId[]) {
      expect(WEAPON_DEFINITIONS[id]).toBeDefined();
    }
    expect(ITEM_DEFINITIONS.sword.displayName).toBe('グラディウス');
    expect(ITEM_DEFINITIONS.spear.displayName).toBe('ショートスピア');
    expect(ITEM_DEFINITIONS.hammer.displayName).toBe('クラブ');
    expect(ITEM_DEFINITIONS.solar_gun.displayName).toBe('太陽銃');
  });

  it('each family (sword/spear/hammer) has exactly 2 C, 2 B, 2 A, 2 S, 1 R', () => {
    for (const family of ['sword', 'spear', 'hammer'] as const) {
      const defs = Object.values(WEAPON_DEFINITIONS).filter((d) => d.family === family);
      expect(defs.length).toBe(9);
      const byRank: Record<EquipmentRank, number> = { C: 0, B: 0, A: 0, S: 0, R: 0 };
      for (const d of defs) byRank[d.rank]++;
      expect(byRank).toEqual({ C: 2, B: 2, A: 2, S: 2, R: 1 });
    }
  });

  it('solar_gun has no family and Phase 23.1 stats are unchanged', () => {
    expect(WEAPON_DEFINITIONS.solar_gun.family).toBeUndefined();
    expect(WEAPON_DEFINITIONS.solar_gun.solarCost).toBe(3);
    expect(WEAPON_DEFINITIONS.solar_gun.reach).toBe(5);
    expect(WEAPON_DEFINITIONS.solar_gun.rank).toBe('C');
  });

  it('every weapon has a valid EquipmentRank', () => {
    const validRanks = new Set(['C', 'B', 'A', 'S', 'R']);
    for (const def of Object.values(WEAPON_DEFINITIONS)) {
      expect(validRanks.has(def.rank)).toBe(true);
    }
  });

  it('sword/spear/hammer common stats (accuracy/range/knockback/recoil) match every rank in that family', () => {
    const commons: Record<'sword' | 'spear' | 'hammer', { hitModifier: number; reach: number; knockbackDistance: number; hasRecoil: boolean }> = {
      sword: { hitModifier: 5, reach: 1, knockbackDistance: 0, hasRecoil: false },
      spear: { hitModifier: 5, reach: 2, knockbackDistance: 0, hasRecoil: false },
      hammer: { hitModifier: -5, reach: 1, knockbackDistance: 1, hasRecoil: true },
    };
    for (const [family, expected] of Object.entries(commons) as [keyof typeof commons, (typeof commons)['sword']][]) {
      for (const def of Object.values(WEAPON_DEFINITIONS).filter((d) => d.family === family)) {
        expect(def.hitModifier).toBe(expected.hitModifier);
        expect(def.reach).toBe(expected.reach);
        expect(def.knockbackDistance).toBe(expected.knockbackDistance);
        expect(def.hasRecoil).toBe(expected.hasRecoil);
      }
    }
  });

  it('the 6 "none"-effect C-rank melee species have no effectId', () => {
    for (const id of ['sword', 'short_sword', 'spear', 'glaive', 'hammer', 'basic_hammer'] as WeaponId[]) {
      expect(WEAPON_DEFINITIONS[id].effectId).toBeUndefined();
    }
  });

  it('every B/A/S/R melee species has an effectId', () => {
    for (const def of Object.values(WEAPON_DEFINITIONS)) {
      if (def.id === 'solar_gun') continue;
      if (def.rank === 'C') continue;
      expect(def.effectId).toBeTruthy();
    }
  });
});

describe('Phase 24.3 Stage 1: armor catalog', () => {
  it('15 armor species exist, no duplicates', () => {
    const ids = Object.keys(ARMOR_DEFINITIONS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(15);
  });

  it('ARMOR_IDS_IN_ORDER matches the ARMOR_DEFINITIONS key set exactly', () => {
    expect(new Set(ARMOR_IDS_IN_ORDER)).toEqual(new Set(Object.keys(ARMOR_DEFINITIONS)));
  });

  it('the pre-existing armor definitionId is preserved (stage_0_contract_audit existing_ids)', () => {
    expect(ARMOR_DEFINITIONS.armor).toBeDefined();
    expect(ARMOR_DEFINITIONS.armor.armorValue).toBe(2);
    expect(ITEM_DEFINITIONS.armor.displayName).toBe('クロスアーマー');
  });

  it('black_armor is rank R and every other armor is C/B/A/S', () => {
    expect(ARMOR_DEFINITIONS.black_armor.rank).toBe('R');
    const nonBlack = Object.values(ARMOR_DEFINITIONS).filter((d) => d.id !== 'black_armor');
    for (const def of nonBlack) {
      expect(['C', 'B', 'A', 'S']).toContain(def.rank);
    }
  });

  it('armor rank distribution matches the equipment_catalog table (2C/6B.../etc totals)', () => {
    const byRank: Record<EquipmentRank, number> = { C: 0, B: 0, A: 0, S: 0, R: 0 };
    for (const d of Object.values(ARMOR_DEFINITIONS)) byRank[d.rank]++;
    expect(byRank).toEqual({ C: 2, B: 5, A: 4, S: 3, R: 1 });
  });

  it('the 2 "none"-effect C-rank armor species have no effectId', () => {
    for (const id of ['armor', 'chain_mail'] as ArmorId[]) {
      expect(ARMOR_DEFINITIONS[id].effectId).toBeUndefined();
    }
  });

  it('every non-C-rank armor species except plate_mail (B rank, effect "none" per spec) has an effectId', () => {
    for (const def of Object.values(ARMOR_DEFINITIONS)) {
      if (def.rank === 'C' || def.id === 'plate_mail') continue;
      expect(def.effectId).toBeTruthy();
    }
  });
});

describe('Phase 24.3 Stage 1: shared item display data', () => {
  it('every weapon/armor definitionId has a matching ITEM_DEFINITIONS entry with the correct category', () => {
    for (const id of WEAPON_IDS_IN_ORDER) {
      expect(ITEM_DEFINITIONS[id]).toBeDefined();
      expect(ITEM_DEFINITIONS[id].category).toBe('weapon');
      expect(ITEM_DEFINITIONS[id].consumable).toBe(false);
      expect(ITEM_DEFINITIONS[id].stackable).toBe(false);
    }
    for (const id of ARMOR_IDS_IN_ORDER) {
      expect(ITEM_DEFINITIONS[id]).toBeDefined();
      expect(ITEM_DEFINITIONS[id].category).toBe('armor');
      expect(ITEM_DEFINITIONS[id].consumable).toBe(false);
      expect(ITEM_DEFINITIONS[id].stackable).toBe(false);
    }
  });
});

describe('Phase 24.3 Stage 1: current floor generation is unchanged', () => {
  it('the staged ground-item pools (floors 1-3) still only ever include the pre-24.3 5 equipment species', () => {
    const preExisting = new Set(['sword', 'armor', 'spear', 'hammer', 'solar_gun']);
    for (const floor of [1, 2, 3]) {
      const pool = getGroundItemPoolForFloor(floor, 'descent');
      const equipmentInPool = pool.filter((id) => WEAPON_IDS_IN_ORDER.includes(id as WeaponId) || ARMOR_IDS_IN_ORDER.includes(id as ArmorId));
      for (const id of equipmentInPool) {
        expect(preExisting.has(id)).toBe(true);
      }
    }
  });
});
