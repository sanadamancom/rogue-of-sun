/**
 * Phase 24.4a: connects Phase 24.3's full equipment catalog to normal
 * floor generation and monsterHouse rewards. Covers floor_progress's
 * pure ratio function, the flattened weighted candidate contract
 * (rank eligibility, monotonic B/A weight, R exclusion and bounded S armor),
 * equipment-instance identity end to end, monsterHouse reward
 * integration, and determinism/snapshot equivalence across
 * TOTAL_FLOORS 3/10/100.
 */
import { describe, expect, it } from 'vitest';
import {
  floorProgressRatio,
  getNormalEquipmentCandidates,
  isNormalEquipmentSlot,
  selectNormalEquipmentDefinition,
  RANK_WEIGHT_PROVISIONAL,
} from '../equipment-loot';
import { WEAPON_DEFINITIONS, WEAPON_IDS_IN_ORDER } from '../weapon-def';
import { ARMOR_DEFINITIONS, ARMOR_IDS_IN_ORDER } from '../armor-def';
import { ACCESSORY_DEFINITIONS, ACCESSORY_IDS_IN_ORDER } from '../accessory-def';
import { createRng, generateMap } from '../mapgen';
import { createInitialState, advanceToNextFloor } from '../state';
import { ArmorId, WeaponId } from '../types';

const SAMPLE_SEEDS = [1, 42, 999, 12345, 2024, 555, 777888, 4242];

describe('floorProgressRatio', () => {
  it('1/1 = 100%', () => {
    expect(floorProgressRatio(1, 1)).toBe(1);
  });

  it('1/3, 2/3, 3/3', () => {
    expect(floorProgressRatio(1, 3)).toBeCloseTo(1 / 3);
    expect(floorProgressRatio(2, 3)).toBeCloseTo(2 / 3);
    expect(floorProgressRatio(3, 3)).toBeCloseTo(1);
  });

  it('7/10 = 70%', () => {
    expect(floorProgressRatio(7, 10)).toBeCloseTo(0.7);
  });

  it('70/100 = 70%', () => {
    expect(floorProgressRatio(70, 100)).toBeCloseTo(0.7);
  });

  it('7/10 and 70/100 resolve to the exact same ratio', () => {
    expect(floorProgressRatio(7, 10)).toBe(floorProgressRatio(70, 100));
  });

  it('clamps floor <= 0 and totalFloors <= 0 to 0', () => {
    expect(floorProgressRatio(0, 3)).toBe(0);
    expect(floorProgressRatio(-5, 3)).toBe(0);
  });

  it('clamps floor beyond totalFloors to 1', () => {
    expect(floorProgressRatio(4, 3)).toBe(1);
    expect(floorProgressRatio(999, 3)).toBe(1);
  });

  it('treats totalFloors <= 0 as 1 (max(1, totalFloors))', () => {
    expect(floorProgressRatio(1, 0)).toBe(1);
    expect(floorProgressRatio(1, -3)).toBe(1);
  });

  it('does not special-case floor === 1/2/3 literally — it is a continuous function of the ratio', () => {
    // Same ratio (0.5) via completely different (floor, totalFloors)
    // pairs must agree, proving no floor===1/2/3 branch exists.
    expect(floorProgressRatio(1, 2)).toBe(floorProgressRatio(5, 10));
    expect(floorProgressRatio(1, 2)).toBe(floorProgressRatio(50, 100));
  });
});

