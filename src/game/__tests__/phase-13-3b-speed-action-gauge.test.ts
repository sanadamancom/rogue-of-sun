import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { createInitialState, advanceToNextFloor } from '../state';
import {
  ABILITY_RANK_CAP,
  PLAYER_BASE_SPEED,
  SPEED_PER_RANK,
  allocateAbilityPoint,
  getAbilityValue,
  getPlayerSpeed,
  openAbilityConfirm,
  toggleAbilityConfirmChoice,
  resolveAbilityConfirm,
  cancelAbilityConfirm,
} from '../ability';
import { EnemyType, GameMap, GameState, Tile } from '../types';
import { getHunger } from '../hunger';
import { createEmptyInventory } from '../item-def';
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

/**
 * A state with a single, huge-HP player (never dies from ordinary
 * combat within these tests) and a single 'bok' enemy placed adjacent to
 * the player from the start, so every scheduler pass that resolves it
 * immediately attacks (generic_melee always attacks when adjacent) —
 * producing exactly one enemy_attack/enemy_attack_missed event per
 * resolveOneEnemy call, which lets the tests count actual scheduler
 * invocations purely from the event log, with no internal access needed.
 */
function adjacentEnemyState(unspentAbilityPoints = 0): GameState {
  const playerPos = { x: 10, y: 4 };
  const enemyPos = { x: 9, y: 4 }; // adjacent (W) to the player
  return {
    map: testMap(),
    player: createInitialActor(playerPos, 1_000_000, 10),
    enemies: [createInitialEnemy('bok', enemyPos, 30, 1)],
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
    inventory: { ...createEmptyInventory(), apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0 },
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

function twoEnemyState(): GameState {
  const state = adjacentEnemyState();
  // A second enemy, also adjacent (from a different side so both can
  // legally occupy tiles next to the player), used only by the
  // player-death interruption test.
  state.enemies.push(createInitialEnemy('bok', { x: 11, y: 4 }, 30, 1, 0, 1));
  return state;
}

/** Runs `count` consumed 'wait' turns and returns the cumulative count of enemy_attack/enemy_attack_missed events (== the number of resolveOneEnemy calls that actually reached the adjacent-attack branch). */
function runWaitsAndCountEnemyActions(state: GameState, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    const result = processTurn(state, { type: 'wait' });
    total += result.events.filter((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed').length;
  }
  return total;
}

function allocateSpeedRanks(state: GameState, n: number): void {
  state.unspentAbilityPoints = (state.unspentAbilityPoints ?? 0) + n;
  for (let i = 0; i < n; i++) {
    const result = allocateAbilityPoint(state, 'speed');
    if (!result.success) throw new Error(`speed allocation failed unexpectedly at rank ${i + 1}`);
  }
}

describe('Phase 13.3b speed ability and enemy action gauge scheduler', () => {
  describe('player speed', () => {
    it('rank 0/1/3/5/10 yields speed 100/110/130/150/200', () => {
      const expected: Record<number, number> = { 0: 100, 1: 110, 3: 130, 5: 150, 10: 200 };
      for (const [rank, speed] of Object.entries(expected)) {
        const state = adjacentEnemyState();
        allocateSpeedRanks(state, Number(rank));
        expect(getPlayerSpeed(state)).toBe(speed);
      }
    });

    it('does not exceed rank 10', () => {
      const state = adjacentEnemyState(1);
      allocateSpeedRanks(state, ABILITY_RANK_CAP);
      state.unspentAbilityPoints = 1;
      const result = allocateAbilityPoint(state, 'speed');
      expect(result.success).toBe(false);
      expect(getAbilityValue(state, 'speed')).toBe(ABILITY_RANK_CAP);
      expect(getPlayerSpeed(state)).toBe(PLAYER_BASE_SPEED + SPEED_PER_RANK * ABILITY_RANK_CAP);
    });

    it('getPlayerSpeed never mutates state', () => {
      const state = adjacentEnemyState();
      const before = JSON.stringify(state);
      getPlayerSpeed(state);
      expect(JSON.stringify(state)).toBe(before);
    });
  });

  describe('scheduler action counts (representative values)', () => {
    // enemy speed is fixed at 100 this phase; expected counts per
    // confirmed_spec's representative_expected_counts table.
    const table: { rank: number; speed: number; turn10: number; turn20: number; turn50: number }[] = [
      { rank: 0, speed: 100, turn10: 10, turn20: 20, turn50: 50 },
      { rank: 1, speed: 110, turn10: 9, turn20: 18, turn50: 45 },
      { rank: 3, speed: 130, turn10: 7, turn20: 15, turn50: 38 },
      { rank: 5, speed: 150, turn10: 6, turn20: 13, turn50: 33 },
      { rank: 10, speed: 200, turn10: 5, turn20: 10, turn50: 25 },
    ];

    for (const { rank, speed, turn10, turn20, turn50 } of table) {
      it(`rank${rank} (speed ${speed}): 10/20/50 turns -> ${turn10}/${turn20}/${turn50} enemy actions`, () => {
        const state = adjacentEnemyState();
        allocateSpeedRanks(state, rank);
        expect(getPlayerSpeed(state)).toBe(speed);

        const first10 = runWaitsAndCountEnemyActions(state, 10);
        expect(first10).toBe(turn10);

        const next10 = runWaitsAndCountEnemyActions(state, 10); // turns 11..20
        expect(first10 + next10).toBe(turn20);

        const next30 = runWaitsAndCountEnemyActions(state, 30); // turns 21..50
        expect(first10 + next10 + next30).toBe(turn50);
      });
    }

    it('leftover gauge persists across player turns rather than resetting each turn', () => {
      const state = adjacentEnemyState();
      allocateSpeedRanks(state, 1); // speed 110
      // turn1: gauge 0+100=100 (<110) -> 0 actions, gauge stays 100
      const t1 = runWaitsAndCountEnemyActions(state, 1);
      expect(t1).toBe(0);
      expect(state.enemies[0].actionGauge).toBe(100);
      // turn2: gauge 100+100=200 (>=110) -> 1 action, remainder 90 (not reset to 0)
      const t2 = runWaitsAndCountEnemyActions(state, 1);
      expect(t2).toBe(1);
      expect(state.enemies[0].actionGauge).toBe(90);
    });

    it('subtracts only the threshold amount per action, never rounding the remainder to 0', () => {
      const state = adjacentEnemyState();
      allocateSpeedRanks(state, 3); // speed 130
      // turn1: gauge 0+100=100 (<130) -> 0 actions, remainder 100 (not reset)
      runWaitsAndCountEnemyActions(state, 1);
      expect(state.enemies[0].actionGauge).toBe(100);
      // turn2: gauge 100+100=200 (>=130) -> 1 action, remainder exactly 70 (200-130)
      runWaitsAndCountEnemyActions(state, 1);
      expect(state.enemies[0].actionGauge).toBe(70);
    });
  });

  describe('rank0 backward compatibility', () => {
    it('multiple enemies each resolve exactly once per player turn, in array order, gauge 0 afterward', () => {
      const state = adjacentEnemyState();
      state.enemies.push(createInitialEnemy('bok', { x: 11, y: 4 }, 30, 1, 0, 1));
      const before = state.enemies.map((e) => e.id);
      const actionsThisTurn = runWaitsAndCountEnemyActions(state, 1);
      expect(actionsThisTurn).toBe(2); // both adjacent enemies attacked exactly once
      expect(state.enemies.map((e) => e.id)).toEqual(before); // order unchanged
      for (const enemy of state.enemies) {
        expect(enemy.actionGauge).toBe(0);
      }
    });

    it('existing full test suite (RNG-dependent included) is unaffected — spot-checked via a deterministic combat sequence', () => {
      const state = adjacentEnemyState();
      state.player.hp = 100;
      state.player.maxHp = 100;
      // 3 wait turns at rank0: exactly 3 enemy_attack/enemy_attack_missed
      // events total, matching pre-Phase-13.3b's unconditional
      // one-call-per-enemy-per-turn behavior.
      const total = runWaitsAndCountEnemyActions(state, 3);
      expect(total).toBe(3);
    });
  });

  describe('allocation reset', () => {
    it('a successful speed allocation resets all enemies actionGauge to 0', () => {
      const state = adjacentEnemyState(1);
      // Build up nonzero gauge first (rank0, one turn: gauge stays 100... use rank1 first for nonzero remainder)
      allocateSpeedRanks(state, 1); // speed 110; consumes the 1 granted point
      runWaitsAndCountEnemyActions(state, 1); // gauge becomes 100 (0+100, 100<110)
      expect(state.enemies[0].actionGauge).toBe(100);

      state.unspentAbilityPoints = 1;
      const result = allocateAbilityPoint(state, 'speed');
      expect(result.success).toBe(true);
      expect(state.enemies[0].actionGauge).toBe(0);
    });

    it('body/mind/power allocations do not touch actionGauge', () => {
      for (const ability of ['body', 'mind', 'power'] as const) {
        const state = adjacentEnemyState(1);
        runWaitsAndCountEnemyActions(state, 1); // gauge becomes 100 at rank0... but rank0 threshold100 means gauge resets to 0 each turn
        // Force a nonzero gauge directly so a false-positive reset is detectable.
        state.enemies[0].actionGauge = 42;
        state.unspentAbilityPoints = 1;
        const result = allocateAbilityPoint(state, ability);
        expect(result.success).toBe(true);
        expect(state.enemies[0].actionGauge).toBe(42);
      }
    });

    it('rank10 speed allocation failure leaves actionGauge, rank, and points unchanged', () => {
      const state = adjacentEnemyState(1);
      allocateSpeedRanks(state, ABILITY_RANK_CAP);
      state.enemies[0].actionGauge = 77;
      state.unspentAbilityPoints = 1;
      const result = allocateAbilityPoint(state, 'speed');
      expect(result.success).toBe(false);
      expect(state.enemies[0].actionGauge).toBe(77);
      expect(state.unspentAbilityPoints).toBe(1);
      expect(getAbilityValue(state, 'speed')).toBe(ABILITY_RANK_CAP);
    });

    it('insufficient points leaves actionGauge unchanged', () => {
      const state = adjacentEnemyState(0);
      state.enemies[0].actionGauge = 55;
      const result = allocateAbilityPoint(state, 'speed');
      expect(result.success).toBe(false);
      expect(state.enemies[0].actionGauge).toBe(55);
    });

    it('cancelling the confirmation leaves actionGauge unchanged', () => {
      const state = adjacentEnemyState(1);
      state.enemies[0].actionGauge = 33;
      state.abilityOverlayOpen = true;
      state.selectedAbilityIndex = 3; // 'speed' is ABILITY_IDS[3]
      openAbilityConfirm(state);
      toggleAbilityConfirmChoice(state); // -> 'yes'
      cancelAbilityConfirm(state); // cancel before resolving
      expect(state.enemies[0].actionGauge).toBe(33);
      expect(state.unspentAbilityPoints).toBe(1);
    });

    it('a confirmation resolved as "いいえ" leaves actionGauge unchanged', () => {
      const state = adjacentEnemyState(1);
      state.enemies[0].actionGauge = 33;
      state.abilityOverlayOpen = true;
      state.selectedAbilityIndex = 3;
      openAbilityConfirm(state); // choice defaults to 'no'
      const resolution = resolveAbilityConfirm(state);
      expect(resolution.attempted).toBe(false);
      expect(state.enemies[0].actionGauge).toBe(33);
      expect(state.unspentAbilityPoints).toBe(1);
    });

    it('the reset and the allocation itself never consume a turn or trigger enemy actions/time progression', () => {
      const state = adjacentEnemyState(1);
      const turnBefore = state.turn;
      const hungerBefore = state.hunger;
      allocateAbilityPoint(state, 'speed');
      expect(state.turn).toBe(turnBefore);
      expect(state.hunger).toBe(hungerBefore);
    });
  });

  describe('lifecycle', () => {
    it('createInitialEnemy returns actionGauge strictly 0 (required field, never undefined)', () => {
      const enemy = createInitialEnemy('bok' as EnemyType, { x: 0, y: 0 }, 10, 1);
      expect(enemy.actionGauge).toBe(0);
      expect(Object.prototype.hasOwnProperty.call(enemy, 'actionGauge')).toBe(true);
    });

    it('every enemy from a freshly generated floor has actionGauge strictly 0', () => {
      const state = createInitialState(12345);
      expect(state.enemies.length).toBeGreaterThan(0);
      for (const enemy of state.enemies) {
        expect(enemy.actionGauge).toBe(0);
      }
    });

    it('every enemy immediately after a floor transition has actionGauge strictly 0', () => {
      const state = createInitialState(12345);
      // Defeat every enemy on floor 1 so the exit unlocks, then walk onto
      // it via advanceToNextFloor directly (bypassing normal play) to
      // inspect the freshly built floor-2 state.
      for (const enemy of state.enemies) enemy.alive = false;
      const next = advanceToNextFloor(state);
      expect(next.enemies.length).toBeGreaterThan(0);
      for (const enemy of next.enemies) {
        expect(enemy.actionGauge).toBe(0);
      }
    });

    it('a dead enemy is skipped entirely by the scheduler and never gains gauge or acts', () => {
      const state = adjacentEnemyState();
      state.enemies[0].alive = false;
      const actions = runWaitsAndCountEnemyActions(state, 1);
      expect(actions).toBe(0);
      expect(state.enemies[0].actionGauge).toBe(0);
    });

    it('player death partway through a multi-action pass stops that enemy and every later enemy in the array', () => {
      const state = twoEnemyState();
      state.player.hp = 1;
      state.player.maxHp = 1;
      const firstEnemy = state.enemies[0];
      firstEnemy.attack = 999; // guaranteed lethal on a hit
      // Force 3 due actions this pass at rank0 (playerSpeed=100): gauge
      // 250+100=350 -> 3 actions (350-100-100-100=50<100, stop).
      firstEnemy.actionGauge = 250;
      // combatRngState=304's first roll (41) is a guaranteed hit against
      // the enemy's 90 base accuracy (see rng.ts), so the very first
      // action-gauge iteration kills the player deterministically.
      state.combatRngState = 304;

      const result = processTurn(state, { type: 'wait' });

      expect(state.player.alive).toBe(false);
      const enemyAttackEvents = result.events.filter((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed');
      // Exactly 1 attack event: the first enemy's first (lethal) action.
      // Neither its remaining 2 due actions nor the second enemy's action
      // run once the player is dead.
      expect(enemyAttackEvents).toHaveLength(1);
    });
  });

  describe('time progression stays decoupled from enemy action count', () => {
    it('hunger/regen/effects update exactly once per player turn even with 0 enemy actions', () => {
      const state = adjacentEnemyState();
      state.enemies[0].alive = false; // 0 enemy actions this turn
      const hungerBefore = getHunger(state);
      processTurn(state, { type: 'wait' });
      // hungerDecreaseProgress advances by exactly 1 (HUNGER_DECREASE_INTERVAL=4), never by an enemy-action-scaled amount.
      expect(state.hungerDecreaseProgress).toBe(1);
      expect(getHunger(state)).toBe(hungerBefore);
    });

    it('hunger/regen/effects update exactly once per player turn even with 1 enemy action', () => {
      const state = adjacentEnemyState();
      processTurn(state, { type: 'wait' });
      expect(state.hungerDecreaseProgress).toBe(1);
    });

    it('hunger/regen/effects update exactly once per player turn even with multiple (simulated) enemy actions', () => {
      const state = adjacentEnemyState();
      state.player.hp = 100_000;
      state.player.maxHp = 100_000;
      state.enemies[0].actionGauge = 250; // forces 3 due actions this pass at rank0
      state.activeEffects = [{ id: 'attack_up', strength: 5, remainingTurns: 5 }];
      processTurn(state, { type: 'wait' });
      expect(state.hungerDecreaseProgress).toBe(1);
      expect(state.activeEffects[0].remainingTurns).toBe(4); // decremented by exactly 1, not 3
    });

    it('poison ticks exactly once regardless of enemy action count this turn', () => {
      const state = adjacentEnemyState();
      state.player.hp = 100_000;
      state.player.maxHp = 100_000;
      state.enemies[0].actionGauge = 250; // forces multiple due actions this pass
      state.activeEffects = [{ id: 'poison', strength: 3, remainingTurns: 5 }];
      state.poisonTickProgress = 1; // Phase 15.2: primed so this turn ticks
      const result = processTurn(state, { type: 'wait' });
      const poisonEvents = result.events.filter((e) => e.type === 'poison_damage');
      expect(poisonEvents).toHaveLength(1);
    });
  });
});
