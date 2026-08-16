import { describe, expect, it } from 'vitest';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { EnemyType, GameMap, GameState, Tile } from '../types';
import { ENEMY_DEFINITIONS } from '../enemy-def';
import { createEmptyInventory } from '../item-def';
import { DEFAULT_RUN_CONFIG } from '../floor';

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
    // Phase 16.2: regen now fires the same turn, fully offsetting bok's 1 damage.
    expect(state.player.hp).toBe(hpBefore);
    expect(enemy.pos).toEqual({ x: 9, y: 4 }); // did not step in
  });

  it('never attacks more than once in a single world turn', () => {
    const state = singleEnemyState('bok', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 1 });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    // Phase 16.2: regen now fires the same turn, fully offsetting bok's 1 damage.
    expect(hpBefore - state.player.hp).toBe(0); // one hit's worth of damage, offset by regen
  });
});

describe('golem (golem_charge) behavior (Phase 23.2, replacing slow_melee)', () => {
  it('acts on the first enemy turn after being created, attacking immediately if already adjacent', () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3, turn: 0 });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    // Phase 16.2: regen now fires the same turn, offsetting 1 of the 3 damage.
    expect(state.player.hp).toBe(hpBefore - 2); // acted: attacked
  });

  it('rests (no movement, no attack) on the turn immediately after attacking, even if still adjacent', () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3, turn: 0 });
    processTurn(state, { type: 'wait' }); // attacks, enters 'recovering'
    const hpBefore = state.player.hp;
    const before = { ...state.enemies[0].pos };
    processTurn(state, { type: 'wait' }); // rests
    // Phase 16.2: natural regen still fires this turn since the golem
    // doesn't attack, offsetting the lack of golem damage with +1 HP.
    expect(state.player.hp).toBe(hpBefore + 1);
    expect(state.enemies[0].pos).toEqual(before); // did not move
    expect(state.enemies[0].golemChargeState).toBe('idle'); // reverted for the *next* turn
  });

  it('resumes normal idle behavior (attacking again) two turns after its first attack', () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3, turn: 0 });
    processTurn(state, { type: 'wait' }); // attacks
    processTurn(state, { type: 'wait' }); // rests
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' }); // attacks again
    expect(state.player.hp).toBe(hpBefore - 2);
  });

  it('takes one ordinary chase step when not adjacent and not cardinally aligned within range, then rests', () => {
    const state = singleEnemyState('golem', { x: 2, y: 3 }, { playerPos: { x: 10, y: 4 }, turn: 0 }); // not aligned (dx=8, dy=1)
    const enemy = state.enemies[0];
    const before = { ...enemy.pos };
    processTurn(state, { type: 'wait' });
    expect(enemy.pos).not.toEqual(before); // took a chase step
    expect(enemy.golemChargeState).toBe('recovering');
  });

  it('resets to an acting first turn again after being freshly (re)created, e.g. on a floor restart', () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      attack: 3,
      turn: 5,
      spawnTurn: 5,
    });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    // A freshly created golem (no golemChargeState set) always starts
    // idle, regardless of spawnTurn/turn — Phase 23.2 no longer keys
    // its cycle off spawnTurn at all (only golemChargeState matters).
    expect(state.player.hp).toBe(hpBefore - 2); // acted, attacked
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
    // Phase 16.2: regen now fires the same turn (hp was below max going
    // in), offsetting 1 of the 2 damage.
    expect(state.player.hp).toBe(hpBefore - 1); // attacked
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
    // Phase 16.2: regen now fires the same turn, offsetting 1 of the 2 damage.
    expect(state.player.hp).toBe(hpBefore - 1);
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
    // Phase 16.2: regen now fires the same turn, offsetting 1 of the 3 damage.
    expect(state.player.hp).toBe(hpBefore - 2);
    expect(enemy.recovering).toBe(true);
  });

  it('is forced to wait (no attack) on the enemy turn immediately following an attack, even while still adjacent', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3 });
    const enemy = state.enemies[0];
    processTurn(state, { type: 'wait' }); // turn 1: attacks, sets recovering
    const hpAfterAttack = state.player.hp;
    const posAfterAttack = { ...enemy.pos };
    processTurn(state, { type: 'wait' }); // turn 2: forced wait
    // Phase 16.2: the axe doesn't attack this turn, but natural regen
    // still fires (hp remains below max), so HP goes up by 1 even
    // without a new hit.
    expect(state.player.hp).toBe(hpAfterAttack + 1); // no additional damage, but regen ticks
    expect(enemy.pos).toEqual(posAfterAttack); // did not move either
    expect(enemy.recovering).toBe(false); // cleared after the forced wait
  });

  it('returns to normal behavior (can attack again) the turn after recovering', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, { playerPos: { x: 10, y: 4 }, attack: 3 });
    processTurn(state, { type: 'wait' }); // attacks
    processTurn(state, { type: 'wait' }); // forced wait
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' }); // normal again: attacks
    // Phase 16.2: regen now fires the same turn, offsetting 1 of the 3 damage.
    expect(state.player.hp).toBe(hpBefore - 2);
  });
});

