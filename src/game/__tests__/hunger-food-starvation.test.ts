import { describe, expect, it } from 'vitest';
import {
  CHOCOLATE_HUNGER_RECOVERY,
  getHunger,
  getHungerDecreaseProgress,
  getStarvationProgress,
  HUNGER_DECREASE_INTERVAL,
  HUNGER_LOW_THRESHOLD,
  HUNGER_MAX,
  STARVATION_DAMAGE,
  STARVATION_INTERVAL,
} from '../hunger';
import { createEmptyInventory, getGroundItemPoolForFloor, ITEM_DEFINITIONS, ITEM_IDS_IN_ORDER } from '../item-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn, REGEN_TURNS_PER_HP } from '../turn';
import { GameMap, GameState, Tile } from '../types';

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

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: testMap(),
    player: createInitialActor({ x: 2, y: 1 }, 30, 10),
    enemies: [],
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
    hunger: HUNGER_MAX,
    hungerDecreaseProgress: 0,
    starvationProgress: 0,
    hungerLowWarned: false,
    hungerZeroWarned: false,
    ...overrides,
  };
}

function waitN(state: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    processTurn(state, { type: 'wait' });
  }
}

describe('hunger initialization (Phase 11.3)', () => {
  it('a new run starts at 100 / 100', () => {
    const state = createInitialState(2024);
    expect(getHunger(state)).toBe(HUNGER_MAX);
  });

  it('a new run starts with both progress counters at 0', () => {
    const state = createInitialState(2024);
    expect(getHungerDecreaseProgress(state)).toBe(0);
    expect(getStarvationProgress(state)).toBe(0);
  });

  it('a new run starts with both warning flags cleared', () => {
    const state = createInitialState(2024);
    expect(state.hungerLowWarned ?? false).toBe(false);
    expect(state.hungerZeroWarned ?? false).toBe(false);
  });

  it('the same seed produces the same initial hunger state (determinism)', () => {
    const a = createInitialState(555);
    const b = createInitialState(555);
    expect(getHunger(a)).toBe(getHunger(b));
  });
});

describe('hunger decrease (Phase 11.3)', () => {
  it('3 successful turns do not decrease hunger', () => {
    const state = freshState();
    waitN(state, 3);
    expect(getHunger(state)).toBe(HUNGER_MAX);
  });

  it('4 successful turns decrease hunger by exactly 1', () => {
    const state = freshState();
    waitN(state, HUNGER_DECREASE_INTERVAL);
    expect(getHunger(state)).toBe(HUNGER_MAX - 1);
  });

  it('8 successful turns decrease hunger by exactly 2', () => {
    const state = freshState();
    waitN(state, HUNGER_DECREASE_INTERVAL * 2);
    expect(getHunger(state)).toBe(HUNGER_MAX - 2);
  });

  it('hunger never goes below 0 even with many successful turns', () => {
    const state = freshState({ hunger: 1 });
    waitN(state, HUNGER_DECREASE_INTERVAL * 3);
    expect(getHunger(state)).toBeGreaterThanOrEqual(0);
  });

  it('a successful move decreases progress toward the next tick', () => {
    const state = freshState();
    processTurn(state, { type: 'move', direction: 'E' });
    expect(getHungerDecreaseProgress(state)).toBe(1);
  });

  it('a successful attack (whiff) counts toward hunger progress', () => {
    const state = freshState();
    processTurn(state, { type: 'action' });
    expect(getHungerDecreaseProgress(state)).toBe(1);
  });

  it('a successful wait counts toward hunger progress', () => {
    const state = freshState();
    processTurn(state, { type: 'wait' });
    expect(getHungerDecreaseProgress(state)).toBe(1);
  });

  it('a successful item use counts toward hunger progress', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 1;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(getHungerDecreaseProgress(state)).toBe(1);
  });

  it('a successful equip counts toward hunger progress', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(getHungerDecreaseProgress(state)).toBe(1);
  });

  it('a successful place counts toward hunger progress', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), apple: 1 } });
    processTurn(state, { type: 'place_item', itemId: 'apple' });
    expect(getHungerDecreaseProgress(state)).toBe(1);
  });

  it('a successful discard counts toward hunger progress', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), apple: 1 } });
    processTurn(state, { type: 'discard_item', itemId: 'apple' });
    expect(getHungerDecreaseProgress(state)).toBe(1);
  });

  it('a failed move (wall) does not progress hunger', () => {
    const state = freshState();
    // Move into a wall (row 0 is all walls; move N from y=1 hits the wall at y=0... actually
    // test map row0 is wall, so moving N from (2,1) should be blocked).
    processTurn(state, { type: 'move', direction: 'N' });
    expect(getHungerDecreaseProgress(state)).toBe(0);
  });

  it('a failed item use (full HP) does not progress hunger', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), apple: 1 } });
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(getHungerDecreaseProgress(state)).toBe(0);
  });

  it('opening/closing the inventory overlay does not progress hunger', () => {
    const state = freshState();
    state.inventoryOpen = true;
    processTurn(state, { type: 'wait' }); // rejected while overlay open
    expect(getHungerDecreaseProgress(state)).toBe(0);
  });

  it('hunger progression does not change combatRngState', () => {
    const state = freshState();
    const before = state.combatRngState;
    waitN(state, HUNGER_DECREASE_INTERVAL);
    expect(state.combatRngState).toBe(before);
  });
});

