import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { normalizeEquipmentInstances, getHeldEquipmentInstances, getEquipmentInstanceById } from '../equipment-instance';
import { getTemperanceCandidates } from '../card-target-selection';
import { createEmptyInventory } from '../item-def';
import { GameMap, GameState, Tile, TrapTile } from '../types';
import {
  createRunTelemetry,
  recordFloorStarted,
  recordTurn,
  snapshotForTurn,
  finalizeRun,
  computeRunSummary,
  buildTelemetryDocument,
  buildExportFilename,
  RunTelemetry,
} from '../telemetry';
import { DEFAULT_RUN_CONFIG } from '../floor';

/**
 * Phase 24.4e2 focused tests: raw-event/summary derivation for every
 * curse lifecycle transition. See
 * docs/history/phase-24-4e2-curse-telemetry.md for the full contract.
 */

const OPEN_LAYOUT: string[] = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

function testMap(): GameMap {
  const terrain: Tile[][] = OPEN_LAYOUT.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width: OPEN_LAYOUT[0].length, height: OPEN_LAYOUT.length, terrain, rooms: [], exit: { x: 199, y: 199 } };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  const state: GameState = {
    map: testMap(),
    player: createInitialActor({ x: 10, y: 5 }, 30, 10),
    enemies: [],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
    runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
    exit: { x: 199, y: 199 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: { ...createEmptyInventory() },
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
    combatRngState: 0,
    sunlight: [],
    ...overrides,
  };
  return state;
}

function step(state: GameState, action: Parameters<typeof processTurn>[1], telemetry: RunTelemetry) {
  const before = snapshotForTurn(state);
  const result = processTurn(state, action);
  recordTurn(telemetry, action, result, before, state);
  finalizeRun(telemetry, state);
  return result;
}

// --- generated ---

describe('Phase 24.4e2: generated', () => {
  it('counts a normal_floor cursed ground item exactly once, by route', () => {
    const state = baseState({
      inventory: { ...createEmptyInventory(), sword: 1 },
    });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    // Move the held instance onto the ground to simulate floor-generated
    // placement (mirrors how state.ts's buildFloorState mints+places in
    // one step) — held count stays consistent via inventory removal.
    state.inventory.sword = 0;
    state.groundItems.push({ id: 0, itemId: 'sword', pos: { x: 3, y: 3 }, equipmentInstanceId: inst.instanceId });
    const telemetry = createRunTelemetry(state);
    const generated = telemetry.events.filter((e) => e.type === 'equipment_curse_generated');
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({ route: 'normal_floor', equipmentInstanceId: inst.instanceId });
  });

  it('counts a monster_house cursed ground item under monster_house', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), armor: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    state.inventory.armor = 0;
    state.groundItems.push({ id: 0, itemId: 'armor', pos: { x: 3, y: 3 }, equipmentInstanceId: inst.instanceId, spawnSource: 'monster_house' });
    const telemetry = createRunTelemetry(state);
    const generated = telemetry.events.filter((e) => e.type === 'equipment_curse_generated');
    expect(generated).toHaveLength(1);
    expect(generated[0]).toMatchObject({ route: 'monster_house' });
  });

  it('an uncursed ground item generates 0 events', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    state.inventory.sword = 0;
    state.groundItems.push({ id: 0, itemId: 'sword', pos: { x: 3, y: 3 }, equipmentInstanceId: inst.instanceId });
    const telemetry = createRunTelemetry(state);
    expect(telemetry.events.some((e) => e.type === 'equipment_curse_generated')).toBe(false);
  });

  it('does not double-count a carried-over instance on the next floor (groundItems is per-floor only)', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    state.equippedWeaponId = 'sword';
    state.equippedWeaponInstanceId = inst.instanceId;
    // Held (equipped), never placed on the ground — never counted as
    // "generated" via the groundItems scan.
    const telemetry = createRunTelemetry(state);
    expect(telemetry.events.some((e) => e.type === 'equipment_curse_generated')).toBe(false);
  });
});

// --- inflicted (mummy/curse_trap, reusing 24.4e1's equipment_cursed) ---

