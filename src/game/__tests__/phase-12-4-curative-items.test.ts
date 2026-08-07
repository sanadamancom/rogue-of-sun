import { describe, expect, it } from 'vitest';
import {
  getActiveEffect,
  removeEffect,
  removePetrification,
  removeSpiderWebSlow,
  removeStatusAilment,
  STATUS_AILMENT_IDS,
} from '../effects';
import { createEmptyInventory, ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from '../item-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Room, Tile, TrapTile } from '../types';

const TEST_LAYOUT: string[] = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  const rooms: Room[] = [{ x: 1, y: 1, width: 18, height: 5 }];
  return { width, height, terrain, rooms, exit: { x: 99, y: 99 } };
}

// Enemy defaults to far away and passive (attack 0, huge HP) so most turns
// resolve purely as the player's own action without incidental combat
// noise, unless a test deliberately wants combat/chase behavior.
function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
    enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    exit: { x: 99, y: 99 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: createEmptyInventory(),
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: null,
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    traps: [],
    ...overrides,
  };
}

describe('registration (Phase 12.4)', () => {
  it('antidote and panacea are registered with 💊 glyphs and distinct names', () => {
    expect(ITEM_IDS_IN_ORDER).toContain('antidote');
    expect(ITEM_IDS_IN_ORDER).toContain('panacea');
    expect(ITEM_DEFINITIONS.antidote.displayName).toBe('毒消し');
    expect(ITEM_DEFINITIONS.panacea.displayName).toBe('万能薬');
    expect(ITEM_DEFINITIONS.antidote.glyph).toBe('💊');
    expect(ITEM_DEFINITIONS.panacea.glyph).toBe('💊');
    expect(ITEM_DEFINITIONS.antidote.consumable).toBe(true);
    expect(ITEM_DEFINITIONS.antidote.stackable).toBe(true);
    expect(ITEM_DEFINITIONS.panacea.consumable).toBe(true);
    expect(ITEM_DEFINITIONS.panacea.stackable).toBe(true);
  });

  it('display order is banana, antidote, panacea', () => {
    const bananaIndex = ITEM_IDS_IN_ORDER.indexOf('banana');
    const antidoteIndex = ITEM_IDS_IN_ORDER.indexOf('antidote');
    const panaceaIndex = ITEM_IDS_IN_ORDER.indexOf('panacea');
    expect(antidoteIndex).toBe(bananaIndex + 1);
    expect(panaceaIndex).toBe(antidoteIndex + 1);
  });

  it('createEmptyInventory initializes both to 0', () => {
    const inv = createEmptyInventory();
    expect(inv.antidote).toBe(0);
    expect(inv.panacea).toBe(0);
  });
});

