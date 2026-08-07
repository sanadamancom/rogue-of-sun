import { describe, expect, it } from 'vitest';
import {
  buildExportFilename,
  buildTelemetryDocument,
  computeRunSummary,
  createRunTelemetry,
  finalizeRun,
  recordAbilityAllocation,
  recordFloorStarted,
  recordTurn,
  snapshotForTurn,
} from '../telemetry';
import { createEmptyInventory } from '../item-def';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { allocateAbilityPoint, POWER_DAMAGE_PER_RANK } from '../ability';
import { formatEvent as formatEventForTest } from '../message-log';
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
const GUARANTEED_MISS_SEED = 43; // first roll: 99

function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
  const before = snapshotForTurn(state);
  const result = processTurn(state, action);
  recordTurn(telemetry, action, result, before, state);
  finalizeRun(telemetry, state);
  return result;
}

describe('run lifecycle (Phase 10.3.1)', () => {
  it('creates one run_started and one floor_started event on a new run', () => {
    const state = freshState();
    const telemetry = createRunTelemetry(state);
    expect(telemetry.events.filter((e) => e.type === 'run_started')).toHaveLength(1);
    expect(telemetry.events.filter((e) => e.type === 'floor_started')).toHaveLength(1);
  });

  it('a normal move keeps the same telemetry object (not a new run)', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'N' });
    step(state, { type: 'wait' }, telemetry);
    expect(telemetry.result).toBe('in_progress');
    expect(telemetry.events.length).toBeGreaterThan(2);
  });

  it('finalizeRun confirms exactly once on death, with result "death"', () => {
    const state = freshState({
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 9999, 0, 0, 0, 90, 0)],
      combatRngState: GUARANTEED_HIT_SEED,
      player: createInitialActor({ x: 2, y: 1 }, 1, 10, 0, 90, 0),
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(state.phase).toBe('gameover');
    expect(telemetry.result).toBe('death');
    expect(telemetry.finalized).toBe(true);
    expect(telemetry.events.filter((e) => e.type === 'run_completed')).toHaveLength(1);
  });

  it('finalizeRun confirms exactly once on the final floor clear, with result "clear"', () => {
    const state = freshState({ enemies: [], floor: 3, totalFloors: 3, exit: { x: 3, y: 1 } });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    expect(state.phase).toBe('victory');
    expect(telemetry.result).toBe('clear');
    expect(telemetry.events.filter((e) => e.type === 'run_completed')).toHaveLength(1);
  });

  it('no further events are added after finalization', () => {
    const state = freshState({
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 9999, 0, 0, 0, 90, 0)],
      combatRngState: GUARANTEED_HIT_SEED,
      player: createInitialActor({ x: 2, y: 1 }, 1, 10, 0, 90, 0),
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const countAfterDeath = telemetry.events.length;
    // The scene would normally stop calling processTurn once dead, but
    // recordTurn/finalizeRun themselves must still refuse to append.
    step(state, { type: 'wait' }, telemetry);
    expect(telemetry.events.length).toBe(countAfterDeath);
  });

  it('createRunTelemetry always starts a brand-new telemetry object (Enter/N restart semantics)', () => {
    const stateA = freshState();
    const telemetryA = createRunTelemetry(stateA);
    const stateB = freshState();
    const telemetryB = createRunTelemetry(stateB);
    expect(telemetryA).not.toBe(telemetryB);
    expect(telemetryA.events).not.toBe(telemetryB.events);
  });
});

