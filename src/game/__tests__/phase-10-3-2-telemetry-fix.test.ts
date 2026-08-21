import { describe, expect, it } from 'vitest';
import {
  buildExportFilename,
  buildTelemetryDocument,
  computeRunSummary,
  createRunTelemetry,
  finalizeRun,
  recordFloorStarted,
  recordTurn,
  snapshotForTurn,
} from '../telemetry';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { advanceToNextFloor } from '../state';
import { GameMap, GameState, PlayerAction, Tile } from '../types';
import { selectedInventoryAction, useSelectedInventoryItem } from '../inventory';
import { DEFAULT_RUN_CONFIG } from '../floor';

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
    leg: 'descent',
    otencoState: 'sealed',
    runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
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
const GUARANTEED_MISS_SEED = 43; // first roll: 99

function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
  const before = snapshotForTurn(state);
  const result = processTurn(state, action);
  recordTurn(telemetry, action, result, before, state);
  finalizeRun(telemetry, state);
  return result;
}

describe('key events never fire (Phase 10.3.2, known_failure invalid_key_events)', () => {
  it('a normal enemy defeat produces no key_* events', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    expect(telemetry.events.some((e) => e.type.startsWith('key_'))).toBe(false);
  });

  it('defeating every enemy on a floor (stairs unlock) never emits key_* events', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [
        createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0),
        createInitialEnemy('spider', { x: 4, y: 1 }, 1, 10, 0, 1, 0, 90, 0),
      ],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    expect(telemetry.events.some((e) => e.type.startsWith('key_'))).toBe(false);
  });

  it('progression.keysAcquired-equivalent field does not exist / is never populated', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    const summary = computeRunSummary(telemetry, state);
    expect((summary.progression as Record<string, unknown>).keysAcquired).toBeUndefined();
  });
});

describe('enemy lifecycle and duplicate-defeat prevention (Phase 10.3.2, known_failure repeated_cockatrice_defeat / inconsistent_kill_counts)', () => {
  it('a defeated enemy is never re-targeted or re-defeated by a later attack on the same species', () => {
    // Two same-species enemies on one floor (a supported, pre-existing
    // spawn possibility) — the exact scenario that caused the original
    // bug: telemetry used to always resolve "an enemy of this type" to
    // the SAME (now-dead) instance.
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [
        createInitialEnemy('cockatrice', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0), // dies in one hit
        createInitialEnemy('cockatrice', { x: 3, y: 1 }, 1000, 10, 0, 1, 0, 90, 0), // survives
      ],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    // First attack kills enemy id 0 (whichever is adjacent/targeted first by resolveFacingAttack's search order).
    step(state, { type: 'action' }, telemetry);
    const defeatedEvents = telemetry.events.filter((e) => e.type === 'enemy_defeated');
    expect(defeatedEvents.length).toBe(1);
    const deadId = (defeatedEvents[0] as { targetId: number }).targetId;

    // Subsequent attacks must never report a second defeat for the same id.
    step(state, { type: 'action' }, telemetry);
    step(state, { type: 'action' }, telemetry);
    const allDefeats = telemetry.events.filter((e) => e.type === 'enemy_defeated');
    const idsDefeated = allDefeats.map((e) => (e as { targetId: number }).targetId);
    expect(idsDefeated.filter((id) => id === deadId)).toHaveLength(1);
  });

  it('enemy_defeated fires at most once per (floor, targetId)', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const byKey = new Map<string, number>();
    for (const e of telemetry.events) {
      if (e.type === 'enemy_defeated') {
        const key = `${e.floor}:${e.targetId}`;
        byKey.set(key, (byKey.get(key) ?? 0) + 1);
      }
    }
    for (const count of byKey.values()) {
      expect(count).toBe(1);
    }
  });

  it('the killed enemy stays dead (alive:false) and inert for subsequent turns — ordinary game invariant, unaffected by telemetry', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0)],
    });
    processTurn(state, { type: 'face', direction: 'E' });
    processTurn(state, { type: 'action' });
    expect(state.enemies[0].alive).toBe(false);
    expect(state.enemies[0].hp).toBe(0);
    // Another action attempt with no living target in range should whiff, not re-attack the corpse.
    const result = processTurn(state, { type: 'action' });
    expect(result.events.some((e) => e.type === 'player_whiff')).toBe(true);
  });
});

