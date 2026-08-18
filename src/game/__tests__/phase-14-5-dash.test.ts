import { describe, expect, it } from 'vitest';
import { canTakeDashStep, shouldStopDashAfterStep } from '../dash';
import { createInitialActor, createInitialEnemy } from '../turn';
import { createEmptyInventory } from '../item-def';
import { GameMap, GameState, Room, Tile } from '../types';

function buildMap(rows: string[], rooms: Room[] = []): GameMap {
  const height = rows.length;
  const width = rows[0].length;
  const terrain: Tile[][] = rows.map((row) => row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')));
  return { width, height, terrain, rooms, exit: { x: -1, y: -1 } };
}

function freshState(map: GameMap, playerPos: { x: number; y: number }, overrides?: Partial<GameState>): GameState {
  return {
    map,
    player: createInitialActor(playerPos, 30, 5),
    enemies: [],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    leg: 'descent',
    exit: map.exit,
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: createEmptyInventory(),
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: 'sword',
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
    combatRngState: 1,
    sunlight: [],
    traps: [],
    ...overrides,
  } as GameState;
}

describe('Phase 14.5 UI overhaul: canTakeDashStep', () => {
  it('allows a step onto open floor with nothing nearby', () => {
    const map = buildMap(['#####', '#...#', '#...#', '#####']);
    const state = freshState(map, { x: 1, y: 1 });
    expect(canTakeDashStep(state, 'E')).toBe(true);
  });

  it('refuses a step into a wall', () => {
    const map = buildMap(['#####', '#...#', '#...#', '#####']);
    const state = freshState(map, { x: 3, y: 1 });
    expect(canTakeDashStep(state, 'E')).toBe(false);
  });

  it('refuses a step out of map bounds', () => {
    const map = buildMap(['###', '#.#', '###']);
    const state = freshState(map, { x: 1, y: 1 });
    expect(canTakeDashStep(state, 'N')).toBe(false);
  });

  it('refuses a diagonal step that cuts a wall corner', () => {
    // Player at (1,1); (2,1) is wall, (1,2) is floor -> corner-cut blocked
    const map = buildMap(['####', '#.##', '#...', '####']);
    const state = freshState(map, { x: 1, y: 1 });
    expect(canTakeDashStep(state, 'SE')).toBe(false);
  });

  it('refuses a step that would bring the player adjacent to an alive enemy', () => {
    const map = buildMap(['#####', '#...#', '#...#', '#####']);
    const state = freshState(map, { x: 1, y: 1 }, {
      enemies: [createInitialEnemy('bok', { x: 3, y: 1 }, 10, 5)],
    });
    // moving E from (1,1) -> (2,1), which is adjacent (distance 1) to enemy at (3,1)
    expect(canTakeDashStep(state, 'E')).toBe(false);
  });

  it('allows a step that stays outside melee contact range of an enemy', () => {
    const map = buildMap(['######', '#....#', '#....#', '######']);
    const state = freshState(map, { x: 1, y: 1 }, {
      enemies: [createInitialEnemy('bok', { x: 4, y: 1 }, 10, 5)],
    });
    // moving E from (1,1) -> (2,1); distance to enemy at (4,1) is 2, not adjacent
    expect(canTakeDashStep(state, 'E')).toBe(true);
  });

  it('does not react to a dead enemy', () => {
    const map = buildMap(['#####', '#...#', '#...#', '#####']);
    const enemy = createInitialEnemy('bok', { x: 3, y: 1 }, 10, 5);
    enemy.alive = false;
    const state = freshState(map, { x: 1, y: 1 }, { enemies: [enemy] });
    expect(canTakeDashStep(state, 'E')).toBe(true);
  });
});

describe('Phase 14.5 UI overhaul: shouldStopDashAfterStep', () => {
  it('does not stop on a plain floor tile with nothing notable', () => {
    const map = buildMap(['#######', '#.....#', '#######'], [{ x: 1, y: 1, width: 5, height: 1 }]);
    const state = freshState(map, { x: 1, y: 1 });
    expect(shouldStopDashAfterStep(state, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(false);
  });

  it('stops after stepping onto the exit', () => {
    const map = buildMap(['#######', '#.....#', '#######'], [{ x: 1, y: 1, width: 5, height: 1 }]);
    const state = freshState(map, { x: 1, y: 1 }, { exit: { x: 3, y: 1 } });
    expect(shouldStopDashAfterStep(state, { x: 2, y: 1 }, { x: 3, y: 1 })).toBe(true);
  });

  it('stops after stepping onto a ground item', () => {
    const map = buildMap(['#######', '#.....#', '#######'], [{ x: 1, y: 1, width: 5, height: 1 }]);
    const state = freshState(map, { x: 1, y: 1 }, {
      groundItems: [{ id: 0, itemId: 'apple', pos: { x: 3, y: 1 } }],
    });
    expect(shouldStopDashAfterStep(state, { x: 2, y: 1 }, { x: 3, y: 1 })).toBe(true);
  });

  it('stops after stepping onto a known (triggered) trap', () => {
    const map = buildMap(['#######', '#.....#', '#######'], [{ x: 1, y: 1, width: 5, height: 1 }]);
    const state = freshState(map, { x: 1, y: 1 }, {
      traps: [{ id: 0, pos: { x: 3, y: 1 }, revealed: true, triggered: true, trapType: 'slow_trap' }],
    });
    expect(shouldStopDashAfterStep(state, { x: 2, y: 1 }, { x: 3, y: 1 })).toBe(true);
  });

  it('does not stop for an undiscovered (untriggered) trap', () => {
    const map = buildMap(['#######', '#.....#', '#######'], [{ x: 1, y: 1, width: 5, height: 1 }]);
    const state = freshState(map, { x: 1, y: 1 }, {
      traps: [{ id: 0, pos: { x: 3, y: 1 }, revealed: false, triggered: false, trapType: 'slow_trap' }],
    });
    expect(shouldStopDashAfterStep(state, { x: 2, y: 1 }, { x: 3, y: 1 })).toBe(false);
  });

  it('stops at a corridor branch (3+ open orthogonal directions, outside any room)', () => {
    // corridor cross: (3,2) has floor N,S,E,W all open, and is not in any room.
    const map = buildMap([
      '#######',
      '###.###',
      '#.....#',
      '###.###',
      '#######',
    ]);
    const state = freshState(map, { x: 1, y: 2 });
    expect(shouldStopDashAfterStep(state, { x: 1, y: 2 }, { x: 3, y: 2 })).toBe(true);
  });

  it('does not stop mid-way along a straight corridor (exactly 2 open directions)', () => {
    const map = buildMap(['#######', '#.....#', '#######']);
    const state = freshState(map, { x: 1, y: 1 });
    expect(shouldStopDashAfterStep(state, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(false);
  });

  it('stops when crossing from a corridor into a room', () => {
    const map = buildMap(
      ['########', '#....RR#', '#....RR#', '########'],
      [{ x: 5, y: 1, width: 2, height: 2 }],
    );
    const state = freshState(map, { x: 3, y: 1 });
    // stepping from corridor tile (4,1) into room tile (5,1)
    expect(shouldStopDashAfterStep(state, { x: 4, y: 1 }, { x: 5, y: 1 })).toBe(true);
  });

  it('stops when crossing from a room into a corridor', () => {
    const map = buildMap(
      ['########', '#RR....#', '#RR....#', '########'],
      [{ x: 1, y: 1, width: 2, height: 2 }],
    );
    const state = freshState(map, { x: 1, y: 1 });
    // stepping from room tile (2,1) into corridor tile (3,1)
    expect(shouldStopDashAfterStep(state, { x: 2, y: 1 }, { x: 3, y: 1 })).toBe(true);
  });

  it('does not stop while moving between two tiles of the same room', () => {
    const map = buildMap(['#######', '#RRRRR#', '#######'], [{ x: 1, y: 1, width: 5, height: 1 }]);
    const state = freshState(map, { x: 1, y: 1 });
    expect(shouldStopDashAfterStep(state, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(false);
  });
});