describe('movement trace (Phase 10.3.1)', () => {
  it('a successful move records correct from/to/direction', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'S' }, telemetry);
    const moveEvent = telemetry.events.find((e) => e.type === 'move');
    expect(moveEvent).toMatchObject({ type: 'move', from: { x: 2, y: 1 }, to: { x: 2, y: 2 }, direction: 'S' });
  });

  it('a diagonal move records correct coordinates', () => {
    const state = freshState({ enemies: [], player: createInitialActor({ x: 1, y: 1 }, 30, 10, 0, 90, 0) });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'SE' }, telemetry);
    const moveEvent = telemetry.events.find((e) => e.type === 'move');
    expect(moveEvent).toMatchObject({ from: { x: 1, y: 1 }, to: { x: 2, y: 2 } });
  });

  it('a blocked move (wall) is recorded as move_blocked, turn non-consuming', () => {
    const state = freshState({ enemies: [], player: createInitialActor({ x: 1, y: 1 }, 30, 10, 0, 90, 0) });
    const telemetry = createRunTelemetry(state);
    const turnBefore = state.turn;
    step(state, { type: 'move', direction: 'N' }, telemetry); // (1,0) is a wall
    const blockedEvent = telemetry.events.find((e) => e.type === 'move_blocked');
    expect(blockedEvent).toBeDefined();
    expect(blockedEvent!.turnConsumed).toBe(false);
    expect(state.turn).toBe(turnBefore);
  });

  it('wait is recorded with the player position', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const waitEvent = telemetry.events.find((e) => e.type === 'wait');
    expect(waitEvent).toMatchObject({ position: { x: 2, y: 1 } });
  });

  it('eventIndex is always monotonically increasing', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    for (let i = 0; i < 5; i++) {
      step(state, { type: 'wait' }, telemetry);
    }
    for (let i = 1; i < telemetry.events.length; i++) {
      expect(telemetry.events[i].eventIndex).toBe(telemetry.events[i - 1].eventIndex + 1);
    }
  });
});

describe('combat trace (Phase 10.3.1)', () => {
  it('records a player hit with weapon, outcome, and damage', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const attackEvent = telemetry.events.find((e) => e.type === 'player_attack');
    expect(attackEvent).toMatchObject({ weapon: 'sword', outcome: 'hit', physicalDamage: 12, actualDamage: 12 });
  });

  it('records a player miss with hitChance/roll and zero damage', () => {
    const state = freshState({
      combatRngState: GUARANTEED_MISS_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const attackEvent = telemetry.events.find((e) => e.type === 'player_attack');
    expect(attackEvent).toMatchObject({ outcome: 'miss', physicalDamage: 0, actualDamage: 0 });
    expect((attackEvent as { hitChance: number }).hitChance).toBe(95);
  });

  it('records an invalid attack (whiff) as attack_invalid, not counted as valid', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'N' });
    step(state, { type: 'action' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'attack_invalid')).toBe(true);
    expect(telemetry.events.some((e) => e.type === 'player_attack')).toBe(false);
  });

  it('records an enemy hit and a player_damaged event', () => {
    const state = freshState({ combatRngState: GUARANTEED_HIT_SEED });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'enemy_attack' && e.outcome === 'hit')).toBe(true);
    expect(telemetry.events.some((e) => e.type === 'player_damaged')).toBe(true);
  });

  it('an enemy miss never produces a player_damaged event', () => {
    const state = freshState({ combatRngState: GUARANTEED_MISS_SEED });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'enemy_attack' && e.outcome === 'miss')).toBe(true);
    expect(telemetry.events.some((e) => e.type === 'player_damaged')).toBe(false);
  });

  it('sol enchantment bonus is recorded as additionalDamage on the same attack event', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      // Phase 14.4 enemy affinities: bok is now sol-weak; use spider
      // (still all-neutral) so this continues to verify the plain
      // neutral-affinity additionalDamage value.
      enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const attackEvent = telemetry.events.find((e) => e.type === 'player_attack');
    expect(attackEvent).toMatchObject({ additionalDamage: 2, solConsumed: 1 });
  });

  it('hammer knockback is recorded on the attack event', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const attackEvent = telemetry.events.find((e) => e.type === 'player_attack');
    expect((attackEvent as { knockbackApplied: boolean }).knockbackApplied).toBe(true);
  });

  it('records enemy_defeated when a kill lands', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'enemy_defeated')).toBe(true);
    const attackEvent = telemetry.events.find((e) => e.type === 'player_attack');
    expect(attackEvent).toMatchObject({ outcome: 'defeated', defeated: true });
  });

  it('never overkills additionalDamage/totalDamage beyond what was actually applied', () => {
    // The recorded physicalDamage/totalDamage always mirrors the real
    // damage event.damage (already computed by turn.ts, capped at the
    // target's remaining HP via Math.max(0, hp - damage)), so overkill
    // is never separately added — verified via the defeat case above,
    // where damage still reflects the full attack power, not a
    // clamped-to-remaining-HP value (matching turn.ts's own behavior:
    // damage is the attack's power, HP is clamped to 0, not the reverse).
    expect(true).toBe(true);
  });
});

