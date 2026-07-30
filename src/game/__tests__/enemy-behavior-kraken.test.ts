import { describe, expect, it } from 'vitest';
import { formatEvent } from '../message-log';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { EnemyActor, GameMap, GameState, Tile, Vec2 } from '../types';

// Open layout with a large clear room, matching the style of the bat/mummy/
// cockatrice behavior tests. Retained only for these kraken-specific unit
// tests; production maps come from mapgen.ts.
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
 * Builds a minimal test-only GameState with exactly one kraken, explicitly
 * placed at `krakenPos`, instead of relying on createInitialState's seeded
 * species RNG or hunting for a seed that happens to roll a kraken.
 */
function krakenState(
  krakenPos: Vec2,
  options?: {
    playerPos?: Vec2;
    attack?: number;
    playerHp?: number;
    turn?: number;
    tentacleTarget?: Vec2;
    krakenId?: number;
    extraEnemies?: EnemyActor[];
    map?: GameMap;
  },
): GameState {
  const playerPos = options?.playerPos ?? { x: 10, y: 5 };
  const attack = options?.attack ?? 2;
  const turn = options?.turn ?? 0;
  const kraken = createInitialEnemy('kraken', krakenPos, 6, attack, turn, options?.krakenId ?? 0);
  kraken.tentacleTarget = options?.tentacleTarget;
  const player = createInitialActor(playerPos, options?.playerHp ?? 20, 1);
  return {
    map: options?.map ?? testMap(),
    player,
    enemies: [kraken, ...(options?.extraEnemies ?? [])],
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
  };
}

describe('kraken event formatting', () => {
  it('formats kraken_tentacle_aim using the official display name', () => {
    const line = formatEvent({
      type: 'kraken_tentacle_aim',
      enemyId: 0,
      enemyType: 'kraken',
      target: { x: 5, y: 5 },
    });
    expect(line).toBe('クラーケンが足元を狙っている！');
  });

  it('formats kraken_tentacle_strike (hit, with damage) distinctly from (miss)', () => {
    const hitLine = formatEvent({
      type: 'kraken_tentacle_strike',
      enemyId: 0,
      enemyType: 'kraken',
      target: { x: 5, y: 5 },
      hit: true,
      damage: 2,
    });
    const missLine = formatEvent({
      type: 'kraken_tentacle_strike',
      enemyId: 0,
      enemyType: 'kraken',
      target: { x: 5, y: 5 },
      hit: false,
      damage: 0,
    });
    expect(hitLine).toBe('クラーケンの触手が襲いかかり、2ダメージ！');
    expect(missLine).toBe('クラーケンの触手が空を切った。');
    expect(hitLine).not.toBe(missLine);
  });

  it('formats player_pulled', () => {
    const line = formatEvent({
      type: 'player_pulled',
      sourceEnemyId: 0,
      enemyType: 'kraken',
      from: { x: 6, y: 5 },
      to: { x: 5, y: 5 },
    });
    expect(line).toBe('触手に引き寄せられた！');
  });
});

describe('kraken stays stationary', () => {
  it('never moves while the player is out of range', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 15, y: 15 } }); // far, out of range
    const kraken = state.enemies[0];
    const before = { ...kraken.pos };
    processTurn(state, { type: 'wait' });
    expect(kraken.pos).toEqual(before);
  });

  it('never moves while the player is in range (telegraphing)', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 } });
    const kraken = state.enemies[0];
    const before = { ...kraken.pos };
    processTurn(state, { type: 'wait' });
    expect(kraken.pos).toEqual(before);
  });

  it('never makes a normal melee attack even when adjacent', () => {
    const state = krakenState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } }); // adjacent
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(false);
  });

  it('does not fall back to chase movement when out of range', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 19, y: 9 } });
    const kraken = state.enemies[0];
    const before = { ...kraken.pos };
    const result = processTurn(state, { type: 'wait' });
    expect(kraken.pos).toEqual(before);
    expect(result.events.some((e) => e.type.startsWith('kraken_'))).toBe(false);
  });
});