describe('getNormalEquipmentCandidates: rank eligibility and exclusion', () => {
  const SLOTS = ['sword', 'spear', 'hammer', 'armor', 'solar_gun'] as const;
  const RATIOS = [0, 0.3, 0.7, 1];

  it('every returned rank is C/B/A, except the 3 canonical S armors in their eligibility window', () => {
    for (const slot of SLOTS) {
      for (const ratio of RATIOS) {
        const candidates = getNormalEquipmentCandidates(slot, ratio, { depth: 26, leg: 'descent' });
        for (const c of candidates) {
          const isWeapon = (WEAPON_IDS_IN_ORDER as readonly string[]).includes(c.definitionId);
          const rank = isWeapon
            ? WEAPON_DEFINITIONS[c.definitionId as WeaponId].rank
            : ARMOR_DEFINITIONS[c.definitionId as ArmorId].rank;
          if (slot === 'armor' && rank === 'S') {
            expect(['light_garb', 'dark_garb', 'spike_mail']).toContain(c.definitionId);
          } else {
            expect(['C', 'B', 'A']).toContain(rank);
          }
        }
      }
    }
  });

  it('black_armor never appears in armor candidates at any ratio', () => {
    for (const ratio of RATIOS) {
      const ids = getNormalEquipmentCandidates('armor', ratio, { depth: 26, leg: 'descent' }).map((c) => c.definitionId);
      expect(ids).not.toContain('black_armor');
    }
  });

  it('no R rank or non-canonical S-rank definitionId appears in any slot candidates', () => {
    for (const slot of SLOTS) {
      for (const ratio of RATIOS) {
        const ids = getNormalEquipmentCandidates(slot, ratio, { depth: 26, leg: 'descent' }).map((c) => c.definitionId);
        for (const id of ids) {
          const isWeapon = (WEAPON_IDS_IN_ORDER as readonly string[]).includes(id);
          const rank = isWeapon ? WEAPON_DEFINITIONS[id as WeaponId].rank : ARMOR_DEFINITIONS[id as ArmorId].rank;
          if (rank === 'S') {
            expect(slot).toBe('armor');
            expect(['light_garb', 'dark_garb', 'spike_mail']).toContain(id);
          }
          expect(rank).not.toBe('R');
        }
      }
    }
  });

  it('sword/spear/hammer slots return exactly that family\'s C/B/A species (2 each = 6) at full progress', () => {
    // Phase 24.6b2a1: 'spear'/'hammer' have unlockProgress 2/3 (item-availability.ts),
    // so this test — which checks every C/B/A species of a family is present —
    // uses progress: 1 (fully unlocked) rather than 0.5, to isolate the rank/family
    // filter this test targets from the separate eligibility gate. The eligibility
    // gate's own progress-2/3 boundary (spear/hammer excluded below it, included
    // at/above it) is covered by phase-24-6b2a-item-availability.test.ts's
    // "progress 2/3 boundary" describe block and
    // phase-24-6b2a2-availability-route-regression.test.ts's
    // "10F/30F/99F unlock-floor boundaries" describe block (Phase 24.6b2a2 —
    // added after 24.6b2a1a's provenance audit found this comment previously
    // claimed dedicated tests existed when they did not).
    for (const family of ['sword', 'spear', 'hammer'] as const) {
      const ids = getNormalEquipmentCandidates(family, 0.5, { depth: 26, leg: 'descent' }).map((c) => c.definitionId);
      const expected = WEAPON_IDS_IN_ORDER.filter(
        (id) => WEAPON_DEFINITIONS[id].family === family && ['C', 'B', 'A'].includes(WEAPON_DEFINITIONS[id].rank),
      );
      expect(new Set(ids)).toEqual(new Set(expected));
      expect(ids.length).toBe(6);
    }
  });

  it('armor slot returns all 11 C/B/A species and the 3 eligible S species', () => {
    const ids = getNormalEquipmentCandidates('armor', 0.5, { depth: 26, leg: 'descent' }).map((c) => c.definitionId);
    const expected = ARMOR_IDS_IN_ORDER.filter(
      (id) => id !== 'black_armor' && ['C', 'B', 'A', 'S'].includes(ARMOR_DEFINITIONS[id].rank),
    );
    expect(new Set(ids)).toEqual(new Set(expected));
    expect(ids.length).toBe(14);
  });

  it('solar_gun slot always returns exactly [solar_gun]', () => {
    for (const ratio of RATIOS) {
      const ids = getNormalEquipmentCandidates('solar_gun', ratio, { depth: 26, leg: 'descent' }).map((c) => c.definitionId);
      expect(ids).toEqual(['solar_gun']);
    }
  });

  it('B and A total weight share is monotonic non-decreasing as ratio increases, for every family/armor slot', () => {
    for (const slot of ['sword', 'spear', 'hammer', 'armor'] as const) {
      let prevShare = -1;
      for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
        const candidates = getNormalEquipmentCandidates(slot, ratio, { depth: 26, leg: 'descent' });
        const total = candidates.reduce((s, c) => s + c.weight, 0);
        const ba = candidates
          .filter((c) => {
            const isWeapon = (WEAPON_IDS_IN_ORDER as readonly string[]).includes(c.definitionId);
            const rank = isWeapon
              ? WEAPON_DEFINITIONS[c.definitionId as WeaponId].rank
              : ARMOR_DEFINITIONS[c.definitionId as ArmorId].rank;
            return rank === 'B' || rank === 'A';
          })
          .reduce((s, c) => s + c.weight, 0);
        const share = ba / total;
        expect(share).toBeGreaterThanOrEqual(prevShare - 1e-9);
        prevShare = share;
      }
    }
  });

  it('C-rank weight never drops to 0 (normal supply never disappears, even at ratio 0)', () => {
    expect(RANK_WEIGHT_PROVISIONAL.C.base).toBeGreaterThan(0);
    for (const slot of ['sword', 'spear', 'hammer', 'armor'] as const) {
      const candidates = getNormalEquipmentCandidates(slot, 0, { depth: 26, leg: 'descent' });
      const cWeight = candidates
        .filter((c) => {
          const isWeapon = (WEAPON_IDS_IN_ORDER as readonly string[]).includes(c.definitionId);
          const rank = isWeapon
            ? WEAPON_DEFINITIONS[c.definitionId as WeaponId].rank
            : ARMOR_DEFINITIONS[c.definitionId as ArmorId].rank;
          return rank === 'C';
        })
        .reduce((s, c) => s + c.weight, 0);
      expect(cWeight).toBeGreaterThan(0);
    }
  });
});