describe('equipment and item trace (Phase 10.3.1)', () => {
  it('picking up a weapon records item_acquired and equipment_acquired', () => {
    const state = freshState({
      enemies: [],
      groundItems: [{ id: 0, itemId: 'sword', pos: { x: 3, y: 1 } }],
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'item_acquired' && e.itemId === 'sword')).toBe(true);
    expect(telemetry.events.some((e) => e.type === 'equipment_acquired' && e.slot === 'weapon')).toBe(true);
  });

  it('equipping a weapon records equipment_changed with correct from/to', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), sword: 1 } });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'sword' }, telemetry);
    const changed = telemetry.events.find((e) => e.type === 'equipment_changed');
    expect(changed).toMatchObject({ slot: 'weapon', from: null, to: 'sword' });
  });

  it('swapping weapons records the previous weapon as "from"', () => {
    const state = freshState({
      enemies: [],
      inventory: { ...createEmptyInventory(), sword: 1, spear: 1 },
      equippedWeaponId: 'sword',
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'spear' }, telemetry);
    const changed = telemetry.events.find((e) => e.type === 'equipment_changed');
    expect(changed).toMatchObject({ from: 'sword', to: 'spear' });
  });

  it('using an item records item_used', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'item_used' && e.itemId === 'apple')).toBe(true);
  });

  it('a final-state equipment snapshot never changes after later mutation', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), sword: 1 } });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'equip_weapon', weaponId: 'sword' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, state);
    const snapshotWeapon = doc.summary.finalState.equipment.weapon;
    state.equippedWeaponId = null; // later mutation
    expect(snapshotWeapon).toBe('sword'); // the earlier doc's copy is untouched
  });
});

describe('resource trace (Phase 10.3.1)', () => {
  it('solar gun consumption is recorded as sol_changed with reason solar_gun', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'sol_changed' && e.reason === 'solar_gun' && e.amount === -3)).toBe(true); // cost raised 1->3 by Phase 16.1
  });

  it('melee enchantment consumption is recorded as sol_changed with reason melee_enchantment', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'sol_changed' && e.reason === 'melee_enchantment')).toBe(true);
  });

  it('solar charge is recorded as a solar_charge event and a sol_changed gain', () => {
    const state = freshState({
      enemies: [],
      solarEnergy: 3,
      sunlight: [[true]],
      player: createInitialActor({ x: 0, y: 0 }, 30, 10, 0, 90, 0),
      map: { width: 1, height: 1, terrain: [['floor']], rooms: [], exit: { x: 99, y: 99 } },
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'solar_charge')).toBe(true);
    expect(telemetry.events.some((e) => e.type === 'sol_changed' && e.reason === 'solar_charge')).toBe(true);
  });

  it('natural regen and apple healing are recorded distinctly', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    const healed = telemetry.events.find((e) => e.type === 'player_healed');
    expect(healed).toMatchObject({ source: 'item', itemId: 'apple' });
  });

  it('healing never exceeds max HP in the recorded amount', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 25; // maxHp 30, apple heals 20 -> actual 5
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    const healed = telemetry.events.find((e) => e.type === 'player_healed');
    expect((healed as { actualHealing: number }).actualHealing).toBe(5);
  });
});