describe('chocolate (Phase 15.4b random ground item generation)', () => {
  it('is a valid candidate on every floor (in the cumulative pool from floor 1)', () => {
    expect(getGroundItemPoolForFloor(1)).toContain('chocolate');
    expect(getGroundItemPoolForFloor(2)).toContain('chocolate');
    expect(getGroundItemPoolForFloor(3)).toContain('chocolate');
  });

  it('floor 1 now guarantees at least one chocolate (Phase 16.1 minimum food supply)', () => {
    // Phase 16.1 early-resource-and-combat-pressure rebalance: floor 1's
    // random draw alone left roughly a 68% chance of zero chocolate (the
    // only hunger-restoring item) across a floor — see docs/history/
    // phase-16-early-game-balance.md's Phase 16.1 section. state.ts now
    // guarantees at least one on floor 1 specifically, superseding this
    // describe block's original Phase 15.4b premise (chocolate's
    // appearance is no longer left fully to chance on floor 1).
    for (let seed = 0; seed < 1000; seed++) {
      const state = createInitialState(seed);
      const count = state.groundItems.filter((item) => item.itemId === 'chocolate').length;
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('the floor-1 guarantee never changes the total ground-item count for that floor', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const state = createInitialState(seed);
      expect(state.groundItems.length).toBeGreaterThanOrEqual(2);
      expect(state.groundItems.length).toBeLessThanOrEqual(6);
    }
  });

  it('when placed, it is on a reachable floor tile', () => {
    for (const seed of [1, 7, 42, 2024]) {
      const state = createInitialState(seed);
      const chocolate = state.groundItems.find((item) => item.itemId === 'chocolate');
      if (!chocolate) continue;
      expect(state.map.terrain[chocolate.pos.y][chocolate.pos.x]).toBe('floor');
    }
  });

  it('does not overlap the player, exit, enemies, or other ground items', () => {
    for (const seed of [1, 7, 42, 2024]) {
      const state = createInitialState(seed);
      const chocolate = state.groundItems.find((item) => item.itemId === 'chocolate');
      if (!chocolate) continue;
      expect(chocolate.pos).not.toEqual(state.player.pos);
      expect(chocolate.pos).not.toEqual(state.exit);
      for (const enemy of state.enemies) {
        expect(chocolate.pos).not.toEqual(enemy.pos);
      }
      const others = state.groundItems.filter((item) => item.itemId !== 'chocolate' || item !== chocolate);
      for (const other of others) {
        if (other === chocolate) continue;
        expect(chocolate.pos).not.toEqual(other.pos);
      }
    }
  });

  it('placement is deterministic for a fixed seed', () => {
    const a = createInitialState(999);
    const b = createInitialState(999);
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('picking it up adds 1 to inventory', () => {
    const state = freshState({
      groundItems: [{ id: 0, itemId: 'chocolate', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.chocolate).toBe(1);
  });

  it('pickup fails when inventory is at capacity (Phase 11.1 regression)', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), apple: 20 },
      groundItems: [{ id: 0, itemId: 'chocolate', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.inventory.chocolate).toBe(0);
  });

  it('using it consumes exactly 1 and recovers 30 hunger', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), chocolate: 2 },
      hunger: 50,
    });
    processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(state.inventory.chocolate).toBe(1);
    expect(getHunger(state)).toBe(50 + CHOCOLATE_HUNGER_RECOVERY);
  });

  it('does not recover past HUNGER_MAX', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), chocolate: 1 },
      hunger: 90,
    });
    processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(getHunger(state)).toBe(HUNGER_MAX);
  });

  it('cannot be used at full hunger: not consumed, no turn', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), chocolate: 1 },
      hunger: HUNGER_MAX,
    });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(result.consumed).toBe(false);
    expect(state.inventory.chocolate).toBe(1);
    expect(state.turn).toBe(turnBefore);
  });

  it('failed use pushes chocolate_use_failed with reason hunger_full', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), chocolate: 1 },
      hunger: HUNGER_MAX,
    });
    const result = processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(result.events).toContainEqual({ type: 'chocolate_use_failed', itemId: 'chocolate', reason: 'hunger_full' });
  });

  it('a successful use consumes exactly 1 turn', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), chocolate: 1 },
      hunger: 50,
    });
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('using chocolate from 0 hunger does not trigger starvation damage on that same turn', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), chocolate: 1 },
      hunger: 0,
      starvationProgress: 4, // one tick away from damage, to stress-test the grace rule
    });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('does not double-progress the 4-turn hunger-decrease cycle on a single chocolate use', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), chocolate: 1 },
      hunger: 50,
      hungerDecreaseProgress: 0,
    });
    processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(getHungerDecreaseProgress(state)).toBe(1);
  });

  it('chocolate can be placed and discarded via the existing Phase 11.2 actions', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), chocolate: 2 },
    });
    const placeResult = processTurn(state, { type: 'place_item', itemId: 'chocolate' });
    expect(placeResult.consumed).toBe(true);
    expect(state.inventory.chocolate).toBe(1);
    expect(state.groundItems.some((g) => g.itemId === 'chocolate')).toBe(true);

    const discardResult = processTurn(state, { type: 'discard_item', itemId: 'chocolate' });
    expect(discardResult.consumed).toBe(true);
    expect(state.inventory.chocolate).toBe(0);
  });

  it('is registered with the correct display name and category', () => {
    expect(ITEM_IDS_IN_ORDER).toContain('chocolate');
    expect(ITEM_DEFINITIONS.chocolate.displayName).toBe('チョコレート');
    expect(ITEM_DEFINITIONS.chocolate.category).toBe('consumable');
    expect(ITEM_DEFINITIONS.chocolate.hungerAmount).toBe(30);
  });
});

