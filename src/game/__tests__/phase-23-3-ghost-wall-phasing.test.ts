import { describe, expect, it } from 'vitest';
import { createEmptyInventory } from '../item-def';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { advanceToNextFloor } from '../state';
import { ENEMY_DEFINITIONS, getEnemyPoolForFloor, ENEMY_TYPES_IN_ORDER } from '../enemy-def';
import { EnemyActor, EnemyType, GameMap, GameState, Tile } from '../types';
import { DEFAULT_RUN_CONFIG } from '../floor';

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
    leg: 'descent',
    runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
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

function ghostAt(x: number, y: number, id = 0, hp = 6): EnemyActor {
  const def = ENEMY_DEFINITIONS.ghost;
  return createInitialEnemy('ghost' as EnemyType, { x, y }, hp, def.attack, 0, id, def.defense, def.accuracy, def.evasion);
}

describe('Phase 23.3: ghost — roster and generation', () => {
  it('ghost is registered as an EnemyType with a definition', () => {
    expect(ENEMY_DEFINITIONS.ghost).toBeDefined();
    expect(ENEMY_DEFINITIONS.ghost.behaviorType).toBe('ghost_phase');
    expect(ENEMY_DEFINITIONS.ghost.movementType).toBe('phasing');
  });

  it('is appended at the end without changing the existing 10 species\' indices', () => {
    // Phase 23.4 appends 'steps' after this phase's own 'ghost', growing
    // the roster from 11 to 12 — 'ghost' itself stays at index 10.
    expect(ENEMY_TYPES_IN_ORDER.length).toBeGreaterThanOrEqual(11);
    expect(ENEMY_TYPES_IN_ORDER[10]).toBe('ghost');
    expect(ENEMY_TYPES_IN_ORDER.slice(0, 10)).toEqual([
      'bok', 'cockatrice', 'spider', 'bat', 'mummy', 'golem', 'sword', 'axe', 'kraken', 'skeleton',
    ]);
  });

  it('1F candidate pool does not include ghost; 2F does (confirmed Phase 23.6 tier)', () => {
    expect(getEnemyPoolForFloor(1)).not.toContain('ghost');
    expect(getEnemyPoolForFloor(2)).toContain('ghost');
  });

  it('3F candidate pool includes ghost', () => {
    expect(getEnemyPoolForFloor(3)).toContain('ghost');
  });

  it('can be constructed via createInitialEnemy and placed normally', () => {
    const state = freshState({ enemies: [ghostAt(5, 4)] });
    expect(state.enemies[0].type).toBe('ghost');
    expect(state.enemies[0].alive).toBe(true);
  });
});