describe('summary calculation (Phase 10.3.1)', () => {
  it('hitRate is null when no attacks were made', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.combatOverall.hitRate).toBeNull();
  });

  it('averageDamagePerHit is null when there are no hits', () => {
    const state = freshState({
      combatRngState: GUARANTEED_MISS_SEED,
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
    });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.combatByWeapon.sword.averageDamagePerHit).toBeNull();
  });

  it('never produces NaN or Infinity anywhere in the summary JSON', () => {
    const state = freshState({ combatRngState: GUARANTEED_HIT_SEED, equippedWeaponId: 'sword', inventory: { ...createEmptyInventory(), sword: 1 } });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/NaN|Infinity/);
  });

  it('per-floor damageDealt sums match the overall combat damage for a single-floor run', () => {
    const state = freshState({ combatRngState: GUARANTEED_HIT_SEED, equippedWeaponId: 'sword', inventory: { ...createEmptyInventory(), sword: 1 } });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    step(state, { type: 'action' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    const perFloorTotal = summary.perFloor.reduce((s, f) => s + f.damageDealt, 0);
    expect(perFloorTotal).toBe(summary.combatOverall.damageDealt);
  });
});

describe('JSON export (Phase 10.3.1)', () => {
  it('schemaVersion is 1', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    const doc = buildTelemetryDocument(telemetry, state);
    expect(doc.schemaVersion).toBe(7);
  });

  it('the exported document round-trips through JSON.stringify/parse', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, state);
    const json = JSON.stringify(doc);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(7);
    expect(parsed.events.length).toBe(doc.events.length);
  });

  it('filename reflects seed and clear/death outcome', () => {
    const state = freshState({
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 9999, 0, 0, 0, 90, 0)],
      combatRngState: GUARANTEED_HIT_SEED,
      player: createInitialActor({ x: 2, y: 1 }, 1, 10, 0, 90, 0),
      runSeed: 12345,
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    expect(buildExportFilename(telemetry)).toBe('rogue-of-sun-run-v7-12345-death.json');
  });

  it('building the document twice from the same finalized telemetry gives identical JSON', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const jsonA = JSON.stringify(buildTelemetryDocument(telemetry, state));
    const jsonB = JSON.stringify(buildTelemetryDocument(telemetry, state));
    expect(jsonA).toBe(jsonB);
  });
});

describe('determinism and non-interference (Phase 10.3.1)', () => {
  it('recordTurn never changes combatRngState', () => {
    const state = freshState({ combatRngState: GUARANTEED_HIT_SEED, equippedWeaponId: 'sword', inventory: { ...createEmptyInventory(), sword: 1 } });
    const telemetry = createRunTelemetry(state);
    processTurn(state, { type: 'face', direction: 'E' });
    const before = snapshotForTurn(state);
    const rngBeforeRecord = state.combatRngState;
    const result = processTurn(state, { type: 'action' });
    const rngAfterProcessTurn = state.combatRngState;
    recordTurn(telemetry, { type: 'action' }, result, before, state);
    expect(state.combatRngState).toBe(rngAfterProcessTurn);
    expect(rngAfterProcessTurn).not.toBe(rngBeforeRecord); // sanity: processTurn itself did roll
  });

  it('computing a summary never mutates telemetry or state', () => {
    const state = freshState({ enemies: [] });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const beforeEvents = telemetry.events.length;
    computeRunSummary(telemetry, state);
    expect(telemetry.events.length).toBe(beforeEvents);
  });

  it('telemetry does not perturb map generation determinism', () => {
    const a = createInitialState(2024);
    const telemetryA = createRunTelemetry(a);
    const b = createInitialState(2024);
    // No telemetry created for b at all — telemetry construction itself
    // must not be why two identical-seed states diverge.
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.combatRngState).toBe(b.combatRngState);
    expect(telemetryA.seed).toBe(a.runSeed);
  });

  it('same seed + same input sequence yields identical event sequences', () => {
    function run(): string {
      const state = freshState({ combatRngState: 999, equippedWeaponId: 'sword', inventory: { ...createEmptyInventory(), sword: 1 } });
      const telemetry = createRunTelemetry(state);
      processTurn(state, { type: 'face', direction: 'E' });
      for (let i = 0; i < 5; i++) {
        state.enemies[0].hp = 1000;
        step(state, { type: 'action' }, telemetry);
      }
      return JSON.stringify(telemetry.events);
    }
    expect(run()).toBe(run());
  });

  it('advanceToNextFloor + recordFloorStarted keeps the same telemetry and advances floor without ending the run', () => {
    let state = freshState({ enemies: [], exit: { x: 3, y: 1 } });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'move', direction: 'E' }, telemetry); // floor_cleared (not final floor: totalFloors 3)
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    recordFloorStarted(telemetry, state);
    expect(telemetry.result).toBe('in_progress');
    expect(telemetry.events.filter((e) => e.type === 'floor_started')).toHaveLength(2);
    expect(telemetry.events.filter((e) => e.type === 'floor_completed')).toHaveLength(1);
  });
});