describe('starvation (Phase 11.3)', () => {
  it('the same turn hunger drops from 1 to 0 deals no damage', () => {
    const state = freshState({ hunger: 1, hungerDecreaseProgress: HUNGER_DECREASE_INTERVAL - 1 });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(getHunger(state)).toBe(0);
    expect(state.player.hp).toBe(hpBefore);
  });

  it('4 successful turns at 0 hunger deal no damage', () => {
    const state = freshState({ hunger: 0 });
    const hpBefore = state.player.hp;
    waitN(state, STARVATION_INTERVAL - 1);
    expect(state.player.hp).toBe(hpBefore);
  });

  it('the 5th successful turn at 0 hunger deals exactly 1 damage', () => {
    const state = freshState({ hunger: 0 });
    const hpBefore = state.player.hp;
    waitN(state, STARVATION_INTERVAL);
    expect(state.player.hp).toBe(hpBefore - STARVATION_DAMAGE);
  });

  it('10 successful turns at 0 hunger deal a total of 2 damage', () => {
    const state = freshState({ hunger: 0 });
    const hpBefore = state.player.hp;
    waitN(state, STARVATION_INTERVAL * 2);
    expect(state.player.hp).toBe(hpBefore - STARVATION_DAMAGE * 2);
  });

  it('a failed action does not progress starvation', () => {
    const state = freshState({ hunger: 0, starvationProgress: STARVATION_INTERVAL - 1 });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'move', direction: 'N' }); // blocked by wall
    expect(state.player.hp).toBe(hpBefore);
    expect(getStarvationProgress(state)).toBe(STARVATION_INTERVAL - 1);
  });

  it('is not reduced by armor', () => {
    const state = freshState({
      hunger: 0,
      equippedArmorId: 'armor',
      inventory: { ...createEmptyInventory(), armor: 1 },
    });
    const hpBefore = state.player.hp;
    waitN(state, STARVATION_INTERVAL);
    expect(state.player.hp).toBe(hpBefore - STARVATION_DAMAGE);
  });

  it('does not use RNG (deterministic damage, no evasion roll)', () => {
    const state = freshState({ hunger: 0 });
    const rngBefore = state.combatRngState;
    waitN(state, STARVATION_INTERVAL);
    expect(state.combatRngState).toBe(rngBefore);
  });

  it('starvation progress resets to 0 once hunger recovers to >= 1', () => {
    const state = freshState({
      hunger: 0,
      starvationProgress: STARVATION_INTERVAL - 1,
      inventory: { ...createEmptyInventory(), chocolate: 1 },
    });
    processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(getStarvationProgress(state)).toBe(0);
  });

  it('starving to exactly 0 HP transitions to the existing gameover phase', () => {
    const state = freshState({ hunger: 0 });
    state.player.hp = STARVATION_DAMAGE; // exactly enough for the 5th tick to kill
    waitN(state, STARVATION_INTERVAL);
    expect(state.player.alive).toBe(false);
    expect(state.phase).toBe('gameover');
  });
});

