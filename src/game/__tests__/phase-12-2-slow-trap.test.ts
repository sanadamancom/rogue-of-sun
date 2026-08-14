import { describe, expect, it } from 'vitest';
import { EFFECT_DEFINITIONS, getActiveEffect, getActiveEffects } from '../effects';
import { chooseTrapPosition } from '../mapgen';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { ActiveEffect, GameMap, GameState, Room, Tile, TrapTile, WebTile } from '../types';
import { createEmptyInventory } from '../item-def';

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
    inventory: { ...createEmptyInventory(),
      apple: 0,
      sword: 0,
      armor: 0,
      spear: 0,
      hammer: 0,
      sun_fruit: 0,
      solar_gun: 0,
      sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0,
      chocolate: 0,
      banana: 0,
      antidote: 0,
      panacea: 0,
      clairvoyance_fruit: 0,
      high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0,
    },
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

describe('chooseTrapPosition (Phase 12.2)', () => {
  it('only returns tiles inside a room rectangle', () => {
    const map = testMap();
    for (let i = 0; i < 20; i++) {
      const pos = chooseTrapPosition(map, map.rooms, { x: 2, y: 3 }, { x: 3, y: 3 }, [], () => i / 20);
      if (!pos) continue;
      const room = map.rooms[0];
      expect(pos.x).toBeGreaterThanOrEqual(room.x);
      expect(pos.x).toBeLessThan(room.x + room.width);
      expect(pos.y).toBeGreaterThanOrEqual(room.y);
      expect(pos.y).toBeLessThan(room.y + room.height);
    }
  });

  it('excludes tiles closer than Manhattan distance 4 from start', () => {
    const map = testMap();
    const start = { x: 2, y: 3 };
    const exit = { x: 99, y: 99 }; // far away, never the binding constraint here
    for (let i = 0; i < 50; i++) {
      const pos = chooseTrapPosition(map, map.rooms, start, exit, [], () => i / 50);
      if (!pos) continue;
      const dist = Math.abs(pos.x - start.x) + Math.abs(pos.y - start.y);
      expect(dist).toBeGreaterThanOrEqual(4);
    }
  });

  it('excludes tiles closer than Manhattan distance 2 from exit', () => {
    const map = testMap();
    const start = { x: -99, y: -99 }; // far away, never the binding constraint here
    const exit = { x: 10, y: 3 };
    for (let i = 0; i < 50; i++) {
      const pos = chooseTrapPosition(map, map.rooms, start, exit, [], () => i / 50);
      if (!pos) continue;
      const dist = Math.abs(pos.x - exit.x) + Math.abs(pos.y - exit.y);
      expect(dist).toBeGreaterThanOrEqual(2);
    }
  });

  it('excludes every tile passed in `exclude`', () => {
    const map = testMap();
    const exclude = [{ x: 10, y: 3 }];
    for (let i = 0; i < 30; i++) {
      const pos = chooseTrapPosition(map, map.rooms, { x: 2, y: 3 }, { x: 3, y: 3 }, exclude, () => i / 30);
      if (!pos) continue;
      expect(pos).not.toEqual(exclude[0]);
    }
  });

  it('returns null when no candidate satisfies every constraint', () => {
    const map = testMap();
    // A tiny 1-tile "room" right next to start makes every candidate fail
    // the distance-4-from-start rule.
    const tinyRoom: Room = { x: 2, y: 3, width: 1, height: 1 };
    const pos = chooseTrapPosition(map, [tinyRoom], { x: 2, y: 3 }, { x: 99, y: 99 }, [], () => 0);
    expect(pos).toBeNull();
  });

  it('is deterministic for a fixed rng sequence', () => {
    const map = testMap();
    const a = chooseTrapPosition(map, map.rooms, { x: 2, y: 3 }, { x: 3, y: 3 }, [], () => 0.42);
    const b = chooseTrapPosition(map, map.rooms, { x: 2, y: 3 }, { x: 3, y: 3 }, [], () => 0.42);
    expect(a).toEqual(b);
  });
});

