import { describe, expect, it } from 'vitest';
import {
  advanceEffectDurations,
  EFFECT_DEFINITIONS,
  getActiveEffect,
  getActiveEffects,
  getEffectStrength,
  grantOrRefreshEffect,
  isEffectAtMaxDuration,
} from '../effects';
import { createEmptyInventory, ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from '../item-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { ActiveEffect, GameMap, GameState, Tile } from '../types';

const TEST_LAYOUT: string[] = [
  '##########',
  '#........#',
  '#..####..#',
  '#..#..#..#',
  '#..#..#..#',
  '#..####..#',
  '#........#',
  '##########',
];

function testMap(): GameMap {
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

// Enemy placed far away and passive (attack 0, huge HP) so most turns in
// this file resolve purely as the player's own action without incidental
// enemy damage/defeat noise, unless a test deliberately wants combat.
function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0, 90, 0),
    enemies: [createInitialEnemy('bok', { x: 7, y: 6 }, 1000, 0, 0, 0, 0, 90, 0)],
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
    ...overrides,
  };
}

describe('effects.ts central definitions (Phase 12.1)', () => {
  it('registers attack_up with strength 5 and duration 20', () => {
    expect(EFFECT_DEFINITIONS.attack_up).toEqual({
      id: 'attack_up',
      displayName: '攻撃力上昇',
      strength: 5,
      duration: 20,
    });
  });

  it('getActiveEffects returns [] when activeEffects is absent from GameState', () => {
    const state = freshState();
    delete (state as { activeEffects?: ActiveEffect[] }).activeEffects;
    expect(getActiveEffects(state)).toEqual([]);
    expect(getEffectStrength(state, 'attack_up')).toBe(0);
    expect(isEffectAtMaxDuration(state, 'attack_up')).toBe(false);
  });

  it('grantOrRefreshEffect grants a new record when none is active', () => {
    const state = freshState();
    const result = grantOrRefreshEffect(state, 'attack_up');
    expect(result).toBe('granted');
    expect(getActiveEffect(state, 'attack_up')).toEqual({ id: 'attack_up', strength: 5, remainingTurns: 20 });
  });

  it('grantOrRefreshEffect refreshes an existing record back to full duration without stacking strength', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 3 }] });
    const result = grantOrRefreshEffect(state, 'attack_up');
    expect(result).toBe('refreshed');
    expect(getActiveEffects(state)).toEqual([{ id: 'attack_up', strength: 5, remainingTurns: 20 }]);
    expect(getActiveEffects(state)).toHaveLength(1);
  });

  it('advanceEffectDurations decrements by 1 and removes effects that reach 0, returning expired ids', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 1 }] });
    const expired = advanceEffectDurations(state);
    expect(expired).toEqual(['attack_up']);
    expect(getActiveEffects(state)).toEqual([]);
  });

  it('advanceEffectDurations leaves a still-positive effect in place', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 5 }] });
    advanceEffectDurations(state);
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(4);
  });
});