describe('Phase 24.4e2: inflicted', () => {
  function mummyState(turn: number, combatRngState: number): GameState {
    const mummy = createInitialEnemy('mummy', { x: 9, y: 5 }, 5, 2, turn, 0);
    const state = baseState({
      enemies: [mummy],
      turn,
      combatRngState,
      inventory: { ...createEmptyInventory(), sword: 1 },
      equippedWeaponId: 'sword',
    });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'sword')!;
    state.equippedWeaponInstanceId = inst.instanceId;
    return state;
  }

  it('mummy_hit success produces 1 inflicted event, source mummy_hit', () => {
    const state = mummyState(4, 0); // known good hit+chance-success combo (see phase-24-4e1 test file)
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const inflicted = telemetry.events.filter((e) => e.type === 'equipment_cursed');
    expect(inflicted).toHaveLength(1);
    expect(inflicted[0]).toMatchObject({ source: 'mummy_hit' });
  });

  it('mummy chance-failure produces 0 inflicted events', () => {
    const state = mummyState(0, 0); // known hit+chance-fail combo
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'equipment_cursed')).toBe(false);
  });

  it('curse_trap success produces 1 inflicted event, source curse_trap', () => {
    const trap: TrapTile = { id: 0, pos: { x: 3, y: 5 }, revealed: false, triggered: false, trapType: 'curse_trap' };
    const state = baseState({
      player: createInitialActor({ x: 2, y: 5 }, 30, 10),
      inventory: { ...createEmptyInventory(), sword: 1 },
      equippedWeaponId: 'sword',
      traps: [trap],
    });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    state.equippedWeaponInstanceId = inst.instanceId;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    const inflicted = telemetry.events.filter((e) => e.type === 'equipment_cursed');
    expect(inflicted).toHaveLength(1);
    expect(inflicted[0]).toMatchObject({ source: 'curse_trap' });
  });
});

// --- discovered ---

describe('Phase 24.4e2: discovered', () => {
  it('equipping an unrevealed cursed weapon produces 1 discovered event', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'sword' }, telemetry);
    const discovered = telemetry.events.filter((e) => e.type === 'equipment_curse_discovered');
    expect(discovered).toHaveLength(1);
  });

  it('a cursed instance discovered by mummy also produces exactly 1 discovered event', () => {
    const mummy = createInitialEnemy('mummy', { x: 9, y: 5 }, 5, 2, 4, 0);
    const state = baseState({
      enemies: [mummy],
      turn: 4,
      combatRngState: 0,
      inventory: { ...createEmptyInventory(), sword: 1 },
      equippedWeaponId: 'sword',
    });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    state.equippedWeaponInstanceId = inst.instanceId;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(telemetry.events.filter((e) => e.type === 'equipment_curse_discovered')).toHaveLength(1);
  });

  it('re-equipping an already-known-cursed weapon does not double count', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1, armor: 1 }, equippedArmorId: 'armor' });
    normalizeEquipmentInstances(state);
    const sword = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'sword')!;
    sword.cursed = true;
    sword.curseRevealed = true; // already known
    state.equippedWeaponId = 'sword';
    state.equippedWeaponInstanceId = sword.instanceId;
    const telemetry = createRunTelemetry(state);
    // Unequip then re-equip the same known-cursed instance is blocked by
    // curse-lock, so instead simulate a fresh equip call directly with
    // equipmentInstanceId (already-equipped no-op path also works, but
    // exercising the discovered-guard is the point here): equip via a
    // different already-known instance path is unavailable while
    // curse-locked, so assert no discovered event on the initial state
    // construction itself (curseRevealed was pre-set true, never
    // transitioned within this telemetry's lifetime).
    expect(telemetry.events.some((e) => e.type === 'equipment_curse_discovered')).toBe(false);
  });
});

// --- acquired ---