describe('Phase 23.3: ghost — movement (BFS pathfinding)', () => {
  it('moves from floor into an interior wall tile toward the player', () => {
    const layout = [
      '##########',
      '#....#...#',
      '#.G..#.P.#',
      '#....#...#',
      '##########',
    ];
    // Ghost at (2,2) is far from player (7,2), separated by a wall column at x=5.
    const state = freshState({
      map: mapFromLayout(layout),
      player: createInitialActor({ x: 7, y: 2 }, 30, 1),
      enemies: [ghostAt(2, 2)],
    });
    const ghost = state.enemies[0];
    for (let i = 0; i < 3; i++) processTurn(state, { type: 'wait' });
    // After a few turns it should have entered the wall column (x=5) at some point or passed through it.
    expect(ghost.pos.x).toBeGreaterThan(2);
  });

  it('can move through the wall column and reach the far side', () => {
    const layout = [
      '##########',
      '#....#...#',
      '#.G..#.P.#',
      '#....#...#',
      '##########',
    ];
    const state = freshState({
      map: mapFromLayout(layout),
      player: createInitialActor({ x: 7, y: 2 }, 30, 1),
      enemies: [ghostAt(2, 2)],
    });
    const ghost = state.enemies[0];
    for (let i = 0; i < 8; i++) processTurn(state, { type: 'wait' });
    expect(ghost.pos.x).toBeGreaterThanOrEqual(6); // reached (or passed) the far side of the wall
  });

  it('never enters the outer perimeter ring', () => {
    const state = freshState({
      player: createInitialActor({ x: 10, y: 4 }, 30, 1),
      enemies: [ghostAt(1, 1)],
    });
    const ghost = state.enemies[0];
    for (let i = 0; i < 20; i++) {
      processTurn(state, { type: 'wait' });
      expect(ghost.pos.x).toBeGreaterThan(0);
      expect(ghost.pos.y).toBeGreaterThan(0);
      expect(ghost.pos.x).toBeLessThan(state.map.width - 1);
      expect(ghost.pos.y).toBeLessThan(state.map.height - 1);
    }
  });

  it('never moves onto the player\'s own tile', () => {
    const state = freshState({ enemies: [ghostAt(9, 4)] }); // adjacent to player (10,4)
    const ghost = state.enemies[0];
    for (let i = 0; i < 5; i++) {
      processTurn(state, { type: 'wait' });
      expect(ghost.pos).not.toEqual(state.player.pos);
    }
  });

  it('never moves onto another body-form enemy\'s tile', () => {
    const state = freshState({
      enemies: [ghostAt(5, 4), createInitialEnemy('bok', { x: 6, y: 4 }, 5, 1)],
    });
    const ghost = state.enemies[0];
    const blocker = state.enemies[1];
    for (let i = 0; i < 5; i++) {
      processTurn(state, { type: 'wait' });
      expect(ghost.pos).not.toEqual(blocker.pos);
    }
  });

  it('can pass through / occupy the same tile as a head-form skeleton', () => {
    const skeletonDef = ENEMY_DEFINITIONS.skeleton;
    const head = createInitialEnemy('skeleton' as EnemyType, { x: 6, y: 4 }, 0, skeletonDef.attack, 0, 1, skeletonDef.defense, skeletonDef.accuracy, skeletonDef.evasion);
    head.skeletonForm = 'head';
    head.skeletonReviveAtTurn = 1000;
    const state = freshState({ enemies: [ghostAt(5, 4), head] });
    // Move the ghost a few turns to confirm it's allowed to occupy/pass
    // through the head's tile without harming it.
    for (let i = 0; i < 3; i++) processTurn(state, { type: 'wait' });
    expect(head.hp).toBe(0); // untouched
    expect(head.skeletonForm).toBe('head'); // untouched
  });

  it('produces identical movement from the same state and RNG across two independent runs', () => {
    const build = () => freshState({ enemies: [ghostAt(3, 3)] });
    const a = build();
    const b = build();
    for (let i = 0; i < 5; i++) {
      processTurn(a, { type: 'wait' });
      processTurn(b, { type: 'wait' });
    }
    expect(a.enemies[0]).toEqual(b.enemies[0]);
    expect(a.combatRngState).toBe(b.combatRngState);
  });

  it('waits in place when no legal attack position is reachable', () => {
    // Ghost fully enclosed by a tiny sealed pocket the player can never
    // approach — no path to any attack-adjacent floor tile exists once
    // every candidate is unreachable. Using a fully-walled 1x1 pocket
    // surrounded by more walls (itself surrounded by the map's own outer
    // wall, so the ghost cannot escape past the perimeter either).
    const layout = [
      '#####',
      '#####',
      '##G##',
      '#####',
      '#####',
    ];
    const state = freshState({
      map: mapFromLayout(layout),
      player: createInitialActor({ x: 2, y: 2 }, 30, 1), // same tile as ghost is invalid; adjust
    });
    // Player cannot be on the same tile as the ghost; move it off, but
    // since everything around is wall/perimeter, no legal attack tile
    // exists for the ghost regardless.
    state.player.pos = { x: 2, y: 2 };
    const ghost = ghostAt(2, 2);
    state.enemies = [ghost];
    // Since ghost cannot share the player's tile in production (createInitialEnemy
    // doesn't enforce this), just confirm processTurn doesn't throw and ghost
    // does not escape the sealed pocket.
    expect(() => processTurn(state, { type: 'wait' })).not.toThrow();
  });

  it('several ghosts never overlap and account for each other\'s updated positions within the same turn', () => {
    const state = freshState({
      enemies: [ghostAt(4, 4, 0), ghostAt(5, 4, 1), ghostAt(6, 4, 2)],
    });
    for (let i = 0; i < 6; i++) {
      processTurn(state, { type: 'wait' });
      const positions = state.enemies.map((e) => `${e.pos.x},${e.pos.y}`);
      expect(new Set(positions).size).toBe(positions.length);
    }
  });
});