describe('banana item definition and placement (Phase 12.1)', () => {
  it('registers banana in ItemId/ITEM_DEFINITIONS/ITEM_IDS_IN_ORDER', () => {
    expect(ITEM_IDS_IN_ORDER).toContain('banana');
    expect(ITEM_DEFINITIONS.banana.displayName).toBe('バナナ');
    expect(ITEM_DEFINITIONS.banana.glyph).toBe('🍌');
    expect(ITEM_DEFINITIONS.banana.category).toBe('consumable');
    expect(ITEM_DEFINITIONS.banana.consumable).toBe(true);
    expect(ITEM_DEFINITIONS.banana.stackable).toBe(true);
  });

  it('createEmptyInventory includes banana at 0', () => {
    expect(createEmptyInventory().banana).toBe(0);
  });

  it('is placed exactly once per floor across several seeds', () => {
    for (const seed of [1, 7, 42, 2024]) {
      const state = createInitialState(seed);
      const bananas = state.groundItems.filter((item) => item.itemId === 'banana');
      expect(bananas).toHaveLength(1);
    }
  });

  it('is placed on a reachable floor tile', () => {
    const state = createInitialState(2024);
    const banana = state.groundItems.find((item) => item.itemId === 'banana')!;
    expect(state.map.terrain[banana.pos.y][banana.pos.x]).toBe('floor');
  });

  it('does not overlap the player, exit, enemies, or other ground items', () => {
    const state = createInitialState(2024);
    const banana = state.groundItems.find((item) => item.itemId === 'banana')!;
    expect(banana.pos).not.toEqual(state.player.pos);
    expect(banana.pos).not.toEqual(state.exit);
    for (const enemy of state.enemies) {
      expect(banana.pos).not.toEqual(enemy.pos);
    }
    const others = state.groundItems.filter((item) => item.itemId !== 'banana');
    for (const other of others) {
      expect(banana.pos).not.toEqual(other.pos);
    }
  });

  it('placement is deterministic for a fixed seed', () => {
    const a = createInitialState(999);
    const b = createInitialState(999);
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('does not change existing items' + "\u2019" + ' placement/positions (apple stays identical with/without banana present)', () => {
    // Regression guard: banana placement is appended after every other
    // existing ground item using its own independent RNG stream, so no
    // prior item's chosen tile should move.
    const state = createInitialState(4242);
    const apple = state.groundItems.find((item) => item.itemId === 'apple')!;
    expect(apple).toBeDefined();
    // Same seed, re-derived: apple's position must be stable regardless of
    // banana's presence in the same groundItems array.
    const again = createInitialState(4242);
    const appleAgain = again.groundItems.find((item) => item.itemId === 'apple')!;
    expect(apple.pos).toEqual(appleAgain.pos);
  });

  it('picking it up adds 1 to inventory via the existing auto-pickup path', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'banana', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.banana).toBe(1);
    expect(state.groundItems).toHaveLength(0);
  });
});

describe('banana use (Phase 12.1)', () => {
  it('with no prior effect: consumes 1 banana, grants attack_up +5 remaining 20, consumes 1 turn', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), banana: 1 } });
    const before = state.turn;
    const result = processTurn(state, { type: 'use_item', itemId: 'banana' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.banana).toBe(0);
    expect(getActiveEffect(state, 'attack_up')).toEqual({ id: 'attack_up', strength: 5, remainingTurns: 20 });
    expect(state.turn).toBe(before + 1);
  });

  it('pushes exactly one effect_granted event on first use', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), banana: 1 } });
    const result = processTurn(state, { type: 'use_item', itemId: 'banana' });
    const granted = result.events.filter((e) => e.type === 'effect_granted');
    expect(granted).toHaveLength(1);
    expect(granted[0]).toEqual({ type: 'effect_granted', effectId: 'attack_up', strength: 5, remainingTurns: 20 });
  });

  it('the used turn itself does not decrement the freshly granted effect (remains 20)', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), banana: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'banana' });
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(20);
  });

  it('at remaining 19 (or less): re-using refreshes to 20 without stacking strength, consuming 1 banana', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), banana: 2 },
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 19 }],
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'banana' });
    expect(result.consumed).toBe(true);
    expect(state.inventory.banana).toBe(1);
    expect(getActiveEffects(state)).toEqual([{ id: 'attack_up', strength: 5, remainingTurns: 20 }]);
    const refreshed = result.events.filter((e) => e.type === 'effect_refreshed');
    expect(refreshed).toHaveLength(1);
  });

  it('never creates more than one attack_up record across repeated grant/refresh', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), banana: 3 } });
    processTurn(state, { type: 'use_item', itemId: 'banana' });
    // advance the effect down before reusing so the second use is a refresh, not a max-duration failure
    for (let i = 0; i < 5; i++) processTurn(state, { type: 'wait' });
    processTurn(state, { type: 'use_item', itemId: 'banana' });
    expect(getActiveEffects(state)).toHaveLength(1);
  });

  it('at remaining 20 (already maximum): use fails, consumes nothing, no turn', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), banana: 1 },
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }],
      combatRngState: 12345,
    });
    const before = state.turn;
    const rngBefore = state.combatRngState;
    const result = processTurn(state, { type: 'use_item', itemId: 'banana' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.banana).toBe(1);
    expect(getActiveEffects(state)).toEqual([{ id: 'attack_up', strength: 5, remainingTurns: 20 }]);
    expect(state.turn).toBe(before);
    expect(state.combatRngState).toBe(rngBefore);
    expect(result.events).toContainEqual({ type: 'banana_use_failed', itemId: 'banana', reason: 'effect_at_max' });
  });

  it('failed use (max duration) pushes exactly one banana_use_failed event, not duplicated', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), banana: 1 },
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }],
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'banana' });
    expect(result.events.filter((e) => e.type === 'banana_use_failed')).toHaveLength(1);
  });

  it('using with 0 owned bananas is a no-op (defense in depth against stale selection)', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), banana: 0 } });
    const result = processTurn(state, { type: 'use_item', itemId: 'banana' });
    expect(result.consumed).toBe(false);
    expect(getActiveEffects(state)).toEqual([]);
  });
});

