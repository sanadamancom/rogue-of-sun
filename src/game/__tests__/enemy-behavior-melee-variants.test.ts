import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { EnemyType, GameMap, GameState, Tile } from '../types';
import { ENEMY_DEFINITIONS } from '../enemy-def';

// Open layout with a long straight corridor (row 5) for sword's 2-step
// approach tests, plus a small walled pocket for "does not jump over
// walls" checks. Retained only for these behavior-variant unit tests;
// production maps come from mapgen.ts.
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
  const terrain: Tile[][] = TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

/**
 * Builds a minimal test-only GameState with exactly one enemy of `type`,
 * explicitly placed at `enemyPos` (player fixed at (10, 4) unless
 * overridden), instead of relying on createInitialState's seeded species
 * RNG or hunting for a seed that happens to roll the desired species
 * (enemy-behavior-01-melee-variants task requirement). `turn` lets tests
 * control golem's act/wait phase directly, since golem's phase is
 * `(state.turn - enemy.spawnTurn) % 2` and spawnTurn is fixed at 0 here.
 */
function singleEnemyState(
  type: EnemyType,
  enemyPos: { x: number; y: number },
  options?: {
    playerPos?: { x: number; y: number };
    hp?: number;
    attack?: number;
    turn?: number;
    spawnTurn?: number;
  },
): GameState {
  const playerPos = options?.playerPos ?? { x: 10, y: 4 };
  const hp = options?.hp ?? 10;
  const attack = options?.attack ?? 1;
  const turn = options?.turn ?? 0;
  const spawnTurn = options?.spawnTurn ?? 0;
  return {
    map: testMap(),
    player: createInitialActor(playerPos, 20, 1),
    enemies: [createInitialEnemy(type, enemyPos, hp, attack, spawnTurn)],
    turn,
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
    inventory: { apple: 0, sword: 0 },
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: null,
  };
}

describe('bok (generic_melee) behavior', () => {
  it('approaches by exactly 1 tile per world turn when not adjacent', () => {
    const state = singleEnemyState('bok', { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 } });
    const enemy = state.enemies[0];
    const before = { ...enemy.pos };
    processTurn(state, { type: 'wait' });
    const dx = Math.abs(enemy.pos.x - before.x);
    const dy = Math.abs(enemy.pos.y - before.y);
    expect(dx + dy).toBe(1);
  });

  it('attacks (attack 1) when orthogonally adjacent to the player', () => {
    const state = singleEnemyState('bok', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 1 });
    const enemy = state.enemies[0];
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore - 1);
    expect(enemy.pos).toEqual({ x: 9, y: 4 }); // did not step in
  });

  it('never attacks more than once in a single world turn', () => {
    const state = singleEnemyState('bok', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 1 });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(hpBefore - state.player.hp).toBe(1); // exactly one hit's worth of damage
  });
});

describe('golem (slow_melee) behavior', () => {
  it('acts on the first enemy turn after being created (phase 0)', () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3, turn: 0 });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore - 3); // acted: attacked
  });

  it('waits (no movement) on the next enemy turn', () => {
    const state = singleEnemyState('golem', { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 }, turn: 1 });
    const enemy = state.enemies[0];
    const before = { ...enemy.pos };
    processTurn(state, { type: 'wait' });
    expect(enemy.pos).toEqual(before);
  });

  it('does not attack on a resting turn even when adjacent to the player', () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3, turn: 1 });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore); // not attacked
  });

  it('alternates act/wait/act/wait over consecutive world turns', () => {
    const state = singleEnemyState('golem', { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 }, turn: 0 });
    const enemy = state.enemies[0];
    const positions: { x: number; y: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const before = { ...enemy.pos };
      processTurn(state, { type: 'wait' });
      positions.push({ ...enemy.pos });
      const moved = enemy.pos.x !== before.x || enemy.pos.y !== before.y;
      // Even iterations (0, 2, ...) are acting turns (moved); odd are rest (did not move).
      expect(moved).toBe(i % 2 === 0);
    }
  });

  it('resets to an acting first turn again after being freshly (re)created, e.g. on a floor restart', () => {
    // A fresh createInitialEnemy call always gets spawnTurn = the turn
    // passed in, so its very next resolution (at that same turn value) is
    // always phase 0, regardless of how the previous instance's phase had
    // drifted.
    const state = singleEnemyState('golem', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      attack: 3,
      turn: 5,
      spawnTurn: 5,
    });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore - 3); // acted, because spawnTurn (5) matches turn (5)
  });
});

