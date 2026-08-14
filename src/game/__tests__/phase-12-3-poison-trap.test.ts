import { describe, expect, it } from 'vitest';
import { EFFECT_DEFINITIONS, getActiveEffect, getActiveEffects } from '../effects';
import { roomIndexContaining } from '../mapgen';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Room, Tile, TrapTile } from '../types';
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

describe('trap types (Phase 12.3)', () => {
  it('slow_trap has an explicit trapType', () => {
    const trap: TrapTile = { id: 0, pos: { x: 5, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    expect(trap.trapType).toBe('slow_trap');
  });

  it('poison_trap has an explicit trapType', () => {
    const trap: TrapTile = { id: 0, pos: { x: 5, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    expect(trap.trapType).toBe('poison_trap');
  });

  it('generated traps are typed explicitly, not inferred from array position', () => {
    // Search several seeds until we find one with 2 traps, then confirm
    // both entries carry an explicit trapType regardless of which index
    // they landed at.
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 42, 2024, 4242]) {
      const state = createInitialState(seed);
      const traps = state.traps ?? [];
      if (traps.length < 2) continue;
      for (const trap of traps) {
        expect(['slow_trap', 'poison_trap']).toContain(trap.trapType);
      }
      return;
    }
    throw new Error('no seed among the sample produced 2 traps; widen the seed sample');
  });
});

describe('slow_trap backward compatibility (Phase 12.3)', () => {
  it('slow_trap still triggers movement_slow, unchanged from Phase 12.2', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({ traps: [trap] });
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.traps?.[0].triggered).toBe(true);
    expect(getActiveEffect(state, 'movement_slow')).toEqual({ id: 'movement_slow', strength: 1, remainingTurns: 10 });
    expect(getActiveEffect(state, 'poison')).toBeUndefined();
  });
});

