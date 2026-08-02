import { describe, expect, it } from 'vitest';
import { formatEvent } from '../message-log';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { EnemyActor, GameMap, GameState, Tile, Vec2 } from '../types';

// Open layout with a large clear room, matching the style of the bat/spider
// behavior tests. Retained only for these mummy-specific unit tests;
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
 * Builds a minimal test-only GameState with exactly one mummy, explicitly
 * placed at `mummyPos`, instead of relying on createInitialState's seeded
 * species RNG or hunting for a seed that happens to roll a mummy.
 */
function mummyState(
  mummyPos: Vec2,
  options?: {
    playerPos?: Vec2;
    attack?: number;
    turn?: number;
    restingAfterMove?: boolean;
    mummyId?: number;
    extraEnemies?: EnemyActor[];
    map?: GameMap;
  },
): GameState {
  const playerPos = options?.playerPos ?? { x: 10, y: 5 };
  const attack = options?.attack ?? 2;
  const turn = options?.turn ?? 0;
  const mummy = createInitialEnemy('mummy', mummyPos, 5, attack, turn, options?.mummyId ?? 0);
  mummy.restingAfterMove = options?.restingAfterMove ?? false;
  return {
    map: options?.map ?? testMap(),
    player: createInitialActor(playerPos, 20, 1),
    enemies: [mummy, ...(options?.extraEnemies ?? [])],
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
    inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0, sol_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0 },
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

describe('mummy_shamble_rest event formatting', () => {
  it('formats mummy_shamble_rest into the specified Japanese line, using the official display name', () => {
    const line = formatEvent({ type: 'mummy_shamble_rest', actorId: 0, enemyType: 'mummy' });
    expect(line).toBe('マミーは足を止めて体勢を整えた。');
  });
});

describe('mummy movement trigger', () => {
  it('becomes rest-pending after a successful chase step', () => {
    // Far from the player so the mummy must move, not attack.
    const state = mummyState({ x: 3, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const mummy = state.enemies[0];
    const before = { ...mummy.pos };
    processTurn(state, { type: 'wait' });
    expect(mummy.pos).not.toEqual(before);
    expect(mummy.restingAfterMove).toBe(true);
  });

  it('does not become rest-pending on the same turn it moved (only on its next action)', () => {
    const state = mummyState({ x: 3, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'mummy_shamble_rest')).toBe(false);
  });

  it('does not become rest-pending when unable to move (fully walled in)', () => {
    const map = testMap();
    for (const [y, x] of [
      [4, 5], [4, 6], [4, 7],
      [5, 5], [5, 7],
      [6, 5], [6, 6], [6, 7],
    ]) {
      map.terrain[y][x] = 'wall';
    }
    const state = mummyState({ x: 6, y: 5 }, { playerPos: { x: 15, y: 5 }, map });
    const mummy = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(mummy.restingAfterMove).toBe(false);
  });

  it('does not become rest-pending after a successful attack', () => {
    const state = mummyState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const mummy = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(mummy.restingAfterMove).toBe(false);
  });

  it('does not rest unconditionally on its first action', () => {
    const state = mummyState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'mummy_shamble_rest')).toBe(false);
  });
});

describe('mummy rest action', () => {
  it('does not move on its rest turn', () => {
    const state = mummyState({ x: 3, y: 5 }, { playerPos: { x: 10, y: 5 }, restingAfterMove: true });
    const mummy = state.enemies[0];
    const before = { ...mummy.pos };
    processTurn(state, { type: 'wait' });
    expect(mummy.pos).toEqual(before);
  });

  it('does not attack on its rest turn even if adjacent to the player', () => {
    const state = mummyState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 }, restingAfterMove: true });
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'wait' });
    expect(result.enemyAttacked).toBe(false);
    expect(state.player.hp).toBe(hpBefore);
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(false);
  });

  it('emits exactly one mummy_shamble_rest event on the rest turn', () => {
    const state = mummyState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 }, restingAfterMove: true });
    const result = processTurn(state, { type: 'wait' });
    const restEvents = result.events.filter((e) => e.type === 'mummy_shamble_rest');
    expect(restEvents).toHaveLength(1);
    expect(restEvents[0]).toEqual({ type: 'mummy_shamble_rest', actorId: 0, enemyType: 'mummy' });
  });

  it('clears restingAfterMove after the rest turn', () => {
    const state = mummyState({ x: 3, y: 5 }, { playerPos: { x: 10, y: 5 }, restingAfterMove: true });
    const mummy = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(mummy.restingAfterMove).toBe(false);
  });

  it('does not rest on two consecutive turns (resumes normal AI right after)', () => {
    // Start far away so the mummy moves, rests, then moves again.
    const state = mummyState({ x: 3, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const mummy = state.enemies[0];

    // Turn 1: moves, becomes rest-pending.
    processTurn(state, { type: 'wait' });
    expect(mummy.restingAfterMove).toBe(true);
    const posAfterMove = { ...mummy.pos };

    // Turn 2: rests in place.
    const result2 = processTurn(state, { type: 'wait' });
    expect(mummy.pos).toEqual(posAfterMove);
    expect(mummy.restingAfterMove).toBe(false);
    expect(result2.events.some((e) => e.type === 'mummy_shamble_rest')).toBe(true);

    // Turn 3: normal AI resumes; since still far from the player, it moves
    // again rather than resting a second time in a row.
    const result3 = processTurn(state, { type: 'wait' });
    expect(mummy.pos).not.toEqual(posAfterMove);
    expect(result3.events.some((e) => e.type === 'mummy_shamble_rest')).toBe(false);
  });
});