describe('sword (fast_melee) behavior', () => {
  it('closes 2 tiles in one world turn along a clear straight corridor', () => {
    const state = singleEnemyState('sword', { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 } });
    const enemy = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(enemy.pos).toEqual({ x: 4, y: 4 });
  });

  it('attacks and stops after step 1 if that step makes it adjacent (no step 2)', () => {
    const state = singleEnemyState('sword', { x: 8, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 2 });
    const enemy = state.enemies[0];
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(enemy.pos).toEqual({ x: 9, y: 4 }); // only 1 step taken
    expect(state.player.hp).toBe(hpBefore - 2); // attacked
  });

  it('does not attack that turn if it only becomes adjacent after step 2', () => {
    const state = singleEnemyState('sword', { x: 7, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 2 });
    const enemy = state.enemies[0];
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(enemy.pos).toEqual({ x: 9, y: 4 }); // moved 2 steps, now adjacent
    expect(state.player.hp).toBe(hpBefore); // but no attack this turn
  });

  it('attacks immediately without moving if already adjacent at the start of its turn', () => {
    const state = singleEnemyState('sword', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 2 });
    const enemy = state.enemies[0];
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(enemy.pos).toEqual({ x: 9, y: 4 });
    expect(state.player.hp).toBe(hpBefore - 2);
  });

  it('never attacks more than once in a single world turn', () => {
    const state = singleEnemyState('sword', { x: 8, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 2 });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(hpBefore - state.player.hp).toBeLessThanOrEqual(2); // at most 1 hit's worth
  });

  it('does not jump over a wall blocking its second step', () => {
    const map = testMap();
    map.terrain[4][9] = 'wall'; // wall directly between enemy and player's approach path
    const state = singleEnemyState('sword', { x: 7, y: 4 }, { playerPos: { x: 10, y: 4 } });
    state.map = map;
    const enemy = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(state.map.terrain[enemy.pos.y][enemy.pos.x]).toBe('floor');
    expect(enemy.pos).not.toEqual({ x: 9, y: 4 });
  });

  it('does not jump over another actor blocking its path', () => {
    const state = singleEnemyState('sword', { x: 7, y: 4 }, { playerPos: { x: 10, y: 4 } });
    const blocker = createInitialEnemy('bok', { x: 8, y: 4 }, 2, 1, 0);
    state.enemies.push(blocker);
    const sword = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(sword.pos).not.toEqual(blocker.pos);
    // With (8,4) occupied, sword cannot step directly east; it should not
    // have advanced 2 tiles east onto or past the blocker.
    expect(sword.pos.x).toBeLessThan(8);
  });
});

describe('axe (recovery_melee) behavior', () => {
  it('approaches by 1 tile per turn when not adjacent', () => {
    const state = singleEnemyState('axe', { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 } });
    const enemy = state.enemies[0];
    const before = { ...enemy.pos };
    processTurn(state, { type: 'wait' });
    const dx = Math.abs(enemy.pos.x - before.x);
    const dy = Math.abs(enemy.pos.y - before.y);
    expect(dx + dy).toBe(1);
    expect(enemy.recovering).toBe(false); // moving alone never triggers recovery
  });

  it('attacks (attack 3) when adjacent', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3 });
    const enemy = state.enemies[0];
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore - 3);
    expect(enemy.recovering).toBe(true);
  });

  it('is forced to wait (no attack) on the enemy turn immediately following an attack, even while still adjacent', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3 });
    const enemy = state.enemies[0];
    processTurn(state, { type: 'wait' }); // turn 1: attacks, sets recovering
    const hpAfterAttack = state.player.hp;
    const posAfterAttack = { ...enemy.pos };
    processTurn(state, { type: 'wait' }); // turn 2: forced wait
    expect(state.player.hp).toBe(hpAfterAttack); // no additional damage
    expect(enemy.pos).toEqual(posAfterAttack); // did not move either
    expect(enemy.recovering).toBe(false); // cleared after the forced wait
  });

  it('returns to normal behavior (can attack again) the turn after recovering', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3 });
    processTurn(state, { type: 'wait' }); // attacks
    processTurn(state, { type: 'wait' }); // forced wait
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' }); // normal again: attacks
    expect(state.player.hp).toBe(hpBefore - 3);
  });
});