describe('HP and damage accuracy (Phase 10.3.2, known_failure incorrect_hp_snapshots)', () => {
  it('consecutive hits on the same surviving enemy have connecting before/after HP', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    step(state, { type: 'action' }, telemetry);
    const attacks = telemetry.events.filter((e) => e.type === 'player_attack') as Array<{ targetHpBefore: number; targetHpAfter: number }>;
    expect(attacks.length).toBe(2);
    expect(attacks[1].targetHpBefore).toBe(attacks[0].targetHpAfter);
  });

  it('damageDealt reflects only the actually-applied damage, never overkill beyond remaining HP', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 5, 10, 0, 0, 0, 90, 0)], // sword deals 12 (Phase 15.1), hp only 5
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const attack = telemetry.events.find((e) => e.type === 'player_attack') as { actualDamage: number; calculatedDamage: number; targetHpBefore: number; targetHpAfter: number };
    // As of Phase 10.3.3, actualDamage reflects only the real HP loss (5),
    // not the raw pre-clamp attack power (12, still visible via
    // calculatedDamage) — targetHpAfter is correctly 0, not negative.
    expect(attack.targetHpAfter).toBe(0);
    expect(attack.targetHpBefore).toBe(5);
    expect(attack.actualDamage).toBe(5);
    expect(attack.calculatedDamage).toBe(12);
  });
});

describe('equipment change tracking (Phase 10.3.2, known_failure missing_equipment_changes)', () => {
  it('equipping a weapon via the direct equip_weapon action records equipment_changed', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), sword: 1 } });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'sword' }, telemetry);
    expect(telemetry.events.filter((e) => e.type === 'equipment_changed')).toHaveLength(1);
  });

  it('selectedInventoryAction correctly identifies an equip_weapon action for a weapon entry', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), sword: 1 } });
    const action = selectedInventoryAction(state);
    expect(action).toEqual({ type: 'equip_weapon', weaponId: 'sword', equipmentInstanceId: 'eq-0' });
  });

  it('the inventory Enter-equip path (main.ts simulation) records equipment_changed exactly once', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), sword: 1 } });
    const telemetry = createRunTelemetry(state);
    // Mirrors main.ts's handleInventoryKey Enter branch.
    const action = selectedInventoryAction(state);
    const before = snapshotForTurn(state);
    const result = useSelectedInventoryItem(state);
    expect(action).not.toBeNull();
    recordTurn(telemetry, action!, result, before, state);
    finalizeRun(telemetry, state);
    expect(telemetry.events.filter((e) => e.type === 'equipment_changed')).toHaveLength(1);
    expect(state.equippedWeaponId).toBe('sword');
  });

  it('acquiring an item without equipping it does not count as a change', () => {
    const state = freshState({
      enemies: [],
      groundItems: [{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }],
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'equipment_acquired')).toBe(true);
    expect(telemetry.events.some((e) => e.type === 'equipment_changed')).toBe(false);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.equipment.changeCount).toBe(0);
    expect(summary.equipment.acquiredCount).toBe(1);
  });

  it('changeCount matches the number of equipment_changed events', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), sword: 1, spear: 1 } });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'sword' }, telemetry);
    step(state, { type: 'equip_weapon', weaponId: 'spear' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.equipment.changeCount).toBe(telemetry.events.filter((e) => e.type === 'equipment_changed').length);
    expect(summary.equipment.changeCount).toBe(2);
  });
});

describe('zero-damage hit semantics (Phase 10.3.2, known_failure zero_damage_hit_definition)', () => {
  it('a heavily-armored hit still counts as a hit (Phase 15.1: armor reduces but never fully negates)', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedArmorId: 'armor',
      inventory: { ...createEmptyInventory(), armor: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)], // atk10, armorValue2 -> proportional reduction, floored at 1
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.damageTakenByEnemy.bok.hits).toBe(1);
    expect(summary.damageTakenByEnemy.bok.misses).toBe(0);
  });

  it('a heavily-reduced hit is still added to damage, and zeroDamageHits stays 0 (Phase 15.1 removes the complete-negation case)', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedArmorId: 'armor',
      inventory: { ...createEmptyInventory(), armor: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.damageTakenByEnemy.bok.damage).toBeGreaterThan(0);
    expect(summary.damageTakenByEnemy.bok.zeroDamageHits).toBe(0);
  });

  it('an actual miss still counts toward misses, not hits', () => {
    const state = freshState({ combatRngState: GUARANTEED_MISS_SEED });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.damageTakenByEnemy.bok.misses).toBe(1);
    expect(summary.damageTakenByEnemy.bok.hits).toBe(0);
  });
});

describe('turnConsumed consistency (Phase 10.3.2, known_failure incorrect_turn_consumed)', () => {
  it('every event derived from one action shares that action\'s turnConsumed value', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    const before = snapshotForTurn(state);
    const result = processTurn(state, { type: 'action' });
    expect(result.consumed).toBe(true);
    recordTurn(telemetry, { type: 'action' }, result, before, state);
    const thisTurnEvents = telemetry.events.filter((e) => e.turn === state.turn - 1 || e.turn === state.turn);
    const relevant = thisTurnEvents.filter((e) => e.type === 'player_attack' || e.type === 'enemy_defeated');
    for (const e of relevant) {
      expect(e.turnConsumed).toBe(true);
    }
  });
});