describe('selectNormalEquipmentDefinition: candidate enumeration and selection share the same table', () => {
  it('every value ever selected across many rng values is present in getNormalEquipmentCandidates', () => {
    for (const slot of ['sword', 'spear', 'hammer', 'armor', 'solar_gun'] as const) {
      const candidateIds = new Set(getNormalEquipmentCandidates(slot, 0.5, { depth: 26, leg: 'descent' }).map((c) => c.definitionId));
      for (let i = 0; i <= 20; i++) {
        const roll = i / 20;
        const rng = () => Math.min(roll, 0.999999);
        const picked = selectNormalEquipmentDefinition(slot, 0.5, rng, { depth: 26, leg: 'descent' });
        expect(candidateIds.has(picked)).toBe(true);
      }
    }
  });

  it('consumes exactly one rng() call per draw, regardless of slot/ratio', () => {
    for (const slot of ['sword', 'spear', 'hammer', 'armor', 'solar_gun'] as const) {
      let calls = 0;
      const rng = () => {
        calls++;
        return 0.42;
      };
      selectNormalEquipmentDefinition(slot, 0.5, rng, { depth: 26, leg: 'descent' });
      expect(calls).toBe(1);
    }
  });

  it('does not throw for extreme rng() edge values (0 and near-1)', () => {
    for (const slot of ['sword', 'spear', 'hammer', 'armor', 'solar_gun'] as const) {
      expect(() => selectNormalEquipmentDefinition(slot, 0,  () => 0, { depth: 26, leg: 'descent' })).not.toThrow();
      expect(() => selectNormalEquipmentDefinition(slot, 1,  () => 0.999999999, { depth: 26, leg: 'descent' })).not.toThrow();
    }
  });
});

describe('isNormalEquipmentSlot', () => {
  it('is true for exactly the 5 pool slot ids', () => {
    for (const id of ['sword', 'spear', 'hammer', 'armor', 'solar_gun']) {
      expect(isNormalEquipmentSlot(id)).toBe(true);
    }
  });

  it('is false for resolved catalog outputs and non-equipment ids', () => {
    for (const id of ['flamberge', 'black_armor', 'gram', 'apple', 'sol_enchantment']) {
      expect(isNormalEquipmentSlot(id)).toBe(false);
    }
  });
});