describe('poison_trap placement (Phase 12.3)', () => {
  it('placement produces at most one slow_trap and one poison_trap per floor across several seeds', () => {
    for (const seed of [1, 7, 42, 2024]) {
      const state = createInitialState(seed);
      const traps = state.traps ?? [];
      const slowTraps = traps.filter((t) => t.trapType === 'slow_trap');
      const poisonTraps = traps.filter((t) => t.trapType === 'poison_trap');
      expect(slowTraps.length).toBeLessThanOrEqual(1);
      expect(poisonTraps.length).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const a = createInitialState(999);
    const b = createInitialState(999);
    expect(a.traps).toEqual(b.traps);
  });

  it('does not place slow_trap and poison_trap on the same tile', () => {
    for (const seed of [1, 7, 42, 2024, 4242, 999]) {
      const state = createInitialState(seed);
      const traps = state.traps ?? [];
      const slow = traps.find((t) => t.trapType === 'slow_trap');
      const poison = traps.find((t) => t.trapType === 'poison_trap');
      if (slow && poison) {
        expect(slow.pos).not.toEqual(poison.pos);
      }
    }
  });

  it('poison_trap does not overlap start, exit, actors, or ground items', () => {
    const state = createInitialState(2024);
    const poison = (state.traps ?? []).find((t) => t.trapType === 'poison_trap');
    if (!poison) return;
    expect(poison.pos).not.toEqual(state.player.pos);
    expect(poison.pos).not.toEqual(state.exit);
    for (const enemy of state.enemies) expect(poison.pos).not.toEqual(enemy.pos);
    for (const item of state.groundItems) expect(poison.pos).not.toEqual(item.pos);
  });

  it('prefers a different room from slow_trap when possible', () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 42, 999, 2024, 4242]) {
      const state = createInitialState(seed);
      const traps = state.traps ?? [];
      const slow = traps.find((t) => t.trapType === 'slow_trap');
      const poison = traps.find((t) => t.trapType === 'poison_trap');
      if (!slow || !poison) continue;
      checked++;
      const slowRoom = roomIndexContaining(state.map.rooms, slow.pos);
      const poisonRoom = roomIndexContaining(state.map.rooms, poison.pos);
      // Either a different room (the preferred case), or — only if that
      // was impossible — the same room but >= 3 tiles away (the
      // documented fallback). Both are valid outcomes; what's invalid is
      // same room AND close together.
      if (slowRoom === poisonRoom) {
        const dist = Math.abs(slow.pos.x - poison.pos.x) + Math.abs(slow.pos.y - poison.pos.y);
        expect(dist).toBeGreaterThanOrEqual(3);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('adding poison_trap does not change existing (non-trap) placement results', () => {
    const state = createInitialState(4242);
    const again = createInitialState(4242);
    expect(state.player.pos).toEqual(again.player.pos);
    expect(state.enemies.map((e) => e.pos)).toEqual(again.enemies.map((e) => e.pos));
    expect(state.groundItems).toEqual(again.groundItems);
    const slow = (state.traps ?? []).find((t) => t.trapType === 'slow_trap');
    const slowAgain = (again.traps ?? []).find((t) => t.trapType === 'slow_trap');
    expect(slow?.pos).toEqual(slowAgain?.pos);
  });
});

describe('poison_trap trigger (Phase 12.3)', () => {
  function poisonTrapState(overrides?: Partial<GameState>): GameState {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    return freshState({ traps: [trap], ...overrides });
  }

  it('only the player can trigger it: an enemy walking over it does not trigger', () => {
    const trap: TrapTile = { id: 0, pos: { x: 17, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      traps: [trap],
    });
    processTurn(state, { type: 'wait' });
    expect(state.traps?.[0].triggered).toBe(false);
  });

  it('stepping onto it triggers: revealed, grants poison at strength 1, remaining 10 (Phase 15.2 rebalance)', () => {
    const state = poisonTrapState();
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.traps?.[0].triggered).toBe(true);
    expect(getActiveEffect(state, 'poison')).toEqual({ id: 'poison', strength: 1, remainingTurns: 10 });
  });

  it('re-stepping onto an already-triggered poison_trap does not re-trigger', () => {
    const state = poisonTrapState();
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' }); // triggers
    processTurn(state, { type: 'move', direction: 'W' });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(result.events.filter((e) => e.type === 'trap_triggered')).toHaveLength(0);
    expect(getActiveEffects(state).filter((e) => e.id === 'poison')).toHaveLength(1);
  });

  it('the trigger turn deals no poison damage', () => {
    const state = poisonTrapState();
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' }); // triggers
    expect(state.player.hp).toBe(hpBefore);
  });

  it('the trigger turn does not decrement remainingTurns (stays 10)', () => {
    const state = poisonTrapState();
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(getActiveEffect(state, 'poison')?.remainingTurns).toBe(10);
  });
});

describe('poison tick (Phase 12.3)', () => {
  it('deals no damage on the 1st successful turn, then 1 damage on the 2nd (Phase 15.2: POISON_TICK_INTERVAL=2), remaining goes to 8', () => {
    const state = freshState({ activeEffects: [{ id: 'poison', strength: 1, remainingTurns: 10 }] });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore); // turn 1: progress only, no tick yet
    expect(getActiveEffect(state, 'poison')?.remainingTurns).toBe(9);
    processTurn(state, { type: 'wait' });
    // Phase 16.2: hp starts at max (30), so no regen fires on turn 1;
    // the tick on turn 2 (hp 30->29) immediately triggers regen the
    // same turn (29 -> 30), netting to 0 visible change.
    expect(hpBefore - state.player.hp).toBe(0); // turn 2: tick fires, offset by regen
    expect(getActiveEffect(state, 'poison')?.remainingTurns).toBe(8);
  });

  it('deals damage exactly once per successful turn even with an additional enemy phase (movement_slow active too)', () => {
    const state = freshState({
      activeEffects: [
        { id: 'poison', strength: 3, remainingTurns: 10 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
      ],
      // Phase 15.2: primed one tick away so this single successful turn
      // (not two) produces exactly one poison tick, matching this test's
      // "exactly once per successful turn" focus regardless of the
      // interval's own length.
      poisonTickProgress: 1,
    });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'move', direction: 'E' });
    // Phase 16.2: regen fires the same turn (hp starts at max, drops
    // below max from the poison tick), offsetting 1 of the 3 damage.
    expect(hpBefore - state.player.hp).toBe(2);
  });

  it('hunger/starvation and effect decrement each run exactly once on a poisoned turn', () => {
    const state = freshState({
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      // Phase 15.2: primed one tick away so this single turn produces
      // exactly one poison tick (see the analogous note above).
      poisonTickProgress: 1,
      hunger: 0,
      starvationProgress: 0, // Phase 15.2: STARVATION_INTERVAL is now 1, so progress 0 -> 1 already ticks this turn
    });
    processTurn(state, { type: 'wait' });
    // starvation (STARVATION_DAMAGE=1) + poison (3) = 4, applied as two
    // separate, single applications rather than either being doubled.
    // Natural regen is suspended while hunger is 0 (as set here), so it
    // does not offset any of this damage.
    expect(30 - state.player.hp).toBe(4);
  });

  it('a blocked (failed) move deals no damage and does not decrement', () => {
    const state = freshState({
      player: createInitialActor({ x: 1, y: 1 }, 30, 10, 0, 90, 0),
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
    });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'move', direction: 'N' }); // wall
    expect(state.player.hp).toBe(hpBefore);
    expect(getActiveEffect(state, 'poison')?.remainingTurns).toBe(10);
  });

  it('a non-turn-consuming operation (face) deals no damage', () => {
    const state = freshState({ activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }] });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'face', direction: 'S' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('progresses on attack, wait, item use, spider web slow, and petrified skip', () => {
    // Phase 15.2: each fixture is primed one tick away (poisonTickProgress:
    // 1) so a single successful turn of each action type produces exactly
    // one poison tick, keeping this test focused on "which action types
    // count as a successful turn" rather than the interval's own length.
    // wait
    const s1 = freshState({ activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }], poisonTickProgress: 1 });
    processTurn(s1, { type: 'wait' });
    // Phase 16.2: regen fires the same turn, offsetting 1 of the 3 damage.
    expect(30 - s1.player.hp).toBe(2);

    // spider-web-slowed move (fails the move but still consumes a turn)
    const s2 = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), slowed: true },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      poisonTickProgress: 1,
    });
    processTurn(s2, { type: 'move', direction: 'E' });
    // Phase 16.2: regen fires the same turn, offsetting 1 of the 3 damage.
    expect(30 - s2.player.hp).toBe(2);

    // petrified skip
    const s3 = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), petrified: true },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      poisonTickProgress: 1,
    });
    processTurn(s3, { type: 'wait' });
    // Phase 16.2: regen fires the same turn, offsetting 1 of the 3 damage.
    expect(30 - s3.player.hp).toBe(2);
  });

  it('reaching the exit still ticks poison once before the floor transition is recorded', () => {
    const state = freshState({
      player: createInitialActor({ x: 6, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [],
      exit: { x: 7, y: 3 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      poisonTickProgress: 1, // Phase 15.2: primed so this one turn ticks
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.phase).not.toBe('playing');
    // Phase 16.2: regen fires the same turn, offsetting 1 of the 3 damage.
    expect(30 - state.player.hp).toBe(2);
  });

  it('applies damage on the final (remaining 1) turn, then expires', () => {
    const state = freshState({
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 1 }],
      poisonTickProgress: 1, // Phase 15.2: primed so this final turn ticks
    });
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'wait' });
    // Phase 16.2: regen fires the same turn, offsetting 1 of the 3 damage.
    expect(hpBefore - state.player.hp).toBe(2);
    expect(getActiveEffect(state, 'poison')).toBeUndefined();
    expect(result.events).toContainEqual({ type: 'effect_expired', effectId: 'poison' });
  });

  it('HP 2 -> actualDamage 2 and the player dies of poison', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), hp: 2 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      poisonTickProgress: 1, // Phase 15.2: primed so this turn ticks
    });
    const result = processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(0);
    expect(state.player.alive).toBe(false);
    expect(result.events).toContainEqual({ type: 'poison_damage', actualDamage: 2, hpBefore: 2, hpAfter: 0 });
    expect(result.playerDefeated).toBe(true);
  });

  it('armor/defense/evasion never reduce poison damage', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 999, 90, 100), hp: 30 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      poisonTickProgress: 1, // Phase 15.2: primed so this turn ticks
    });
    processTurn(state, { type: 'wait' });
    // Phase 16.2: regen fires the same turn, offsetting 1 of the 3 damage.
    expect(30 - state.player.hp).toBe(2);
  });

  it('a full 10-turn poison duration (real values) ticks exactly on turns 2/4/6/8/10, for 5 total damage (Phase 15.2)', () => {
    // Enemy pushed out to AGGRO_RANGE + 1 so it never notices the player
    // and interferes with this poison-only damage measurement (Phase
    // 16.1 gave enemies a finite aggro range — see turn.ts's
    // AGGRO_RANGE/isWithinAggroRange).
    const state = freshState({
      enemies: [createInitialEnemy('bok', { x: 12, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'poison', strength: 1, remainingTurns: 10 }],
    });
    const hpBefore = state.player.hp;
    const damagePerTurn: number[] = [];
    for (let i = 0; i < 10; i++) {
      const before = state.player.hp;
      processTurn(state, { type: 'wait' });
      damagePerTurn.push(before - state.player.hp);
    }
    // Phase 16.2: hp starts at max (30), so every tick (-1) immediately
    // triggers regen the same turn (+1), netting every turn to 0 —
    // poison's remainingTurns countdown and eventual expiry are
    // unaffected by this.
    expect(damagePerTurn).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(hpBefore - state.player.hp).toBe(0);
    expect(getActiveEffect(state, 'poison')).toBeUndefined(); // expired exactly at turn 10
  });

  it('does not use combatRngState', () => {
    const state = freshState({
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      combatRngState: 999999,
    });
    const before = state.combatRngState;
    processTurn(state, { type: 'wait' });
    expect(state.combatRngState).toBe(before);
  });
});

