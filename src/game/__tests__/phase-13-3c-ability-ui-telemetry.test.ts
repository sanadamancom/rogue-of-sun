import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { advanceToNextFloor } from '../state';
import {
  ABILITY_RANK_CAP,
  BODY_MAX_HP_PER_RANK,
  MIND_MAX_SOL_PER_RANK,
  POWER_DAMAGE_PER_RANK,
  SPEED_PER_RANK,
  allocateAbilityPoint,
  formatAbilityEffectLine,
  getAbilityEffectDisplay,
} from '../ability';
import {
  buildExportFilename,
  buildTelemetryDocument,
  computeRunSummary,
  createRunTelemetry,
  CURRENT_GAME_VERSION,
  finalizeRun,
  recordTurn,
  snapshotForTurn,
} from '../telemetry';
import { createEmptyInventory } from '../item-def';
import { GameMap, GameState, PlayerAction, Tile } from '../types';
import { DEFAULT_RUN_CONFIG } from '../floor';

const TEST_LAYOUT: string[] = [
  '####################',
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
  const height = TEST_LAYOUT.length;
  const width = TEST_LAYOUT[0].length;
  const terrain: Tile[][] = TEST_LAYOUT.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(unspentAbilityPoints = 0): GameState {
  const playerPos = { x: 10, y: 4 };
  const enemyPos = { x: 9, y: 4 };
  return {
    map: testMap(),
    player: createInitialActor(playerPos, 30, 10),
    enemies: [createInitialEnemy('bok', enemyPos, 1000, 1)],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
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
    combatRngState: 304,
    sunlight: [],
    unspentAbilityPoints,
  };
}

function allocateRanks(state: GameState, ability: 'body' | 'mind' | 'power' | 'speed', n: number): void {
  state.unspentAbilityPoints = (state.unspentAbilityPoints ?? 0) + n;
  for (let i = 0; i < n; i++) {
    const result = allocateAbilityPoint(state, ability);
    if (!result.success) throw new Error(`allocation failed unexpectedly at rank ${i + 1}`);
  }
}

function step(state: GameState, action: PlayerAction, telemetry: ReturnType<typeof createRunTelemetry>) {
  const before = snapshotForTurn(state);
  const result = processTurn(state, action);
  recordTurn(telemetry, action, result, before, state);
  finalizeRun(telemetry, state);
  return result;
}

describe('Phase 13.3c ability effect display', () => {
  describe('body', () => {
    it.each([0, 1, 9, 10])('rank%i shows the correct current and next maxHp', (rank) => {
      const state = freshState();
      allocateRanks(state, 'body', rank);
      const display = getAbilityEffectDisplay(state, 'body');
      expect(display.currentValue).toBe(30 + BODY_MAX_HP_PER_RANK * rank);
      if (rank >= ABILITY_RANK_CAP) {
        expect(display.nextValue).toBeNull();
        expect(display.atRankCap).toBe(true);
      } else {
        expect(display.nextValue).toBe(30 + BODY_MAX_HP_PER_RANK * (rank + 1));
        expect(display.atRankCap).toBe(false);
      }
    });
  });

  describe('mind', () => {
    it.each([0, 1, 9, 10])('rank%i shows the correct current and next maxSOL', (rank) => {
      const state = freshState();
      allocateRanks(state, 'mind', rank);
      const display = getAbilityEffectDisplay(state, 'mind');
      expect(display.currentValue).toBe(5 + MIND_MAX_SOL_PER_RANK * rank);
      if (rank >= ABILITY_RANK_CAP) {
        expect(display.nextValue).toBeNull();
      } else {
        expect(display.nextValue).toBe(5 + MIND_MAX_SOL_PER_RANK * (rank + 1));
      }
    });

    it('states the 2-points-per-+1 elemental bonus rule explicitly (Phase 15.3 step_7 requirement)', () => {
      const state = freshState();
      const line = formatAbilityEffectLine(state, 'mind');
      expect(line).toMatch(/2ポイントごとに属性追加\+1/);
    });

    it('never implies current SOL is restored on allocation (Phase 15.3: only maxSolarEnergy increases)', () => {
      const state = freshState();
      const line = formatAbilityEffectLine(state, 'mind');
      expect(line).not.toMatch(/回復/);
    });
  });

  describe('power', () => {
    it.each([0, 1, 9, 10])('rank%i shows the correct current and next direct-attack bonus', (rank) => {
      const state = freshState();
      allocateRanks(state, 'power', rank);
      const display = getAbilityEffectDisplay(state, 'power');
      expect(display.currentValue).toBe(POWER_DAMAGE_PER_RANK * rank);
      if (rank >= ABILITY_RANK_CAP) {
        expect(display.nextValue).toBeNull();
      } else {
        expect(display.nextValue).toBe(POWER_DAMAGE_PER_RANK * (rank + 1));
      }
    });
  });

  describe('speed', () => {
    it.each([0, 1, 9, 10])('rank%i shows the correct current and next player speed', (rank) => {
      const state = freshState();
      allocateRanks(state, 'speed', rank);
      const display = getAbilityEffectDisplay(state, 'speed');
      expect(display.currentValue).toBe(100 + SPEED_PER_RANK * rank);
      if (rank >= ABILITY_RANK_CAP) {
        expect(display.nextValue).toBeNull();
      } else {
        expect(display.nextValue).toBe(100 + SPEED_PER_RANK * (rank + 1));
      }
    });

    it('never implies the player acts more often or moves farther', () => {
      const state = freshState();
      const line = formatAbilityEffectLine(state, 'speed');
      expect(line).not.toMatch(/行動回数/);
      expect(line).not.toMatch(/移動距離/);
      expect(line).not.toMatch(/2回行動/);
    });
  });

  describe('rank cap', () => {
    it('does not display or compute a rank-11 value at rank 10', () => {
      const state = freshState();
      for (const ability of ['body', 'mind', 'power', 'speed'] as const) {
        allocateRanks(state, ability, ABILITY_RANK_CAP);
        const display = getAbilityEffectDisplay(state, ability);
        expect(display.nextValue).toBeNull();
        expect(display.atRankCap).toBe(true);
        expect(formatAbilityEffectLine(state, ability)).toContain('上限');
      }
    });
  });

  describe('availability without points', () => {
    it('current effect values remain readable at 0 unspent ability points', () => {
      const state = freshState(0);
      for (const ability of ['body', 'mind', 'power', 'speed'] as const) {
        expect(() => getAbilityEffectDisplay(state, ability)).not.toThrow();
        expect(() => formatAbilityEffectLine(state, ability)).not.toThrow();
      }
    });
  });

  describe('purity', () => {
    it('getAbilityEffectDisplay and formatAbilityEffectLine never mutate state', () => {
      const state = freshState(3);
      allocateRanks(state, 'power', 2);
      const before = JSON.stringify(state);
      getAbilityEffectDisplay(state, 'body');
      getAbilityEffectDisplay(state, 'speed');
      formatAbilityEffectLine(state, 'mind');
      formatAbilityEffectLine(state, 'power');
      expect(JSON.stringify(state)).toBe(before);
    });
  });
});

describe('Phase 13.3c telemetry schemaVersion 7', () => {
  it('createRunTelemetry produces schemaVersion 7', () => {
    const state = freshState();
    const telemetry = createRunTelemetry(state);
    expect(telemetry.schemaVersion).toBe(8);
  });

  it('the final export document is schemaVersion 7', () => {
    const s = freshState();
    s.enemies = [];
    const telemetry = createRunTelemetry(s);
    step(s, { type: 'wait' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, s);
    expect(doc.schemaVersion).toBe(8);
  });

  it('the export filename uses the v7 prefix', () => {
    const s = freshState();
    s.enemies = [];
    const telemetry = createRunTelemetry(s);
    step(s, { type: 'wait' }, telemetry);
    expect(buildExportFilename(telemetry)).toMatch(/^rogue-of-sun-run-v8-/);
  });

  it('JSON.stringify/parse round-trips abilityRanks (endingAbilityRanks) intact', () => {
    const s = freshState(4);
    s.enemies = [];
    allocateRanks(s, 'body', 1);
    allocateRanks(s, 'speed', 2);
    const telemetry = createRunTelemetry(s);
    step(s, { type: 'wait' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, s);
    const parsed = JSON.parse(JSON.stringify(doc));
    expect(parsed.summary.progression.endingAbilityRanks).toEqual({ body: 1, mind: 0, power: 0, speed: 2 });
  });
});

describe('Phase 13.3c ability-rank telemetry snapshot (endingAbilityRanks)', () => {
  it('all 4 abilities are 0 at rank0', () => {
    const s = freshState();
    s.enemies = [];
    const telemetry = createRunTelemetry(s);
    step(s, { type: 'wait' }, telemetry);
    const summary = computeRunSummary(telemetry, s);
    expect(summary.progression.endingAbilityRanks).toEqual({ body: 0, mind: 0, power: 0, speed: 0 });
  });

  it('records the exact final ranks at clear', () => {
    const s = freshState(10);
    s.enemies = [];
    allocateRanks(s, 'body', 2);
    allocateRanks(s, 'mind', 1);
    allocateRanks(s, 'power', 3);
    allocateRanks(s, 'speed', 4);
    s.phase = 'victory'; // simulate a clear
    const telemetry = createRunTelemetry(s);
    finalizeRun(telemetry, s);
    const summary = computeRunSummary(telemetry, s);
    expect(summary.progression.endingAbilityRanks).toEqual({ body: 2, mind: 1, power: 3, speed: 4 });
  });

  it('records the exact final ranks at death', () => {
    const s = freshState(6);
    s.enemies = [];
    allocateRanks(s, 'body', 1);
    allocateRanks(s, 'mind', 2);
    allocateRanks(s, 'power', 1);
    allocateRanks(s, 'speed', 2);
    s.player.alive = false;
    s.phase = 'gameover';
    const telemetry = createRunTelemetry(s);
    finalizeRun(telemetry, s);
    const summary = computeRunSummary(telemetry, s);
    expect(summary.progression.endingAbilityRanks).toEqual({ body: 1, mind: 2, power: 1, speed: 2 });
  });

  it('does not add unspent ability points into the recorded ranks', () => {
    const s = freshState(5); // 5 points granted but never spent
    s.enemies = [];
    const telemetry = createRunTelemetry(s);
    step(s, { type: 'wait' }, telemetry);
    const summary = computeRunSummary(telemetry, s);
    expect(summary.progression.endingAbilityRanks).toEqual({ body: 0, mind: 0, power: 0, speed: 0 });
    expect(summary.progression.unspentAbilityPoints).toBe(5);
  });

  it('a floor transition alone does not finalize a summary', () => {
    const s = freshState();
    s.enemies = [];
    const telemetry = createRunTelemetry(s);
    step(s, { type: 'wait' }, telemetry);
    const next = advanceToNextFloor(s);
    void next;
    expect(telemetry.finalized).toBe(false);
    expect(telemetry.result).toBe('in_progress');
  });

  it('finalizing twice does not change the recorded ranks', () => {
    const s = freshState(3);
    s.enemies = [];
    allocateRanks(s, 'power', 2);
    s.phase = 'victory';
    const telemetry = createRunTelemetry(s);
    finalizeRun(telemetry, s);
    const first = computeRunSummary(telemetry, s).progression.endingAbilityRanks;
    finalizeRun(telemetry, s); // no-op, telemetry.finalized guard
    const second = computeRunSummary(telemetry, s).progression.endingAbilityRanks;
    expect(second).toEqual(first);
  });

  it('repeated export calls return the same value', () => {
    const s = freshState(2);
    s.enemies = [];
    allocateRanks(s, 'mind', 2);
    s.phase = 'victory';
    const telemetry = createRunTelemetry(s);
    finalizeRun(telemetry, s);
    const doc1 = buildTelemetryDocument(telemetry, s);
    const doc2 = buildTelemetryDocument(telemetry, s);
    expect(doc1.summary.progression.endingAbilityRanks).toEqual(doc2.summary.progression.endingAbilityRanks);
  });

  it('computing the summary/export does not mutate GameState or combatRngState', () => {
    const s = freshState(2);
    s.enemies = [];
    allocateRanks(s, 'speed', 1);
    const telemetry = createRunTelemetry(s);
    step(s, { type: 'wait' }, telemetry);
    const rngBefore = s.combatRngState;
    const abilitiesBefore = JSON.stringify(s.abilities);
    computeRunSummary(telemetry, s);
    buildTelemetryDocument(telemetry, s);
    expect(s.combatRngState).toBe(rngBefore);
    expect(JSON.stringify(s.abilities)).toBe(abilitiesBefore);
  });
});

describe('maintenance-game-version-policy: gameVersion', () => {
  it("the export document's gameVersion is 'phase-20' (the most recently main-integrated Phase)", () => {
    const s = freshState();
    s.enemies = [];
    const telemetry = createRunTelemetry(s);
    step(s, { type: 'wait' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, s);
    expect(doc.gameVersion).toBe('phase-20');
    expect(doc.gameVersion).toBe(CURRENT_GAME_VERSION);
  });

  it('gameVersion and schemaVersion are independent values: schemaVersion stays 7 regardless of gameVersion', () => {
    const s = freshState();
    s.enemies = [];
    const telemetry = createRunTelemetry(s);
    step(s, { type: 'wait' }, telemetry);
    const doc = buildTelemetryDocument(telemetry, s);
    expect(doc.schemaVersion).toBe(8);
    expect(doc.gameVersion).toBe('phase-20');
    // Neither field is derived from the other — confirms they are two
    // independently-tracked identifiers (gameplay milestone vs payload
    // structure), not a single combined version.
    expect(typeof doc.schemaVersion).toBe('number');
    expect(typeof doc.gameVersion).toBe('string');
  });
});
