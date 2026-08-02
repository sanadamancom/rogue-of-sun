import { describe, expect, it } from 'vitest';
import { advanceEffectDurations, getActiveEffect, getActiveEffects, removeEffect } from '../effects';
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
    enemies: [createInitialEnemy('bok', { x: 17, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
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
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    traps: [],
    ...overrides,
  };
}

describe('antidote registration (Phase 12.4)', () => {
  it('is registered in ItemId/ITEM_DEFINITIONS/ITEM_IDS_IN_ORDER', () => {
    expect(ITEM_IDS_IN_ORDER).toContain('antidote');
    expect(ITEM_DEFINITIONS.antidote.displayName).toBe('毒消し草');
    expect(ITEM_DEFINITIONS.antidote.category).toBe('consumable');
    expect(ITEM_DEFINITIONS.antidote.consumable).toBe(true);
    expect(ITEM_DEFINITIONS.antidote.stackable).toBe(true);
  });

  it('createEmptyInventory includes antidote at 0', () => {
    expect(createEmptyInventory().antidote).toBe(0);
  });

  it('antidote is placed after banana in ITEM_IDS_IN_ORDER (existing display order preserved)', () => {
    const bananaIndex = ITEM_IDS_IN_ORDER.indexOf('banana');
    const antidoteIndex = ITEM_IDS_IN_ORDER.indexOf('antidote');
    expect(antidoteIndex).toBe(bananaIndex + 1);
  });

  it('does not change existing item definitions', () => {
    expect(ITEM_DEFINITIONS.apple.healAmount).toBe(20);
    expect(ITEM_DEFINITIONS.sun_fruit.solarAmount).toBe(2);
    expect(ITEM_DEFINITIONS.chocolate.hungerAmount).toBe(30);
  });
});

describe('antidote placement (Phase 12.4)', () => {
  it('places at most one antidote per floor across several seeds', () => {
    for (const seed of [1, 7, 42, 2024]) {
      const state = createInitialState(seed);
      const antidotes = state.groundItems.filter((item) => item.itemId === 'antidote');
      expect(antidotes.length).toBeLessThanOrEqual(1);
    }
  });

  it('is placed on a reachable room floor tile when present', () => {
    const state = createInitialState(2024);
    const antidote = state.groundItems.find((item) => item.itemId === 'antidote');
    if (!antidote) return;
    expect(state.map.terrain[antidote.pos.y][antidote.pos.x]).toBe('floor');
    const insideSomeRoom = state.map.rooms.some(
      (room) =>
        antidote.pos.x >= room.x &&
        antidote.pos.x < room.x + room.width &&
        antidote.pos.y >= room.y &&
        antidote.pos.y < room.y + room.height,
    );
    expect(insideSomeRoom).toBe(true);
  });

  it('does not overlap start, exit, actors, other ground items, or either trap', () => {
    const state = createInitialState(2024);
    const antidote = state.groundItems.find((item) => item.itemId === 'antidote');
    if (!antidote) return;
    expect(antidote.pos).not.toEqual(state.player.pos);
    expect(antidote.pos).not.toEqual(state.exit);
    for (const enemy of state.enemies) expect(antidote.pos).not.toEqual(enemy.pos);
    for (const item of state.groundItems) {
      if (item.itemId === 'antidote') continue;
      expect(antidote.pos).not.toEqual(item.pos);
    }
    for (const trap of state.traps ?? []) {
      expect(antidote.pos).not.toEqual(trap.pos);
    }
  });

  it('placement is deterministic for a fixed seed', () => {
    const a = createInitialState(999);
    const b = createInitialState(999);
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('does not change existing (non-antidote) placement or combatRngState', () => {
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

describe('antidote pickup and inventory (Phase 12.4)', () => {
  it('picking it up adds 1 to inventory via the existing auto-pickup path', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'antidote', pos: { x: 3, y: 3 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.antidote).toBe(1);
    expect(state.groundItems).toHaveLength(0);
  });

  it('multiple can stack', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 2 } });
    expect(state.inventory.antidote).toBe(2);
  });

  it('cannot be picked up at inventory capacity (stays on the ground)', () => {
    const fullInventory = { ...createEmptyInventory(), apple: 20 };
    const state = freshState({
      inventory: fullInventory,
      groundItems: [{ id: 0, itemId: 'antidote', pos: { x: 3, y: 3 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.antidote).toBe(0);
    expect(state.groundItems).toHaveLength(1);
  });

  it('can be placed on the ground via the existing place_item action', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 1 }, inventoryOpen: true, selectedItemIndex: 0 });
    const result = processTurn(state, { type: 'place_item', itemId: 'antidote' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.antidote).toBe(0);
    expect(state.groundItems.some((i) => i.itemId === 'antidote')).toBe(true);
  });

  it('can be discarded via the existing discard flow', () => {
    // discard_item itself is a single-step processTurn action; the
    // confirm/cancel prompt (discardConfirmItemId) is a main.ts UI-level
    // concern layered on top, not something processTurn re-checks.
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 1 }, inventoryOpen: true });
    const result = processTurn(state, { type: 'discard_item', itemId: 'antidote' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.antidote).toBe(0);
  });

  it('is maintained across floor transitions', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 3 } });
    const next = advanceToNextFloor(state);
    expect(next.inventory.antidote).toBe(3);
  });

  it('resets to 0 on a brand new run', () => {
    const state = createInitialState(123);
    expect(state.inventory.antidote).toBe(0);
  });
});