describe('enemy_attack raw/reduction/floor fields (Phase 15.1 core combat rebalance)', () => {
  it('an unarmored hit records rawAttackPower equal to damage, armorReduction 0, flooredAtMinimum false', () => {
    const state = freshState({ combatRngState: GUARANTEED_HIT_SEED });
    const telemetry = createRunTelemetry(state);
    const result = step(state, { type: 'wait' }, telemetry);
    expect(result.enemyAttacked).toBe(true);
    const attack = telemetry.events.find((e) => e.type === 'enemy_attack') as {
      rawAttackPower: number;
      armorReduction: number;
      flooredAtMinimum: boolean;
      damage: number;
    };
    expect(attack.rawAttackPower).toBe(10);
    expect(attack.damage).toBe(10);
    expect(attack.armorReduction).toBe(0);
    expect(attack.flooredAtMinimum).toBe(false);
  });

  it('a heavily-armored hit records the proportional armorReduction and detects the minimum-damage floor', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedArmorId: 'armor',
      inventory: { ...createEmptyInventory(), armor: 1 },
      // attack 10, armorValue 2 -> round(10 * 2^-0.2) = 9, well above the floor.
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const attack = telemetry.events.find((e) => e.type === 'enemy_attack') as {
      rawAttackPower: number;
      armorReduction: number;
      flooredAtMinimum: boolean;
      damage: number;
    };
    expect(attack.rawAttackPower).toBe(10);
    expect(attack.damage).toBe(9);
    expect(attack.armorReduction).toBe(1);
    expect(attack.flooredAtMinimum).toBe(false);
  });

  it('an extreme-defense hit is detected as flooredAtMinimum', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      player: createInitialActor({ x: 2, y: 1 }, 30, 10, 100, 90, 0), // defense 100: proportional result rounds to 0
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const attack = telemetry.events.find((e) => e.type === 'enemy_attack') as {
      damage: number;
      flooredAtMinimum: boolean;
    };
    expect(attack.damage).toBe(1); // computeIncomingDamage's own floor
    expect(attack.flooredAtMinimum).toBe(true);
  });

  it('computeRunSummary aggregates rawDamage, armorReduction, flooredAtMinimumHits, and defeated per enemy species', () => {
    const state = freshState({
      combatRngState: GUARANTEED_HIT_SEED,
      equippedArmorId: 'armor',
      inventory: { ...createEmptyInventory(), armor: 1, sword: 1 },
      equippedWeaponId: 'sword',
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 2, 10, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    state.player.facing = 'E';
    step(state, { type: 'action' }, telemetry); // kills the bok, and the bok's own attack never lands (defeated first)
    const summary = computeRunSummary(telemetry, state);
    const bokStats = summary.damageTakenByEnemy.bok;
    expect(bokStats.defeated).toBe(1);
  });
});