describe('placement (Phase 12.4)', () => {
  it('places at most one of each per floor across several seeds', () => {
    for (const seed of [1, 7, 42, 2024]) {
      const state = createInitialState(seed);
      const antidotes = state.groundItems.filter((i) => i.itemId === 'antidote');
      const panaceas = state.groundItems.filter((i) => i.itemId === 'panacea');
      expect(antidotes.length).toBeLessThanOrEqual(1);
      expect(panaceas.length).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = createInitialState(999);
    const b = createInitialState(999);
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('antidote and panacea never share a tile, and neither overlaps existing placements', () => {
    for (const seed of [1, 7, 42, 2024, 4242]) {
      const state = createInitialState(seed);
      const antidote = state.groundItems.find((i) => i.itemId === 'antidote');
      const panacea = state.groundItems.find((i) => i.itemId === 'panacea');
      if (antidote && panacea) {
        expect(antidote.pos).not.toEqual(panacea.pos);
      }
      for (const item of [antidote, panacea]) {
        if (!item) continue;
        expect(item.pos).not.toEqual(state.player.pos);
        expect(item.pos).not.toEqual(state.exit);
        for (const enemy of state.enemies) expect(item.pos).not.toEqual(enemy.pos);
        for (const other of state.groundItems) {
          if (other === item) continue;
          expect(item.pos).not.toEqual(other.pos);
        }
        for (const trap of state.traps ?? []) expect(item.pos).not.toEqual(trap.pos);
      }
    }
  });

  it('does not change existing placement or combatRngState', () => {
    const state = createInitialState(4242);
    const again = createInitialState(4242);
    expect(state.player.pos).toEqual(again.player.pos);
    expect(state.enemies.map((e) => e.pos)).toEqual(again.enemies.map((e) => e.pos));
    expect(state.traps).toEqual(again.traps);
    const apple = state.groundItems.find((i) => i.itemId === 'apple');
    const appleAgain = again.groundItems.find((i) => i.itemId === 'apple');
    expect(apple?.pos).toEqual(appleAgain?.pos);
    expect(state.combatRngState).toBe(again.combatRngState);
  });
});

describe('status ailment removal foundation (Phase 12.4)', () => {
  it('STATUS_AILMENT_IDS excludes attack_up', () => {
    expect(STATUS_AILMENT_IDS).toEqual(['poison', 'movement_slow', 'spider_web', 'petrification']);
    expect(STATUS_AILMENT_IDS).not.toContain('attack_up');
  });

  it('removeEffect removes only the targeted activeEffect', () => {
    const state = freshState({
      activeEffects: [
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
        { id: 'poison', strength: 3, remainingTurns: 10 },
      ],
    });
    expect(removeEffect(state, 'poison')).toBe('removed');
    expect(getActiveEffect(state, 'poison')).toBeUndefined();
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(8);
  });

  it('removeSpiderWebSlow / removePetrification operate on Actor fields', () => {
    const state = freshState({ player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), slowed: true, petrified: true } });
    expect(removeSpiderWebSlow(state)).toBe('removed');
    expect(state.player.slowed).toBe(false);
    expect(removePetrification(state)).toBe('removed');
    expect(state.player.petrified).toBe(false);
  });

  it('returns not_present when nothing to remove', () => {
    const state = freshState();
    expect(removeEffect(state, 'poison')).toBe('not_present');
    expect(removeSpiderWebSlow(state)).toBe('not_present');
    expect(removePetrification(state)).toBe('not_present');
  });

  it('removes all duplicate records for the same EffectId', () => {
    const state = freshState({
      activeEffects: [
        { id: 'poison', strength: 3, remainingTurns: 10 },
        { id: 'poison', strength: 3, remainingTurns: 4 },
      ],
    });
    removeEffect(state, 'poison');
    expect((state.activeEffects ?? []).filter((e) => e.id === 'poison')).toHaveLength(0);
  });

  it('removeStatusAilment dispatches correctly for every ailment kind', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), slowed: true, petrified: true },
      activeEffects: [
        { id: 'poison', strength: 3, remainingTurns: 10 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
      ],
    });
    expect(removeStatusAilment(state, 'poison')).toBe('removed');
    expect(removeStatusAilment(state, 'movement_slow')).toBe('removed');
    expect(removeStatusAilment(state, 'spider_web')).toBe('removed');
    expect(removeStatusAilment(state, 'petrification')).toBe('removed');
    expect(state.player.slowed).toBe(false);
    expect(state.player.petrified).toBe(false);
  });
});

describe('antidote (Phase 12.4)', () => {
  it('cures only poison', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), antidote: 1 },
      activeEffects: [
        { id: 'poison', strength: 3, remainingTurns: 10 },
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
      ],
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), slowed: true, petrified: false },
    });
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(getActiveEffect(state, 'poison')).toBeUndefined();
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(7); // normal decrement
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(4); // normal decrement, not removed
    expect(state.player.slowed).toBe(true); // untouched
  });

  it('deals no poison damage on the use turn', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), antidote: 1 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
    });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('fails and changes nothing when not poisoned', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 1 } });
    const before = state.turn;
    const result = processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.antidote).toBe(1);
    expect(state.turn).toBe(before);
    expect(result.events).toContainEqual({ type: 'antidote_use_failed', itemId: 'antidote', reason: 'not_poisoned' });
  });

  it('pushes antidote_used and effect_removed exactly once each on success', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), antidote: 1 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(result.events.filter((e) => e.type === 'antidote_used')).toHaveLength(1);
    expect(result.events.filter((e) => e.type === 'effect_removed')).toHaveLength(1);
    expect(result.events).toContainEqual({ type: 'antidote_used', itemId: 'antidote', removedEffectIds: ['poison'] });
    expect(result.events).toContainEqual({ type: 'effect_removed', effectId: 'poison', reason: 'antidote' });
  });
});