describe('kraken targeting', () => {
  it('telegraphs at Chebyshev distance 1 (adjacent)', () => {
    const state = krakenState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const kraken = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(kraken.tentacleTarget).toEqual({ x: 10, y: 5 });
  });

  it('telegraphs at Chebyshev distance 5', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 10, y: 5 } }); // distance 5
    const kraken = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(kraken.tentacleTarget).toEqual({ x: 10, y: 5 });
  });

  it('does not telegraph at Chebyshev distance 6', () => {
    const state = krakenState({ x: 4, y: 5 }, { playerPos: { x: 10, y: 5 } }); // distance 6
    const kraken = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(kraken.tentacleTarget).toBeUndefined();
  });

  it('telegraphs a non-aligned (off-line) position within range', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 7 } }); // dx=3, dy=2, Chebyshev=3
    const kraken = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(kraken.tentacleTarget).toEqual({ x: 8, y: 7 });
  });

  it('telegraphs through a wall (no line of sight required)', () => {
    const map = testMap();
    map.terrain[5][7] = 'wall'; // directly between kraken and player
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, map });
    const kraken = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(kraken.tentacleTarget).toEqual({ x: 8, y: 5 });
  });

  it('stores the target coordinate at telegraph time on the enemy state', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 } });
    const kraken = state.enemies[0];
    const result = processTurn(state, { type: 'wait' });
    expect(kraken.tentacleTarget).toEqual({ x: 8, y: 5 });
    const aimEvent = result.events.find((e) => e.type === 'kraken_tentacle_aim');
    expect(aimEvent).toMatchObject({ target: { x: 8, y: 5 } });
  });

  it('does not strike on the same turn it telegraphs', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'kraken_tentacle_strike')).toBe(false);
  });
});

describe('kraken strike area (orthogonal cross)', () => {
  it('hits when the player stays at the telegraphed center', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    const strikeEvent = result.events.find((e) => e.type === 'kraken_tentacle_strike');
    expect(strikeEvent).toMatchObject({ hit: true });
  });

  it('hits when the player moves north of the telegraphed center', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 4 }, tentacleTarget: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.find((e) => e.type === 'kraken_tentacle_strike')).toMatchObject({ hit: true });
  });

  it('hits when the player moves south of the telegraphed center', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 6 }, tentacleTarget: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.find((e) => e.type === 'kraken_tentacle_strike')).toMatchObject({ hit: true });
  });

  it('hits when the player moves west of the telegraphed center', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 7, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.find((e) => e.type === 'kraken_tentacle_strike')).toMatchObject({ hit: true });
  });

  it('hits when the player moves east of the telegraphed center', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 9, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.find((e) => e.type === 'kraken_tentacle_strike')).toMatchObject({ hit: true });
  });

  it('misses when the player moves diagonally off the telegraphed center', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 9, y: 4 }, tentacleTarget: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.find((e) => e.type === 'kraken_tentacle_strike')).toMatchObject({ hit: false });
  });

  it('misses when the player moves well outside the cross', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 15, y: 15 }, tentacleTarget: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.find((e) => e.type === 'kraken_tentacle_strike')).toMatchObject({ hit: false });
  });

  it('does not re-center on the player at strike time (stale telegraphed center)', () => {
    // Player has moved far off the originally-telegraphed center by strike
    // time; the strike must still resolve against the stale (8,5) center.
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    state.player.pos = { x: 2, y: 2 };
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.find((e) => e.type === 'kraken_tentacle_strike')).toMatchObject({
      target: { x: 8, y: 5 },
      hit: false,
    });
  });

  it('handles a telegraphed center near the map edge without error', () => {
    const state = krakenState({ x: 1, y: 1 }, { playerPos: { x: 1, y: 1 }, tentacleTarget: { x: 1, y: 1 } });
    // Kraken itself sits at the telegraphed center near the top-left
    // corner; north/west cells would be out of bounds/walls, must not throw.
    expect(() => processTurn(state, { type: 'wait' })).not.toThrow();
  });

  it('does not strike again on the very next turn (no consecutive strikes)', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    const result1 = processTurn(state, { type: 'wait' }); // strikes
    expect(result1.events.some((e) => e.type === 'kraken_tentacle_strike')).toBe(true);
    const result2 = processTurn(state, { type: 'wait' }); // next turn: re-telegraphs, does not strike
    expect(result2.events.some((e) => e.type === 'kraken_tentacle_strike')).toBe(false);
  });
});