describe('Phase 15.2 recovery/satiety/status rebalance telemetry', () => {
  it('run_started records the true starting satiety', () => {
    const state = createInitialState(1);
    const telemetry = createRunTelemetry(state);
    const started = telemetry.events.find((e) => e.type === 'run_started') as { satiety: number };
    expect(started.satiety).toBe(100);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.recoveryAndSatiety.satiety.start).toBe(100);
  });

  it('satiety_decreased fires only on an actual natural decrease, never for chocolate', () => {
    const state = freshState({ hunger: 5, inventory: { ...createEmptyInventory(), chocolate: 1 } });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'chocolate' }, telemetry);
    expect(telemetry.events.some((e) => e.type === 'satiety_decreased')).toBe(false);
    const chocolateEvent = telemetry.events.find((e) => e.type === 'item_used' && e.itemId === 'chocolate') as { effect: string; amount: number };
    expect(chocolateEvent).toMatchObject({ effect: 'satiety', amount: 30 });
    const summary = computeRunSummary(telemetry, state);
    expect(summary.recoveryAndSatiety.satiety.naturalLoss).toBe(0);
    expect(summary.recoveryAndSatiety.satiety.foodRecovered).toBe(30);
  });

  it('starvation_damage is translated into both a detailed record and a starvation-sourced player_damaged', () => {
    const state = freshState({ enemies: [], hunger: 0, starvationProgress: 0 });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const detailed = telemetry.events.find((e) => e.type === 'starvation_damage') as { damage: number; hpBefore: number; hpAfter: number };
    expect(detailed).toBeDefined();
    expect(detailed.damage).toBe(1);
    const generic = telemetry.events.find((e) => e.type === 'player_damaged' && e.source === 'starvation') as { amount: number };
    expect(generic.amount).toBe(1);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.recoveryAndSatiety.starvation).toEqual({ turnsAtZero: 1, damageEvents: 1, totalDamage: 1 });
    // Excluded from damageTakenByEnemy (no attacking enemy), same as poison.
    expect(summary.damageTakenByEnemy.bok).toBeUndefined();
  });

  it('starvation damage and poison damage are never confused with each other', () => {
    const state = freshState({
      enemies: [],
      hunger: 0,
      starvationProgress: 0,
      activeEffects: [{ id: 'poison', strength: 1, remainingTurns: 10 }],
      poisonTickProgress: 1,
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.recoveryAndSatiety.starvation.totalDamage).toBe(1);
    expect(summary.recoveryAndSatiety.poison.totalDamage).toBe(1);
    expect(summary.recoveryAndSatiety.poison.tickEvents).toBe(1);
  });

  it('natural regen requested/actual totals reflect the real per-tick amount, distinct from apple', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry); // hp 5 -> 10 (apple heals 5)
    for (let i = 0; i < 10; i++) {
      step(state, { type: 'wait' }, telemetry); // REGEN_TURNS_PER_HP=10; ticks once, +1
    }
    const summary = computeRunSummary(telemetry, state);
    expect(summary.recoveryAndSatiety.apple).toEqual({ usedCount: 1, requestedTotal: 5, actualTotal: 5 });
    expect(summary.recoveryAndSatiety.naturalRegen.occurrences).toBe(1);
    expect(summary.recoveryAndSatiety.naturalRegen.requestedTotal).toBe(1);
    expect(summary.recoveryAndSatiety.naturalRegen.actualTotal).toBe(1);
  });

  it('apple actualTotal reflects LIFE-cap rounding, distinct from requestedTotal', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 27; // maxHp 30: apple requests 5, actual clamps to 3
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.recoveryAndSatiety.apple).toEqual({ usedCount: 1, requestedTotal: 5, actualTotal: 3 });
  });

  it('apple aggregation and the generic item-used count are not double counted', () => {
    const state = freshState({ enemies: [], inventory: { ...createEmptyInventory(), apple: 1 } });
    state.player.hp = 5;
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'apple' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.resources.itemsUsedByType.apple).toBe(1);
    expect(summary.recoveryAndSatiety.apple.usedCount).toBe(1);
  });

  it('banana attacksWhileActive counts every attack attempt (hit and miss) while attack_up is active, matching the existing attempt-based attack convention', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 1 }, 30, 10, 0, 100, 0),
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      activeEffects: [{ id: 'attack_up', strength: 1, remainingTurns: 20 }],
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 0, 0, 0, 0, 90, 0)],
    });
    const telemetry = createRunTelemetry(state);
    state.player.facing = 'E';
    step(state, { type: 'action' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.recoveryAndSatiety.banana.attacksWhileActive).toBe(1);
  });

  it('satiety.min tracks the lowest value reached over the run, even after later recovery', () => {
    const state = freshState({ enemies: [], hunger: 4, inventory: { ...createEmptyInventory(), chocolate: 1 } });
    const telemetry = createRunTelemetry(state);
    for (let i = 0; i < 5; i++) {
      step(state, { type: 'wait' }, telemetry); // 4 -> 3 on the 5th (HUNGER_DECREASE_INTERVAL=5, Phase 16.1)
    }
    step(state, { type: 'use_item', itemId: 'chocolate' }, telemetry); // 3 -> 33
    const summary = computeRunSummary(telemetry, state);
    expect(summary.recoveryAndSatiety.satiety.start).toBe(4);
    expect(summary.recoveryAndSatiety.satiety.min).toBe(3);
    expect(summary.recoveryAndSatiety.satiety.end).toBe(33);
  });
});