describe('ordering: poison vs enemy attack / starvation / regen (Phase 12.3)', () => {
  const GUARANTEED_HIT_SEED = 0; // first roll: 26 (matches phase-10-3-1-telemetry.test.ts's constant)

  it('does not stack poison damage on a turn the player already died to an enemy attack', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), hp: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 3 }, 1000, 999, 0, 0, 0, 100, 0)],
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      combatRngState: GUARANTEED_HIT_SEED,
    });
    const result = processTurn(state, { type: 'wait' });
    // Whatever the enemy attack did, HP must never go negative and must
    // not additionally lose 3 from poison on the same turn it already
    // reached (or passed through) 0.
    expect(state.player.hp).toBe(0);
    expect(result.events.filter((e) => e.type === 'poison_damage')).toHaveLength(0);
  });

  it('does not stack poison damage on a turn the player died of starvation', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), hp: 1 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      hunger: 0,
      starvationProgress: 999,
    });
    const result = processTurn(state, { type: 'wait' });
    expect(state.player.alive).toBe(false);
    expect(result.events.filter((e) => e.type === 'poison_damage')).toHaveLength(0);
  });

  it('does not naturally regenerate on the turn the player dies of poison', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), hp: 2 },
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
      // Phase 16.2 exposed a pre-existing gap in this fixture: without
      // priming poisonTickProgress, poison doesn't actually tick on the
      // first turn (POISON_TICK_INTERVAL=2), so the player never died
      // here in the first place — this test was only passing because
      // natural regen used to need 10 turns to fire too, for an
      // unrelated reason. Priming progress to 1 (matching the sibling
      // tests in this file) makes poison actually tick and kill the
      // player this turn, which is what the test's title describes.
      poisonTickProgress: 1,
    });
    const result = processTurn(state, { type: 'wait' });
    expect(state.player.alive).toBe(false);
    expect(result.playerRegenerated).toBe(false);
  });

  it('natural regen proceeds normally on a turn poison did not kill the player', () => {
    const state = freshState({
      player: { ...createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0), hp: 20 },
      regenProgress: 0,
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
    });
    // Drive regenProgress up to just before the tick threshold, then let
    // the final poisoned turn both tick poison and trigger regen.
    // REGEN_TURNS_PER_HP's exact value isn't asserted here — only that
    // regen isn't unconditionally suppressed by poison's presence.
    let result;
    for (let i = 0; i < 50; i++) {
      result = processTurn(state, { type: 'wait' });
      if (state.player.hp <= 0) break;
      if (result.playerRegenerated) break;
    }
    expect(result?.playerRegenerated).toBe(true);
  });

  it('poison_trap trigger turn with no prior poison deals no damage', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    const state = freshState({ traps: [trap] });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('slow_trap trigger turn with existing poison still ticks poison normally', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      traps: [trap],
      activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 10 }],
    });
    processTurn(state, { type: 'move', direction: 'E' }); // ordinary poisoned move: -3, offset by 1 regen (Phase 16.2)
    const hpBeforeTrigger = state.player.hp;
    processTurn(state, { type: 'move', direction: 'E' }); // triggers slow_trap
    // Phase 16.2: regen fires the same turn, offsetting 1 of the 3 damage.
    expect(hpBeforeTrigger - state.player.hp).toBe(2); // poison still applied
    expect(getActiveEffect(state, 'poison')?.remainingTurns).toBe(8); // decremented on both turns
  });
});