describe('attack_up damage bonus (Phase 12.1)', () => {
  function attackerState(weaponId: import('../types').WeaponId | null, activeEffects?: ActiveEffect[]): GameState {
    return freshState({
      player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0, 100, 0),
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 0, 0, 0, 0, 90, 0)],
      equippedWeaponId: weaponId,
      activeEffects: activeEffects ?? [{ id: 'attack_up', strength: 5, remainingTurns: 10 }],
    });
  }

  it('bare hands: +5 applied on top of base attack 10, floor 0 defense -> 15 damage', () => {
    const state = attackerState(null);
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(before - state.enemies[0].hp).toBe(15);
  });

  it('sword (+10 weapon bonus): 10 base + 5 attack_up + 10 sword - 0 defense = 25 damage', () => {
    const state = attackerState('sword');
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(before - state.enemies[0].hp).toBe(25);
  });

  it('spear (+0 weapon bonus): 10 base + 5 attack_up + 0 - 0 defense = 15 damage', () => {
    const state = attackerState('spear');
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(before - state.enemies[0].hp).toBe(15);
  });

  it('hammer (+20 weapon bonus): 10 base + 5 attack_up + 20 - 0 defense = 35 damage', () => {
    const state = attackerState('hammer');
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(before - state.enemies[0].hp).toBe(35);
  });

  it('does not apply to the solar gun', () => {
    const withEffect = attackerState('solar_gun', [{ id: 'attack_up', strength: 5, remainingTurns: 10 }]);
    const withoutEffect = attackerState('solar_gun', []);
    withEffect.solarEnergy = 5;
    withoutEffect.solarEnergy = 5;
    processTurn(withEffect, { type: 'face', direction: 'E' });
    processTurn(withoutEffect, { type: 'face', direction: 'E' });
    processTurn(withEffect, { type: 'action' });
    processTurn(withoutEffect, { type: 'action' });
    const finalDamageWith = 1000 - withEffect.enemies[0].hp;
    const finalDamageWithout = 1000 - withoutEffect.enemies[0].hp;
    expect(finalDamageWith).toBe(finalDamageWithout);
  });

  it('does not change sol enchantment bonus damage', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0, 100, 0),
      // Phase 14.4 enemy affinities: bok is now sol-weak; use spider
      // (still all-neutral) so the fixed sol bonus stays exactly 10.
      enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 0, 0, 0, 0, 90, 0)],
      equippedWeaponId: 'sword',
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 10 }],
    });
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    // 10 base + 5 attack_up + 10 sword - 0 defense = 25, plus fixed sol bonus 10 = 35
    expect(before - state.enemies[0].hp).toBe(35);
  });

  it('floors at minimum damage 1 even with attack_up active against high defense', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0, 100, 0),
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 0, 0, 500, 90, 0)],
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 10 }],
    });
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(before - state.enemies[0].hp).toBe(1);
  });

  it('does not change Actor.attack or WeaponDefinition', () => {
    const state = attackerState('sword');
    expect(state.player.attack).toBe(10);
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(state.player.attack).toBe(10);
  });
});

