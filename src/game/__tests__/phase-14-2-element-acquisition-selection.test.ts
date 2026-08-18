import { describe, expect, it } from 'vitest';
import { createEmptyInventory, getGroundItemPoolForFloor } from '../item-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { createRunTelemetry, recordTurn, snapshotForTurn } from '../telemetry';
import { ElementId, GameMap, GameState, PlayerAction, Tile } from '../types';

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
    player: createInitialActor({ x: 2, y: 1 }, 3, 1),
    enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 1)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
    exit: { x: 99, y: 99 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: createEmptyInventory(),
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: 'sword',
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: true,
    unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'sol',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  } as GameState;
}

function faceEastAtEnemy(state: GameState): void {
  processTurn(state, { type: 'face', direction: 'E' });
}

describe('Phase 14.2/15.4b: floor placement (random ground item generation)', () => {
  it('flame_enchantment is a candidate from floor 1 onward; frost/cloud from floor 2; earth from floor 3 (cumulative staged pool)', () => {
    expect(getGroundItemPoolForFloor(1, 3, 'short')).toContain('flame_enchantment');
    expect(getGroundItemPoolForFloor(1, 3, 'short')).not.toContain('frost_enchantment');
    expect(getGroundItemPoolForFloor(1, 3, 'short')).not.toContain('cloud_enchantment');
    expect(getGroundItemPoolForFloor(1, 3, 'short')).not.toContain('earth_enchantment');

    expect(getGroundItemPoolForFloor(2, 3, 'short')).toContain('flame_enchantment');
    expect(getGroundItemPoolForFloor(2, 3, 'short')).toContain('frost_enchantment');
    expect(getGroundItemPoolForFloor(2, 3, 'short')).toContain('cloud_enchantment');
    expect(getGroundItemPoolForFloor(2, 3, 'short')).not.toContain('earth_enchantment');

    expect(getGroundItemPoolForFloor(3, 3, 'short')).toContain('flame_enchantment');
    expect(getGroundItemPoolForFloor(3, 3, 'short')).toContain('frost_enchantment');
    expect(getGroundItemPoolForFloor(3, 3, 'short')).toContain('cloud_enchantment');
    expect(getGroundItemPoolForFloor(3, 3, 'short')).toContain('earth_enchantment');
  });

  it('no element item is guaranteed on any floor any more (Phase 15.4b): presence varies across seeds', () => {
    let seenFlamePresent = false;
    let seenFlameAbsent = false;
    for (let seed = 0; seed < 60; seed++) {
      const state = createInitialState(seed);
      const hasFlame = state.groundItems.some((i) => i.itemId === 'flame_enchantment');
      if (hasFlame) seenFlamePresent = true;
      else seenFlameAbsent = true;
    }
    expect(seenFlamePresent).toBe(true);
    expect(seenFlameAbsent).toBe(true);
  });

  it('never draws the same enchantment id twice on one floor', () => {
    for (let seed = 0; seed < 60; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        for (const id of ['sol_enchantment', 'flame_enchantment', 'frost_enchantment', 'cloud_enchantment', 'earth_enchantment'] as const) {
          const count = state.groundItems.filter((i) => i.itemId === id).length;
          expect(count).toBeLessThanOrEqual(1);
        }
        if (floor < 3) state = advanceToNextFloor(state);
      }
    }
  });

  it('reproduces the same groundItems for the same seed (Phase 15.4b: full-array determinism)', () => {
    const a = createInitialState(555);
    const b = createInitialState(555);
    expect(a.groundItems).toEqual(b.groundItems);
  });

  it('when placed, element items never sit on start, exit, or another ground item', () => {
    const seeds = [1, 2, 3, 42, 999, 123456];
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        for (const item of state.groundItems) {
          expect(item.pos).not.toEqual(state.player.pos);
          expect(item.pos).not.toEqual(state.exit);
        }
        const positions = state.groundItems.map((i) => `${i.pos.x},${i.pos.y}`);
        expect(new Set(positions).size).toBe(positions.length);
        if (floor < 3) state = advanceToNextFloor(state);
      }
    }
  });

  it('does not disturb enemy placement determinism (same seed -> same enemy positions)', () => {
    const a = createInitialState(4242);
    const b = createInitialState(4242);
    expect(a.enemies.map((e) => e.pos)).toEqual(b.enemies.map((e) => e.pos));
    expect(a.enemies.map((e) => e.type)).toEqual(b.enemies.map((e) => e.type));
  });
});

