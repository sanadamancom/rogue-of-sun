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
import { advanceToNextFloor } from '../state';
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

const GUARANTEED_HIT_SEED = 0; // first roll: 26

function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
  const before = snapshotForTurn(state);
  const result = processTurn(state, action);
  recordTurn(telemetry, action, result, before, state);
  return result;
}

describe('actual damage (Phase 10.3.3, confirmed_findings.damage_dealt)', () => {
  it('a killing blow on an enemy with 10 remaining HP against a 40-power attack records actualDamage 10', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      // Phase 14.4 enemy affinities: bok is now sol-weak; use spider
      // (still all-neutral) so calculatedDamage keeps the exact
      // pre-14.4 value asserted below.
      enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 10, 10, 0, 0, 0, 90, 0)], // hammer(3)+sol(2)=5 raw, plus player.attack(10) = 15 raw >> 10 hp
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const attack = telemetry.events.find((e) => e.type === 'player_attack') as {
      actualDamage: number;
      calculatedDamage: number;
      targetHpBefore: number;
      targetHpAfter: number;
    };
    expect(attack.targetHpBefore).toBe(10);
    expect(attack.targetHpAfter).toBe(0);
    expect(attack.actualDamage).toBe(10);
    // player.attack(10) + hammer bonus(3, Phase 15.1) + sol bonus(2, Phase 15.3) = 15 (raw, pre-clamp)
    expect(attack.calculatedDamage).toBe(15);
  });

  it('an attack exactly matching remaining HP records the full amount (no discrepancy)', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 12, 10, 0, 0, 0, 90, 0)], // sword deals exactly 12 (Phase 15.1: player.attack 10 + sword bonus 2)
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const attack = telemetry.events.find((e) => e.type === 'player_attack') as { actualDamage: number };
    expect(attack.actualDamage).toBe(12);
  });

  it('a non-defeating hit has connecting before/after HP equal to actualDamage', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const attack = telemetry.events.find((e) => e.type === 'player_attack') as {
      actualDamage: number;
      targetHpBefore: number;
      targetHpAfter: number;
    };
    expect(attack.targetHpBefore - attack.targetHpAfter).toBe(attack.actualDamage);
  });

  it('a dead enemy is never re-damaged, so no further actualDamage accrues to it', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    step(state, { type: 'action' }, telemetry); // whiffs: no living target
    const attacks = telemetry.events.filter((e) => e.type === 'player_attack');
    expect(attacks).toHaveLength(1);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.combatOverall.damageDealt).toBe(1); // only the real 1 HP it had
  });

  it('combatOverall, weapon, and per-floor damage totals all agree with the sum of actualDamage', () => {
    const state = freshState({
      combatRngState: 16, // safe for many consecutive hits
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    for (let i = 0; i < 3; i++) {
      step(state, { type: 'action' }, telemetry);
    }
    const summary = computeRunSummary(telemetry, state);
    const attacks = telemetry.events.filter((e) => e.type === 'player_attack') as Array<{ actualDamage: number }>;
    const sumActual = attacks.reduce((s, a) => s + a.actualDamage, 0);
    expect(summary.combatOverall.damageDealt).toBe(sumActual);
    expect(summary.combatByWeapon.sword.damageDealt).toBe(sumActual);
    expect(summary.perFloor[0].damageDealt).toBe(sumActual);
  });
});

describe('natural regeneration healing (Phase 10.3.3, confirmed_findings.unobserved_healing)', () => {
  it('records a player_healed event with source natural_regeneration after REGEN_TURNS_PER_HP consumed turns', () => {
    const state = freshState({ enemies: [] });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    let lastResult;
    for (let i = 0; i < REGEN_TURNS_PER_HP; i++) {
      lastResult = step(state, { type: 'wait' }, telemetry);
    }
    expect(lastResult!.playerRegenerated).toBe(true);
    const healed = telemetry.events.find((e) => e.type === 'player_healed');
    expect(healed).toMatchObject({ source: 'natural_regeneration', hpBefore: 5, hpAfter: 6, actualHealing: 1 });
  });

  it('actualHealing is clamped near max HP and never exceeds the real HP delta', () => {
    const state = freshState({ enemies: [] });
    state.player.hp = 29; // maxHp 30, regen would add 1 -> clamped to 1
    const telemetry = createRunTelemetry(state);
    for (let i = 0; i < REGEN_TURNS_PER_HP; i++) {
      step(state, { type: 'wait' }, telemetry);
    }
    const healed = telemetry.events.find((e) => e.type === 'player_healed');
    expect((healed as { actualHealing: number }).actualHealing).toBe(1);
    expect((healed as { hpAfter: number }).hpAfter).toBe(30);
  });

  it('no player_healed event is generated at full HP (no regen progress accrues)', () => {
    const state = freshState({ enemies: [] }); // player.hp already at maxHp (30) by default
    const telemetry = createRunTelemetry(state);
    for (let i = 0; i < REGEN_TURNS_PER_HP + 2; i++) {
      step(state, { type: 'wait' }, telemetry);
    }
    expect(telemetry.events.some((e) => e.type === 'player_healed')).toBe(false);
  });

  it('a picked-up-but-unused apple never generates a player_healed event', () => {
    const state = freshState({
      enemies: [],
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'item_acquired')).toBe(true);
    expect(telemetry.events.some((e) => e.type === 'player_healed')).toBe(false);
  });

  it('using an apple records a player_healed event with source item and the correct itemId', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    const healed = telemetry.events.find((e) => e.type === 'player_healed');
    // Phase 16.2: hpAfter reflects the whole turn's end state, which now
    // also includes this same turn's natural regen tick (hp 10 -> 11;
    // actualHealing on the item event itself is unaffected, still 5).
    expect(healed).toMatchObject({ source: 'item', itemId: 'apple', actualHealing: 5, hpBefore: 5, hpAfter: 11 });
  });

  it('a floor transition with no HP change never generates a player_healed event', () => {
    let state = freshState({ enemies: [], exit: { x: 3, y: 1 } });
    // Phase 16.2: hp must already be at max, or natural regen (which now
    // fires every turn, not just every 10) would generate its own
    // player_healed event on the move-to-exit turn, defeating the point
    // of this "no HP change" scenario.
    state.player.hp = state.player.maxHp;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry); // reaches exit
    expect(state.phase).toBe('floor_cleared');
    const hpBeforeAdvance = state.player.hp;
    state = advanceToNextFloor(state);
    expect(state.player.hp).toBe(hpBeforeAdvance); // carried over verbatim, no event to generate
    expect(telemetry.events.some((e) => e.type === 'player_healed')).toBe(false);
  });

  it('healingBySource total matches the sum of all player_healed actualHealing values', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry); // hp 5 -> 10, and Phase 16.2's every-turn regen also ticks 10 -> 11 on this same turn
    const summary = computeRunSummary(telemetry, state);
    const healEvents = telemetry.events.filter((e) => e.type === 'player_healed') as Array<{ source: string; actualHealing: number }>;
    const totalFromEvents = healEvents.reduce((s, e) => s + e.actualHealing, 0);
    const totalFromSummary = Object.values(summary.resources.healingBySource).reduce((s, v) => s + v, 0);
    expect(totalFromSummary).toBe(totalFromEvents);
    expect(summary.resources.healingBySource.item).toBe(5);
    expect(summary.resources.healingBySource.natural_regeneration).toBe(1);
  });
});

