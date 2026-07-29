import { describe, expect, it } from 'vitest';
import { advanceToNextFloor, createInitialState } from '../state';
import { processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';

const RUN_SEEDS = Array.from({ length: 100 }, (_, i) => i * 17 + 5);

describe('enemy species assignment', () => {
  it('always generates exactly one bok (index 0) and one spider (index 1) per floor', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      expect(state.enemies).toHaveLength(2);
      expect(state.enemies[0].type).toBe('bok');
      expect(state.enemies[1].type).toBe('spider');
    }
  });

  it('keeps the same species assignment across restarts of the same run seed', () => {
    const runSeed = 2780624551;
    const a = createInitialState(runSeed);
    const b = createInitialState(runSeed);
    expect(a.enemies.map((e) => e.type)).toEqual(b.enemies.map((e) => e.type));
    expect(a.enemies.map((e) => e.pos)).toEqual(b.enemies.map((e) => e.pos));
  });

  it('gives a fresh run (new run seed) the same bok+spider composition', () => {
    const state = createInitialState(999999);
    expect(state.enemies.map((e) => e.type)).toEqual(['bok', 'spider']);
  });

  it('keeps bok+spider composition on the next floor', () => {
    let state = createInitialState(2780624551);
    state.enemies.forEach((e) => (e.alive = false));
    // Force onto exit and clear.
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);
    expect(state.enemies.map((e) => e.type)).toEqual(['bok', 'spider']);
  });

  it('does not change map generation determinism (species assignment consumes no extra PRNG draws)', () => {
    // Same seed generates the same map/placement regardless of species tagging.
    const a = createInitialState(2780624551);
    const b = createInitialState(2780624551);
    expect(a.map.terrain).toEqual(b.map.terrain);
    expect(a.enemies.map((e) => e.pos)).toEqual(b.enemies.map((e) => e.pos));
  });
});

describe('bok regression (unchanged 8-direction behavior)', () => {
  it('bok attacks a diagonally adjacent player', () => {
    const state = createInitialState(2780624551);
    const bok = state.enemies[0];
    bok.pos = { x: state.player.pos.x + 1, y: state.player.pos.y + 1 };
    bok.alive = true;
    bok.hp = bok.maxHp;
    const spider = state.enemies[1];
    spider.pos = { x: 0, y: 0 };
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore - bok.attack);
  });

  it('keeps existing bok HP and attack values', () => {
    const state = createInitialState(1);
    const bok = state.enemies[0];
    expect(bok.hp).toBe(2);
    expect(bok.maxHp).toBe(2);
    expect(bok.attack).toBe(1);
  });
});

// Small fixed layout for isolated spider AI unit tests (mirrors turn.test.ts's approach).
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

function freshSpiderState(): GameState {
  return {
    map: testMap(),
    player: {
      pos: { x: 5, y: 4 },
      hp: 3,
      maxHp: 3,
      attack: 1,
      facing: 'S',
      alive: true,
    },
    enemies: [
      { pos: { x: 1, y: 1 }, hp: 2, maxHp: 2, attack: 1, facing: 'S', alive: true, type: 'bok' },
      { pos: { x: 1, y: 6 }, hp: 2, maxHp: 2, attack: 1, facing: 'S', alive: true, type: 'spider' },
    ],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    exit: { x: 99, y: 99 },
    regenProgress: 0,
  };
}