describe('removeEffect (Phase 12.4 effect-removal foundation)', () => {
  it('removes only the targeted effect id', () => {
    const state = freshState({
      activeEffects: [
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
        { id: 'poison', strength: 3, remainingTurns: 10 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
      ],
    });
    const result = removeEffect(state, 'poison');
    expect(result).toBe('removed');
    expect(getActiveEffect(state, 'poison')).toBeUndefined();
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(8);
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(5);
  });

  it('returns not_present when the effect is not active', () => {
    const state = freshState({ activeEffects: [] });
    const result = removeEffect(state, 'poison');
    expect(result).toBe('not_present');
  });

  it('removes all matching records if duplicates somehow exist', () => {
    const state = freshState({
      activeEffects: [
        { id: 'poison', strength: 3, remainingTurns: 10 },
        { id: 'poison', strength: 3, remainingTurns: 4 },
      ],
    });
    removeEffect(state, 'poison');
    expect(getActiveEffects(state).filter((e) => e.id === 'poison')).toHaveLength(0);
  });

  it('is distinct from natural expiry: advanceEffectDurations still yields effect_expired-worthy ids separately', () => {
    const state = freshState({ activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 1 }] });
    const expired = advanceEffectDurations(state);
    expect(expired).toEqual(['poison']);
  });

  it('handles an absent activeEffects field safely', () => {
    const state = freshState();
    delete (state as { activeEffects?: unknown }).activeEffects;
    const result = removeEffect(state, 'poison');
    expect(result).toBe('not_present');
  });
});