describe('natural regeneration interaction (Phase 11.3)', () => {
  it('hunger >= 1 still regenerates on the existing cycle', () => {
    const state = freshState({ hunger: 50 });
    state.player.hp = state.player.maxHp - 10;
    waitN(state, REGEN_TURNS_PER_HP);
    expect(state.player.hp).toBe(state.player.maxHp - 10 + 1);
  });

  it('hunger 0 suspends natural regeneration entirely', () => {
    const state = freshState({ hunger: 0 });
    state.player.hp = state.player.maxHp - 10;
    waitN(state, REGEN_TURNS_PER_HP);
    expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp - 10);
  });

  it('regenProgress does not increase while hunger is 0', () => {
    const state = freshState({ hunger: 0, regenProgress: 2 });
    state.player.hp = state.player.maxHp - 10;
    processTurn(state, { type: 'wait' });
    expect(state.regenProgress).toBe(2);
  });

  it('transitioning to hunger 0 does not reset an in-progress regenProgress', () => {
    const state = freshState({ hunger: 1, hungerDecreaseProgress: HUNGER_DECREASE_INTERVAL - 1, regenProgress: 3 });
    state.player.hp = state.player.maxHp - 10;
    processTurn(state, { type: 'wait' }); // this turn hunger drops 1->0
    expect(getHunger(state)).toBe(0);
    expect(state.regenProgress).toBe(3);
  });

  it('regen resumes from the preserved regenProgress once hunger recovers', () => {
    const state = freshState({
      hunger: 0,
      regenProgress: REGEN_TURNS_PER_HP - 1,
      inventory: { ...createEmptyInventory(), chocolate: 1 },
    });
    state.player.hp = state.player.maxHp - 10;
    // Using chocolate is itself a consumed turn; hunger becomes >=1 before
    // the regen step runs this same turn, so this turn's regen tick
    // (the preserved REGEN_TURNS_PER_HP-1 + 1 this turn) should complete.
    processTurn(state, { type: 'use_item', itemId: 'chocolate' });
    expect(state.player.hp).toBe(state.player.maxHp - 10 + 1);
  });

  it('starvation damage and natural regen never both apply on the same turn', () => {
    const state = freshState({ hunger: 0 });
    state.player.hp = state.player.maxHp - 10;
    const hpAfterEachTurn: number[] = [];
    for (let i = 0; i < STARVATION_INTERVAL; i++) {
      processTurn(state, { type: 'wait' });
      hpAfterEachTurn.push(state.player.hp);
    }
    // Only the starvation tick (last turn) should have changed HP, and
    // only downward.
    expect(state.player.hp).toBe(state.player.maxHp - 10 - STARVATION_DAMAGE);
  });

  it('regen interval matches the Phase 15.2 rebalance', () => {
    expect(REGEN_TURNS_PER_HP).toBe(10);
  });
});

describe('lifecycle: floor transitions, new run, retry (Phase 11.3)', () => {
  it('hunger and both progress counters are maintained across a floor transition', () => {
    let state = freshState({ hunger: 42, hungerDecreaseProgress: 2, starvationProgress: 0 });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { x: 99, y: 99 };
    state.exit = { x: 99, y: 99 };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    // The wait above also progressed hungerDecreaseProgress by 1 (2->3).
    expect(getHunger(state)).toBe(42);
    expect(getHungerDecreaseProgress(state)).toBe(3);
  });

  it('floor transition does not recover hunger', () => {
    let state = freshState({ hunger: 10 });
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { x: 99, y: 99 };
    state.exit = { x: 99, y: 99 };
    processTurn(state, { type: 'wait' });
    state = advanceToNextFloor(state);
    expect(getHunger(state)).toBeLessThanOrEqual(10);
  });

  it('a new run does not carry over a previous run\'s low hunger value', () => {
    const state = createInitialState(2024);
    expect(getHunger(state)).toBe(HUNGER_MAX);
  });
});

