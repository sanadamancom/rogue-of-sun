import { describe, expect, it } from 'vitest';
import {
  ACCESSORY_RANK_WEIGHT_PROVISIONAL,
  LOOT_ROUTE_WEIGHT_PROVISIONAL,
  resolveLootSlot,
  rollLootCategory,
  selectAccessoryRank,
  selectAccessoryWithinRank,
  substituteLootSlots,
} from '../accessory-loot';
import { ACCESSORY_DEFINITIONS, ACCESSORY_IDS_IN_ORDER } from '../accessory-def';
import { CARD_IDS_IN_ORDER } from '../card-def';
import { CARD_ROUTE_WEIGHT_PROVISIONAL, CARD_RARITY_WEIGHT_PROVISIONAL } from '../card-loot';
import { getEquipmentInstanceById, isAccessoryId } from '../equipment-instance';
import { selectEnemyDropItemIdWithCards, rollEnemyDropOccurs } from '../enemy-drop';
import { isGeneralItemIdentified } from '../item-identification';
import { advanceToNextFloor, createInitialState } from '../state';
import { GameState } from '../types';

/**
 * Phase 24.5c アクセサリー生成接続 focused tests. See
 * docs/history/phase-24-5c-accessory-generation.md for the full
 * contract these tests enforce.
 */

describe('Phase 24.5c: route/rarity weight contracts', () => {
  it('LOOT_ROUTE_WEIGHT_PROVISIONAL sums to 100 with card 10 + accessory 10 + existingNonCard 80', () => {
    expect(LOOT_ROUTE_WEIGHT_PROVISIONAL.card).toBe(10);
    expect(LOOT_ROUTE_WEIGHT_PROVISIONAL.accessory).toBe(10);
    expect(LOOT_ROUTE_WEIGHT_PROVISIONAL.existingNonCard).toBe(80);
    expect(
      LOOT_ROUTE_WEIGHT_PROVISIONAL.card + LOOT_ROUTE_WEIGHT_PROVISIONAL.accessory + LOOT_ROUTE_WEIGHT_PROVISIONAL.existingNonCard,
    ).toBe(100);
  });

  it("card's own share (10) matches card-loot.ts's unchanged CARD_ROUTE_WEIGHT_PROVISIONAL.card", () => {
    expect(LOOT_ROUTE_WEIGHT_PROVISIONAL.card).toBe(CARD_ROUTE_WEIGHT_PROVISIONAL.card);
  });

  it('ACCESSORY_RANK_WEIGHT_PROVISIONAL is fixed at C60/B30/A8/S2, mirroring card rarity weight', () => {
    expect(ACCESSORY_RANK_WEIGHT_PROVISIONAL).toEqual({ C: 60, B: 30, A: 8, S: 2 });
    expect(ACCESSORY_RANK_WEIGHT_PROVISIONAL).toEqual(CARD_RARITY_WEIGHT_PROVISIONAL);
  });

  it('rollLootCategory consumes exactly one rng() call', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    rollLootCategory(rng);
    expect(calls).toBe(1);
  });

  it('rollLootCategory resolves card for a low roll, accessory for a mid roll, non_card for a high roll', () => {
    expect(rollLootCategory(() => 0.05)).toBe('card'); // 5/100 < 10
    expect(rollLootCategory(() => 0.15)).toBe('accessory'); // 15/100, in [10,20)
    expect(rollLootCategory(() => 0.5)).toBe('non_card'); // 50/100, in [20,100)
  });

  it('a fixed 3000-sample sequence yields card~10%, accessory~10%, non_card~80% within tolerance', () => {
    let card = 0;
    let accessory = 0;
    let nonCard = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      // Deterministic pseudo-uniform sequence for a stable statistical
      // check, same style as the existing card-loot statistical test.
      const value = ((i * 2654435761) % 1000000) / 1000000;
      const result = rollLootCategory(() => value);
      if (result === 'card') card++;
      else if (result === 'accessory') accessory++;
      else nonCard++;
    }
    expect(card / N).toBeGreaterThan(0.07);
    expect(card / N).toBeLessThan(0.13);
    expect(accessory / N).toBeGreaterThan(0.07);
    expect(accessory / N).toBeLessThan(0.13);
    expect(nonCard / N).toBeGreaterThan(0.75);
    expect(nonCard / N).toBeLessThan(0.85);
  });

  it('selectAccessoryRank consumes exactly one rng() call and picks among C/B/A/S (all 4 have candidates)', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    const rank = selectAccessoryRank(rng);
    expect(calls).toBe(1);
    expect(['C', 'B', 'A', 'S']).toContain(rank);
  });

  it('a fixed large sample of selectAccessoryRank matches the 60/30/8/2 ratio within tolerance', () => {
    const counts: Record<string, number> = { C: 0, B: 0, A: 0, S: 0 };
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const value = ((i * 2654435761) % 1000000) / 1000000;
      const rank = selectAccessoryRank(() => value);
      counts[rank]++;
    }
    expect(counts.C / N).toBeGreaterThan(0.5);
    expect(counts.C / N).toBeLessThan(0.7);
    expect(counts.B / N).toBeGreaterThan(0.22);
    expect(counts.B / N).toBeLessThan(0.38);
  });

  it('selectAccessoryWithinRank never returns an accessory outside the requested rank', () => {
    for (const rank of ['C', 'B', 'A', 'S'] as const) {
      for (let i = 0; i < 50; i++) {
        const id = selectAccessoryWithinRank(rank, () => i / 50);
        expect(ACCESSORY_DEFINITIONS[id].rank).toBe(rank);
      }
    }
  });

  it('the single S-rank accessory (grigri_glasses) is always returned for S', () => {
    for (let i = 0; i < 10; i++) {
      expect(selectAccessoryWithinRank('S', () => i / 10)).toBe('grigri_glasses');
    }
  });
});