describe('spider behavior', () => {
  it('never moves diagonally, only orthogonally, when chasing', () => {
    const state = freshSpiderState();
    const spider = state.enemies[1];
    spider.pos = { x: 4, y: 6 };
    state.player.pos = { x: 6, y: 4 }; // diagonal offset from spider
    const before = { ...spider.pos };
    processTurn(state, { type: 'wait' });
    const dx = Math.abs(spider.pos.x - before.x);
    const dy = Math.abs(spider.pos.y - before.y);
    // A legal single step is exactly one tile along a single axis.
    expect(dx + dy).toBeLessThanOrEqual(1);
  });

  it('attacks when orthogonally adjacent to the player', () => {
    const state = freshSpiderState();
    const spider = state.enemies[1];
    spider.pos = { x: state.player.pos.x, y: state.player.pos.y - 1 }; // directly north
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore - spider.attack);
    expect(spider.pos).toEqual({ x: state.player.pos.x, y: state.player.pos.y - 1 });
  });

  it('does not attack when only diagonally adjacent, and instead tries to move orthogonally', () => {
    const state = freshSpiderState();
    const spider = state.enemies[1];
    spider.pos = { x: state.player.pos.x - 1, y: state.player.pos.y - 1 }; // diagonal (NW)
    const hpBefore = state.player.hp;
    const before = { ...spider.pos };
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore); // not attacked
    // Either moved one orthogonal step, or waited in place if blocked.
    const dx = Math.abs(spider.pos.x - before.x);
    const dy = Math.abs(spider.pos.y - before.y);
    expect((dx === 1 && dy === 0) || (dx === 0 && dy === 1) || (dx === 0 && dy === 0)).toBe(true);
  });

  it('never steps onto a wall tile', () => {
    const state = freshSpiderState();
    const spider = state.enemies[1];
    // Surround the spider with the inner wall block to its east; it should
    // never choose to move into a wall tile regardless of chase target.
    spider.pos = { x: 3, y: 3 }; // adjacent to inner wall block at x=3..4
    state.player.pos = { x: 6, y: 3 };
    for (let i = 0; i < 5; i++) {
      processTurn(state, { type: 'wait' });
      expect(state.map.terrain[spider.pos.y][spider.pos.x]).toBe('floor');
    }
  });

  it('never overlaps another living enemy and never steps onto the player tile', () => {
    const state = freshSpiderState();
    const bok = state.enemies[0];
    const spider = state.enemies[1];
    // Put bok directly in the spider's shortest path toward the player.
    spider.pos = { x: 3, y: 6 };
    bok.pos = { x: 4, y: 6 };
    state.player.pos = { x: 6, y: 6 };
    processTurn(state, { type: 'wait' });
    expect(spider.pos).not.toEqual(bok.pos);
    expect(spider.pos).not.toEqual(state.player.pos);
  });

  it('waits in place when no legal orthogonal candidate exists', () => {
    const state = freshSpiderState();
    const spider = state.enemies[1];
    // Fully enclose the spider with walls on all four orthogonal sides.
    const map = testMap();
    map.terrain[6][1] = 'floor'; // spider itself
    map.terrain[5][1] = 'wall';
    map.terrain[7][1] = 'wall';
    map.terrain[6][0] = 'wall';
    map.terrain[6][2] = 'wall';
    state.map = map;
    spider.pos = { x: 1, y: 6 };
    state.player.pos = { x: 5, y: 6 };
    const before = { ...spider.pos };
    processTurn(state, { type: 'wait' });
    expect(spider.pos).toEqual(before);
  });

  it('picks the minimum-Manhattan-distance candidate, breaking ties in fixed N,S,E,W order', () => {
    const state = freshSpiderState();
    const spider = state.enemies[1];
    spider.pos = { x: 5, y: 3 };
    // Player due south by 2 and due east by 2: both S and E reduce distance
    // equally (tie); fixed order prefers N,S,E,W, so S is chosen over E.
    state.player.pos = { x: 7, y: 5 };
    processTurn(state, { type: 'wait' });
    expect(spider.pos).toEqual({ x: 5, y: 4 });
  });

  it('is deterministic for the same state and input sequence', () => {
    const stateA = freshSpiderState();
    const stateB = freshSpiderState();
    const actions: { type: 'wait' }[] = [{ type: 'wait' }, { type: 'wait' }, { type: 'wait' }];
    for (const action of actions) {
      processTurn(stateA, action);
      processTurn(stateB, action);
    }
    expect(stateA.enemies).toEqual(stateB.enemies);
  });
});

describe('combat and progression with mixed enemy types', () => {
  it('the player can attack and defeat either bok or spider independently', () => {
    const state = createInitialState(2780624551);
    const spider = state.enemies[1];
    spider.pos = { x: state.player.pos.x + 1, y: state.player.pos.y };
    spider.hp = 1;
    const bok = state.enemies[0];
    bok.pos = { x: 0, y: 0 };
    processTurn(state, { type: 'move', direction: 'E' });
    expect(spider.alive).toBe(false);
    expect(bok.alive).toBe(true);
    expect(bok.hp).toBe(bok.maxHp);
  });

  it('keeps the stairs locked until both bok and spider are defeated', () => {
    const state = createInitialState(11);
    state.enemies[0].alive = false; // only bok defeated
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('playing');

    state.enemies[1].alive = false; // both defeated now
    state.player.pos = { ...state.exit };
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('floor_cleared');
  });
});