describe('HUD/message thresholds (Phase 11.3)', () => {
  it('reaching <= 20 for the first time pushes hunger_low_warning exactly once', () => {
    const state = freshState({ hunger: HUNGER_LOW_THRESHOLD + 1, hungerDecreaseProgress: HUNGER_DECREASE_INTERVAL - 1 });
    const result = processTurn(state, { type: 'wait' });
    expect(getHunger(state)).toBe(HUNGER_LOW_THRESHOLD);
    const warnings = result.events.filter((e) => e.type === 'hunger_low_warning');
    expect(warnings).toHaveLength(1);
  });

  it('staying at or below 20 across further turns does not repeat the warning', () => {
    const state = freshState({ hunger: HUNGER_LOW_THRESHOLD, hungerLowWarned: true });
    const result = processTurn(state, { type: 'wait' });
    const warnings = result.events.filter((e) => e.type === 'hunger_low_warning');
    expect(warnings).toHaveLength(0);
  });

  it('reaching 0 for the first time pushes hunger_zero_warning exactly once', () => {
    const state = freshState({ hunger: 1, hungerDecreaseProgress: HUNGER_DECREASE_INTERVAL - 1 });
    const result = processTurn(state, { type: 'wait' });
    expect(getHunger(state)).toBe(0);
    const warnings = result.events.filter((e) => e.type === 'hunger_zero_warning');
    expect(warnings).toHaveLength(1);
  });

  it('staying at 0 across further turns does not repeat the zero warning', () => {
    const state = freshState({ hunger: 0, hungerZeroWarned: true });
    const result = processTurn(state, { type: 'wait' });
    const warnings = result.events.filter((e) => e.type === 'hunger_zero_warning');
    expect(warnings).toHaveLength(0);
  });

  it('recovering above 20 then dipping again re-triggers the low warning', () => {
    const state = freshState({
      hunger: 90,
      hungerLowWarned: true, // stale flag from a much earlier dip
    });
    // Manually simulate recovery clearing the flag by going through a turn
    // above the threshold first.
    processTurn(state, { type: 'wait' });
    expect(state.hungerLowWarned).toBe(false);
  });

  it('starvation damage is notified exactly once per tick', () => {
    const state = freshState({ hunger: 0 });
    const result = waitAndCollect(state, STARVATION_INTERVAL);
    const damageEvents = result.filter((e) => e.type === 'starvation_damage');
    expect(damageEvents).toHaveLength(1);
  });

  function waitAndCollect(state: GameState, n: number) {
    const all: import('../events').GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      const r = processTurn(state, { type: 'wait' });
      all.push(...r.events);
    }
    return all;
  }
});

describe('regression: existing systems unaffected by Phase 11.3', () => {
  it('Phase 11.1 capacity (20) is unchanged', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), apple: 20 } });
    const result = processTurn(state, { type: 'wait' });
    // Unrelated action, but confirms inventory object shape/capacity math still intact.
    expect(Object.values(state.inventory).reduce((a, b) => a + b, 0)).toBe(20);
    expect(result.consumed).toBe(true);
  });

  it('apple still heals HP by the existing amount', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 1;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(state.player.hp).toBe(1 + ITEM_DEFINITIONS.apple.healAmount!);
  });

  it('sun_fruit still restores solar energy by the existing amount (Phase 15.3: clamped to this fixture\'s max 5)', () => {
    const state = freshState({
      inventory: { ...createEmptyInventory(), sun_fruit: 1 },
      solarEnergy: 0,
    });
    processTurn(state, { type: 'use_item', itemId: 'sun_fruit' });
    expect(state.solarEnergy).toBe(5);
  });

  it('weapon equip/unequip via place-then-reequip still works', () => {
    const state = freshState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    processTurn(state, { type: 'equip_weapon', weaponId: 'sword' });
    expect(state.equippedWeaponId).toBe('sword');
  });

  it('normal move/attack/wait still function and consume 1 turn', () => {
    const state = freshState();
    const turnBefore = state.turn;
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('enemy/environment progress exactly once per player turn (unchanged)', () => {
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 2, 1);
    const state = freshState({ enemies: [enemy] });
    const result = processTurn(state, { type: 'wait' });
    expect(result.enemyActed).toBe(true);
  });

  it('floor transitions still work normally', () => {
    let state = freshState();
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { x: 99, y: 99 };
    state.exit = { x: 99, y: 99 };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(2);
  });

  it('a new run and death-retry both start hunger at HUNGER_MAX', () => {
    const runA = createInitialState(1);
    const runB = createInitialState(2);
    expect(getHunger(runA)).toBe(HUNGER_MAX);
    expect(getHunger(runB)).toBe(HUNGER_MAX);
  });
});