describe('mummy combat', () => {
  it('attacks normally when adjacent and not rest-pending', () => {
    const state = mummyState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const hpBefore = state.player.hp;
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(true);
    expect(state.player.hp).toBeLessThan(hpBefore);
  });

  it('attacks again on its very next turn while still adjacent (no post-attack pause)', () => {
    const state = mummyState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } });
    processTurn(state, { type: 'wait' }); // attack 1
    const hpAfterFirst = state.player.hp;
    const result2 = processTurn(state, { type: 'wait' }); // should attack again, not rest
    expect(result2.events.some((e) => e.type === 'enemy_attack')).toBe(true);
    expect(state.player.hp).toBeLessThan(hpAfterFirst);
  });
});

describe('mummy edge cases', () => {
  it('rests even if the player becomes adjacent between the move turn and the rest turn', () => {
    const state = mummyState({ x: 8, y: 5 }, { playerPos: { x: 10, y: 5 }, restingAfterMove: true });
    // Player steps next to the mummy before the mummy's rest turn resolves.
    state.player.pos = { x: 9, y: 5 };
    const mummy = state.enemies[0];
    const before = { ...mummy.pos };
    const result = processTurn(state, { type: 'wait' });
    expect(mummy.pos).toEqual(before);
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(false);
    expect(result.events.some((e) => e.type === 'mummy_shamble_rest')).toBe(true);
  });

  it('rests even if the player moves away between the move turn and the rest turn', () => {
    const state = mummyState({ x: 8, y: 5 }, { playerPos: { x: 9, y: 5 }, restingAfterMove: true });
    state.player.pos = { x: 15, y: 5 };
    const mummy = state.enemies[0];
    const before = { ...mummy.pos };
    processTurn(state, { type: 'wait' });
    expect(mummy.pos).toEqual(before);
  });

  it('tracks restingAfterMove independently per mummy', () => {
    // Second mummy starts adjacent to the player so it attacks (never
    // rest-pending), proving its state is independent of the first
    // mummy's move-triggered rest.
    const other = createInitialEnemy('mummy', { x: 11, y: 5 }, 5, 2, 0, 1);
    other.restingAfterMove = false;
    const state = mummyState(
      { x: 3, y: 5 },
      { playerPos: { x: 10, y: 5 }, extraEnemies: [other] },
    );
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].restingAfterMove).toBe(true); // moved
    expect(state.enemies[1].restingAfterMove).toBe(false); // attacked instead
  });

  it('does not carry over state when the resting mummy is defeated before its rest turn', () => {
    const state = mummyState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 }, restingAfterMove: true });
    const mummy = state.enemies[0];
    mummy.hp = 0;
    mummy.alive = false;
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'mummy_shamble_rest')).toBe(false);
  });
});

describe('mummy lifecycle', () => {
  it('a fresh mummy created via createInitialEnemy starts with restingAfterMove falsy', () => {
    const mummy = createInitialEnemy('mummy', { x: 0, y: 0 }, 5, 2);
    expect(mummy.restingAfterMove).toBeFalsy();
  });

  it('does not interfere with an independent bat retreating in the same state', () => {
    const bat = createInitialEnemy('bat', { x: 8, y: 5 }, 2, 1, 0, 1);
    bat.retreating = true;
    const state = mummyState(
      { x: 3, y: 5 },
      { playerPos: { x: 10, y: 5 }, extraEnemies: [bat] },
    );
    processTurn(state, { type: 'wait' });
    // The bat's retreat resolution must be unaffected by the mummy's rest
    // logic running in the same turn.
    expect(state.enemies[1].retreating).toBe(false);
  });
});