describe('axe recovery exploitability at real definition values (phase-07-3-axe-recovery-tune)', () => {
  it('has an implemented attack value of 2', () => {
    expect(ENEMY_DEFINITIONS.axe.attack).toBe(2);
  });

  it('a full-HP (3) player survives a single axe hit at real values, landing on HP1', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      attack: ENEMY_DEFINITIONS.axe.attack,
    });
    state.player.hp = 3;
    state.player.maxHp = 3;
    const enemy = state.enemies[0];
    processTurn(state, { type: 'wait' }); // attacks
    expect(state.player.hp).toBe(1);
    expect(state.player.alive).toBe(true);
    expect(enemy.recovering).toBe(true);
  });

  it('the axe is forced to wait (no attack, no move) on its next turn, even while still adjacent, letting a surviving player act freely', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      attack: ENEMY_DEFINITIONS.axe.attack,
    });
    state.player.hp = 3;
    state.player.maxHp = 3;
    const enemy = state.enemies[0];
    processTurn(state, { type: 'wait' }); // turn 1: attacks, HP 3 -> 1
    const hpAfterAttack = state.player.hp;
    const posAfterAttack = { ...enemy.pos };
    processTurn(state, { type: 'wait' }); // turn 2: forced wait (enemy_recovering)
    expect(state.player.hp).toBe(hpAfterAttack); // no additional damage
    expect(enemy.pos).toEqual(posAfterAttack); // did not move
    expect(enemy.recovering).toBe(false); // cleared after the forced wait
  });

  it('a player already at HP2 still dies to a single axe hit at real values', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      attack: ENEMY_DEFINITIONS.axe.attack,
    });
    state.player.hp = 2;
    state.player.maxHp = 3;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(0);
    expect(state.player.alive).toBe(false);
  });
});

describe('golem HP boundary at real definition values (phase-07-5-golem-hp-tune)', () => {
  it('has an implemented HP of 4', () => {
    expect(ENEMY_DEFINITIONS.golem.hp).toBe(4);
  });

  it('has an implemented attack value of 3 (unchanged by the HP tune)', () => {
    expect(ENEMY_DEFINITIONS.golem.attack).toBe(3);
  });

  it('survives 3 hits from the player\'s normal attack (attack 1)', () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      hp: ENEMY_DEFINITIONS.golem.hp,
      attack: ENEMY_DEFINITIONS.golem.attack,
    });
    const enemy = state.enemies[0];
    expect(state.player.attack).toBe(1); // confirms the player's normal-attack baseline used below
    // Attacking every turn: golem only occupies the adjacent tile, so a
    // move toward it resolves as a player attack regardless of the
    // golem's own act/rest phase.
    processTurn(state, { type: 'move', direction: 'W' }); // hit 1
    processTurn(state, { type: 'move', direction: 'W' }); // hit 2
    processTurn(state, { type: 'move', direction: 'W' }); // hit 3
    expect(enemy.hp).toBe(1);
    expect(enemy.alive).toBe(true);
  });

  it('is defeated on the 4th hit from the player\'s normal attack (attack 1)', () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      hp: ENEMY_DEFINITIONS.golem.hp,
      attack: ENEMY_DEFINITIONS.golem.attack,
    });
    const enemy = state.enemies[0];
    processTurn(state, { type: 'move', direction: 'W' }); // hit 1
    processTurn(state, { type: 'move', direction: 'W' }); // hit 2
    processTurn(state, { type: 'move', direction: 'W' }); // hit 3
    const result = processTurn(state, { type: 'move', direction: 'W' }); // hit 4
    expect(enemy.hp).toBe(0);
    expect(enemy.alive).toBe(false);
    expect(result.events).toContainEqual({ type: 'enemy_defeated', enemyType: 'golem' });
  });
});

describe('shared melee-variant constraints', () => {
  it('none of the 4 variants ever step onto a wall or out of bounds', () => {
    for (const type of ['bok', 'golem', 'sword', 'axe'] as const) {
      const state = singleEnemyState(type, { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 } });
      const enemy = state.enemies[0];
      for (let i = 0; i < 6; i++) {
        processTurn(state, { type: 'wait' });
        expect(state.map.terrain[enemy.pos.y][enemy.pos.x]).toBe('floor');
      }
    }
  });

  it('is deterministic: identical starting state and input sequence produce identical results', () => {
    for (const type of ['bok', 'golem', 'sword', 'axe'] as const) {
      const stateA = singleEnemyState(type, { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 } });
      const stateB = singleEnemyState(type, { x: 2, y: 4 }, { playerPos: { x: 10, y: 4 } });
      for (let i = 0; i < 5; i++) {
        processTurn(stateA, { type: 'wait' });
        processTurn(stateB, { type: 'wait' });
      }
      expect(stateA.enemies).toEqual(stateB.enemies);
      expect(stateA.player).toEqual(stateB.player);
    }
  });

  it('stops later enemies from acting once the player is defeated mid-turn', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3 });
    state.player.hp = 1;
    const golem = createInitialEnemy('golem', { x: 11, y: 4 }, 8, 3, 0); // also adjacent, would attack if it got a turn
    state.enemies.push(golem);
    const golemFacingBefore = golem.facing;
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('gameover');
    expect(golem.facing).toBe(golemFacingBefore); // never got to act
  });
});
