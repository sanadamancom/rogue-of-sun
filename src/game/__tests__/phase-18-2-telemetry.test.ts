import { describe, expect, it } from 'vitest';
import { createEmptyInventory } from '../item-def';
import { createRunTelemetry, finalizeRun, recordTurn, snapshotForTurn } from '../telemetry';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, PlayerAction, Tile, TrapTile } from '../types';

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
  const rooms = [{ x: 1, y: 1, width: 18, height: 5 }];
  return { width, height, terrain, rooms, exit: { x: 99, y: 99 } };
}

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

function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
  const before = snapshotForTurn(state);
  const result = processTurn(state, action);
  recordTurn(telemetry, action, result, before, state);
  finalizeRun(telemetry, state);
  return result;
}

describe('trap discovery/trigger telemetry (Phase 18.2)', () => {
  it('stepping onto a hidden trap records trap_revealed and trap_triggered once each', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({ enemies: [], traps: [trap] });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    const revealed = telemetry.events.filter((e) => e.type === 'trap_revealed');
    const triggered = telemetry.events.filter((e) => e.type === 'trap_triggered');
    expect(revealed).toHaveLength(1);
    expect(triggered).toHaveLength(1);
  });

  it('stepping onto an already-revealed, untriggered trap records only trap_triggered', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: true, triggered: false, trapType: 'poison_trap' };
    const state = freshState({ enemies: [], traps: [trap] });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    const revealed = telemetry.events.filter((e) => e.type === 'trap_revealed');
    const triggered = telemetry.events.filter((e) => e.type === 'trap_triggered');
    expect(revealed).toHaveLength(0);
    expect(triggered).toHaveLength(1);
  });

  it('clairvoyance records one trap_revealed per newly discovered trap and never trap_triggered', () => {
    const trapA: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const trapB: TrapTile = { id: 1, pos: { x: 10, y: 3 }, revealed: false, triggered: false, trapType: 'poison_trap' };
    const state = freshState({
      enemies: [],
      traps: [trapA, trapB],
      inventory: { ...createEmptyInventory(), clairvoyance_fruit: 1 },
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'clairvoyance_fruit' }, telemetry);
    const revealed = telemetry.events.filter((e) => e.type === 'trap_revealed');
    const triggered = telemetry.events.filter((e) => e.type === 'trap_triggered');
    expect(revealed).toHaveLength(2);
    expect(triggered).toHaveLength(0);
  });

  it('re-entering an already-triggered trap records nothing new', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: true, triggered: true, trapType: 'slow_trap' };
    const state = freshState({ enemies: [], traps: [trap] });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    const revealed = telemetry.events.filter((e) => e.type === 'trap_revealed');
    const triggered = telemetry.events.filter((e) => e.type === 'trap_triggered');
    expect(revealed).toHaveLength(0);
    expect(triggered).toHaveLength(0);
  });

  it('re-using clairvoyance after everything is revealed records nothing new', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      enemies: [],
      traps: [trap],
      inventory: { ...createEmptyInventory(), clairvoyance_fruit: 2 },
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'clairvoyance_fruit' }, telemetry);
    step(state, { type: 'use_item', itemId: 'clairvoyance_fruit' }, telemetry);
    const revealed = telemetry.events.filter((e) => e.type === 'trap_revealed');
    expect(revealed).toHaveLength(1);
  });

  it('an enemy moving over a hidden or revealed-untriggered trap records neither event', () => {
    const trap: TrapTile = { id: 0, pos: { x: 5, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({
      player: createInitialActor({ x: 2, y: 3 }, 30, 10, 0, 90, 0),
      enemies: [createInitialEnemy('bok', { x: 9, y: 3 }, 1000, 0, 0, 0, 0, 90, 0)],
      traps: [trap],
    });
    const telemetry = createRunTelemetry(state);
    for (let i = 0; i < 6; i++) step(state, { type: 'wait' }, telemetry);
    const revealed = telemetry.events.filter((e) => e.type === 'trap_revealed');
    const triggered = telemetry.events.filter((e) => e.type === 'trap_triggered');
    expect(revealed).toHaveLength(0);
    expect(triggered).toHaveLength(0);
  });

  it('the existing trap_triggered message-log line still appears exactly once for a hidden-trap step', () => {
    const trap: TrapTile = { id: 0, pos: { x: 4, y: 3 }, revealed: false, triggered: false, trapType: 'slow_trap' };
    const state = freshState({ enemies: [], traps: [trap] });
    processTurn(state, { type: 'move', direction: 'E' });
    const result = processTurn(state, { type: 'move', direction: 'E' });
    const triggeredEvents = result.events.filter((e) => e.type === 'trap_triggered');
    expect(triggeredEvents).toHaveLength(1);
  });
});