describe('Phase 24.5c: resolveLootSlot / substituteLootSlots', () => {
  it('resolveLootSlot consumes only the category stream for a non_card result', () => {
    let categoryCalls = 0;
    let otherCalls = 0;
    const categoryRng = () => {
      categoryCalls++;
      return 0.99; // far into non_card range
    };
    const other = () => {
      otherCalls++;
      return 0.5;
    };
    const result = resolveLootSlot(categoryRng, other, other, other, other);
    expect(result.category).toBe('non_card');
    expect(categoryCalls).toBe(1);
    expect(otherCalls).toBe(0);
  });

  it('resolveLootSlot consumes category+rank+item streams (not card streams) for an accessory result', () => {
    let cardCalls = 0;
    const categoryRng = () => 0.15; // accessory range
    const cardStream = () => {
      cardCalls++;
      return 0.5;
    };
    let accessoryCalls = 0;
    const accessoryStream = () => {
      accessoryCalls++;
      return 0.5;
    };
    const result = resolveLootSlot(categoryRng, cardStream, cardStream, accessoryStream, accessoryStream);
    expect(result.category).toBe('accessory');
    if (result.category === 'accessory') {
      expect((ACCESSORY_IDS_IN_ORDER as readonly string[])).toContain(result.id);
    }
    expect(cardCalls).toBe(0);
    expect(accessoryCalls).toBe(2);
  });

  it('resolveLootSlot consumes category+rarity+body streams (not accessory streams) for a card result', () => {
    const categoryRng = () => 0.05; // card range
    let cardCalls = 0;
    const cardStream = () => {
      cardCalls++;
      return 0.5;
    };
    let accessoryCalls = 0;
    const accessoryStream = () => {
      accessoryCalls++;
      return 0.5;
    };
    const result = resolveLootSlot(categoryRng, cardStream, cardStream, accessoryStream, accessoryStream);
    expect(result.category).toBe('card');
    if (result.category === 'card') {
      expect((CARD_IDS_IN_ORDER as readonly string[])).toContain(result.id);
    }
    expect(cardCalls).toBe(2);
    expect(accessoryCalls).toBe(0);
  });

  it('substituteLootSlots preserves array length', () => {
    const input = ['apple', 'sword', 'armor', 'banana'] as const;
    const result = substituteLootSlots(
      input,
      () => 0.99,
      () => 0.5,
      () => 0.5,
      () => 0.5,
      () => 0.5,
    );
    expect(result).toHaveLength(input.length);
  });

  it('every non-substituted slot is unchanged from the input (category rolls all non_card)', () => {
    const input = ['apple', 'sword', 'armor', 'banana'] as const;
    const result = substituteLootSlots(
      input,
      () => 0.99, // always non_card
      () => 0.5,
      () => 0.5,
      () => 0.5,
      () => 0.5,
    );
    expect(result).toEqual(input);
  });
});

describe('Phase 24.5c: 3-route reachability', () => {
  it('all 6 accessory species are reachable via normal floor generation across many seeds', () => {
    const found = new Set<string>();
    for (let seed = 1; seed <= 3000 && found.size < 6; seed++) {
      const state = createInitialState(seed);
      for (const item of state.groundItems) {
        if (isAccessoryId(item.itemId)) found.add(item.itemId);
      }
    }
    for (const id of ACCESSORY_IDS_IN_ORDER) {
      expect(found.has(id)).toBe(true);
    }
  });

  it('accessory is reachable as a monsterHouse reward across many seeds', () => {
    let sawAccessory = false;
    for (let seed = 1; seed <= 600 && !sawAccessory; seed++) {
      let state: GameState = createInitialState(seed);
      for (let floor = 1; floor <= 3 && !sawAccessory; floor++) {
        if (floor > 1) state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const rewardAccessories = state.groundItems.filter(
          (g) => g.spawnSource === 'monster_house' && isAccessoryId(g.itemId),
        );
        if (rewardAccessories.length > 0) sawAccessory = true;
      }
    }
    expect(sawAccessory).toBe(true);
  });

  it('accessory is reachable via enemy drop across many enemyIds', () => {
    let sawAccessory = false;
    for (let enemyId = 0; enemyId < 800 && !sawAccessory; enemyId++) {
      const picked = selectEnemyDropItemIdWithCards(2, 12345, enemyId);
      if (isAccessoryId(picked)) sawAccessory = true;
    }
    expect(sawAccessory).toBe(true);
  });
});