describe('axe recovery exploitability at real definition values (phase-07-3-axe-recovery-tune)', () => {
  it('has an implemented attack value of 12 (Phase 15.1 rebalance)', () => {
    expect(ENEMY_DEFINITIONS.axe.attack).toBe(12);
  });

  it('a full-HP (30) player survives a single axe hit at real values, landing on HP18 (Phase 15.1 rebalance; unarmored so incoming damage equals attack)', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      attack: ENEMY_DEFINITIONS.axe.attack,
    });
    state.player.hp = 30;
    state.player.maxHp = 30;
    const enemy = state.enemies[0];
    processTurn(state, { type: 'wait' }); // attacks
    // Phase 16.2: regen now fires the same turn (30-12=18, then +1), landing on 19 instead of 18.
    expect(state.player.hp).toBe(19);
    expect(state.player.alive).toBe(true);
    expect(enemy.recovering).toBe(true);
  });

  it('the axe is forced to wait (no attack, no move) on its next turn, even while still adjacent, letting a surviving player act freely', () => {
    const state = singleEnemyState('axe', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      attack: ENEMY_DEFINITIONS.axe.attack,
    });
    state.player.hp = 30;
    state.player.maxHp = 30;
    const enemy = state.enemies[0];
    processTurn(state, { type: 'wait' }); // turn 1: attacks, HP 30 -> 18
    const hpAfterAttack = state.player.hp;
    const posAfterAttack = { ...enemy.pos };
    processTurn(state, { type: 'wait' }); // turn 2: forced wait (enemy_recovering)
    // Phase 16.2: no attack this turn, but natural regen still fires
    // (hp remains below max), so HP goes up by 1 anyway.
    expect(state.player.hp).toBe(hpAfterAttack + 1); // no additional damage, but regen ticks
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

describe('golem HP boundary at real definition values (phase-07-5-golem-hp-tune, Phase 10.2 rescaled)', () => {
  it('has an implemented HP of 10 (Phase 15.1 rebalance)', () => {
    expect(ENEMY_DEFINITIONS.golem.hp).toBe(10);
  });

  it('has an implemented attack value of 12 (Phase 15.1 rebalance; unchanged by the HP tune)', () => {
    expect(ENEMY_DEFINITIONS.golem.attack).toBe(12);
  });

  it("survives 9 hits from the player's normal attack (attack 1, golem defense 1 floors each hit at 1)", () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      hp: ENEMY_DEFINITIONS.golem.hp,
      attack: ENEMY_DEFINITIONS.golem.attack,
    });
    const enemy = state.enemies[0];
    // This fixture's golem carries its real Phase 15.1 attack value (12),
    // which can exceed the player's default synthetic HP (20) in a single
    // unarmored hit. Since this test's actual focus is the golem's HP
    // boundary (not player survivability), give the player generous HP
    // headroom purely so an incidental golem counter-attack over the
    // course of 9 player actions can never end the run early.
    state.player.hp = 100000;
    state.player.maxHp = 100000;
    // Phase 10.3 accuracy/evasion foundation: hitChance here is 90 (player
    // accuracy 90 + unarmed mod 0 - golem evasion 0); force a combat RNG
    // seed verified safe for many consecutive sub-90 rolls so this loop's
    // exact hit-count assertions stay deterministic.
    state.combatRngState = 22;
    expect(state.player.attack).toBe(1); // confirms the player's normal-attack baseline used below
    state.player.facing = 'W';
    // Attacking every turn via the X action: golem only occupies the
    // adjacent tile, so this resolves as a player attack regardless of
    // the golem's own act/rest phase. This fixture's golem carries the
    // real (nonzero) defense 1, so each unarmed hit still deals exactly 1
    // (computeAttackDamage's minimum, since player.attack(1) - golem
    // defense(1) = 0, floored to 1) — the hit count needed to reach the
    // Phase 15.1 HP (10) is therefore 10, not 40.
    for (let i = 0; i < 9; i++) {
      processTurn(state, { type: 'action' });
    }
    expect(enemy.hp).toBe(1);
    expect(enemy.alive).toBe(true);
  });

  it("is defeated on the 10th hit from the player's normal attack (attack 1)", () => {
    const state = singleEnemyState('golem', { x: 9, y: 4 }, {
      playerPos: { x: 10, y: 4 },
      hp: ENEMY_DEFINITIONS.golem.hp,
      attack: ENEMY_DEFINITIONS.golem.attack,
    });
    const enemy = state.enemies[0];
    // See the identical note in the previous test: generous player HP
    // headroom, since this test's real focus is the golem's HP boundary.
    state.player.hp = 100000;
    state.player.maxHp = 100000;
    state.combatRngState = 22; // see the identical note in the previous test
    state.player.facing = 'W';
    for (let i = 0; i < 9; i++) {
      processTurn(state, { type: 'action' });
    }
    const result = processTurn(state, { type: 'action' }); // hit 10
    expect(enemy.hp).toBe(0);
    expect(enemy.alive).toBe(false);
    expect(result.events).toContainEqual({ type: 'enemy_defeated', enemyType: 'golem', targetId: 0 });
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
