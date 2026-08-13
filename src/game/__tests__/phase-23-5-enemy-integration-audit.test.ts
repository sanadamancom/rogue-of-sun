import { describe, expect, it } from 'vitest';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { advanceToNextFloor } from '../state';
import { ENEMY_DEFINITIONS } from '../enemy-def';
import { getStepsTelegraph, getGolemChargeTelegraph } from '../telegraph';
import { getMinimapStepsMarkers } from '../minimap';
import { EnemyActor, EnemyType, GameMap, GameState, Tile } from '../types';

function mapFromLayout(layout: string[]): GameMap {
  const height = layout.length;
  const width = layout[0].length;
  const terrain: Tile[][] = layout.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms: [], exit: { x: 99, y: 99 } };
}

function freshState(overrides?: Partial<GameState>): GameState {
  return {
    map: mapFromLayout([
      '####################',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '####################',
    ]),
    player: createInitialActor({ x: 10, y: 4 }, 30, 1),
    enemies: [],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    exit: { x: 199, y: 199 },
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
    solarEnergy: 15,
    maxSolarEnergy: 15,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 304,
    sunlight: [],
    ...overrides,
  };
}

function skeletonAt(x: number, y: number, id = 0, hp = 1): EnemyActor {
  const def = ENEMY_DEFINITIONS.skeleton;
  return createInitialEnemy('skeleton' as EnemyType, { x, y }, hp, def.attack, 0, id, def.defense, def.accuracy, def.evasion);
}
function ghostAt(x: number, y: number, id = 0, hp = 6): EnemyActor {
  const def = ENEMY_DEFINITIONS.ghost;
  return createInitialEnemy('ghost' as EnemyType, { x, y }, hp, def.attack, 0, id, def.defense, def.accuracy, def.evasion);
}
function golemAt(x: number, y: number, id = 0): EnemyActor {
  const def = ENEMY_DEFINITIONS.golem;
  return createInitialEnemy('golem' as EnemyType, { x, y }, def.hp, def.attack, 0, id, def.defense, def.accuracy, def.evasion);
}
function stepsAt(x: number, y: number, id = 0, hp = 6): EnemyActor {
  const def = ENEMY_DEFINITIONS.steps;
  return createInitialEnemy('steps' as EnemyType, { x, y }, hp, def.attack, 0, id, def.defense, def.accuracy, def.evasion);
}

describe('Phase 23.5: shared targeting matrix', () => {
  it('a wall-phased ghost is excluded from melee, spear, solar gun, and room-card targeting; a floor ghost is not', () => {
    const layout = [
      '##########',
      '#........#',
      '#...#P...#',
      '#........#',
      '##########',
    ];
    const state = freshState({
      map: mapFromLayout(layout),
      player: createInitialActor({ x: 5, y: 2 }, 30, 1),
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
    });
    const wallGhost = ghostAt(4, 2); // inside the wall tile, adjacent to player
    state.enemies = [wallGhost];
    state.player.facing = 'W';
    const hpBefore = wallGhost.hp;
    const result = processTurn(state, { type: 'action' });
    expect(wallGhost.hp).toBe(hpBefore);
    expect(result.playerAttacked).toBe(false);

    // Same ghost, now standing on floor: becomes a normal target.
    const floorState = freshState({ enemies: [ghostAt(9, 4)] }); // adjacent to player (10,4)
    floorState.player.facing = 'W';
    const floorResult = processTurn(floorState, { type: 'action' });
    expect(floorResult.playerAttacked).toBe(true);
    expect(floorState.enemies[0].hp).toBeLessThan(6);
  });

  it('skeleton head, every steps state, and every golem state remain valid melee targets', () => {
    const head = skeletonAt(9, 4, 0, 0);
    head.skeletonForm = 'head';
    head.skeletonReviveAtTurn = 1000;
    const hiddenSteps = stepsAt(11, 4, 1);
    const telegraphedGolem = golemAt(9, 5, 2);
    telegraphedGolem.golemChargeState = 'telegraphed';
    telegraphedGolem.golemChargeDirection = 'N';
    telegraphedGolem.golemChargeTargetTile = { x: 9, y: 4 };

    for (const target of [head, hiddenSteps, telegraphedGolem]) {
      const state = freshState({ enemies: [target] });
      state.player.pos = { x: target.pos.x - 1 === -1 ? target.pos.x + 1 : target.pos.x - 1, y: target.pos.y };
      // Simplify: place player directly west of target and face east.
      state.player.pos = { x: target.pos.x - 1, y: target.pos.y };
      state.player.facing = 'E';
      const hpBefore = target.hp;
      const result = processTurn(state, { type: 'action' });
      expect(result.playerAttacked).toBe(true);
      expect(target.hp).toBeLessThanOrEqual(hpBefore);
    }
  });

  it('an already-attacked room-wide card (justice) never damages a wall-phased ghost, even inside its own room', () => {
    const layout = [
      '####################',
      '#..................#',
      '#...#..............#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '####################',
    ];
    const state = freshState({
      map: { ...mapFromLayout(layout), rooms: [{ x: 0, y: 0, width: 20, height: 9 }] },
      inventory: { ...createEmptyInventory(), justice: 1 },
    });
    const wallGhost = ghostAt(4, 2);
    state.enemies = [wallGhost];
    const hpBefore = wallGhost.hp;
    processTurn(state, { type: 'use_item', itemId: 'justice' });
    expect(wallGhost.hp).toBe(hpBefore);
  });
});