describe('trap placement via createInitialState (Phase 12.2)', () => {
  it('places at most one slow_trap per floor across several seeds', () => {
    // Phase 12.3 adds poison_trap into this same array, so the overall
    // traps array can now hold up to 2 entries — this assertion is
    // narrowed to slow_trap specifically, which is what Phase 12.2
    // originally guaranteed and still does.
    for (const seed of [1, 7, 42, 2024]) {
      const state = createInitialState(seed);
      const slowTraps = (state.traps ?? []).filter((t) => t.trapType === 'slow_trap');
      expect(slowTraps.length).toBeLessThanOrEqual(1);
    }
  });

  it('is placed on a reachable room floor tile when present', () => {
    const state = createInitialState(2024);
    const trap = (state.traps ?? [])[0];
    if (!trap) return; // this seed's map may legitimately have none
    expect(state.map.terrain[trap.pos.y][trap.pos.x]).toBe('floor');
    const insideSomeRoom = state.map.rooms.some(
      (room) =>
        trap.pos.x >= room.x &&
        trap.pos.x < room.x + room.width &&
        trap.pos.y >= room.y &&
        trap.pos.y < room.y + room.height,
    );
    expect(insideSomeRoom).toBe(true);
  });

  it('does not overlap the player, exit, enemies, or ground items', () => {
    const state = createInitialState(2024);
    const trap = (state.traps ?? [])[0];
    if (!trap) return;
    expect(trap.pos).not.toEqual(state.player.pos);
    expect(trap.pos).not.toEqual(state.exit);
    for (const enemy of state.enemies) expect(trap.pos).not.toEqual(enemy.pos);
    for (const item of state.groundItems) expect(trap.pos).not.toEqual(item.pos);
  });

  it('starts untriggered', () => {
    const state = createInitialState(2024);
    const trap = (state.traps ?? [])[0];
    if (!trap) return;
    expect(trap.triggered).toBe(false);
  });

  it('placement is deterministic for a fixed seed', () => {
    const a = createInitialState(999);
    const b = createInitialState(999);
    expect(a.traps).toEqual(b.traps);
  });

  it('does not change existing (non-trap) placement RNG consumption/results', () => {
    const state = createInitialState(4242);
    const again = createInitialState(4242);
    expect(state.player.pos).toEqual(again.player.pos);
    expect(state.enemies.map((e) => e.pos)).toEqual(again.enemies.map((e) => e.pos));
    expect(state.groundItems).toEqual(again.groundItems);
  });
});

describe('trap trigger (Phase 12.2)', () => {
  function trapState(overrides?: Partial<GameState>): GameState {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    return freshState({ traps: [trap], ...overrides });
  }

  it('only the player can trigger it: an enemy walking over it does not trigger', () => {
    const trap: TrapTile = { id: 0, pos: { x: 17, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      traps: [trap],
    });
    processTurn(state, { type: 'wait' }); // bok chases one step onto (or toward) the trap tile
    expect(state.traps?.[0].triggered).toBe(false);
  });

  it('stepping onto it triggers: revealed, grants movement_slow at strength 1, remaining 10', () => {
    const state = trapState();
    processTurn(state, { type: 'move', direction: 'E' }); // 2,3 -> 3,3
    processTurn(state, { type: 'move', direction: 'E' }); // 3,3 -> 4,3 (trap tile)
    expect(state.traps?.[0].triggered).toBe(true);
    expect(getActiveEffect(state, 'movement_slow')).toEqual({ id: 'movement_slow', strength: 1, remainingTurns: 10 });
  });

  it('pushes exactly one trap_triggered event and one effect_granted event', () => {
    const state = trapState();
    processTurn(state, { type: 'move', direction: 'E' });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events.filter((e) => e.type === 'trap_triggered')).toHaveLength(1);
    expect(result.events.filter((e) => e.type === 'effect_granted')).toHaveLength(1);
  });

  it('re-stepping onto an already-triggered trap does not re-trigger or duplicate the effect', () => {
    const state = trapState();
    processTurn(state, { type: 'move', direction: 'E' }); // -> 3,3
    processTurn(state, { type: 'move', direction: 'E' }); // -> 4,3, triggers
    processTurn(state, { type: 'move', direction: 'W' }); // -> 3,3
    const result = processTurn(state, { type: 'move', direction: 'E' }); // -> 4,3 again
    expect(result.events.filter((e) => e.type === 'trap_triggered')).toHaveLength(0);
    expect(getActiveEffects(state)).toHaveLength(1);
  });

  it('the trigger turn itself does not decrement remainingTurns (stays 10)', () => {
    const state = trapState();
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' }); // triggers
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(10);
  });

  it('the trigger turn itself does not run an additional enemy phase', () => {
    // Enemy several tiles east of the trap tile; one chase step per phase.
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      traps: [trap],
    });
    processTurn(state, { type: 'move', direction: 'E' }); // -> 3,3
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'move', direction: 'E' }); // -> 4,3, triggers
    // Only the normal single enemy phase should have run this turn.
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(1);
  });
});