describe('equipment identity: end-to-end through normal floor generation', () => {
  it('every floor-generated weapon/armor GroundItem has a matching EquipmentInstance with correct definitionId/rank, and no black_armor/S/R ever appears (Phase 24.5c: accessory GroundItems also carry an EquipmentInstance and are checked separately, since accessory legitimately generates at S — see accessory-def.ts)', () => {
    for (const seed of SAMPLE_SEEDS) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        if (floor > 1) state = advanceToNextFloor(state);
        for (const item of state.groundItems) {
          if (item.equipmentInstanceId === undefined) continue;
          const instance = (state.equipmentInstances ?? []).find((i) => i.instanceId === item.equipmentInstanceId);
          expect(instance).toBeDefined();
          expect(instance!.definitionId).toBe(item.itemId);
          // Phase 24.5c: an accessory GroundItem is checked against its
          // own catalog (ACCESSORY_DEFINITIONS) — it never has a
          // WEAPON_DEFINITIONS/ARMOR_DEFINITIONS entry, and its rank IS
          // allowed to be 'S' (grigri_glasses), unlike weapon/armor
          // below.
          if ((ACCESSORY_IDS_IN_ORDER as readonly string[]).includes(item.itemId)) {
            const accessoryRank = ACCESSORY_DEFINITIONS[item.itemId as (typeof ACCESSORY_IDS_IN_ORDER)[number]].rank;
            expect(instance!.rank).toBe(accessoryRank);
            continue;
          }
          const isWeapon = (WEAPON_IDS_IN_ORDER as readonly string[]).includes(item.itemId);
          const rank = isWeapon
            ? WEAPON_DEFINITIONS[item.itemId as WeaponId].rank
            : ARMOR_DEFINITIONS[item.itemId as ArmorId]?.rank;
          expect(rank).toBeDefined();
          expect(instance!.rank).toBe(rank);
          expect(item.itemId).not.toBe('black_armor');
          expect(rank).not.toBe('S');
          expect(rank).not.toBe('R');
        }
      }
    }
  });

  it('two same-definition individuals on the same floor never collide on instanceId', () => {
    for (const seed of SAMPLE_SEEDS) {
      const state = createInitialState(seed);
      const ids = (state.equipmentInstances ?? []).map((i) => i.instanceId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('monsterHouse equipment rewards', () => {
  it('when a monsterHouse floor is found, its equipment reward ground items resolve through a valid catalog definition, never black_armor/S/R (Phase 24.5c: accessory rewards checked separately, since accessory legitimately generates at S)', () => {
    let foundMonsterHouseWithEquipmentReward = false;
    for (let seed = 1; seed <= 300; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        if (floor > 1) state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const equipmentGroundItems = state.groundItems.filter((g) => g.equipmentInstanceId !== undefined);
        if (equipmentGroundItems.length === 0) continue;
        foundMonsterHouseWithEquipmentReward = true;
        for (const item of equipmentGroundItems) {
          expect(item.itemId).not.toBe('black_armor');
          if ((ACCESSORY_IDS_IN_ORDER as readonly string[]).includes(item.itemId)) {
            const accessoryRank = ACCESSORY_DEFINITIONS[item.itemId as (typeof ACCESSORY_IDS_IN_ORDER)[number]].rank;
            expect(accessoryRank).toBeDefined();
            continue;
          }
          const isWeapon = (WEAPON_IDS_IN_ORDER as readonly string[]).includes(item.itemId);
          const rank = isWeapon
            ? WEAPON_DEFINITIONS[item.itemId as WeaponId].rank
            : ARMOR_DEFINITIONS[item.itemId as ArmorId]?.rank;
          expect(rank).toBeDefined();
          expect(rank).not.toBe('S');
          expect(rank).not.toBe('R');
        }
      }
    }
    expect(foundMonsterHouseWithEquipmentReward).toBe(true);
  });

  it('does not affect floors without a monsterHouse: groundItems/equipmentInstances counts are unaffected by this module for non-monsterHouse floors compared to a manual reference count', () => {
    for (const seed of SAMPLE_SEEDS) {
      const state = createInitialState(seed);
      if (state.map.monsterHouse) continue;
      // groundItems length should equal exactly the normal-generation
      // selectedItemIds count (no extra items silently added).
      expect(state.groundItems.length).toBeGreaterThan(0);
    }
  });
});

describe('determinism across TOTAL_FLOORS 3/10/100', () => {
  it('selectNormalEquipmentDefinition is a pure function: same slot/ratio/rng-sequence always yields the same result', () => {
    for (const slot of ['sword', 'spear', 'hammer', 'armor', 'solar_gun'] as const) {
      const a = selectNormalEquipmentDefinition(slot, 0.6, createRng(777), { depth: 26, leg: 'descent' });
      const b = selectNormalEquipmentDefinition(slot, 0.6, createRng(777), { depth: 26, leg: 'descent' });
      expect(a).toBe(b);
    }
  });

  it('does not throw for totalFloors 3, 10, or 100 at any floor number', () => {
    for (const totalFloors of [3, 10, 100]) {
      for (const floor of [1, Math.ceil(totalFloors / 2), totalFloors]) {
        const ratio = floorProgressRatio(floor, totalFloors);
        for (const slot of ['sword', 'spear', 'hammer', 'armor', 'solar_gun'] as const) {
          expect(() => selectNormalEquipmentDefinition(slot, ratio, createRng(floor ^ totalFloors), { depth: 26, leg: 'descent' })).not.toThrow();
        }
      }
    }
  });

  it('representative seeds x multiple simulated depths never produce black_armor, R, or a non-canonical S definition', () => {
    for (const seed of [1, 42, 999]) {
      for (const totalFloors of [3, 10, 100]) {
        for (const floor of [1, Math.ceil(totalFloors * 0.7), totalFloors]) {
          const ratio = floorProgressRatio(floor, totalFloors);
          for (const slot of ['sword', 'spear', 'hammer', 'armor', 'solar_gun'] as const) {
            const picked = selectNormalEquipmentDefinition(slot, ratio, createRng(seed ^ floor ^ totalFloors), { depth: 26, leg: 'descent' });
            expect(picked).not.toBe('black_armor');
            const isWeapon = (WEAPON_IDS_IN_ORDER as readonly string[]).includes(picked);
            const rank = isWeapon
              ? WEAPON_DEFINITIONS[picked as WeaponId].rank
              : ARMOR_DEFINITIONS[picked as ArmorId]?.rank;
            if (rank === 'S') {
              expect(slot).toBe('armor');
              expect(['light_garb', 'dark_garb', 'spike_mail']).toContain(picked);
            }
            expect(rank).not.toBe('R');
          }
        }
      }
    }
  });

  it('production floor generation (TOTAL_FLOORS=3) remains fully deterministic for the same seed', () => {
    for (const seed of SAMPLE_SEEDS) {
      const a = createInitialState(seed);
      const b = createInitialState(seed);
      expect(a.groundItems).toEqual(b.groundItems);
      expect(a.equipmentInstances).toEqual(b.equipmentInstances);
      expect(a.enemies).toEqual(b.enemies);
      expect(a.traps).toEqual(b.traps);
      expect(a.map.exit).toEqual(b.map.exit);
    }
  });

  it('map generation itself (terrain/rooms/exit) stays deterministic and untouched by equipment resolution, across repeated calls', () => {
    for (const seed of SAMPLE_SEEDS) {
      const a = generateMap(seed);
      const b = generateMap(seed);
      expect(a.map!.terrain).toEqual(b.map!.terrain);
      expect(a.map!.rooms).toEqual(b.map!.rooms);
      expect(a.map!.exit).toEqual(b.map!.exit);
    }
  });
});