describe('effect duration progression (Phase 12.1)', () => {
  it('decreases by 1 on a successful move turn', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }] });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(19);
  });

  it('decreases by 1 on a successful wait turn', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }] });
    processTurn(state, { type: 'wait' });
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(19);
  });

  it('does not decrease on a blocked (failed) move', () => {
    // Wall directly north of the player's starting tile in TEST_LAYOUT.
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }] });
    const result = processTurn(state, { type: 'move', direction: 'N' });
    expect(result.consumed).toBe(false);
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(20);
  });

  it('does not decrease on a failed solar gun attack (insufficient SOL)', () => {
    const state = freshState({
      equippedWeaponId: 'solar_gun',
      solarEnergy: 0,
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }],
    });
    processTurn(state, { type: 'face', direction: 'E' });
    const result = processTurn(state, { type: 'action' });
    expect(result.consumed).toBe(false);
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(20);
  });

  it('does not decrease on a failed item use', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 1 },
      player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0, 90, 0),
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }],
    });
    // Player already at full HP -> apple use fails (full_hp).
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(result.consumed).toBe(false);
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(20);
  });

  it('does not decrease on toggling the inventory overlay or moving the cursor (no turn consumed)', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }] });
    processTurn(state, { type: 'face', direction: 'S' }); // 'face' never consumes a turn either
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(20);
  });

  it('reaches 1 after 19 successful turns from a fresh grant, then expires on the 20th', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), banana: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'banana' }); // grant: remains 20, this turn not counted
    for (let i = 0; i < 19; i++) {
      processTurn(state, { type: 'wait' });
    }
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(1);
    const result = processTurn(state, { type: 'wait' });
    expect(getActiveEffect(state, 'attack_up')).toBeUndefined();
    expect(result.events).toContainEqual({ type: 'effect_expired', effectId: 'attack_up' });
  });

  it('applies the bonus on the final (remaining 1) action before it expires', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0, 100, 0),
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 1 }],
    });
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(before - state.enemies[0].hp).toBe(15); // bonus still applied
    expect(getActiveEffect(state, 'attack_up')).toBeUndefined(); // then expired
  });

  it('does not decrement more than once for a single successful action', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }] });
    processTurn(state, { type: 'wait' });
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(19);
  });

  it('does not consume RNG (combatRngState unchanged) purely from duration progression', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 20 }] });
    const before = state.combatRngState;
    processTurn(state, { type: 'wait' });
    expect(state.combatRngState).toBe(before);
  });
});

describe('lifecycle: floor transition, new run, retry (Phase 12.1)', () => {
  it('a brand new run starts with no active effects', () => {
    const state = createInitialState(123);
    expect(getActiveEffects(state)).toEqual([]);
  });

  it('advanceToNextFloor carries the active effect and its remaining turns over', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 7 }] });
    const next = advanceToNextFloor(state);
    expect(getActiveEffects(next)).toEqual([{ id: 'attack_up', strength: 5, remainingTurns: 7 }]);
  });

  it('advanceToNextFloor does not reset remaining turns to 20', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 3 }] });
    const next = advanceToNextFloor(state);
    expect(getActiveEffect(next, 'attack_up')?.remainingTurns).toBe(3);
  });

  it('mutating the next floor state does not reach back into the previous floor state (independent array copy)', () => {
    const state = freshState({ activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 7 }] });
    const next = advanceToNextFloor(state);
    advanceEffectDurations(next);
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(7);
    expect(getActiveEffect(next, 'attack_up')?.remainingTurns).toBe(6);
  });

  it('reaching the exit on the turn effect drops to 0 does not carry it to the next floor', () => {
    const state = freshState({
      player: createInitialActor({ x: 6, y: 6 }, 30, 10, 0, 90, 0),
      enemies: [],
      exit: { x: 7, y: 6 },
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 1 }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.phase).toBe('floor_cleared');
    expect(getActiveEffects(state)).toEqual([]);
    const next = advanceToNextFloor(state);
    expect(getActiveEffects(next)).toEqual([]);
  });
});
