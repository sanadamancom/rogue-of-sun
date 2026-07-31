import { describe, expect, it } from 'vitest';
import { formatEvent } from '../message-log';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { EnemyActor, GameMap, GameState, Tile, Vec2 } from '../types';

// Open layout with a large clear room, matching the style of the spider
// behavior tests. Retained only for these bat-specific unit tests;
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
  return { width, height, terrain, rooms: [], exit: { x: 199, y: 199 } };
}

/**
 * Builds a minimal test-only GameState with exactly one bat, explicitly
 * placed at `batPos`, instead of relying on createInitialState's seeded
 * species RNG or hunting for a seed that happens to roll a bat.
 */
function batState(
  batPos: Vec2,
  options?: {
    playerPos?: Vec2;
    attack?: number;
    turn?: number;
    retreating?: boolean;
    batId?: number;
    extraEnemies?: EnemyActor[];
    map?: GameMap;
  },
): GameState {
  const playerPos = options?.playerPos ?? { x: 10, y: 5 };
  const attack = options?.attack ?? 1;
  const turn = options?.turn ?? 0;
  const bat = createInitialEnemy('bat', batPos, 10, attack, turn, options?.batId ?? 0);
  bat.retreating = options?.retreating ?? false;
  return {
    map: options?.map ?? testMap(),
    player: createInitialActor(playerPos, 20, 1),
    enemies: [bat, ...(options?.extraEnemies ?? [])],
    turn,
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
    inventory: { apple: 0 },
    inventoryOpen: false,
    selectedItemIndex: 0,
  };
}

describe('bat_retreat event formatting', () => {
  it('formats bat_retreat into the specified Japanese line, using the official display name', () => {
    const line = formatEvent({ type: 'bat_retreat', actorId: 0, enemyType: 'bat' });
    expect(line).toBe('コウモリはひらりと距離を取った。');
  });
});

describe('bat retreat trigger', () => {
  it('becomes retreat-pending only after a successful melee attack', () => {
    const state = batState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const bat = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(bat.retreating).toBe(true);
  });

  it('does not become retreat-pending after a normal chase move', () => {
    const state = batState({ x: 6, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const bat = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(bat.retreating).toBe(false);
  });

  it('does not become retreat-pending when unable to attack (blocked, no legal step)', () => {
    const map = testMap();
    map.terrain[4][6] = 'wall';
    map.terrain[6][6] = 'wall';
    map.terrain[5][5] = 'wall';
    map.terrain[5][7] = 'wall';
    map.terrain[4][5] = 'wall';
    map.terrain[4][7] = 'wall';
    map.terrain[6][5] = 'wall';
    map.terrain[6][7] = 'wall';
    const state = batState({ x: 6, y: 5 }, { playerPos: { x: 15, y: 5 }, map });
    const bat = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(bat.retreating).toBe(false);
  });

  it('does not retreat on the same turn it attacks (no position change, no bat_retreat event)', () => {
    const state = batState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const bat = state.enemies[0];
    const before = { ...bat.pos };
    const result = processTurn(state, { type: 'wait' });
    expect(bat.pos).toEqual(before);
    expect(result.events.some((e) => e.type === 'bat_retreat')).toBe(false);
  });
});

describe('bat successful retreat', () => {
  it('moves to the adjacent tile that strictly maximizes distance to the player and clears retreating', () => {
    // Bat directly west of the player; the tile directly further west (8,5)
    // maximizes Chebyshev distance among the 8 candidates.
    const state = batState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 }, retreating: true });
    const bat = state.enemies[0];
    const result = processTurn(state, { type: 'wait' });
    expect(bat.pos).toEqual({ x: 8, y: 5 });
    expect(bat.retreating).toBe(false);
    const retreatEvents = result.events.filter((e) => e.type === 'bat_retreat');
    expect(retreatEvents).toHaveLength(1);
    expect(retreatEvents[0]).toEqual({ type: 'bat_retreat', actorId: 0, enemyType: 'bat' });
  });

  it('does not attack or take any extra action on a successful retreat turn', () => {
    // Player adjacent diagonally to the bat's only viable retreat spot is
    // avoided; here the bat is not adjacent to the player at all, so a
    // successful retreat step must be the only thing that happens.
    const state = batState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 }, retreating: true });
    const state2 = batState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 }, retreating: true });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore);
    // sanity: independent identical state behaves the same (determinism)
    processTurn(state2, { type: 'wait' });
    expect(state2.enemies[0].pos).toEqual(state.enemies[0].pos);
  });

  it('breaks ties between equally-far candidates using the fixed N/S/E/W/NE/NW/SE/SW order', () => {
    // Bat at (9,5), player far north at (9,0): S(9,6), SE(10,6), and
    // SW(8,6) all tie at Chebyshev distance 6 (the maximum among all
    // candidates). ALL_DIRECTIONS order checks S before SE and SW, so S
    // must be the one picked.
    const state = batState({ x: 9, y: 5 }, { playerPos: { x: 9, y: 0 }, retreating: true });
    const bat = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(bat.pos).toEqual({ x: 9, y: 6 });
  });

  it('retreats correctly near a wall where only some candidates increase distance', () => {
    // Bat backed against the north wall (row 0 is wall); north, northeast,
    // and northwest are all blocked. Player to the southeast means only
    // moving west (and, tied, southwest) actually increases distance; the
    // fixed order picks west over the tied southwest candidate.
    const state = batState({ x: 10, y: 1 }, { playerPos: { x: 12, y: 2 }, retreating: true });
    const bat = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(bat.pos).toEqual({ x: 9, y: 1 });
  });
});