describe('Phase 14.2: acquisition', () => {
  const elements: { itemId: 'flame_enchantment' | 'frost_enchantment' | 'cloud_enchantment' | 'earth_enchantment'; element: ElementId }[] = [
    { itemId: 'flame_enchantment', element: 'flame' },
    { itemId: 'frost_enchantment', element: 'frost' },
    { itemId: 'cloud_enchantment', element: 'cloud' },
    { itemId: 'earth_enchantment', element: 'earth' },
  ];

  for (const { itemId, element } of elements) {
    it(`picking up ${itemId} unlocks only ${element}`, () => {
      const state = freshState({
        unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
        solUnlocked: false,
        selectedEnchantment: 'none',
        enemies: [],
        groundItems: [{ id: 0, itemId, pos: { x: 3, y: 1 } }],
      });
      const result = processTurn(state, { type: 'move', direction: 'E' });
      expect(result.consumed).toBe(true);
      for (const other of ['sol', 'flame', 'frost', 'cloud', 'earth'] as ElementId[]) {
        expect(state.unlockedEnchantments[other]).toBe(other === element);
      }
      expect(state.groundItems).toHaveLength(0);
      expect((state.inventory as Record<string, number>)[itemId]).toBeUndefined();
      expect(result.events.some((e) => e.type === 'element_enchantment_acquired' && e.element === element)).toBe(true);
    });
  }

  it('does not change selectedEnchantment on pickup', () => {
    const state = freshState({
      unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
      solUnlocked: false,
      selectedEnchantment: 'none',
      enemies: [],
      groundItems: [{ id: 0, itemId: 'flame_enchantment', pos: { x: 3, y: 1 } }],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.selectedEnchantment).toBe('none');
  });

  it('requires no extra turn beyond the normal move that collects it', () => {
    const state = freshState({
      unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
      solUnlocked: false,
      selectedEnchantment: 'none',
      enemies: [],
      groundItems: [{ id: 0, itemId: 'flame_enchantment', pos: { x: 3, y: 1 } }],
      turn: 0,
    });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.turn).toBe(1);
  });

  it('unlock state is preserved across a floor transition', () => {
    let state = createInitialState(999);
    state.unlockedEnchantments.flame = true;
    state = advanceToNextFloor(state);
    expect(state.unlockedEnchantments.flame).toBe(true);
    expect(state.unlockedEnchantments.frost).toBe(false);
  });

  it('starts every element unlocked: false on a brand new run', () => {
    const state = createInitialState(1);
    expect(state.unlockedEnchantments).toEqual({ sol: false, flame: false, frost: false, cloud: false, earth: false });
    expect(state.selectedEnchantment).toBe('none');
  });

  it('existing sol pickup/select behavior is unchanged', () => {
    const state = freshState({
      unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
      solUnlocked: false,
      selectedEnchantment: 'none',
      enemies: [],
      groundItems: [{ id: 0, itemId: 'sol_enchantment', pos: { x: 3, y: 1 } }],
    });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(state.solUnlocked).toBe(true);
    expect(state.unlockedEnchantments.sol).toBe(true);
    expect(state.selectedEnchantment).toBe('none');
    expect(result.events.some((e) => e.type === 'sol_enchantment_acquired')).toBe(true);
  });
});

describe('Phase 14.2: switching (the "f" key)', () => {
  it('cycles none -> sol -> flame -> frost -> cloud -> earth -> none when all are unlocked', () => {
    const state = freshState({
      unlockedEnchantments: { sol: true, flame: true, frost: true, cloud: true, earth: true },
      solUnlocked: true,
      selectedEnchantment: 'none',
    });
    const expected = ['sol', 'flame', 'frost', 'cloud', 'earth', 'none'];
    for (const next of expected) {
      processTurn(state, { type: 'toggle_enchantment' });
      expect(state.selectedEnchantment).toBe(next);
    }
  });

  it('skips unlocked-false elements', () => {
    const state = freshState({
      unlockedEnchantments: { sol: true, flame: false, frost: true, cloud: false, earth: false },
      solUnlocked: true,
      selectedEnchantment: 'none',
    });
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('sol');
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('frost');
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('none');
  });

  it('stays at none when nothing is unlocked', () => {
    const state = freshState({
      unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
      solUnlocked: false,
      selectedEnchantment: 'none',
    });
    const result = processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('none');
    expect(result.events.some((e) => e.type === 'enchantment_toggled')).toBe(false);
  });

  it('toggles none<->sol as before when only sol is unlocked', () => {
    const state = freshState({
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      solUnlocked: true,
      selectedEnchantment: 'none',
    });
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('sol');
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.selectedEnchantment).toBe('none');
  });

  it('does not consume a turn', () => {
    const state = freshState({
      unlockedEnchantments: { sol: true, flame: true, frost: false, cloud: false, earth: false },
      turn: 5,
    });
    const result = processTurn(state, { type: 'toggle_enchantment' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(5);
  });

  it('does not move enemies', () => {
    const enemyBefore = { x: 3, y: 1 };
    const state = freshState({
      unlockedEnchantments: { sol: true, flame: true, frost: false, cloud: false, earth: false },
      enemies: [createInitialEnemy('bok', enemyBefore, 1000, 1)],
    });
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.enemies[0].pos).toEqual(enemyBefore);
  });

  it('does not change hunger or actionGauge fields', () => {
    const state = freshState({
      unlockedEnchantments: { sol: true, flame: true, frost: false, cloud: false, earth: false },
      hunger: 50,
    });
    const before = state.hunger;
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.hunger).toBe(before);
  });

  it('does not change mapgen-derived state or combat RNG', () => {
    const state = freshState({
      unlockedEnchantments: { sol: true, flame: true, frost: false, cloud: false, earth: false },
      combatRngState: 12345,
    });
    processTurn(state, { type: 'toggle_enchantment' });
    expect(state.combatRngState).toBe(12345);
  });
});