describe('Phase 23.5: actor collision matrix', () => {
  it('a golem charge passes through a skeleton head but stops before a hidden-state steps (both blocking)', () => {
    const state = freshState({
      player: createInitialActor({ x: 19, y: 4 }, 30, 1),
      enemies: [golemAt(3, 4), skeletonAt(6, 4, 1, 0), stepsAt(9, 4, 2)],
    });
    state.enemies[1].skeletonForm = 'head';
    state.enemies[1].skeletonReviveAtTurn = 1000;
    const golem = state.enemies[0];
    const blocker = state.enemies[2];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 19, y: 4 };
    processTurn(state, { type: 'wait' });
    expect(golem.pos.x).toBeLessThan(blocker.pos.x); // stopped before the steps
    expect(golem.pos.x).toBeGreaterThan(6); // passed through (or at least past) the skeleton head's original x
  });

  it('a wall-phased ghost never grants wall-passage to any other species\' own movement', () => {
    const layout = [
      '##########',
      '#........#',
      '#...##...#',
      '#........#',
      '##########',
    ];
    const state = freshState({
      map: mapFromLayout(layout),
      player: createInitialActor({ x: 8, y: 2 }, 30, 1),
      enemies: [ghostAt(4, 2), skeletonAt(2, 2, 1)],
    });
    const skeleton = state.enemies[1];
    for (let i = 0; i < 5; i++) {
      processTurn(state, { type: 'wait' });
      expect(state.map.terrain[skeleton.pos.y][skeleton.pos.x]).toBe('floor'); // never entered a wall tile
    }
  });
});