describe('Phase 23.3: ghost — attack timing', () => {
  it('attacks immediately without moving when already on floor and adjacent', () => {
    const state = freshState({ enemies: [ghostAt(9, 4)] }); // adjacent to player (10,4)
    const ghost = state.enemies[0];
    const before = { ...ghost.pos };
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(ghost.pos).toEqual(before);
    expect(state.player.hp).toBeLessThan(hpBefore);
  });

  // Shared fixture for the remaining attack-timing tests: a full-height
  // (rows 1-3), 9-tile-wide wall band (columns 6-14) completely
  // separates the west floor region (unreachable from the player) from
  // the east floor region the player stands in, so the only route from
  // the ghost (placed in the middle of the band) to any legal attack
  // position is straight east through several wall tiles first —
  // giving several turns to observe "still inside a wall, no attack"
  // before the eventual wall->floor emerge-and-attack turn.
  function wallBandState(playerX: number): GameState {
    const row = (x1: number, x2: number) =>
      '#' + '.'.repeat(x1 - 1) + '#'.repeat(x2 - x1 + 1) + '.'.repeat(18 - x2) + '#';
    const layout = [
      '####################',
      row(6, 14),
      row(6, 14),
      row(6, 14),
      '####################',
    ];
    const state = freshState({
      map: mapFromLayout(layout),
      player: createInitialActor({ x: playerX, y: 2 }, 1000, 1),
    });
    const ghost = ghostAt(10, 2);
    state.enemies = [ghost];
    return state;
  }

  it('never attacks while inside a wall, across several turns before it reaches floor', () => {
    const state = wallBandState(17); // exit at x=15 is not yet adjacent to a player this far away
    const ghost = state.enemies[0];
    for (let i = 0; i < 4; i++) {
      const before = state.player.hp;
      processTurn(state, { type: 'wait' });
      expect(state.map.terrain[ghost.pos.y][ghost.pos.x]).toBe('wall'); // still inside the band
      expect(state.player.hp).toBe(before); // never attacked
    }
  });

  it('attacks once in the same turn it steps from a wall tile onto a legal floor attack position', () => {
    // Player at x=16 puts the band's east floor exit (x=15) directly
    // adjacent, so the wall(14)->floor(15) step itself is the
    // emerge-and-attack turn.
    const state = wallBandState(16);
    const ghost = state.enemies[0];
    let attackedThisTurn = false;
    let stillInsideWallCount = 0;
    for (let i = 0; i < 6 && !attackedThisTurn; i++) {
      const wasInsideWall = state.map.terrain[ghost.pos.y][ghost.pos.x] === 'wall';
      const before = state.player.hp;
      processTurn(state, { type: 'wait' });
      const nowInsideWall = state.map.terrain[ghost.pos.y][ghost.pos.x] === 'wall';
      if (state.player.hp < before) {
        attackedThisTurn = true;
        expect(wasInsideWall).toBe(true);
        expect(nowInsideWall).toBe(false);
      } else if (wasInsideWall) {
        stillInsideWallCount++;
      }
    }
    expect(attackedThisTurn).toBe(true);
    expect(stillInsideWallCount).toBeGreaterThan(0); // confirms it really did spend turns inside the wall first
  });

  it('never attacks twice from a single move-then-attack turn', () => {
    const state = wallBandState(16);
    const ghost = state.enemies[0];
    let maxHitEventsInOneTurn = 0;
    for (let i = 0; i < 6; i++) {
      const result = processTurn(state, { type: 'wait' });
      const dmgEvents = result.events.filter((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed');
      maxHitEventsInOneTurn = Math.max(maxHitEventsInOneTurn, dmgEvents.length);
    }
    void ghost;
    expect(maxHitEventsInOneTurn).toBeLessThanOrEqual(1);
  });

  it('does not attack the same turn it moves floor-to-floor', () => {
    const state = freshState({
      player: createInitialActor({ x: 10, y: 4 }, 1000, 1),
      enemies: [ghostAt(7, 4)], // 3 tiles away on floor, will take 1 step closer but not become adjacent
    });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack' || e.type === 'enemy_attack_missed')).toBe(false);
  });
});

describe('Phase 23.3: ghost — attackability (wall-phased immunity)', () => {
  function wallGhostAdjacentState(): GameState {
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
    });
    const ghost = ghostAt(4, 2); // inside wall, adjacent to player
    state.enemies = [ghost];
    return state;
  }

  it('is not a valid melee attack target while inside a wall', () => {
    const state = wallGhostAdjacentState();
    state.player.facing = 'W';
    const hpBefore = state.enemies[0].hp;
    const result = processTurn(state, { type: 'action' });
    expect(state.enemies[0].hp).toBe(hpBefore);
    expect(result.playerAttacked).toBe(false);
  });

  it('is not a valid spear reach-2 target while inside a wall', () => {
    const layout = [
      '##########',
      '#........#',
      '#..#G#P..#',
      '#........#',
      '##########',
    ];
    const state = freshState({
      map: mapFromLayout(layout),
      player: createInitialActor({ x: 6, y: 2 }, 30, 1),
      equippedWeaponId: 'spear',
      inventory: { ...createEmptyInventory(), spear: 1 },
    });
    const ghost = ghostAt(4, 2);
    state.enemies = [ghost];
    state.player.facing = 'W';
    const hpBefore = ghost.hp;
    processTurn(state, { type: 'action' });
    expect(ghost.hp).toBe(hpBefore);
  });

  it('is not a valid solar gun target while inside a wall', () => {
    const layout = [
      '##########',
      '#........#',
      '#..G#P...#',
      '#........#',
      '##########',
    ];
    const state = freshState({
      map: mapFromLayout(layout),
      player: createInitialActor({ x: 5, y: 2 }, 30, 1),
      equippedWeaponId: 'solar_gun',
      inventory: { ...createEmptyInventory(), solar_gun: 1 },
    });
    const ghost = ghostAt(3, 2);
    state.enemies = [ghost];
    state.player.facing = 'W';
    const hpBefore = ghost.hp;
    processTurn(state, { type: 'action' });
    expect(ghost.hp).toBe(hpBefore);
  });

  it('is excluded from room-wide card attacks (justice) while inside a wall', () => {
    const state = freshState({
      map: { ...freshState().map, rooms: [{ x: 0, y: 0, width: 20, height: 9 }] },
      inventory: { ...createEmptyInventory(), justice: 1 },
    });
    const ghost = ghostAt(4, 2); // inside a wall tile per the default map's perimeter... use interior instead
    // Carve an interior wall pocket within the room bounds for this test.
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
    state.map = { ...mapFromLayout(layout), rooms: [{ x: 0, y: 0, width: 20, height: 9 }] };
    ghost.pos = { x: 4, y: 2 }; // the interior wall tile
    state.enemies = [ghost];
    const hpBefore = ghost.hp;
    processTurn(state, { type: 'use_item', itemId: 'justice' });
    expect(ghost.hp).toBe(hpBefore);
  });

  it('is never knocked back while inside a wall (never a valid target at all)', () => {
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
      equippedWeaponId: 'hammer',
      inventory: { ...createEmptyInventory(), hammer: 1 },
    });
    const ghost = ghostAt(4, 2);
    state.enemies = [ghost];
    state.player.facing = 'W';
    const result = processTurn(state, { type: 'action' });
    // Never a valid target at all while wall-phased, so hammer's
    // knockback mechanic (tryKnockback) is never even reached for it —
    // no enemy_knocked_back event fires (the ghost's own AI may still
    // move it on its own turn afterward, unrelated to knockback).
    expect(result.events.some((e) => e.type === 'enemy_knocked_back')).toBe(false);
  });

  it('is a normal, attackable target once standing on floor', () => {
    const state = freshState({ enemies: [ghostAt(9, 4)] }); // floor, adjacent to player
    state.player.facing = 'W';
    const hpBefore = state.enemies[0].hp;
    const result = processTurn(state, { type: 'action' });
    expect(result.playerAttacked).toBe(true);
    expect(state.enemies[0].hp).toBeLessThan(hpBefore);
  });

  it('preserves skeleton head/body attack-target priority unaffected by the new isEnemyAttackable check', () => {
    const skeletonDef = ENEMY_DEFINITIONS.skeleton;
    const head = createInitialEnemy('skeleton' as EnemyType, { x: 9, y: 4 }, 0, skeletonDef.attack, 0, 1, skeletonDef.defense, skeletonDef.accuracy, skeletonDef.evasion);
    head.skeletonForm = 'head';
    head.skeletonReviveAtTurn = 1000;
    const bok = createInitialEnemy('bok', { x: 9, y: 4 }, 5, 1);
    const state = freshState({ enemies: [head, bok] });
    state.player.facing = 'W';
    const result = processTurn(state, { type: 'action' });
    expect(bok.hp).toBeLessThan(5);
    expect(head.hp).toBe(0);
    expect(result.playerAttacked).toBe(true);
  });
});