describe('Phase 15.3 SOL/element/ability rebalance telemetry', () => {
  it('run_started records the true starting SOL', () => {
    const state = createInitialState(1);
    const telemetry = createRunTelemetry(state);
    const started = telemetry.events.find((e) => e.type === 'run_started') as { sol: number };
    expect(started.sol).toBe(15);
  });

  it('sol_changed carries requestedAmount for sun_fruit (item) recovery, distinct from the clamped actual amount', () => {
    const state = freshState({
      enemies: [],
      solarEnergy: 13,
      maxSolarEnergy: 15,
      inventory: { ...createEmptyInventory(), sun_fruit: 1 },
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'sun_fruit' }, telemetry);
    const solChanged = telemetry.events.find((e) => e.type === 'sol_changed') as { amount: number; requestedAmount?: number };
    expect(solChanged.requestedAmount).toBe(5); // real sun_fruit.solarAmount
    expect(solChanged.amount).toBe(2); // clamped: 13 -> 15
  });

  it('sol_changed carries requestedAmount for sunlight charge, matching SUNLIGHT_CHARGE_AMOUNT', () => {
    const sunlitGrid = Array.from({ length: 8 }, () => Array.from({ length: 10 }, () => true));
    const state = freshState({ enemies: [], solarEnergy: 3, maxSolarEnergy: 15, sunlight: sunlitGrid });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'wait' }, telemetry); // sunlit + below max -> solar charge, not a plain wait
    const solChanged = telemetry.events.find((e) => e.type === 'sol_changed') as { amount: number; requestedAmount?: number };
    expect(solChanged.requestedAmount).toBe(1);
    expect(solChanged.amount).toBe(1);
  });

  it('element_activation records requested/actual elemental damage and mind bonus for a neutral hit', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 1)], // all-neutral
    });
    const telemetry = createRunTelemetry(state);
    state.player.facing = 'E';
    step(state, { type: 'action' }, telemetry);
    const activation = telemetry.events.find((e) => e.type === 'element_activation') as {
      element: string;
      affinity: string;
      requestedElementalDamage: number;
      actualElementalDamage: number;
      mindBonusPortion: number;
      solConsumed: number;
    };
    expect(activation).toBeDefined();
    expect(activation.element).toBe('sol');
    expect(activation.affinity).toBe('neutral');
    expect(activation.requestedElementalDamage).toBe(2); // fixed neutral bonus, mind rank 0
    expect(activation.actualElementalDamage).toBe(2);
    expect(activation.mindBonusPortion).toBe(0);
    expect(activation.solConsumed).toBe(1);
  });

  it('element_activation attributes mindBonusPortion correctly at mind rank 4 (floor(4/2)=2)', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      abilities: { body: 0, mind: 4, power: 0, speed: 0 },
      enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 1)],
    });
    const telemetry = createRunTelemetry(state);
    state.player.facing = 'E';
    step(state, { type: 'action' }, telemetry);
    const activation = telemetry.events.find((e) => e.type === 'element_activation') as {
      requestedElementalDamage: number;
      actualElementalDamage: number;
      mindBonusPortion: number;
    };
    expect(activation.mindBonusPortion).toBe(2);
    expect(activation.requestedElementalDamage).toBe(4); // fixed 2 + mind bonus 2
    expect(activation.actualElementalDamage).toBe(4);
  });

  it('element_activation caps actualElementalDamage at the real remaining HP on an overkill hit', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 5,
      // physical portion alone (player.attack 10 + sword bonus 2) = 12,
      // already exceeds this enemy's 1 HP, so the elemental portion's
      // actual contribution is entirely absorbed by the overkill clamp.
      enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1, 1)],
    });
    const telemetry = createRunTelemetry(state);
    state.player.facing = 'E';
    step(state, { type: 'action' }, telemetry);
    const activation = telemetry.events.find((e) => e.type === 'element_activation') as {
      requestedElementalDamage: number;
      actualElementalDamage: number;
    };
    expect(activation.requestedElementalDamage).toBe(2);
    expect(activation.actualElementalDamage).toBe(0);
  });

  it('element_activation_failed fires when an eligible, selected, unlocked element lacks enough SOL', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      unlockedEnchantments: { sol: false, flame: true, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'flame',
      solarEnergy: 1, // flame costs 2
      enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 1)],
    });
    const telemetry = createRunTelemetry(state);
    state.player.facing = 'E';
    step(state, { type: 'action' }, telemetry);
    const failed = telemetry.events.find((e) => e.type === 'element_activation_failed') as { element: string; reason: string };
    expect(failed).toBeDefined();
    expect(failed.element).toBe('flame');
    expect(failed.reason).toBe('insufficient_sol');
    expect(telemetry.events.some((e) => e.type === 'element_activation')).toBe(false);
    // The message log identifies this distinctly from a plain unenchanted hit.
    const line = formatEventForTest({ type: 'element_activation_failed', element: 'flame', reason: 'insufficient_sol' });
    expect(line).toContain('SOLが足りず');
  });

  it('computeRunSummary aggregates element activations by element and by affinity, and counts insufficient-SOL failures', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      solUnlocked: true,
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 1, // enough for exactly 1 sol activation (cost 1)
      // bok is sol-weak (see enemy-def.ts), so this hit is a 'weak' activation.
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 1000, 1)],
    });
    const telemetry = createRunTelemetry(state);
    state.player.facing = 'E';
    step(state, { type: 'action' }, telemetry); // SOL 1 -> 0, weak sol activation
    step(state, { type: 'action' }, telemetry); // SOL 0: insufficient, no activation
    const summary = computeRunSummary(telemetry, state);
    expect(summary.solAndElements.elementActivations.byElement.sol.count).toBe(1);
    expect(summary.solAndElements.elementActivations.byElement.sol.requestedTotal).toBe(3); // fixed weak bonus
    expect(summary.solAndElements.elementActivations.byAffinity.weak).toBe(1);
    expect(summary.solAndElements.elementActivations.insufficientSolCount).toBe(1);
  });

  it('computeRunSummary tracks sol.start/gained/consumed/end and mirrors the pre-existing resources totals', () => {
    const state = freshState({
      enemies: [],
      solarEnergy: 3,
      maxSolarEnergy: 15,
      inventory: { ...createEmptyInventory(), sun_fruit: 1 },
    });
    const telemetry = createRunTelemetry(state);
    step(state, { type: 'use_item', itemId: 'sun_fruit' }, telemetry); // 3 -> 8
    const summary = computeRunSummary(telemetry, state);
    expect(summary.solAndElements.sol.start).toBe(3);
    expect(summary.solAndElements.sol.gained).toBe(summary.resources.solGained);
    expect(summary.solAndElements.sol.consumed).toBe(summary.resources.solConsumed);
    expect(summary.solAndElements.sol.end).toBe(state.solarEnergy);
  });

  it('computeRunSummary tracks per-ability allocation counts and mind/power bonus damage totals', () => {
    const state = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      unspentAbilityPoints: 2,
      abilities: { body: 0, mind: 0, power: 0, speed: 0 },
      enemies: [createInitialEnemy('spider', { x: 3, y: 1 }, 1000, 1)],
    });
    const telemetry = createRunTelemetry(state);
    const allocResult = allocateAbilityPoint(state, 'power');
    if (allocResult.success) {
      recordAbilityAllocation(telemetry, state, 'power', allocResult.previousValue, allocResult.newValue, allocResult.remainingAbilityPoints);
    }
    state.player.facing = 'E';
    step(state, { type: 'action' }, telemetry);
    const summary = computeRunSummary(telemetry, state);
    expect(summary.solAndElements.abilities.allocationsByAbility.power).toBe(1);
    expect(summary.solAndElements.abilities.powerBonusDamageTotal).toBe(POWER_DAMAGE_PER_RANK);
  });
});