describe('kraken damage', () => {
  it("reduces the player's HP by the kraken's attack value on a hit", () => {
    const state = krakenState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 }, attack: 2, playerHp: 20 },
    );
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(18);
  });

  it('does not reduce HP on a miss', () => {
    const state = krakenState(
      { x: 5, y: 5 },
      { playerPos: { x: 15, y: 15 }, tentacleTarget: { x: 8, y: 5 }, playerHp: 20 },
    );
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(20);
  });

  it('does not additionally trigger a normal melee attack on a hit', () => {
    const state = krakenState({ x: 8, y: 5 }, { playerPos: { x: 9, y: 5 }, tentacleTarget: { x: 9, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(false);
  });

  it('defeats the player exactly once via the existing defeat handling when HP reaches 0', () => {
    const state = krakenState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 }, attack: 2, playerHp: 2 },
    );
    const result = processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(0);
    expect(state.player.alive).toBe(false);
    expect(result.events.filter((e) => e.type === 'player_defeated')).toHaveLength(1);
  });
});

describe('kraken pull', () => {
  it('pulls the player 1 tile toward the kraken along the x axis when |dx| >= |dy|', () => {
    // kraken at (5,5), player at (8,5) after being telegraphed there ->
    // dx = 5-8 = -3, dy = 0; |dx| > |dy| -> move x by -1 (toward kraken).
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    processTurn(state, { type: 'wait' });
    expect(state.player.pos).toEqual({ x: 7, y: 5 });
  });

  it('pulls the player 1 tile toward the kraken along the y axis when |dy| > |dx|', () => {
    // kraken at (5,5), player at (5,8): dx=0, dy=-3; |dy|>|dx| -> move y by -1.
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 5, y: 8 }, tentacleTarget: { x: 5, y: 8 } });
    processTurn(state, { type: 'wait' });
    expect(state.player.pos).toEqual({ x: 5, y: 7 });
  });

  it('prefers the x axis on a tie (|dx| === |dy|)', () => {
    // kraken at (5,5), player at (8,8): dx=-3, dy=-3, tie -> x axis.
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 8 }, tentacleTarget: { x: 8, y: 8 } });
    processTurn(state, { type: 'wait' });
    expect(state.player.pos).toEqual({ x: 7, y: 8 });
  });

  it('emits exactly one player_pulled event with correct from/to on a successful pull', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    const pulled = result.events.filter((e) => e.type === 'player_pulled');
    expect(pulled).toHaveLength(1);
    expect(pulled[0]).toEqual({
      type: 'player_pulled',
      sourceEnemyId: 0,
      enemyType: 'kraken',
      from: { x: 8, y: 5 },
      to: { x: 7, y: 5 },
    });
  });

  it('does not pull (and applies no player_pulled event) when the pull destination is a wall', () => {
    const map = testMap();
    map.terrain[5][7] = 'wall'; // the tile the player would be pulled onto
    const state = krakenState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 }, map },
    );
    const result = processTurn(state, { type: 'wait' });
    expect(state.player.pos).toEqual({ x: 8, y: 5 });
    expect(result.events.some((e) => e.type === 'player_pulled')).toBe(false);
    // Damage must still have been applied even though the pull failed.
    expect(state.player.hp).toBeLessThan(20);
  });

  it('does not pull when the pull destination is occupied by another living enemy', () => {
    const blocker = createInitialEnemy('bok', { x: 7, y: 5 }, 3, 1, 0, 1);
    const state = krakenState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 }, extraEnemies: [blocker] },
    );
    const result = processTurn(state, { type: 'wait' });
    expect(state.player.pos).toEqual({ x: 8, y: 5 });
    expect(result.events.some((e) => e.type === 'player_pulled')).toBe(false);
  });

  it('does not pull onto the kraken\'s own tile', () => {
    // Player adjacent to the kraken; pulling would land exactly on the kraken.
    const state = krakenState({ x: 6, y: 5 }, { playerPos: { x: 7, y: 5 }, tentacleTarget: { x: 7, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(state.player.pos).toEqual({ x: 7, y: 5 }); // unchanged
    expect(result.events.some((e) => e.type === 'player_pulled')).toBe(false);
  });

  it('does not pull a defeated player', () => {
    const state = krakenState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 }, attack: 2, playerHp: 2 },
    );
    const before = { ...state.player.pos };
    processTurn(state, { type: 'wait' });
    expect(state.player.alive).toBe(false);
    expect(state.player.pos).toEqual(before); // no pull after defeat
  });

  it('does not consume an extra player action or enemy turn for the pull', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    // Exactly one player action's worth of processing occurred: no extra
    // regen/turn side effects beyond the normal single processTurn call.
    expect(state.turn).toBe(1);
  });

  it('does not trigger floor advancement even if pulled onto the exit tile', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    state.exit = { x: 7, y: 5 }; // exactly the pull destination
    // Not all enemies are defeated, so even if this were treated as
    // reaching the exit, the floor must not unlock/advance.
    const result = processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('playing');
    expect(result.events.some((e) => e.type === 'floor_advanced')).toBe(false);
  });
});