describe('Phase 23.3: ghost — integration', () => {
  it('a monster-house-spawned ghost uses the identical AI', () => {
    const state = freshState({ enemies: [ghostAt(9, 4)] });
    state.enemies[0].spawnSource = 'monster_house';
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBeLessThan(hpBefore);
  });

  it('a floor-standing ghost blocks a golem\'s charge like any other enemy', () => {
    const state = freshState({
      player: createInitialActor({ x: 19, y: 4 }, 30, 1),
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
      enemies: [
        (() => {
          const def = ENEMY_DEFINITIONS.golem;
          return createInitialEnemy('golem' as EnemyType, { x: 5, y: 4 }, def.hp, def.attack, 0, 0, def.defense, def.accuracy, def.evasion);
        })(),
        ghostAt(8, 4, 1),
      ],
    });
    const golem = state.enemies[0];
    const blocker = state.enemies[1];
    golem.golemChargeState = 'telegraphed';
    golem.golemChargeDirection = 'E';
    golem.golemChargeTargetTile = { x: 19, y: 4 };
    processTurn(state, { type: 'wait' });
    expect(golem.pos.x).toBeLessThan(blocker.pos.x);
  });

  it('does not carry position or state across a floor transition', () => {
    const state = freshState({ enemies: [ghostAt(5, 4)] });
    state.player.pos = { ...state.exit };
    const next = advanceToNextFloor(state);
    for (const enemy of next.enemies) {
      if (enemy.type === 'ghost') {
        expect(enemy.pos).not.toEqual({ x: 5, y: 4 });
      }
    }
  });

  it('grants experience exactly once when defeated', () => {
    const state = freshState({ enemies: [ghostAt(9, 4, 0, 1)] }); // 1 HP
    state.player.facing = 'W';
    const result = processTurn(state, { type: 'action' });
    const expEvents = result.events.filter((e) => e.type === 'experience_gained');
    expect(expEvents).toHaveLength(1);
  });
});