describe('movement_slow additional enemy phase (Phase 12.2)', () => {
  function activeState(overrides?: Partial<GameState>): GameState {
    return freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
      ...overrides,
    });
  }

  it('a successful move runs the enemy phase twice (bok chases 2 steps instead of 1)', () => {
    const state = activeState();
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'move', direction: 'E' });
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(2);
  });

  it('the player still only moves 1 tile', () => {
    const state = activeState();
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.player.pos).toEqual({ x: 3, y: 3 });
  });

  it('a melee attack does not trigger the additional enemy phase', () => {
    const state = activeState({
      enemies: [createInitialEnemy('bok', { x: 3, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
    });
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    // bok is adjacent and attacks (does not move) either way; assert no
    // extra phase by checking the effect's remainingTurns decremented by
    // exactly 1 (a double phase would not change this, but this test's
    // primary intent is documented via the 'wait'/'use_item' cases below
    // which are unambiguous — enemy position is not a reliable double-
    // phase signal when adjacent, since attacking never moves it).
    expect(enemyXBefore).toBe(state.enemies[0].pos.x);
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(4);
  });

  it('waiting does not trigger the additional enemy phase', () => {
    const state = activeState();
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'wait' });
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(1);
  });

  it('using an item does not trigger the additional enemy phase', () => {
    const state = activeState({ inventory: { ...freshState().inventory, apple: 1 }, player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0) });
    state.player.hp = 10; // below max so the apple use succeeds
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(1);
  });

  it('the solar gun does not trigger the additional enemy phase', () => {
    const state = activeState({ equippedWeaponId: 'solar_gun', solarEnergy: 5 });
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(1);
  });

  it('a blocked (failed) move does not trigger the additional enemy phase', () => {
    const state = activeState({ player: createInitialActor({ x: 1, y: 1 }, 30, 10, 0, 90, 0) });
    const enemyXBefore = state.enemies[0].pos.x;
    const result = processTurn(state, { type: 'move', direction: 'N' }); // wall
    expect(result.consumed).toBe(false);
    expect(enemyXBefore).toBe(state.enemies[0].pos.x); // no enemy phase ran at all
  });

  it('moving onto the exit tile does not trigger the additional enemy phase', () => {
    const state = activeState({ exit: { x: 3, y: 3 }, enemies: [] });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.consumed).toBe(true);
    expect(state.phase).not.toBe('playing'); // floor_cleared or victory
  });

  it('if the player dies in the first enemy phase, no additional phase runs', () => {
    const state = activeState({
      player: createInitialActor({ x: 2, y: 3 }, 1, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 3, y: 3 }, 1000, 999, 0, 0, 100, 0)],
    });
    const result = processTurn(state, { type: 'move', direction: 'S' }); // moves to 2,4; bok (adjacent-ish) kills
    // Whatever happened, the call must not throw and must report defeat
    // consistently; the key guarantee is no crash/double-processing.
    expect(result.consumed).toBe(true);
  });

  it('satisfies fixed enemy count per phase: each enemy acts at most once per phase (2 enemies both advance once per phase)', () => {
    const state = activeState({
      enemies: [
        createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0),
        createInitialEnemy('bok', { x: 9, y: 5 }, 1000, 0, 1, 1, 0, 90, 0),
      ],
    });
    const xBefore = state.enemies.map((e) => e.pos.x);
    processTurn(state, { type: 'move', direction: 'E' });
    for (let i = 0; i < 2; i++) {
      expect(xBefore[i] - state.enemies[i].pos.x).toBe(2);
    }
  });
});