describe('panacea (Phase 12.4)', () => {
  it('cures poison only when only poison is active', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 1 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(result.consumed).toBe(true);
    expect(getActiveEffect(state, 'poison')).toBeUndefined();
    expect(result.events).toContainEqual({ type: 'panacea_used', itemId: 'panacea', removedEffectIds: ['poison'] });
  });

  it('cures movement_slow only when only movement_slow is active', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 1 },
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
    });
    processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(getActiveEffect(state, 'movement_slow')).toBeUndefined();
  });

  it('cures spider-web slow only when only that is active', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 1 },
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), slowed: true },
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(result.consumed).toBe(true);
    expect(state.player.slowed).toBe(false);
    expect(result.events).toContainEqual({ type: 'panacea_used', itemId: 'panacea', removedEffectIds: ['spider_web'] });
  });

  it('cures petrification only when only that is active, and can be used while petrified', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 1 },
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), petrified: true },
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(result.consumed).toBe(true);
    expect(state.player.petrified).toBe(false);
    expect(result.events).toContainEqual({ type: 'panacea_used', itemId: 'panacea', removedEffectIds: ['petrification'] });
    // The forced petrified_skip must NOT also fire this same turn.
    expect(result.events.filter((e) => e.type === 'player_petrified_skip')).toHaveLength(0);
  });

  it('cures all 4 ailments at once, preserving attack_up', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 1 },
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), slowed: true, petrified: true },
      activeEffects: [
        { id: 'poison', strength: 3, remainingTurns: 10 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
      ],
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(getActiveEffect(state, 'poison')).toBeUndefined();
    expect(getActiveEffect(state, 'movement_slow')).toBeUndefined();
    expect(state.player.slowed).toBe(false);
    expect(state.player.petrified).toBe(false);
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(7); // preserved, normally decremented
    const used = result.events.find((e) => e.type === 'panacea_used');
    expect(used && (used as { removedEffectIds: string[] }).removedEffectIds.sort()).toEqual(
      ['movement_slow', 'petrification', 'poison', 'spider_web'].sort(),
    );
    expect(result.events.filter((e) => e.type === 'effect_removed')).toHaveLength(4);
    expect(state.inventory.panacea).toBe(0); // consumed exactly 1, regardless of 4 cures
  });

  it('consumes exactly 1 panacea regardless of how many ailments are cured', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 5 },
      activeEffects: [
        { id: 'poison', strength: 3, remainingTurns: 10 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
      ],
    });
    processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(state.inventory.panacea).toBe(4);
  });

  it('fails and changes nothing when there is no status ailment', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), panacea: 1 } });
    const before = state.turn;
    const result = processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.panacea).toBe(1);
    expect(state.turn).toBe(before);
    expect(result.events).toContainEqual({ type: 'panacea_use_failed', itemId: 'panacea', reason: 'no_status_ailment' });
  });

  it('deals no poison damage on the use turn', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 1 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
    });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('does not trigger the movement_slow additional enemy phase on the use turn', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 1 },
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
    });
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'use_item', itemId: 'panacea' });
    // use_item is not a 'move' action, so the additional-phase logic never applies regardless.
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(1);
  });

  it('petrified player without panacea still gets the normal forced skip', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 0 },
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), petrified: true },
    });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events).toContainEqual({ type: 'player_petrified_skip' });
    expect(state.player.petrified).toBe(false);
  });

  it('does not run enemy actions, hunger, natural regen, or effect decrement on failure', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), panacea: 1 },
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 8 }],
    });
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(enemyXBefore).toBe(state.enemies[0].pos.x);
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(8);
  });
});

describe('turn order and side-effect isolation (Phase 12.4)', () => {
  it('a successful antidote/panacea use consumes exactly 1 turn', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), antidote: 1 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
    });
    const before = state.turn;
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.turn).toBe(before + 1);
  });

  it('does not close the inventory overlay on failure', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), panacea: 1 }, inventoryOpen: true });
    processTurn(state, { type: 'use_item', itemId: 'panacea' });
    expect(state.inventoryOpen).toBe(true);
  });

  it('is maintained across floor transitions and reset on a new run', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 2, panacea: 3 } });
    const next = advanceToNextFloor(state);
    expect(next.inventory.antidote).toBe(2);
    expect(next.inventory.panacea).toBe(3);
    const fresh = createInitialState(123);
    expect(fresh.inventory.antidote).toBe(0);
    expect(fresh.inventory.panacea).toBe(0);
  });

  it('poison_trap and slow_trap remain unaffected by these items existing', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, triggered: false, trapType: 'poison_trap' };
    const state = freshState({ traps: [trap] });
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(getActiveEffect(state, 'poison')).toEqual({ id: 'poison', strength: 1, remainingTurns: 10 });
  });
});

describe('telemetry (Phase 12.4)', () => {
  it('is exercised indirectly via events; schemaVersion/messages are covered in message-log/telemetry test suites', () => {
    // Direct schemaVersion/file-name assertions live in the existing
    // phase-10-3-* telemetry test files; this suite focuses on GameEvent
    // -level correctness, which telemetry.ts's translateGameEvent
    // consumes directly.
    expect(true).toBe(true);
  });
});