describe('lifecycle invariants re-confirmed (Phase 10.3.3)', () => {
  it('a defeated target never has a negative or re-incremented HP-after value', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 5, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const attack = telemetry.events.find((e) => e.type === 'player_attack') as { targetHpAfter: number };
    expect(attack.targetHpAfter).toBeGreaterThanOrEqual(0);
  });

  it('enemy_defeated still fires exactly once for the killed target', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 5, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    step(state, { type: 'action' }, telemetry);
    expect(telemetry.events.filter((e) => e.type === 'enemy_defeated')).toHaveLength(1);
  });
});

describe('no NaN/Infinity/negative values (Phase 10.3.3)', () => {
  it('the exported document never contains NaN, Infinity, or a negative damage/healing value', () => {
    const state = freshState({
      combatRngState: 16,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1, apple: 1 },
    });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    for (let i = 0; i < REGEN_TURNS_PER_HP; i++) {
      step(state, { type: 'wait' }, telemetry);
    }
    const doc = buildTelemetryDocument(telemetry, state);
    const json = JSON.stringify(doc);
    expect(json).not.toMatch(/NaN|Infinity/);

    // Recursively check every numeric field relevant to damage/healing is
    // non-negative — a plain regex over the whole JSON string would also
    // false-positive on unrelated hyphenated text (e.g. "phase-10.3.3"
    // contains "-10"), so this walks the parsed structure instead.
    const negativeFieldNames = new Set([
      'physicalDamage',
      'additionalDamage',
      'calculatedDamage',
      'actualDamage',
      'damage',
      'requestedAmount',
      'actualHealing',
      'damageDealt',
    ]);
    function checkNoNegatives(value: unknown): void {
      if (Array.isArray(value)) {
        value.forEach(checkNoNegatives);
      } else if (value && typeof value === 'object') {
        for (const [key, v] of Object.entries(value)) {
          if (negativeFieldNames.has(key) && typeof v === 'number') {
            expect(v).toBeGreaterThanOrEqual(0);
          }
          checkNoNegatives(v);
        }
      }
    }
    checkNoNegatives(JSON.parse(json));
  });
});

describe('schema v3 (Phase 10.3.3)', () => {
  it('schemaVersion is 3', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    const doc = buildTelemetryDocument(telemetry, state);
    expect(doc.schemaVersion).toBe(8);
  });

  it('filename uses the v3 prefix', () => {
    const state = freshState({
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 9999, 0, 0, 0, 90, 0)],
      combatRngState: GUARANTEED_HIT_SEED,
      player: createInitialActor({ x: 2, y: 1 }, 1, 10, 0, 90, 0),
      runSeed: 777,
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(buildExportFilename(telemetry)).toMatch(/^rogue-of-sun-run-v8-777-/);
  });

  it('the same seed and input sequence produce an identical JSON document', () => {
    function run(): string {
      const state = freshState({ combatRngState: 999, equippedWeaponId: 'sword', inventory: { ...createEmptyInventory(), sword: 1 } });
      const telemetry = createRunTelemetry(state);
      processTurn(state, { type: 'face', direction: 'E' });
      for (let i = 0; i < 3; i++) {
        state.enemies[0].hp = 1000;
        step(state, { type: 'action' }, telemetry);
      }
      return JSON.stringify(buildTelemetryDocument(telemetry, state));
    }
    expect(run()).toBe(run());
  });

  it('telemetry never mutates combatRngState', () => {
    const state = freshState({ combatRngState: GUARANTEED_HIT_SEED, equippedWeaponId: 'sword', inventory: { ...createEmptyInventory(), sword: 1 } });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    const before = snapshotForTurn(state);
    const result = processTurn(state, { type: 'action' });
    const rngAfterProcessTurn = state.combatRngState;
    recordTurn(telemetry, { type: 'action' }, result, before, state);
    expect(state.combatRngState).toBe(rngAfterProcessTurn);
  });
});