describe('per-floor turn accounting (Phase 10.3.2, known_failure per_floor_turn_mismatch)', () => {
  it('perFloor.turns sums to totalTurns for a single-floor run', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    for (let i = 0; i < 5; i++) {
      step(state, { type: 'wait' }, telemetry);
    }
    const doc = buildTelemetryDocument(telemetry, state);
    const perFloorSum = doc.summary.perFloor.reduce((s, f) => s + f.turns, 0);
    expect(perFloorSum).toBe(doc.run.totalTurns);
  });

  it('perFloor.turns sums to totalTurns across a floor transition', () => {
    let state = freshState({ enemies: [], exit: { x: 3, y: 1 } });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    step(state, { type: 'wait' }, telemetry);
    step(state, { type: 'move', direction: 'E' }, telemetry); // reaches exit -> floor_cleared
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    recordFloorStarted(telemetry, state);
    step(state, { type: 'wait' }, telemetry);
    step(state, { type: 'wait' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, state);
    const perFloorSum = doc.summary.perFloor.reduce((s, f) => s + f.turns, 0);
    expect(perFloorSum).toBe(doc.run.totalTurns);
  });
});

describe('cross-summary invariants (Phase 10.3.2, known_failure inconsistent_kill_counts)', () => {
  function runWithKills(killCount: number): { telemetry: ReturnType<typeof createRunTelemetry>; state: GameState } {
    const enemies = [];
    for (let i = 0; i < killCount; i++) {
      enemies.push(createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, i, 0, 90, 0));
    }
    const state = freshState({
      combatRngState: 16, // verified safe (roll<95) for 60 consecutive draws
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies,
      player: createInitialActor({ x: 2, y: 1 }, 100000, 10, 0, 90, 0), // headroom against retaliation from the other stacked enemies
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    for (let i = 0; i < killCount; i++) {
      step(state, { type: 'action' }, telemetry);
    }
    return { telemetry, state };
  }

  it('combatOverall.kills, combatByWeapon kills sum, progression.enemiesDefeated, and perFloor kills sum all agree', () => {
    const { telemetry, state } = runWithKills(3);
    const summary = computeRunSummary(telemetry, state);
    const weaponKillsSum = Object.values(summary.combatByWeapon).reduce((s, w) => s + w.kills, 0);
    const perFloorKillsSum = summary.perFloor.reduce((s, f) => s + f.kills, 0);
    expect(summary.combatOverall.kills).toBe(3);
    expect(weaponKillsSum).toBe(3);
    expect(summary.progression.enemiesDefeated).toBe(3);
    expect(perFloorKillsSum).toBe(3);
  });

  it('the invariant holds even with zero kills', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.combatOverall.kills).toBe(0);
    expect(summary.progression.enemiesDefeated).toBe(0);
    expect(summary.perFloor.reduce((s, f) => s + f.kills, 0)).toBe(0);
  });
});

describe('JSON schema v2 (Phase 10.3.2)', () => {
  it('schemaVersion is 2', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    const doc = buildTelemetryDocument(telemetry, state);
    expect(doc.schemaVersion).toBe(11);
  });

  it('filename uses the v2 prefix', () => {
    const state = freshState({
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 9999, 0, 0, 0, 90, 0)],
      combatRngState: GUARANTEED_HIT_SEED,
      player: createInitialActor({ x: 2, y: 1 }, 1, 10, 0, 90, 0),
      runSeed: 555,
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(buildExportFilename(telemetry)).toBe('rogue-of-sun-run-v11-555-death.json');
  });

  it('no NaN or Infinity anywhere in the exported document', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, state);
    const json = JSON.stringify(doc);
    expect(json).not.toMatch(/NaN|Infinity/);
  });
});

describe('non-interference re-confirmed after the fix (Phase 10.3.2)', () => {
  it('telemetry still never mutates combatRngState', () => {
    const state = freshState({ combatRngState: GUARANTEED_HIT_SEED, equippedWeaponId: 'sword', inventory: { ...createEmptyInventory(), sword: 1 } });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    const before = snapshotForTurn(state);
    const result = processTurn(state, { type: 'action' });
    const rngAfterProcessTurn = state.combatRngState;
    recordTurn(telemetry, { type: 'action' }, result, before, state);
    expect(state.combatRngState).toBe(rngAfterProcessTurn);
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
});
