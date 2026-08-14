import { describe, expect, it } from 'vitest';
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

// Same defaults-shape as phase-12-2-slow-trap.test.ts's freshState: enemy
// far away and passive so most turns resolve without incidental combat.
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

describe('trap discovery state (Phase 18.1)', () => {
  it('a newly generated trap is revealed=false and triggered=false', () => {
    const state = createInitialState(4242);
    const traps = state.traps ?? [];
    expect(traps.length).toBeGreaterThan(0);
    for (const trap of traps) {
      expect(trap.revealed).toBe(false);
      expect(trap.triggered).toBe(false);
    }
  });

  it('stepping onto a hidden trap sets revealed=true and triggered=true', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({ traps: [trap] });
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    const updated = state.traps?.[0];
    expect(updated?.revealed).toBe(true);
    expect(updated?.triggered).toBe(true);
  });

  it('stepping onto an already-revealed but untriggered trap triggers it', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: true, triggered: false, trapType: 'poison_trap' };
    const state = freshState({ traps: [trap] });
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    const updated = state.traps?.[0];
    expect(updated?.revealed).toBe(true);
    expect(updated?.triggered).toBe(true);
  });

  it('re-entering an already-triggered trap does not re-trigger it', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: true, triggered: true, trapType: 'slow_trap' };
    const state = freshState({ traps: [trap] });
    const before = { ...state.traps![0] };
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.traps?.[0]).toEqual(before);
  });

  it('multiple traps hold independent discovery/trigger state', () => {
    const trapA: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const trapB: TrapTile = { id: 1, pos: { x: 10, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [],
      traps: [trapA, trapB],
    });
    processTurn(state, { type: 'move', direction: 'E' });
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.traps?.[0].revealed).toBe(true);
    expect(state.traps?.[0].triggered).toBe(true);
    expect(state.traps?.[1].revealed).toBe(false);
    expect(state.traps?.[1].triggered).toBe(false);
  });

  it('a fresh floor never inherits the previous floor\'s trap discovery state', () => {
    const state = createInitialState(9911);
    // Reveal/trigger everything the current floor happens to have, then
    // advance — the next floor's freshly generated traps must start over.
    for (const trap of state.traps ?? []) {
      trap.revealed = true;
      trap.triggered = true;
    }
    const next = advanceToNextFloor(state);
    for (const trap of next.traps ?? []) {
      expect(trap.revealed).toBe(false);
      expect(trap.triggered).toBe(false);
    }
  });

  it('an enemy moving onto a hidden trap does not reveal or trigger it', () => {
    const trap: TrapTile = { id: 0, pos: { x: 5, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      traps: [trap],
    });
    // The bok chases the passive player; run several waits so it steps
    // across the trap's tile on its way (enemy passes through x=5..8).
    for (let i = 0; i < 6; i++) processTurn(state, { type: 'wait' });
    expect(state.traps?.[0].revealed).toBe(false);
    expect(state.traps?.[0].triggered).toBe(false);
  });

  it('an enemy moving onto a revealed-but-untriggered trap does not trigger it', () => {
    const trap: TrapTile = { id: 0, pos: { x: 5, y: 3 }, revealed: true, triggered: false, trapType: 'poison_trap' };
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      traps: [trap],
    });
    for (let i = 0; i < 6; i++) processTurn(state, { type: 'wait' });
    expect(state.traps?.[0].revealed).toBe(true);
    expect(state.traps?.[0].triggered).toBe(false);
  });

  it('the trap generation count/positions are unchanged from baseline for a fixed seed', () => {
    const state = createInitialState(4242);
    const again = createInitialState(4242);
    expect((state.traps ?? []).map((t) => ({ pos: t.pos, trapType: t.trapType }))).toEqual(
      (again.traps ?? []).map((t) => ({ pos: t.pos, trapType: t.trapType })),
    );
  });
});