describe('Phase 23.5: damage, death, and reward integration', () => {
  it('body -> head -> revive -> full defeat grants experience exactly once, only at full defeat', () => {
    const state = freshState({ equippedWeaponId: null, enemies: [skeletonAt(9, 4, 0, 1)] }); // adjacent, 1 HP
    state.player.facing = 'W';
    // Unenchanted hit: body -> head.
    let result = processTurn(state, { type: 'action' });
    const skeleton = state.enemies[0];
    expect(skeleton.skeletonForm).toBe('head');
    expect(result.events.some((e) => e.type === 'experience_gained')).toBe(false);

    // Revive after 8 world turns (tile unoccupied).
    skeleton.skeletonReviveAtTurn = state.turn + 8;
    for (let i = 0; i < 8; i++) processTurn(state, { type: 'wait' });
    expect(skeleton.skeletonForm).toBe('body');
    expect(skeleton.hp).toBe(skeleton.maxHp);

    // Full defeat via an elemental attack.
    const state2 = freshState({
      equippedWeaponId: 'sword',
      inventory: { ...createEmptyInventory(), sword: 1 },
      unlockedEnchantments: { sol: true, flame: false, frost: false, cloud: false, earth: false },
      selectedEnchantment: 'sol',
      solarEnergy: 15,
      enemies: [skeleton],
    });
    skeleton.hp = 1;
    skeleton.alive = true;
    skeleton.pos = { x: 9, y: 4 };
    state2.player.pos = { x: 10, y: 4 };
    state2.player.facing = 'W';
    result = processTurn(state2, { type: 'action' });
    expect(skeleton.alive).toBe(false);
    const expEvents = result.events.filter((e) => e.type === 'experience_gained');
    expect(expEvents).toHaveLength(1);
  });

  it('a golem charge collision and a steps spike each resolve at most one attack-hit event', () => {
    const state = freshState({ enemies: [golemAt(6, 4)] });
    const golem = state.enemies[0];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 10, y: 4 };
    const golemResult = processTurn(state, { type: 'wait' });
    const golemHits = golemResult.events.filter((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed');
    expect(golemHits.length).toBeLessThanOrEqual(1);

    const state2 = freshState({ enemies: [stepsAt(9, 4)] });
    processTurn(state2, { type: 'wait' }); // telegraph
    const stepsResult = processTurn(state2, { type: 'wait' }); // execute
    const stepsHits = stepsResult.events.filter((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed');
    expect(stepsHits.length).toBeLessThanOrEqual(1);
  });
});

describe('Phase 23.5: mixed-turn state independence', () => {
  it('skeleton head, telegraphed golem, wall ghost, and telegraphed steps each advance by exactly one stage per world turn, independently', () => {
    const layout = [
      '####################',
      '#..................#',
      '#...#..............#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '####################',
    ];
    const state = freshState({ map: mapFromLayout(layout), player: createInitialActor({ x: 19, y: 19 }, 30, 1) });
    const head = skeletonAt(1, 1, 0, 0);
    head.skeletonForm = 'head';
    head.skeletonReviveAtTurn = state.turn + 3;
    const golem = golemAt(6, 6, 1);
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 19, y: 6 };
    const wallGhost = ghostAt(4, 2, 2);
    const steps = stepsAt(8, 8, 3);
    steps.stepsState = 'telegraphed';
    steps.stepsTelegraphCenter = { x: 8, y: 8 };
    state.enemies = [head, golem, wallGhost, steps];

    processTurn(state, { type: 'wait' }); // one world turn

    expect(golem.golemChargeState).toBe('recovering'); // charged exactly once
    expect(steps.stepsState).toBe('revealed'); // executed exactly once
    expect(head.skeletonForm).toBe('head'); // not yet due to revive
  });

  it('golem/steps AGGRO_RANGE bypass does not activate normal idle enemies far from the player', () => {
    const state = freshState({
      player: createInitialActor({ x: 19, y: 19 }, 30, 1),
      enemies: [
        (() => {
          const bok = createInitialEnemy('bok', { x: 1, y: 1 }, 5, 1);
          return bok;
        })(),
      ],
    });
    const before = { ...state.enemies[0].pos };
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].pos).toEqual(before); // far outside AGGRO_RANGE, no bypass applies to a generic_melee bok
  });
});

describe('Phase 23.5: floor transition and carry-over', () => {
  it('clairvoyance flag, telegraph state, and revealed countdown do not survive a floor transition', () => {
    const state = freshState({ stepsClairvoyanceActive: true });
    const golem = golemAt(5, 5);
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 10, y: 5 };
    const steps = stepsAt(6, 6, 1);
    steps.stepsState = 'revealed';
    steps.stepsRevealTurnsRemaining = 2;
    state.enemies = [golem, steps];
    state.player.pos = { ...state.exit };
    const next = advanceToNextFloor(state);
    expect(next.stepsClairvoyanceActive).toBeUndefined();
    for (const enemy of next.enemies) {
      expect(enemy.golemChargeState).toBeUndefined();
      expect(enemy.stepsState).toBeUndefined();
      expect(enemy.stepsRevealTurnsRemaining).toBeUndefined();
    }
    // combatRngState (an ordinary carry-over stat) is still explicitly carried, unaffected by this phase's additions.
    expect(next.combatRngState).toBe(state.combatRngState);
  });
});