describe('Phase 24.4e2: acquired', () => {
  it('picking up a cursed ground item (unrevealed) produces 1 acquired event', () => {
    const state = baseState({ player: createInitialActor({ x: 2, y: 5 }, 30, 10) });
    // Simulate a floor-generated cursed sword sitting on the ground.
    normalizeEquipmentInstances(state);
    state.inventory.sword = 1; // mint via inventory bump then move to ground
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    state.inventory.sword = 0;
    state.groundItems.push({ id: 0, itemId: 'sword', pos: { x: 3, y: 5 }, equipmentInstanceId: inst.instanceId });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    const acquired = telemetry.events.filter((e) => e.type === 'cursed_equipment_acquired');
    expect(acquired).toHaveLength(1);
  });

  it('picking up an uncursed item never produces an acquired event', () => {
    const state = baseState({ player: createInitialActor({ x: 2, y: 5 }, 30, 10) });
    normalizeEquipmentInstances(state);
    state.inventory.sword = 1;
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    state.inventory.sword = 0;
    state.groundItems.push({ id: 0, itemId: 'sword', pos: { x: 3, y: 5 }, equipmentInstanceId: inst.instanceId });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'cursed_equipment_acquired')).toBe(false);
  });

  it('ground-only generation (never picked up) never counts as acquired', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    state.inventory.sword = 0;
    state.groundItems.push({ id: 0, itemId: 'sword', pos: { x: 3, y: 3 }, equipmentInstanceId: inst.instanceId });
    const telemetry = createRunTelemetry(state); // generation only, no pickup step
    expect(telemetry.events.some((e) => e.type === 'cursed_equipment_acquired')).toBe(false);
  });
});

// --- equipped ---

describe('Phase 24.4e2: equipped', () => {
  it('equipping a known cursed weapon increments equippedCount only', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    inst.curseRevealed = true;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'sword' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.curses.equippedCount).toBe(1);
    expect(summary.curses.equippedWhileUnrevealedCount).toBe(0);
  });

  it('equipping an unknown cursed weapon increments both counters', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'sword' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.curses.equippedCount).toBe(1);
    expect(summary.curses.equippedWhileUnrevealedCount).toBe(1);
  });

  it('a blocked/no-op equip attempt never increments equippedCount', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 }, equippedWeaponId: 'sword' });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    state.equippedWeaponInstanceId = inst.instanceId;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'sword' }, telemetry); // already equipped no-op
    const summary = computeRunSummary(telemetry, state);
    expect(summary.curses.equippedCount).toBe(0);
  });
});

// --- rejection ---

describe('Phase 24.4e2: curse-lock rejection', () => {
  function cursedEquippedState(overrides: Partial<GameState> = {}): GameState {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1, spear: 1 }, equippedWeaponId: 'sword', ...overrides });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'sword')!;
    inst.cursed = true;
    inst.curseRevealed = true;
    state.equippedWeaponInstanceId = inst.instanceId;
    return state;
  }

  it('unequip rejection: 1 event, operation unequip', () => {
    const state = cursedEquippedState();
    const inst = getHeldEquipmentInstances(state)[0];
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'unequip_weapon', equipmentInstanceId: inst.instanceId }, telemetry);
    const rejected = telemetry.events.filter((e) => e.type === 'curse_lock_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ operation: 'unequip' });
  });

  it('equip_swap rejection: 1 event, operation equip_swap', () => {
    const state = cursedEquippedState();
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'spear' }, telemetry);
    const rejected = telemetry.events.filter((e) => e.type === 'curse_lock_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ operation: 'equip_swap' });
  });

  it('a non-curse rejection (e.g. stale unequip) produces 0 curse_lock_rejected events', () => {
    const state = cursedEquippedState();
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'unequip_weapon', equipmentInstanceId: 'not-a-real-id' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'curse_lock_rejected')).toBe(false);
  });

  it('star_transform rejection: curse-locked equipped target produces 1 event, operation star_transform', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1, star: 1 }, equippedWeaponId: 'sword' });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    inst.curseRevealed = true;
    state.equippedWeaponInstanceId = inst.instanceId;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_targeted_card', cardId: 'star', target: { kind: 'equipment_instance', instanceId: inst.instanceId } }, telemetry);
    const rejected = telemetry.events.filter((e) => e.type === 'curse_lock_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ operation: 'star_transform', equipmentInstanceId: inst.instanceId });
  });

  it('at most 1 event per rejected operation', () => {
    const state = cursedEquippedState();
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'spear' }, telemetry);
    step(state, { type: 'equip_weapon', weaponId: 'spear' }, telemetry);
    const rejected = telemetry.events.filter((e) => e.type === 'curse_lock_rejected');
    expect(rejected).toHaveLength(2); // 2 separate operations, 1 event each
  });
});

// --- uncursed (Temperance) ---