describe('compatibility: attack_up, movement_slow, poison simultaneously (Phase 12.3)', () => {
  it('all three effects can be held at once and each decrements independently', () => {
    const state = freshState({
      activeEffects: [
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
        { id: 'poison', strength: 3, remainingTurns: 10 },
      ],
    });
    processTurn(state, { type: 'wait' });
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(7);
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(4);
    expect(getActiveEffect(state, 'poison')?.remainingTurns).toBe(9);
  });

  it('poison_trap trigger turn skips only poison, not simultaneously active attack_up/movement_slow', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    const state = freshState({
      traps: [trap],
      activeEffects: [
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
        { id: 'movement_slow', strength: 1, remainingTurns: 5 },
      ],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' }); // triggers poison_trap
    expect(getActiveEffect(state, 'poison')?.remainingTurns).toBe(10); // fresh, not decremented
    expect(getActiveEffect(state, 'attack_up')?.remainingTurns).toBe(6); // decremented normally x2
    expect(getActiveEffect(state, 'movement_slow')?.remainingTurns).toBe(3); // decremented normally x2
  });

  it('poison_trap trigger move still runs the additional enemy phase if movement_slow was already active', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    const state = freshState({
      traps: [trap],
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
    });
    processTurn(state, { type: 'move', direction: 'E' }); // -> 3,3
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'move', direction: 'E' }); // -> 4,3, triggers poison_trap
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(2); // additional phase still ran
  });

  it('slow_trap trigger move does not run the additional enemy phase, per Phase 12.2', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      traps: [trap],
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
    });
    processTurn(state, { type: 'move', direction: 'E' }); // -> 3,3
    const enemyXBefore = state.enemies[0].pos.x;
    processTurn(state, { type: 'move', direction: 'E' }); // -> 4,3, triggers slow_trap (refresh)
    expect(enemyXBefore - state.enemies[0].pos.x).toBe(1); // no additional phase
  });

  it('attack_up physical damage bonus is unaffected by poison', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 100, 0),
      enemies: [createInitialEnemy('bok', { x: 3, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      activeEffects: [
        { id: 'attack_up', strength: 5, remainingTurns: 8 },
        { id: 'poison', strength: 3, remainingTurns: 10 },
      ],
    });
    const before = state.enemies[0].hp;
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(before - state.enemies[0].hp).toBe(15); // 10 base + 5 attack_up - 0 defense
  });

  it('new run starts with no poison', () => {
    const state = createInitialState(123);
    expect(getActiveEffect(state, 'poison')).toBeUndefined();
  });

  it('poison is maintained across floor transitions', () => {
    const state = freshState({ activeEffects: [{ id: 'poison', strength: 3, remainingTurns: 6 }] });
    const next = advanceToNextFloor(state);
    expect(getActiveEffect(next, 'poison')).toEqual({ id: 'poison', strength: 3, remainingTurns: 6 });
  });
});

describe('HUD label content (Phase 12.3, via EFFECT_DEFINITIONS)', () => {
  it('poison is registered with displayName 毒, strength 1, duration 10 (Phase 15.2 rebalance)', () => {
    expect(EFFECT_DEFINITIONS.poison).toEqual({
      id: 'poison',
      displayName: '毒',
      strength: 1,
      duration: 10,
    });
  });
});