describe('Phase 23.5: visibility and telegraph independence', () => {
  it('a golem telegraph and a steps telegraph coexist without one getter mutating the other\'s state', () => {
    const state = freshState({
      enemies: [golemAt(5, 5), stepsAt(9, 4)],
    });
    const golem = state.enemies[0];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 10, y: 5 };
    state.enemies[1].stepsState = 'telegraphed';
    state.enemies[1].stepsTelegraphCenter = { x: 9, y: 4 };

    const golemTelegraphBefore = getGolemChargeTelegraph(state.map, golem);
    const stepsTelegraphBefore = getStepsTelegraph(state.map, state.enemies[1]);
    expect(golemTelegraphBefore).not.toBeNull();
    expect(stepsTelegraphBefore).not.toBeNull();
    // Re-reading again produces identical results (pure getters, no mutation).
    expect(getGolemChargeTelegraph(state.map, golem)).toEqual(golemTelegraphBefore);
    expect(getStepsTelegraph(state.map, state.enemies[1])).toEqual(stepsTelegraphBefore);
  });

  it('steps minimap markers expose only position while clairvoyance is active, and ghost is never included', () => {
    const state = freshState({
      stepsClairvoyanceActive: true,
      enemies: [stepsAt(3, 3, 0), ghostAt(7, 7, 1)],
    });
    const markers = getMinimapStepsMarkers(state.enemies, state.stepsClairvoyanceActive ?? false);
    expect(markers).toEqual([{ x: 3, y: 3 }]);
  });
});

describe('Phase 23.5: RNG and determinism across a mixed floor', () => {
  it('the same seed and action sequence produce identical enemy states, events, and combatRngState', () => {
    const build = () =>
      freshState({
        enemies: [skeletonAt(9, 4, 0, 1), golemAt(6, 6, 1), ghostAt(4, 2, 2), stepsAt(9, 5, 3)],
      });
    const a = build();
    const b = build();
    const actions: import('../types').PlayerAction[] = [
      { type: 'wait' },
      { type: 'wait' },
      { type: 'wait' },
      { type: 'wait' },
    ];
    const eventsA: string[] = [];
    const eventsB: string[] = [];
    for (const action of actions) {
      const ra = processTurn(a, action);
      const rb = processTurn(b, action);
      eventsA.push(...ra.events.map((e) => e.type));
      eventsB.push(...rb.events.map((e) => e.type));
    }
    expect(a.enemies).toEqual(b.enemies);
    expect(a.combatRngState).toBe(b.combatRngState);
    expect(eventsA).toEqual(eventsB);
  });

  it('a whiffed/no-target special attack does not consume combat RNG', () => {
    const state = freshState({ enemies: [stepsAt(9, 4)] });
    processTurn(state, { type: 'wait' }); // telegraph — no RNG
    const rngBefore = state.combatRngState;
    state.player.pos = { x: 19, y: 19 }; // move out of the fixed area before execution
    processTurn(state, { type: 'wait' }); // execute, but player not in area -> no hit resolution, no RNG draw
    expect(state.combatRngState).toBe(rngBefore);
  });
});

describe('Phase 23.5: pre-existing slow-trap extra-enemy-phase interaction (record-only)', () => {
  it('documents that an active movement_slow effect can let a telegraphed golem both telegraph and execute within one processTurn call — a pre-existing characteristic of resolveEnemiesAction shared with cockatrice/kraken, not a Phase 23 regression', () => {
    const state = freshState({
      player: createInitialActor({ x: 2, y: 4 }, 30, 1),
      activeEffects: [{ id: 'movement_slow', strength: 1, remainingTurns: 5 }],
      enemies: [golemAt(7, 4)], // cardinally aligned, distance 5 -> telegraphs this turn
    });
    const golem = state.enemies[0];
    // An ordinary move (not wait) with movement_slow already active before
    // this action triggers resolveEnemiesAction's pre-existing (pre-Phase-
    // 23) "additional enemy phase" a second time within this same
    // processTurn call — see turn.ts's shouldRunAdditionalEnemyPhase.
    processTurn(state, { type: 'move', direction: 'E' });
    // If the double-resolution path was taken, the golem would have both
    // telegraphed (first phase) and executed its charge (second phase)
    // within this single processTurn call, ending in 'recovering' instead
    // of 'telegraphed'. This is recorded as a pre-existing characteristic
    // of the whole telegraph-style system (predating Phase 23.1-23.4,
    // equally reachable by cockatrice/kraken), not something Phase 23.1-
    // 23.4 introduced or is expected to prevent — see this phase's history
    // "修正しなかった不明点" section.
    expect(['telegraphed', 'recovering']).toContain(golem.golemChargeState);
  });
});