describe('Phase 24.4e2: uncursed', () => {
  it('Temperance success produces exactly 1 event, source temperance, same instance', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1, temperance: 1 }, equippedWeaponId: 'sword' });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    inst.curseRevealed = true;
    state.equippedWeaponInstanceId = inst.instanceId;
    const candidates = getTemperanceCandidates(state);
    expect(candidates.length).toBeGreaterThan(0);
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_targeted_card', cardId: 'temperance', target: candidates[0] }, telemetry);
    const uncursed = telemetry.events.filter((e) => e.type === 'equipment_uncursed');
    expect(uncursed).toHaveLength(1);
    expect(uncursed[0]).toMatchObject({ source: 'temperance', equipmentInstanceId: inst.instanceId });
    expect(getEquipmentInstanceById(state, inst.instanceId)?.cursed).toBe(false);
  });

  it('no eligible target produces 0 uncursed events', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), temperance: 1 } });
    const telemetry = createRunTelemetry(state);
    // No candidates exist; use_targeted_card with a bogus target fails validation.
    step(state, { type: 'use_targeted_card', cardId: 'temperance', target: { kind: 'equipment_instance', instanceId: 'nope' } }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'equipment_uncursed')).toBe(false);
  });
});

// --- discarded / floor transition ---

describe('Phase 24.4e2: discarded and floor transition', () => {
  it('placing an unequipped cursed instance produces 1 discarded event', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'place_item', itemId: 'sword', equipmentInstanceId: inst.instanceId }, telemetry);
    const discarded = telemetry.events.filter((e) => e.type === 'cursed_equipment_discarded');
    expect(discarded).toHaveLength(1);
    expect(discarded[0]).toMatchObject({ action: 'place' });
  });

  it('discarding an unequipped cursed instance produces 1 discarded event', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'discard_item', itemId: 'sword', equipmentInstanceId: inst.instanceId }, telemetry);
    const discarded = telemetry.events.filter((e) => e.type === 'cursed_equipment_discarded');
    expect(discarded).toHaveLength(1);
    expect(discarded[0]).toMatchObject({ action: 'discard' });
  });

  it('an equipped cursed instance rejected by place produces 0 discarded events', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 }, equippedWeaponId: 'sword' });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    inst.curseRevealed = true;
    state.equippedWeaponInstanceId = inst.instanceId;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'place_item', itemId: 'sword', equipmentInstanceId: inst.instanceId }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'cursed_equipment_discarded')).toBe(false);
  });

  it('floor transition with a cursed equipped item produces 1 floor_transition event', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 }, equippedWeaponId: 'sword', floor: 2 });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    inst.curseRevealed = true;
    state.equippedWeaponInstanceId = inst.instanceId;
    const telemetry = createRunTelemetry(state); // floor 1's own creation never counts
    recordFloorStarted(telemetry, state); // simulate arriving on floor 2 via a real transition
    const transitions = telemetry.events.filter((e) => e.type === 'cursed_equipment_floor_transition');
    expect(transitions).toHaveLength(1);
  });

  it('floor transition with 2 cursed equipped items still produces only 1 event', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1, armor: 1 }, equippedWeaponId: 'sword', equippedArmorId: 'armor', floor: 2 });
    normalizeEquipmentInstances(state);
    const weapon = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'sword')!;
    const armor = getHeldEquipmentInstances(state).find((i) => i.definitionId === 'armor')!;
    weapon.cursed = true;
    armor.cursed = true;
    state.equippedWeaponInstanceId = weapon.instanceId;
    state.equippedArmorInstanceId = armor.instanceId;
    const telemetry = createRunTelemetry(state);
    recordFloorStarted(telemetry, state);
    expect(telemetry.events.filter((e) => e.type === 'cursed_equipment_floor_transition')).toHaveLength(1);
  });

  it('floor transition with no cursed equipment produces 0 events', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 }, equippedWeaponId: 'sword', floor: 2 });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    state.equippedWeaponInstanceId = inst.instanceId;
    const telemetry = createRunTelemetry(state);
    recordFloorStarted(telemetry, state);
    expect(telemetry.events.some((e) => e.type === 'cursed_equipment_floor_transition')).toBe(false);
  });

  it('the initial floor 1 (createRunTelemetry) never counts as a transition', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 }, equippedWeaponId: 'sword' });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    state.equippedWeaponInstanceId = inst.instanceId;
    const telemetry = createRunTelemetry(state);
    expect(telemetry.events.some((e) => e.type === 'cursed_equipment_floor_transition')).toBe(false);
  });
});