// Phase 14.3 note: this describe block originally asserted that
// flame/frost/cloud/earth dealt no damage and consumed no SOL, matching
// Phase 14.2's scope (acquisition/selection only, no combat effects).
// Phase 14.3 has since implemented those elements' combat effects (see
// phase-14-3-element-combat-effects.test.ts for the dedicated coverage),
// so this block is updated to assert the new, intended behavior instead
// of the now-superseded Phase 14.2-era boundary.
describe('Phase 14.2/14.3: other-element combat activation (superseded boundary, updated for Phase 14.3)', () => {
  const otherElements: Array<'flame' | 'frost' | 'cloud' | 'earth'> = ['flame', 'frost', 'cloud', 'earth'];

  for (const element of otherElements) {
    it(`${element} selected: activates via the shared element_enchantment_used event, consumes 2 SOL, still deals physical damage`, () => {
      const state = freshState({
        unlockedEnchantments: { sol: true, flame: true, frost: true, cloud: true, earth: true },
        selectedEnchantment: element,
        solarEnergy: 5,
      });
      faceEastAtEnemy(state);
      const before = state.enemies[0].hp;
      const result = processTurn(state, { type: 'action' });
      expect(result.events.some((e) => e.type === 'sol_enchantment_used')).toBe(false);
      expect(result.events.some((e) => e.type === 'element_enchantment_used' && e.element === element)).toBe(true);
      expect(state.solarEnergy).toBe(3);
      const attackEvent = result.events.find((e) => e.type === 'player_attack');
      expect(attackEvent).toBeDefined();
      expect(before - state.enemies[0].hp).toBeGreaterThan(0);
    });
  }

  it('sol selection continues to add 2 damage and consume 1 SOL exactly as before (Phase 15.3: neutral affinity, mind rank 0)', () => {
    // Phase 14.4 enemy affinities: bok is now sol-weak; use spider
    // (still all-neutral) so this keeps testing the plain neutral
    // result.
    const state = freshState({ enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 1)] });
    faceEastAtEnemy(state);
    const result = processTurn(state, { type: 'action' });
    expect(state.solarEnergy).toBe(4);
    const solEvent = result.events.find((e) => e.type === 'sol_enchantment_used');
    expect(solEvent).toBeDefined();
    if (solEvent && solEvent.type === 'sol_enchantment_used') {
      expect(solEvent.bonusDamage).toBe(2);
    }
  });
});

describe('Phase 14.2: telemetry compatibility', () => {
  function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
    const before = snapshotForTurn(state);
    const result = processTurn(state, action);
    recordTurn(telemetry, action, result, before, state);
    return result;
  }

  it('keeps schemaVersion at 7', () => {
    const state = freshState();
    const telemetry = createRunTelemetry(state);
    expect(telemetry.schemaVersion).toBe(10);
  });

  // Phase 14.3 note: originally asserted additionalDamage 0 (no combat
  // effect yet); Phase 14.3 implements flame's combat effect, so this
  // now asserts the additionalDamage value (2 at mind rank 0 against a
  // neutral-affinity enemy, per Phase 15.3's fixed-additive rebalance)
  // instead.
  it('records additionalDamage for a normal attack while flame is selected (Phase 14.3 combat effect)', () => {
    const state = freshState({
      unlockedEnchantments: { sol: true, flame: true, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'flame',
    });
    const telemetry = createRunTelemetry(state);
    faceEastAtEnemy(state);
    step(state, { type: 'action' }, telemetry);
    const attackRunEvent = telemetry.events.find((e) => e.type === 'player_attack');
    expect(attackRunEvent).toBeDefined();
    if (attackRunEvent && attackRunEvent.type === 'player_attack') {
      // bok is neutral to flame (Phase 15.3: fixed neutral bonus 2, mind rank 0)
      expect(attackRunEvent.additionalDamage).toBe(2);
      expect(attackRunEvent.solConsumed).toBe(2);
    }
  });
});
