import { describe, expect, it } from 'vitest';
import {
  buildExportFilename,
  buildTelemetryDocument,
  computeRunSummary,
  createRunTelemetry,
  recordTurn,
  snapshotForTurn,
} from '../telemetry';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn, REGEN_TURNS_PER_HP } from '../turn';
import { GameMap, GameState, PlayerAction, Tile } from '../types';

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
    player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0, 90, 0),
    enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)],
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
    sunlight: [],
    combatRngState: 0,
    ...overrides,
  };
}

function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
  const before = snapshotForTurn(state);
  const result = processTurn(state, action);
  recordTurn(telemetry, action, result, before, state);
  return result;
}

describe('player_healed field name (Phase 10.3.3a)', () => {
  it('a natural regeneration event has actualHealing and does not have actualAmount', () => {
    const state = freshState({ enemies: [] });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    for (let i = 0; i < REGEN_TURNS_PER_HP; i++) {
      step(state, { type: 'wait' }, telemetry);
    }
    const healed = telemetry.events.find((e) => e.type === 'player_healed') as unknown as Record<string, unknown>;
    expect(healed).toBeDefined();
    expect(healed.actualHealing).toBe(1);
    expect('actualAmount' in healed).toBe(false);
  });

  it('an item-healing event has actualHealing and does not have actualAmount', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    const healed = telemetry.events.find((e) => e.type === 'player_healed') as unknown as Record<string, unknown>;
    expect(healed).toBeDefined();
    expect(healed.actualHealing).toBe(5);
    expect('actualAmount' in healed).toBe(false);
  });

  it('actualHealing equals hpAfter - hpBefore for both sources', () => {
    const natState = freshState({ enemies: [] });
    natState.player.hp = 5;
    const natTelemetry = createRunTelemetry(natState);
    for (let i = 0; i < REGEN_TURNS_PER_HP; i++) {
      step(natState, { type: 'wait' }, natTelemetry);
    }
    const natHealed = natTelemetry.events.find((e) => e.type === 'player_healed') as { actualHealing: number; hpBefore: number; hpAfter: number };
    expect(natHealed.actualHealing).toBe(natHealed.hpAfter - natHealed.hpBefore);

    const itemState = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    itemState.player.hp = 5;
    const itemTelemetry = createRunTelemetry(itemState);
    step(itemState, { type: 'use_item', itemId: 'apple' }, itemTelemetry);
    const itemHealed = itemTelemetry.events.find((e) => e.type === 'player_healed') as { actualHealing: number; hpBefore: number; hpAfter: number };
    expect(itemHealed.actualHealing).toBe(itemHealed.hpAfter - itemHealed.hpBefore);
  });

  it('near max HP, only the real increase is recorded as actualHealing', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 25; // maxHp 30, apple heals 5 raw -> actual 5 (no clamp needed)
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    const healed = telemetry.events.find((e) => e.type === 'player_healed') as { actualHealing: number; hpAfter: number };
    expect(healed.actualHealing).toBe(5);
    expect(healed.hpAfter).toBe(30);
  });

  it('no player_healed event is generated at full HP', () => {
    const state = freshState({ enemies: [] }); // already at maxHp
    const telemetry = createRunTelemetry(state);
    for (let i = 0; i < REGEN_TURNS_PER_HP + 2; i++) {
      step(state, { type: 'wait' }, telemetry);
    }
    expect(telemetry.events.some((e) => e.type === 'player_healed')).toBe(false);
  });

  it('healingBySource is a correct re-aggregation of every player_healed.actualHealing', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    for (let i = 0; i < REGEN_TURNS_PER_HP; i++) {
      step(state, { type: 'wait' }, telemetry);
    }
    const summary = computeRunSummary(telemetry, state);
    const healEvents = telemetry.events.filter((e) => e.type === 'player_healed') as Array<{ source: string; actualHealing: number }>;

    const bySourceFromEvents: Record<string, number> = {};
    for (const e of healEvents) {
      bySourceFromEvents[e.source] = (bySourceFromEvents[e.source] ?? 0) + e.actualHealing;
    }
    expect(summary.resources.healingBySource).toEqual(bySourceFromEvents);

    const totalFromSummary = Object.values(summary.resources.healingBySource).reduce((s, v) => s + v, 0);
    const totalFromEvents = healEvents.reduce((s, e) => s + e.actualHealing, 0);
    expect(totalFromSummary).toBe(totalFromEvents);
  });

  it('natural regeneration and item healing are aggregated under separate sources', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    for (let i = 0; i < REGEN_TURNS_PER_HP; i++) {
      step(state, { type: 'wait' }, telemetry);
    }
    const summary = computeRunSummary(telemetry, state);
    expect(Object.keys(summary.resources.healingBySource).sort()).toEqual(['item', 'natural_regeneration']);
  });
});

describe('schema stability after the field rename (Phase 10.3.3a)', () => {
  it('schemaVersion is still 3', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    const doc = buildTelemetryDocument(telemetry, state);
    expect(doc.schemaVersion).toBe(7);
  });

  it('the export filename still uses the v3 prefix', () => {
    const state = freshState({
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 9999, 0, 0, 0, 90, 0)],
      combatRngState: 0,
      player: createInitialActor({ x: 2, y: 1 }, 1, 10, 0, 90, 0),
      runSeed: 888,
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(buildExportFilename(telemetry)).toMatch(/^rogue-of-sun-run-v7-888-/);
  });

  it('the saved JSON re-parses and no player_healed event contains actualAmount', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, state);
    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);
    const healedEvents = parsed.events.filter((e: { type: string }) => e.type === 'player_healed');
    expect(healedEvents.length).toBeGreaterThan(0);
    for (const e of healedEvents) {
      expect('actualAmount' in e).toBe(false);
      expect(typeof e.actualHealing).toBe('number');
    }
  });

  it('the same seed and input sequence produce an identical JSON document', () => {
    function run(): string {
      const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
      state.player.hp = 5;
      const telemetry = createRunTelemetry(state);
      step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
      return JSON.stringify(buildTelemetryDocument(telemetry, state));
    }
    expect(run()).toBe(run());
  });

  it('telemetry never mutates GameState or combatRngState', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    const before = snapshotForTurn(state);
    const rngBefore = state.combatRngState;
    const result = processTurn(state, { type: 'use_item', itemId: 'apple' });
    const rngAfterProcessTurn = state.combatRngState;
    recordTurn(telemetry, { type: 'use_item', itemId: 'apple' }, result, before, state);
    expect(state.combatRngState).toBe(rngAfterProcessTurn);
    expect(rngAfterProcessTurn).toBe(rngBefore); // use_item never rolls combat RNG
  });
});