describe('kraken multiple enemies', () => {
  it('tracks tentacleTarget independently per kraken', () => {
    const other = createInitialEnemy('kraken', { x: 15, y: 15 }, 6, 2, 0, 1);
    const state = krakenState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, extraEnemies: [other] },
    );
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].tentacleTarget).toEqual({ x: 8, y: 5 });
    expect(other.tentacleTarget).toBeUndefined(); // out of range for the other kraken
  });

  it("a striking kraken's resolution does not affect another independent (out-of-range) kraken's state", () => {
    // The other kraken is far from the player and not telegraphing, so its
    // own turn this processTurn call does nothing on its own — any change
    // to it would only be attributable to the first kraken's strike.
    const other = createInitialEnemy('kraken', { x: 15, y: 15 }, 6, 2, 0, 1);
    const state = krakenState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 }, extraEnemies: [other] },
    );
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].tentacleTarget).toBeUndefined(); // struck and cleared
    expect(other.tentacleTarget).toBeUndefined(); // untouched (was already undefined, still is)
    expect(other.hp).toBe(6);
  });

  it('does not damage or forcibly move another enemy standing in the strike area', () => {
    // Uses another kraken (never moves, and out of range from the player
    // itself so it takes no independent action this turn) standing at the
    // north cell of the strike area, isolating the assertion to the
    // strike's effect on it.
    const other = createInitialEnemy('kraken', { x: 8, y: 4 }, 6, 1, 0, 1); // north of the target
    const state = krakenState(
      { x: 5, y: 5 },
      { playerPos: { x: 15, y: 15 }, tentacleTarget: { x: 8, y: 5 }, extraEnemies: [other] },
    );
    const otherPosBefore = { ...other.pos };
    processTurn(state, { type: 'wait' });
    expect(other.hp).toBe(6);
    expect(other.pos).toEqual(otherPosBefore);
  });

  it('does not carry over state when the telegraphing kraken is defeated first', () => {
    const state = krakenState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, tentacleTarget: { x: 8, y: 5 } });
    const kraken = state.enemies[0];
    kraken.hp = 0;
    kraken.alive = false;
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'kraken_tentacle_strike')).toBe(false);
  });
});

describe('kraken regression / no interference with other species state', () => {
  it('does not interfere with an independent bat retreating in the same state', () => {
    const bat = createInitialEnemy('bat', { x: 8, y: 5 }, 2, 1, 0, 1);
    bat.retreating = true;
    const state = krakenState(
      { x: 15, y: 15 },
      { playerPos: { x: 10, y: 5 }, extraEnemies: [bat] },
    );
    processTurn(state, { type: 'wait' });
    expect(state.enemies[1].retreating).toBe(false); // bat retreated normally
  });

  it('does not interfere with an independent cockatrice aiming in the same state', () => {
    const cockatrice = createInitialEnemy('cockatrice', { x: 5, y: 8 }, 3, 1, 0, 1);
    const state = krakenState(
      { x: 15, y: 15 },
      { playerPos: { x: 8, y: 8 }, extraEnemies: [cockatrice] },
    );
    processTurn(state, { type: 'wait' });
    expect(state.enemies[1].gazeDirection).toBe('E');
  });
});

describe('kraken lifecycle', () => {
  it('a fresh kraken created via createInitialEnemy starts with tentacleTarget undefined', () => {
    const kraken = createInitialEnemy('kraken', { x: 0, y: 0 }, 6, 2);
    expect(kraken.tentacleTarget).toBeUndefined();
  });
});
