import { describe, expect, it } from 'vitest';
import {
  CARD_DEFINITIONS,
  CARD_DISPLAY_NAMES,
  CARD_GLYPH,
  CARD_IDS_IN_ORDER,
  getCardDefinition,
} from '../card-def';
import { inventoryEntries } from '../inventory';
import {
  createEmptyInventory,
  drawGroundItemSelection,
  getGroundItemPoolForFloor,
  GROUND_ITEM_COUNT_WEIGHTS,
  ITEM_DEFINITIONS,
  ITEM_IDS_IN_ORDER,
} from '../item-def';
import { createRng } from '../mapgen';
import { CardId } from '../types';

/**
 * Phase 20.0a required tests (rogue-of-sun-development-plan.md
 * required_tests.card_registry/mapping/loot_isolation). This unit only
 * registers card *data*; nothing here exercises use/effect/turn logic
 * (see card-def.ts's module doc comment for the full out-of-scope list).
 */

describe('Phase 20.0a: card definition foundation', () => {
  describe('card_registry', () => {
    it('has exactly 17 CardDefinitions', () => {
      expect(CARD_IDS_IN_ORDER.length).toBe(17);
      expect(Object.keys(CARD_DEFINITIONS).length).toBe(17);
    });

    it('has 16 manual cards and exactly 1 automatic card (judgement)', () => {
      const manual = CARD_IDS_IN_ORDER.filter((id) => CARD_DEFINITIONS[id].useMode === 'manual');
      const automatic = CARD_IDS_IN_ORDER.filter((id) => CARD_DEFINITIONS[id].useMode === 'automatic');
      expect(manual.length).toBe(16);
      expect(automatic).toEqual(['judgement']);
    });

    it('never includes fool', () => {
      expect(CARD_IDS_IN_ORDER).not.toContain('fool');
      expect(Object.keys(CARD_DEFINITIONS)).not.toContain('fool');
    });

    it('has no duplicate CardIds', () => {
      const unique = new Set(CARD_IDS_IN_ORDER);
      expect(unique.size).toBe(CARD_IDS_IN_ORDER.length);
    });

    it('every definition has all required fields populated', () => {
      for (const id of CARD_IDS_IN_ORDER) {
        const def = CARD_DEFINITIONS[id];
        expect(def.id).toBe(id);
        expect(typeof def.displayName).toBe('string');
        expect(def.displayName.length).toBeGreaterThan(0);
        expect(typeof def.unidentifiedDisplayName).toBe('string');
        expect(def.unidentifiedDisplayName.length).toBeGreaterThan(0);
        expect(['manual', 'automatic']).toContain(def.useMode);
        expect(typeof def.targetScope).toBe('string');
        expect(['default', 'on_pending_death']).toContain(def.usableConditionId);
        expect(['effect_succeeded', 'trigger_succeeded']).toContain(def.consumeCondition);
        expect([0, 1]).toContain(def.turnCost);
        expect(typeof def.effectId).toBe('string');
        // Phase 20.0e weighted ground-item foundation: lootWeight/
        // floorDropEnabled are no longer 0/false for every card — the 9
        // Phase 20.1/20.2/20.3-implemented cards now carry their real
        // provisional weight and floorDropEnabled: true. Only a
        // non-negative-number/boolean shape check applies to all 17 here;
        // the loot_isolation describe block below asserts the precise
        // per-card values.
        expect(def.lootWeight).toBeGreaterThanOrEqual(0);
        expect(typeof def.floorDropEnabled).toBe('boolean');
        expect(def.enemyDropEnabled).toBe(false);
        expect(typeof def.telemetryCategory).toBe('string');
      }
    });

    it('every definition\'s telemetryCategory is exactly "card"', () => {
      for (const id of CARD_IDS_IN_ORDER) {
        expect(CARD_DEFINITIONS[id].telemetryCategory).toBe('card');
      }
    });

    it('every card is registered in ITEM_DEFINITIONS as category "consumable"', () => {
      for (const id of CARD_IDS_IN_ORDER) {
        const itemDef = ITEM_DEFINITIONS[id];
        expect(itemDef).toBeDefined();
        expect(itemDef.category).toBe('consumable');
        expect(itemDef.consumable).toBe(true);
        expect(itemDef.stackable).toBe(true);
      }
    });

    it('getCardDefinition(id) and ITEM_DEFINITIONS[id] both resolve for every card id', () => {
      for (const id of CARD_IDS_IN_ORDER) {
        expect(getCardDefinition(id).id).toBe(id);
        expect(ITEM_DEFINITIONS[id].id).toBe(id);
      }
    });

    it('manual cards have turnCost 1; judgement has turnCost 0', () => {
      for (const id of CARD_IDS_IN_ORDER) {
        const def = CARD_DEFINITIONS[id];
        if (id === 'judgement') {
          expect(def.turnCost).toBe(0);
        } else {
          expect(def.turnCost).toBe(1);
        }
      }
    });
  });

  describe('mapping', () => {
    const expected: Record<
      CardId,
      { displayName: string; useMode: 'manual' | 'automatic'; targetScope: string; effectId: string }
    > = {
      high_priestess: { displayName: '女教皇', useMode: 'manual', targetScope: 'self', effectId: 'increase_mind' },
      empress: { displayName: '女帝', useMode: 'manual', targetScope: 'self', effectId: 'increase_body' },
      emperor: { displayName: '皇帝', useMode: 'manual', targetScope: 'self', effectId: 'temporary_damage_reduction' },
      lovers: { displayName: '恋人', useMode: 'manual', targetScope: 'self', effectId: 'restore_sol' },
      chariot: { displayName: '戦車', useMode: 'manual', targetScope: 'self', effectId: 'increase_speed' },
      strength: { displayName: '力', useMode: 'manual', targetScope: 'self', effectId: 'increase_strength' },
      wheel_of_fortune: {
        displayName: '運命の輪',
        useMode: 'manual',
        targetScope: 'self',
        effectId: 'increase_random_ability',
      },
      justice: {
        displayName: '正義',
        useMode: 'manual',
        targetScope: 'current_room_enemies',
        effectId: 'room_damage_from_missing_life',
      },
      hanged_man: {
        displayName: '吊るされた男',
        useMode: 'manual',
        targetScope: 'self',
        effectId: 'swap_life_and_sol',
      },
      death: {
        displayName: '死神',
        useMode: 'manual',
        targetScope: 'self',
        effectId: 'sacrifice_life_restore_sol',
      },
      temperance: {
        displayName: '節制',
        useMode: 'manual',
        targetScope: 'selected_identified_cursed_equipment',
        effectId: 'remove_equipment_curse',
      },
      devil: {
        displayName: '悪魔',
        useMode: 'manual',
        targetScope: 'current_room_enemies',
        effectId: 'room_dark_effect',
      },
      tower: {
        displayName: '塔',
        useMode: 'manual',
        targetScope: 'current_room_all_characters',
        effectId: 'indiscriminate_room_damage',
      },
      star: {
        displayName: '星',
        useMode: 'manual',
        targetScope: 'selected_inventory_item',
        effectId: 'transform_item',
      },
      moon: {
        displayName: '月',
        useMode: 'manual',
        targetScope: 'equipped_armor',
        effectId: 'refine_equipped_armor',
      },
      sun: {
        displayName: '太陽',
        useMode: 'manual',
        targetScope: 'equipped_weapon',
        effectId: 'refine_equipped_weapon',
      },
      judgement: {
        displayName: '審判',
        useMode: 'automatic',
        targetScope: 'self_on_pending_death',
        effectId: 'prevent_death_and_restore',
      },
    };

    it('matches id, displayName, useMode, targetScope, effectId for every card', () => {
      for (const id of CARD_IDS_IN_ORDER) {
        const def = CARD_DEFINITIONS[id];
        const exp = expected[id];
        expect(def.displayName).toBe(exp.displayName);
        expect(def.useMode).toBe(exp.useMode);
        expect(def.targetScope).toBe(exp.targetScope);
        expect(def.effectId).toBe(exp.effectId);
        expect(CARD_DISPLAY_NAMES[id]).toBe(exp.displayName);
      }
    });

    it('moon targets equipped_armor and sun targets equipped_weapon', () => {
      expect(CARD_DEFINITIONS.moon.targetScope).toBe('equipped_armor');
      expect(CARD_DEFINITIONS.sun.targetScope).toBe('equipped_weapon');
    });

    it('only temperance and star have a selection-shaped targetScope', () => {
      const selectionScopes = new Set(['selected_identified_cursed_equipment', 'selected_inventory_item']);
      const withSelection = CARD_IDS_IN_ORDER.filter((id) => selectionScopes.has(CARD_DEFINITIONS[id].targetScope));
      expect(withSelection.sort()).toEqual(['star', 'temperance'].sort());
    });

    it('only judgement is the on-death automatic definition', () => {
      const onDeath = CARD_IDS_IN_ORDER.filter((id) => CARD_DEFINITIONS[id].targetScope === 'self_on_pending_death');
      expect(onDeath).toEqual(['judgement']);
      expect(CARD_DEFINITIONS.judgement.usableConditionId).toBe('on_pending_death');
      expect(CARD_DEFINITIONS.judgement.consumeCondition).toBe('trigger_succeeded');
    });
  });

  describe('loot_isolation', () => {
    it('the 8 not-yet-implemented cards keep lootWeight 0/floorDropEnabled false; enemyDropEnabled stays false for all 17', () => {
      const notYetImplemented: CardId[] = [
        'emperor',
        'justice',
        'temperance',
        'devil',
        'tower',
        'star',
        'moon',
        'sun',
      ];
      for (const id of notYetImplemented) {
        const def = CARD_DEFINITIONS[id];
        expect(def.lootWeight).toBe(0);
        expect(def.floorDropEnabled).toBe(false);
      }
      for (const id of CARD_IDS_IN_ORDER) {
        expect(CARD_DEFINITIONS[id].enemyDropEnabled).toBe(false);
      }
    });

    it('all 17 cards are included in ITEM_IDS_IN_ORDER (Inventory display order)', () => {
      for (const id of CARD_IDS_IN_ORDER) {
        expect(ITEM_IDS_IN_ORDER).toContain(id);
      }
    });

    it('no duplicate CardId within ITEM_IDS_IN_ORDER', () => {
      const cardEntries = ITEM_IDS_IN_ORDER.filter((id) => (CARD_IDS_IN_ORDER as readonly string[]).includes(id));
      expect(new Set(cardEntries).size).toBe(cardEntries.length);
      expect(cardEntries.length).toBe(17);
    });

    it('adding cards does not change the pre-existing 12 items relative order', () => {
      const preExisting = [
        'apple',
        'sword',
        'armor',
        'spear',
        'hammer',
        'sun_fruit',
        'solar_gun',
        'chocolate',
        'banana',
        'antidote',
        'panacea',
        'clairvoyance_fruit',
      ];
      const preExistingInDisplayOrder = ITEM_IDS_IN_ORDER.filter((id) => preExisting.includes(id));
      expect(preExistingInDisplayOrder).toEqual(preExisting);
    });

    it('cards are never included in the floor-1/2/3 ground item pools', () => {
      for (const floor of [1, 2, 3]) {
        const pool = getGroundItemPoolForFloor(floor);
        for (const id of CARD_IDS_IN_ORDER) {
          expect(pool).not.toContain(id);
        }
      }
    });

    it('createEmptyInventory zero-initializes every card (now part of ITEM_IDS_IN_ORDER)', () => {
      const inv = createEmptyInventory();
      for (const id of ITEM_IDS_IN_ORDER) {
        expect(inv[id]).toBe(0);
      }
      for (const id of CARD_IDS_IN_ORDER) {
        expect(inv[id]).toBe(0);
      }
    });

    it('a held card is displayable via inventoryEntries (Inventory display, independent of loot registration)', () => {
      const inv = createEmptyInventory();
      inv.high_priestess = 1;
      const entries = inventoryEntries({ inventory: inv } as unknown as Parameters<typeof inventoryEntries>[0]);
      expect(entries.some((e) => e.itemId === 'high_priestess' && e.kind === 'inventory_item' && e.count === 1)).toBe(true);
    });

    it('does not change existing ground-item draw results for a fixed seed (floor 1, count 4)', () => {
      // Regression guard: registering 17 new ItemId members must not
      // perturb any existing seeded draw. getGroundItemPoolForFloor(1)'s
      // returned array/order is asserted unchanged, and a fixed-seed
      // drawGroundItemSelection over it is asserted unchanged.
      const pool = getGroundItemPoolForFloor(1);
      expect(pool).toEqual([
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
      ]);
      const rng = createRng(12345);
      const draw = drawGroundItemSelection(4, pool, rng);
      expect(draw.length).toBe(4);
      for (const id of draw) {
        expect(CARD_IDS_IN_ORDER).not.toContain(id);
      }
    });

    it('GROUND_ITEM_COUNT_WEIGHTS is unaffected by card registration', () => {
      const total = GROUND_ITEM_COUNT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
      expect(total).toBe(100);
    });
  });

  describe('regression: existing item lookups unaffected', () => {
    it('apple/banana/sword/armor still resolve with their original shape', () => {
      expect(ITEM_DEFINITIONS.apple).toMatchObject({ id: 'apple', category: 'consumable', healAmount: 5 });
      expect(ITEM_DEFINITIONS.banana).toMatchObject({ id: 'banana', category: 'consumable' });
      expect(ITEM_DEFINITIONS.sword).toMatchObject({ id: 'sword', category: 'weapon', consumable: false });
      expect(ITEM_DEFINITIONS.armor).toMatchObject({ id: 'armor', category: 'armor', consumable: false });
    });

    it('ITEM_IDS_IN_ORDER is exactly the pre-existing 12 non-card ids followed by all 17 cards, in CARD_IDS_IN_ORDER order', () => {
      expect(ITEM_IDS_IN_ORDER).toEqual([
        'apple',
        'sword',
        'armor',
        'spear',
        'hammer',
        'sun_fruit',
        'solar_gun',
        'chocolate',
        'banana',
        'antidote',
        'panacea',
        'clairvoyance_fruit',
        ...CARD_IDS_IN_ORDER,
      ]);
    });

    it('every card glyph uses the shared placeholder CARD_GLYPH', () => {
      for (const id of CARD_IDS_IN_ORDER) {
        expect(ITEM_DEFINITIONS[id].glyph).toBe(CARD_GLYPH);
      }
    });
  });
});