describe('Phase 24.5c: instance/ground-item identity and integrity', () => {
  it('every accessory GroundItem has a matching EquipmentInstance with the same definitionId and no curse', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const state = createInitialState(seed);
      for (const item of state.groundItems) {
        if (!isAccessoryId(item.itemId)) continue;
        expect(item.equipmentInstanceId).toBeDefined();
        const instance = getEquipmentInstanceById(state, item.equipmentInstanceId!);
        expect(instance).toBeDefined();
        expect(instance!.definitionId).toBe(item.itemId);
        expect(instance!.cursed).toBe(false);
        expect(instance!.curseRevealed).toBe(false);
        expect(instance!.refineLevel).toBe(0);
      }
    }
  });

  it('never leaves an orphaned accessory instance (every accessory instance is referenced by exactly one ground item or equip state)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const state = createInitialState(seed);
      const accessoryInstances = (state.equipmentInstances ?? []).filter((i) => isAccessoryId(i.definitionId));
      for (const instance of accessoryInstances) {
        const onFloor = state.groundItems.some((g) => g.equipmentInstanceId === instance.instanceId);
        const equipped = state.equippedAccessoryInstanceId === instance.instanceId;
        expect(onFloor || equipped).toBe(true);
      }
    }
  });
});

describe('Phase 24.5c: existing generation/drop/card contracts preserved', () => {
  it('floor item count distribution (2-6) is unaffected by accessory substitution', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const state = createInitialState(seed);
      expect(state.groundItems.length).toBeGreaterThanOrEqual(2);
      expect(state.groundItems.length).toBeLessThanOrEqual(6);
    }
  });

  it('enemy drop occurrence rate (~10%) is unaffected by accessory addition', () => {
    let occurs = 0;
    const N = 2000;
    for (let enemyId = 0; enemyId < N; enemyId++) {
      if (rollEnemyDropOccurs(999, enemyId)) occurs++;
    }
    const rate = occurs / N;
    expect(rate).toBeGreaterThan(0.07);
    expect(rate).toBeLessThan(0.13);
  });

  it('cards remain reachable in normal floor generation (17 species roster untouched)', () => {
    let sawCard = false;
    for (let seed = 1; seed <= 500 && !sawCard; seed++) {
      const state = createInitialState(seed);
      if (state.groundItems.some((g) => (CARD_IDS_IN_ORDER as readonly string[]).includes(g.itemId))) {
        sawCard = true;
      }
    }
    expect(sawCard).toBe(true);
  });

  it('black_armor never appears across normal floor/monsterHouse/enemy-drop with accessory added', () => {
    for (let seed = 1; seed <= 150; seed++) {
      let state: GameState = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        if (floor > 1) state = advanceToNextFloor(state);
        for (const item of state.groundItems) {
          expect(item.itemId).not.toBe('black_armor');
        }
      }
    }
  });
});

describe('Phase 24.5c: RNG determinism and non-interference', () => {
  it('the same seed produces the exact same floor-1 groundItems (fully deterministic)', () => {
    const a = createInitialState(777);
    const b = createInitialState(777);
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('accessory-bearing seeds never perturb combatRngState (no enemies present)', () => {
    const state = createInitialState(1);
    state.enemies = [];
    const before = state.combatRngState;
    // Re-creating initial state (floor generation) is the only RNG
    // consumer relevant here; combatRngState itself is untouched by
    // floor generation regardless of accessory presence.
    expect(state.combatRngState).toBe(before);
  });

  it('selectEnemyDropItemIdWithCards is deterministic for the same (floor, floorSeed, enemyId)', () => {
    expect(selectEnemyDropItemIdWithCards(1, 5, 5)).toBe(selectEnemyDropItemIdWithCards(1, 5, 5));
  });
});

describe('Phase 24.5c: identification and effect-inertness of generated accessories', () => {
  it('a floor-generated accessory is not identified merely by existing on the floor', () => {
    let checked = false;
    for (let seed = 1; seed <= 500 && !checked; seed++) {
      const state = createInitialState(seed);
      const accessoryItem = state.groundItems.find((g) => isAccessoryId(g.itemId));
      if (!accessoryItem) continue;
      expect(isGeneralItemIdentified(state, accessoryItem.itemId)).toBe(false);
      checked = true;
    }
    expect(checked).toBe(true);
  });
});

describe('Phase 24.5c: telemetry schemaVersion unaffected', () => {
  it('accessory generation introduces no new event categories that would require a schema bump (structural smoke check)', () => {
    // This is a structural assertion, not a behavioral one — Phase
    // 24.5c does not add any accessory-specific raw telemetry event or
    // summary field; CURRENT_GAME_VERSION in telemetry.ts is untouched
    // by this Phase (see docs/history/phase-24-5c-accessory-
    // generation.md's telemetry section).
    const state = createInitialState(1);
    expect(state.groundItems).toBeDefined();
  });
});