describe('antidote successful use (Phase 12.4)', () => {
  function poisonedState(overrides?: Partial<GameState>): GameState {
    return freshState({
      inventory: { ...createEmptyInventory(), antidote: 1 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      ...overrides,
    });
  }

  it('consumes 1 antidote and removes poison immediately', () => {
    const state = poisonedState();
    const result = processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.antidote).toBe(0);
    expect(getActiveEffect(state, 'poison')).toBeUndefined();
  });

  it('pushes antidote_used and effect_removed exactly once each', () => {
    const state = poisonedState();
    const result = processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(result.events.filter((e) => e.type === 'antidote_used')).toHaveLength(1);
    expect(result.events.filter((e) => e.type === 'effect_removed')).toHaveLength(1);
    expect(result.events).toContainEqual({ type: 'antidote_used', itemId: 'antidote', removedEffectId: 'poison' });
    expect(result.events).toContainEqual({ type: 'effect_removed', effectId: 'poison', reason: 'antidote' });
  });

  it('consumes exactly 1 turn', () => {
    const state = poisonedState();
    const before = state.turn;
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.turn).toBe(before + 1);
  });

  it('deals no poison damage on the turn it is used', () => {
    const state = poisonedState();
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('removing poison at remaining 1 still deals no final damage', () => {
    const state = poisonedState({ activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 1 }] });
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.player.hp).toBe(hpBefore);
    expect(result.events.filter((e) => e.type === 'poison_damage')).toHaveLength(0);
  });

  it('does not heal HP', () => {
    const state = poisonedState({ player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), hp: 10 } });
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.player.hp).toBe(10);
  });

  it('attack_up and movement_slow still decrement normally on the use turn', () => {
    const state = poisonedState({
      activeEffects: [
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
        { id: 'poison', strength: 3, remainingTurns: 10 },
      ],
    });
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(7);
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(4);
  });

  it('does not remove spider-web slowed or petrified state', () => {
    const state = poisonedState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), slowed: true, petrified: false },
    });
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.player.slowed).toBe(true);
  });

  it('enemy action, hunger, natural regen, and effect decrement each run at most once', () => {
    const state = poisonedState({
      enemies: [createInitialEnemy('bok', { x: 17, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
    });
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    // A single ordinary enemy phase (never doubled — antidote use is not
    // a move, so movement_slow's additional-phase logic never applies).
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(1);
  });
});

describe('antidote failed use (Phase 12.4)', () => {
  it('fails when poison is not active', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 1 } });
    const result = processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(result.consumed).toBe(false);
    expect(result.events).toContainEqual({ type: 'antidote_use_failed', itemId: 'antidote', reason: 'not_poisoned' });
  });

  it('does not consume the antidote on failure', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.inventory.antidote).toBe(1);
  });

  it('does not consume a turn on failure', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 1 } });
    const before = state.turn;
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.turn).toBe(before);
  });

  it('does not close the inventory overlay on failure', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 1 }, inventoryOpen: true });
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(state.inventoryOpen).toBe(true);
  });

  it('does not run enemy actions, hunger, natural regen, or effect decrement on failure', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), antidote: 1 },
      enemies: [createInitialEnemy('bok', { x: 17, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 8 }],
    });
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(enemyXBefore).toBe(state.enemies[0].pos.x);
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(8);
  });

  it('using with 0 owned antidotes is a no-op and changes nothing', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), antidote: 0 } });
    const result = processTurn(state, { type: 'use_item', itemId: 'antidote' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.antidote).toBe(0);
  });
});

describe('compatibility (Phase 12.4)', () => {
  it('poison strength and duration are unchanged', () => {
    const state = freshState();
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, triggered: false, trapType: 'poison_trap' };
    state.traps = [trap];
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(getActiveEffect(state, 'poison')).toEqual({ id: 'poison', strength: 3, remainingTurns: 10 });
  });

  it('poison_trap trigger-turn behavior is unchanged', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, triggered: false, trapType: 'poison_trap' };
    const state = freshState({ traps: [trap] });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' }); // triggers
    expect(state.player.hp).toBe(hpBefore);
    expect(getActiveEffect(state, 'poison')?.remainingTurns).toBe(10);
  });

  it('slow_trap / movement_slow behavior is unchanged', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, triggered: false, trapType: 'slow_trap' };
    const state = freshState({ traps: [trap] });
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(getActiveEffect(state, 'movement_slow')).toEqual({ id: 'movement_slow', strength: 1, remainingTurns: 10 });
  });

  it('attack_up strength and duration are unchanged', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), banana: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'banana' });
    expect(getActiveEffect(state, 'attack_up')).toEqual({ id: 'attack_up', strength: 5, remainingTurns: 20 });
  });

  it('apple, sun_fruit, chocolate, banana use rules are unchanged', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), hp: 10 },
      inventory: { ...createEmptyInventory(), apple: 1 },
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(true);
    expect(state.player.hp).toBe(30);
  });

  it('physical damage calculations are unaffected', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 100, 0),
      enemies: [createInitialEnemy('bok', { x: 3, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
    });
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(before - state.enemies[0].hp).toBe(10);
  });
});