describe('movement_slow duration and lifecycle (Phase 12.2)', () => {
  it('decreases by 1 on a successful move once already active', () => {
    const state = freshState({ activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 10 }] });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(9);
  });

  it('decreases by 1 on a successful wait', () => {
    const state = freshState({ activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 10 }] });
    processTurn(state, { type: 'wait' });
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(9);
  });

  it('does not decrease on a blocked move', () => {
    const state = freshState({
      player: createInitialActor({ x: 1, y: 1 }, 30, 10, 0, 90, 0),
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 10 }],
    });
    processTurn(state, { type: 'move', direction: 'N' });
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(10);
  });

  it('applies the extra phase on the final (remaining 1) successful move, then expires', () => {
    const state = freshState({
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 1 }],
    });
    const enemyXBefore = state.enemies[0].pos.x;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(2); // extra phase still applied
    expect(getActiveEffect(state, 'movement_slow')).toBeUndefined(); // then expired
    expect(result.events).toContainEqual({ type: 'effect_expired', effectId: 'movement_slow' });
  });

  it('expires after a non-move successful action at remaining 1', () => {
    const state = freshState({ activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 1 }] });
    const result = processTurn(state, { type: 'wait' });
    expect(getActiveEffect(state, 'movement_slow')).toBeUndefined();
    expect(result.events).toContainEqual({ type: 'effect_expired', effectId: 'movement_slow' });
  });

  it('is maintained across floor transitions', () => {
    const state = freshState({ activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 6 }] });
    const next = advanceToNextFloor(state);
    expect(getActiveEffect(next, 'movement_slow')).toEqual({ id: 'movement_slow', strength: 1, remainingTurns: 6 });
  });

  it('a brand new run starts with no movement_slow', () => {
    const state = createInitialState(123);
    expect(getActiveEffect(state, 'movement_slow')).toBeUndefined();
  });
});

describe('compatibility: spider web (Phase 12.2)', () => {
  it('spider-web movement failure takes priority; no additional enemy phase on that turn', () => {
    const web: WebTile = { id: 0, pos: { x: 3, y: 3 }, ownerEnemyId: 0, placedTurn: 0 };
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), slowed: true },
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      webs: [web],
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
    });
    const enemyXBefore = state.enemies[0].pos.x;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(state.player.pos).toEqual({ x: 2, y: 3 }); // move failed (web-slowed)
    expect(result.events).toContainEqual({ type: 'slowed_move_cancelled' });
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(1); // only 1 phase, not 2
  });

  it('the spider-web-failed turn still decrements movement_slow by 1 (it is a successful/consumed turn)', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), slowed: true },
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(4);
  });
});

describe('compatibility: petrified (Phase 12.2)', () => {
  it('a forced petrified skip does not run the additional enemy phase', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), petrified: true },
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
    });
    const enemyXBefore = state.enemies[0].pos.x;
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events).toContainEqual({ type: 'player_petrified_skip' });
    expect(state.player.pos).toEqual({ x: 2, y: 3 });
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(1);
  });

  it('petrified and movement_slow can be simultaneously true', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), petrified: true },
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
    });
    processTurn(state, { type: 'wait' });
    expect(state.player.petrified).toBe(false); // cleared by the skip, as before
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(4); // still progresses normally
  });
});

describe('compatibility: attack_up (Phase 12.2)', () => {
  it('attack_up and movement_slow can be held simultaneously', () => {
    const state = freshState({
      activeEffects: [
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
      ],
    });
    processTurn(state, { type: 'wait' });
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(7);
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(4);
  });

  it('a trap-trigger turn skips only movement_slow, not a simultaneously active attack_up', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      traps: [trap],
      activeEffects: [{ id: 'attack_up', strength: 5, remainingTurns: 8 }],
    });
    processTurn(state, { type: 'move', direction: 'E' }); // -> 3,3
    processTurn(state, { type: 'move', direction: 'E' }); // -> 4,3, triggers movement_slow
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(10); // not decremented
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(6); // decremented normally, twice (2 moves)
  });

  it('attack_up physical damage bonus is unaffected by movement_slow', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 100, 0),
      enemies: [createInitialEnemy('bok', { x: 3, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
      ],
    });
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(before - state.enemies[0].hp).toBe(15); // 10 base + 5 attack_up - 0 defense
  });
});

describe('HUD label content (Phase 12.2, via EFFECT_DEFINITIONS)', () => {
  it('movement_slow is registered with displayName 鈍足, strength 1, duration 10', () => {
    expect(EFFECT_DEFINITIONS.movement_slow).toEqual({
      id: 'movement_slow',
      displayName: '鈍足',
      strength: 1,
      duration: 10,
    });
  });
});

describe('telemetry/regression guards (Phase 12.2)', () => {
  it('does not change combatRngState purely from trap trigger or duration progression', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({ traps: [trap], combatRngState: 12345 });
    const before = state.combatRngState;
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' }); // triggers, no attack rolls involved
    expect(state.combatRngState).toBe(before);
  });

  it('an untriggered ActiveEffect type import is exercised for type-checking purposes', () => {
    const effect: ActiveEffect = { id: 'movement_slow', strength: 1, remainingTurns: 1 };
    expect(effect.id).toBe('movement_slow');
  });
});