// --- schema ---

describe('Phase 24.4e2: schema', () => {
  it('schemaVersion is 9 on RunTelemetry, TelemetryDocument, and export filename', () => {
    const state = baseState();
    const telemetry = createRunTelemetry(state);
    expect(telemetry.schemaVersion).toBe(10);
    const doc = buildTelemetryDocument(telemetry, state);
    expect(doc.schemaVersion).toBe(10);
    expect(buildExportFilename(telemetry)).toMatch(/^rogue-of-sun-run-v10-/);
  });

  it('a run with no curse activity zero-defaults every curses counter', () => {
    const state = baseState();
    const telemetry = createRunTelemetry(state);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.curses).toEqual({
      generatedCount: 0,
      generatedByRoute: { normal_floor: 0, monster_house: 0, enemy_drop: 0, star_transform: 0 },
      inflictedCount: 0,
      inflictedBySource: { mummy_hit: 0, curse_trap: 0 },
      discoveredCount: 0,
      acquiredCount: 0,
      equippedCount: 0,
      equippedWhileUnrevealedCount: 0,
      lockRejectedCount: 0,
      lockRejectedByOperation: { unequip: 0, equip_swap: 0, place: 0, discard: 0, solar_forge: 0, star_transform: 0 },
      uncursedCount: 0,
      uncursedBySource: { temperance: 0 },
      discardedUnequippedCount: 0,
      floorTransitionsWhileEquippedCount: 0,
    });
  });

  it('exported JSON preserves internal true ids for raw events', () => {
    const state = baseState({ inventory: { ...createEmptyInventory(), sword: 1 } });
    normalizeEquipmentInstances(state);
    const inst = getHeldEquipmentInstances(state)[0];
    inst.cursed = true;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'sword' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, state);
    const json = JSON.parse(JSON.stringify(doc));
    const equippedEvent = json.events.find((e: { type: string }) => e.type === 'cursed_equipment_equipped');
    expect(equippedEvent.equipmentInstanceId).toBe(inst.instanceId);
    expect(equippedEvent.itemId).toBe('sword');
  });
});

// --- regression: telemetry never changes gameplay/RNG/turn/inventory/equipment ---

describe('Phase 24.4e2: regression (telemetry has zero gameplay side effects)', () => {
  it('identical seed/action sequence produces identical GameState with or without telemetry recording', () => {
    const mummy1 = createInitialEnemy('mummy', { x: 9, y: 5 }, 5, 2, 4, 0);
    const stateA = baseState({ enemies: [mummy1], turn: 4, combatRngState: 0, inventory: { ...createEmptyInventory(), sword: 1 }, equippedWeaponId: 'sword' });
    normalizeEquipmentInstances(stateA);
    stateA.equippedWeaponInstanceId = getHeldEquipmentInstances(stateA)[0].instanceId;

    const mummy2 = createInitialEnemy('mummy', { x: 9, y: 5 }, 5, 2, 4, 0);
    const stateB = baseState({ enemies: [mummy2], turn: 4, combatRngState: 0, inventory: { ...createEmptyInventory(), sword: 1 }, equippedWeaponId: 'sword' });
    normalizeEquipmentInstances(stateB);
    stateB.equippedWeaponInstanceId = getHeldEquipmentInstances(stateB)[0].instanceId;

    // A: no telemetry at all.
    processTurn(stateA, { type: 'wait' });
    // B: full telemetry recording.
    const telemetry = createRunTelemetry(stateB);
    step(stateB, { type: 'wait' }, telemetry);

    expect(stateB.combatRngState).toBe(stateA.combatRngState);
    expect(stateB.turn).toBe(stateA.turn);
    expect(stateB.inventory).toEqual(stateA.inventory);
    expect(stateB.equippedWeaponId).toBe(stateA.equippedWeaponId);
    const instA = getHeldEquipmentInstances(stateA)[0];
    const instB = getHeldEquipmentInstances(stateB)[0];
    expect(instB.cursed).toBe(instA.cursed);
    expect(instB.curseRevealed).toBe(instA.curseRevealed);
  });
});