describe('bat blocked retreat', () => {
  it('falls back to normal AI when fully walled in (no tile increases distance)', () => {
    const map = testMap();
    // Enclose the bat entirely at (6,5).
    for (const [y, x] of [
      [4, 5], [4, 6], [4, 7],
      [5, 5], [5, 7],
      [6, 5], [6, 6], [6, 7],
    ]) {
      map.terrain[y][x] = 'wall';
    }
    const state = batState({ x: 6, y: 5 }, { playerPos: { x: 15, y: 5 }, retreating: true, map });
    const bat = state.enemies[0];
    const before = { ...bat.pos };
    const result = processTurn(state, { type: 'wait' });
    expect(bat.pos).toEqual(before); // fully enclosed: normal AI also can't move
    expect(bat.retreating).toBe(false);
    expect(result.events.some((e) => e.type === 'bat_retreat')).toBe(false);
  });

  it('never steps onto another living enemy currently occupying the only farther tile', () => {
    const blocker = createInitialEnemy('bok', { x: 8, y: 5 }, 3, 1, 0, 1);
    const state = batState(
      { x: 9, y: 5 },
      { playerPos: { x: 10, y: 5 }, retreating: true, extraEnemies: [blocker] },
    );
    const bat = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(bat.pos).not.toEqual({ x: 8, y: 5 });
  });

  it('never steps onto the player tile', () => {
    // Contrived: player adjacent such that stepping onto the player's tile
    // would be the only "farther" option is impossible by construction
    // (moving onto the player's own tile can never increase distance to
    // the player), but we still assert the bat never ends on the player.
    const state = batState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 }, retreating: true });
    const bat = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(bat.pos).not.toEqual(state.player.pos);
  });

  it('does not select a diagonal retreat tile that cuts a wall corner', () => {
    const map = testMap();
    // Bat at (6,5); block diagonal corner-cut candidates by walling both
    // orthogonal sides of the NW diagonal (5,4): (5,5) and (6,4).
    map.terrain[5][5] = 'wall';
    map.terrain[4][6] = 'wall';
    const state = batState({ x: 6, y: 5 }, { playerPos: { x: 10, y: 5 }, retreating: true, map });
    const bat = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(bat.pos).not.toEqual({ x: 5, y: 4 });
  });

  it('does not emit bat_retreat when falling back to normal AI', () => {
    const map = testMap();
    for (const [y, x] of [
      [4, 5], [4, 6], [4, 7],
      [5, 5], [5, 7],
      [6, 5], [6, 6], [6, 7],
    ]) {
      map.terrain[y][x] = 'wall';
    }
    const state = batState({ x: 6, y: 5 }, { playerPos: { x: 15, y: 5 }, retreating: true, map });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'bat_retreat')).toBe(false);
  });
});

describe('bat lifecycle', () => {
  it('tracks retreating independently per bat', () => {
    const other = createInitialEnemy('bat', { x: 3, y: 3 }, 2, 1, 0, 1);
    other.retreating = false;
    const state = batState(
      { x: 9, y: 5 },
      { playerPos: { x: 10, y: 5 }, retreating: true, extraEnemies: [other] },
    );
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].retreating).toBe(false); // retreated
    // other bat is far from the player and unattacked; it should not have
    // become retreat-pending merely because the first bat did.
    expect(state.enemies[1].retreating).toBe(false);
  });

  it('a fresh bat created via createInitialEnemy starts with retreating falsy', () => {
    const bat = createInitialEnemy('bat', { x: 0, y: 0 }, 2, 1);
    expect(bat.retreating).toBeFalsy();
  });
});
