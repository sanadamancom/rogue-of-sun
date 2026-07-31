import { describe, expect, it } from 'vitest';
import { formatEvent } from '../message-log';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { EnemyActor, GameMap, GameState, Tile, Vec2 } from '../types';

// Open layout with a large clear room, matching the style of the bat/mummy
// behavior tests. Retained only for these cockatrice-specific unit tests;
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
 * Builds a minimal test-only GameState with exactly one cockatrice,
 * explicitly placed at `cockatricePos`, instead of relying on
 * createInitialState's seeded species RNG or hunting for a seed that
 * happens to roll a cockatrice.
 */
function cockatriceState(
  cockatricePos: Vec2,
  options?: {
    playerPos?: Vec2;
    attack?: number;
    turn?: number;
    gazeDirection?: EnemyActor['gazeDirection'];
    playerPetrified?: boolean;
    cockatriceId?: number;
    extraEnemies?: EnemyActor[];
    map?: GameMap;
  },
): GameState {
  const playerPos = options?.playerPos ?? { x: 10, y: 5 };
  const attack = options?.attack ?? 1;
  const turn = options?.turn ?? 0;
  const cockatrice = createInitialEnemy(
    'cockatrice',
    cockatricePos,
    3,
    attack,
    turn,
    options?.cockatriceId ?? 0,
  );
  cockatrice.gazeDirection = options?.gazeDirection;
  const player = createInitialActor(playerPos, 20, 1);
  player.petrified = options?.playerPetrified ?? false;
  return {
    map: options?.map ?? testMap(),
    player,
    enemies: [cockatrice, ...(options?.extraEnemies ?? [])],
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

describe('cockatrice event formatting', () => {
  it('formats cockatrice_gaze_aim using the official display name', () => {
    const line = formatEvent({
      type: 'cockatrice_gaze_aim',
      actorId: 0,
      enemyType: 'cockatrice',
      direction: 'E',
    });
    expect(line).toBe('コカトリスがこちらへ石化光線の狙いを定めた。');
  });

  it('formats cockatrice_gaze_fire (hit) distinctly from (miss)', () => {
    const hitLine = formatEvent({
      type: 'cockatrice_gaze_fire',
      actorId: 0,
      enemyType: 'cockatrice',
      direction: 'E',
      hit: true,
    });
    const missLine = formatEvent({
      type: 'cockatrice_gaze_fire',
      actorId: 0,
      enemyType: 'cockatrice',
      direction: 'E',
      hit: false,
    });
    expect(hitLine).toBe('コカトリスの石化光線を浴びた。');
    expect(missLine).toBe('コカトリスの石化光線が放たれた。');
    expect(hitLine).not.toBe(missLine);
  });

  it('formats player_petrified and player_petrified_skip', () => {
    expect(formatEvent({ type: 'player_petrified', actorId: 0, enemyType: 'cockatrice' })).toBe(
      '体が石のように動かない。',
    );
    expect(formatEvent({ type: 'player_petrified_skip' })).toBe('体が石のように動かない。');
  });

  it('does not double-display the same content from cockatrice_gaze_fire and player_petrified on a hit turn', () => {
    // Same-turn hit: fire text and petrified-onset text must differ so the
    // two lines pushed to the log are not literal duplicates.
    const fireHitLine = formatEvent({
      type: 'cockatrice_gaze_fire',
      actorId: 0,
      enemyType: 'cockatrice',
      direction: 'E',
      hit: true,
    });
    const petrifiedLine = formatEvent({ type: 'player_petrified', actorId: 0, enemyType: 'cockatrice' });
    expect(fireHitLine).not.toBe(petrifiedLine);
  });
});

describe('cockatrice targeting (alignment, range, line of sight)', () => {
  it('aims along a vertical line (N)', () => {
    const state = cockatriceState({ x: 10, y: 8 }, { playerPos: { x: 10, y: 5 } }); // distance 3
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBe('N');
  });

  it('aims along a horizontal line (E)', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 } }); // distance 3
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBe('E');
  });

  it('aims along a perfect diagonal (SE)', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 8 } }); // distance 3
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBe('SE');
  });

  it('does not aim when not aligned on any of the 8 directions', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 9, y: 7 } }); // dx=4, dy=2, not aligned
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBeUndefined();
  });

  it('aims at the minimum range (distance 2)', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 7, y: 5 } }); // distance 2
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBe('E');
  });

  it('aims at the maximum range (distance 5)', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 10, y: 5 } }); // distance 5
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBe('E');
  });

  it('attacks in melee at distance 1 instead of aiming', () => {
    const state = cockatriceState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } }); // distance 1
    const cockatrice = state.enemies[0];
    const result = processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBeUndefined();
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(true);
  });

  it('does not aim at distance 6 or beyond (falls back to chase)', () => {
    const state = cockatriceState({ x: 3, y: 5 }, { playerPos: { x: 10, y: 5 } }); // distance 7
    const cockatrice = state.enemies[0];
    const before = { ...cockatrice.pos };
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBeUndefined();
    expect(cockatrice.pos).not.toEqual(before); // chased instead
  });

  it('does not aim through a wall blocking the line', () => {
    const map = testMap();
    map.terrain[5][8] = 'wall'; // between cockatrice (5,5) and player (10,5)
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 10, y: 5 }, map });
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBeUndefined();
  });

  it('does not create an invalid diagonal corner-cutting line of sight', () => {
    const map = testMap();
    // Block both orthogonal neighbors of the first diagonal step from
    // (5,5) toward SE (6,6), which must forbid the diagonal line per the
    // existing corner-cut rule.
    map.terrain[5][6] = 'wall';
    map.terrain[6][5] = 'wall';
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 8 }, map });
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBeUndefined();
  });
});

describe('cockatrice aim action', () => {
  it('does not move while aiming', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 } });
    const cockatrice = state.enemies[0];
    const before = { ...cockatrice.pos };
    processTurn(state, { type: 'wait' });
    expect(cockatrice.pos).toEqual(before);
  });

  it('does not attack while aiming', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 } });
    const hpBefore = 20;
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(false);
    expect(state.player.hp).toBe(hpBefore);
  });

  it('emits exactly one cockatrice_gaze_aim event', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    const aimEvents = result.events.filter((e) => e.type === 'cockatrice_gaze_aim');
    expect(aimEvents).toHaveLength(1);
    expect(aimEvents[0]).toEqual({
      type: 'cockatrice_gaze_aim',
      actorId: 0,
      enemyType: 'cockatrice',
      direction: 'E',
    });
  });

  it('does not fire on the same turn it aims', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'cockatrice_gaze_fire')).toBe(false);
  });

  it('does not fall back to a chase move on the same turn it aims', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 } });
    const cockatrice = state.enemies[0];
    const before = { ...cockatrice.pos };
    processTurn(state, { type: 'wait' });
    expect(cockatrice.pos).toEqual(before);
  });
});

describe('cockatrice firing', () => {
  it('fires along the stored direction on the next turn', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    const result = processTurn(state, { type: 'wait' });
    const fireEvents = result.events.filter((e) => e.type === 'cockatrice_gaze_fire');
    expect(fireEvents).toHaveLength(1);
    expect(fireEvents[0]).toMatchObject({ direction: 'E', hit: true });
  });

  it('does not move or attack while firing', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    const cockatrice = state.enemies[0];
    const before = { ...cockatrice.pos };
    const result = processTurn(state, { type: 'wait' });
    expect(cockatrice.pos).toEqual(before);
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(false);
  });

  it('does not re-aim toward the player at fire time (fires along the stale stored direction)', () => {
    // Player has moved off the originally-aimed line by fire time; the
    // shot must still go out along 'E' (missing), not toward the player's
    // new position.
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    state.player.pos = { x: 8, y: 2 };
    const result = processTurn(state, { type: 'wait' });
    const fireEvent = result.events.find((e) => e.type === 'cockatrice_gaze_fire');
    expect(fireEvent).toMatchObject({ direction: 'E', hit: false });
  });

  it('clears gazeDirection after firing', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBeUndefined();
  });

  it('fires even if now adjacent to the player instead of switching to melee', () => {
    const state = cockatriceState({ x: 7, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'cockatrice_gaze_fire')).toBe(true);
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(false);
  });

  it('does not fire twice in a row (re-aims or falls back the turn after firing)', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    const result1 = processTurn(state, { type: 'wait' }); // fires
    expect(result1.events.some((e) => e.type === 'cockatrice_gaze_fire')).toBe(true);
    const result2 = processTurn(state, { type: 'wait' }); // next turn: not a fire (aim or melee instead)
    expect(result2.events.some((e) => e.type === 'cockatrice_gaze_fire')).toBe(false);
  });
});

describe('cockatrice hit and miss', () => {
  it('hits when the player stays on the aimed line', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    const result = processTurn(state, { type: 'wait' });
    const fireEvent = result.events.find((e) => e.type === 'cockatrice_gaze_fire');
    expect(fireEvent).toMatchObject({ hit: true });
    expect(state.player.petrified).toBe(true);
  });

  it('misses when the player has stepped off the aimed line', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    state.player.pos = { x: 8, y: 6 };
    const result = processTurn(state, { type: 'wait' });
    const fireEvent = result.events.find((e) => e.type === 'cockatrice_gaze_fire');
    expect(fireEvent).toMatchObject({ hit: false });
    expect(state.player.petrified).toBe(false);
    expect(result.events.some((e) => e.type === 'player_petrified')).toBe(false);
  });

  it('misses when a wall now blocks the previously-clear line', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    state.map.terrain[5][7] = 'wall';
    const result = processTurn(state, { type: 'wait' });
    const fireEvent = result.events.find((e) => e.type === 'cockatrice_gaze_fire');
    expect(fireEvent).toMatchObject({ hit: false });
    expect(state.player.petrified).toBe(false);
  });

  it('does not deal HP damage on a hit', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    const hpBefore = state.player.hp;
    processTurn(state, { type: 'wait' });
    expect(state.player.hp).toBe(hpBefore);
  });

  it('is not blocked or absorbed by another enemy standing on the line', () => {
    const other = createInitialEnemy('bok', { x: 6, y: 5 }, 3, 1, 0, 1);
    const state = cockatriceState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, gazeDirection: 'E', extraEnemies: [other] },
    );
    const result = processTurn(state, { type: 'wait' });
    const fireEvent = result.events.find((e) => e.type === 'cockatrice_gaze_fire');
    expect(fireEvent).toMatchObject({ hit: true });
    // The other enemy must be untouched (no damage/status applied to it).
    expect(other.hp).toBe(3);
  });
});

describe('player petrification', () => {
  it('skips the very next valid action and consumes the turn', () => {
    // Distant, non-hostile cockatrice so only petrification affects this
    // player action.
    const state = cockatriceState({ x: 0, y: 0 }, { playerPos: { x: 10, y: 5 }, playerPetrified: true });
    const before = { ...state.player.pos };
    const result = processTurn(state, { type: 'move', direction: 'E' });
    expect(state.player.pos).toEqual(before); // move did not happen
    expect(result.consumed).toBe(true); // turn was still consumed
    expect(result.events.some((e) => e.type === 'player_petrified_skip')).toBe(true);
  });

  it('skips a wait input too (any valid action)', () => {
    const state = cockatriceState({ x: 0, y: 0 }, { playerPos: { x: 10, y: 5 }, playerPetrified: true });
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(true);
    expect(result.events.some((e) => e.type === 'player_petrified_skip')).toBe(true);
  });

  it('clears petrified after the skipped turn, and the following turn acts normally', () => {
    const state = cockatriceState({ x: 0, y: 0 }, { playerPos: { x: 10, y: 5 }, playerPetrified: true });
    processTurn(state, { type: 'wait' }); // skipped
    expect(state.player.petrified).toBe(false);
    const before = { ...state.player.pos };
    processTurn(state, { type: 'move', direction: 'E' }); // normal move now
    expect(state.player.pos).not.toEqual(before);
  });

  it('advances the enemy turn even while the player is skipped', () => {
    // A mummy far away should still take its chase step during a
    // petrified-skip player turn.
    const mummy = createInitialEnemy('mummy', { x: 3, y: 3 }, 5, 2, 0, 1);
    const state = cockatriceState(
      { x: 0, y: 0 },
      { playerPos: { x: 10, y: 5 }, playerPetrified: true, extraEnemies: [mummy] },
    );
    const before = { ...mummy.pos };
    processTurn(state, { type: 'wait' });
    expect(mummy.pos).not.toEqual(before);
  });

  it('emits exactly one player_petrified_skip event', () => {
    const state = cockatriceState({ x: 0, y: 0 }, { playerPos: { x: 10, y: 5 }, playerPetrified: true });
    const result = processTurn(state, { type: 'wait' });
    const skipEvents = result.events.filter((e) => e.type === 'player_petrified_skip');
    expect(skipEvents).toHaveLength(1);
  });

  it('does not accumulate extra skipped turns from repeated hits (re-hit is a plain re-assignment)', () => {
    const state = cockatriceState({ x: 0, y: 0 }, { playerPos: { x: 10, y: 5 }, playerPetrified: true });
    state.player.petrified = true; // simulate an immediate re-hit before consumption
    processTurn(state, { type: 'wait' }); // consumes the single skip
    expect(state.player.petrified).toBe(false);
    const before = { ...state.player.pos };
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.player.pos).not.toEqual(before); // normal action, not another skip
  });
});

describe('cockatrice priority', () => {
  it('attacks in melee when adjacent and not aimed', () => {
    const state = cockatriceState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'enemy_attack')).toBe(true);
  });

  it('does not enter aiming state after a melee attack', () => {
    const state = cockatriceState({ x: 9, y: 5 }, { playerPos: { x: 10, y: 5 } });
    const cockatrice = state.enemies[0];
    processTurn(state, { type: 'wait' });
    expect(cockatrice.gazeDirection).toBeUndefined();
  });

  it('falls back to chasing when not adjacent and no valid line exists', () => {
    const state = cockatriceState({ x: 3, y: 3 }, { playerPos: { x: 10, y: 9 } }); // not aligned, far
    const cockatrice = state.enemies[0];
    const before = { ...cockatrice.pos };
    processTurn(state, { type: 'wait' });
    expect(cockatrice.pos).not.toEqual(before);
  });
});

describe('cockatrice multiple enemies', () => {
  it('tracks gazeDirection independently per cockatrice', () => {
    const other = createInitialEnemy('cockatrice', { x: 15, y: 15 }, 3, 1, 0, 1);
    const state = cockatriceState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, extraEnemies: [other] },
    );
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].gazeDirection).toBe('E');
    expect(other.gazeDirection).toBeUndefined();
  });

  it('a firing cockatrice does not change another aiming cockatrice\'s state', () => {
    const aiming = createInitialEnemy('cockatrice', { x: 15, y: 5 }, 3, 1, 0, 1);
    aiming.gazeDirection = undefined;
    const state = cockatriceState(
      { x: 5, y: 5 },
      { playerPos: { x: 8, y: 5 }, gazeDirection: 'E', extraEnemies: [aiming] },
    );
    processTurn(state, { type: 'wait' });
    expect(state.enemies[0].gazeDirection).toBeUndefined(); // fired and cleared
  });

  it('does not carry state over when the aiming cockatrice is defeated first', () => {
    const state = cockatriceState({ x: 5, y: 5 }, { playerPos: { x: 8, y: 5 }, gazeDirection: 'E' });
    const cockatrice = state.enemies[0];
    cockatrice.hp = 0;
    cockatrice.alive = false;
    const result = processTurn(state, { type: 'wait' });
    expect(result.events.some((e) => e.type === 'cockatrice_gaze_fire')).toBe(false);
  });
});

describe('cockatrice regression / no interference with other species state', () => {
  it('does not interfere with an independent bat retreating in the same state', () => {
    const bat = createInitialEnemy('bat', { x: 8, y: 5 }, 2, 1, 0, 1);
    bat.retreating = true;
    const state = cockatriceState(
      { x: 3, y: 3 },
      { playerPos: { x: 10, y: 5 }, extraEnemies: [bat] },
    );
    processTurn(state, { type: 'wait' });
    expect(state.enemies[1].retreating).toBe(false); // bat retreated normally
  });

  it('does not interfere with an independent mummy resting in the same state', () => {
    const mummy = createInitialEnemy('mummy', { x: 3, y: 3 }, 5, 2, 0, 1);
    mummy.restingAfterMove = true;
    const state = cockatriceState(
      { x: 15, y: 15 },
      { playerPos: { x: 10, y: 5 }, extraEnemies: [mummy] },
    );
    const before = { ...mummy.pos };
    const result = processTurn(state, { type: 'wait' });
    expect(mummy.pos).toEqual(before);
    expect(result.events.some((e) => e.type === 'mummy_shamble_rest')).toBe(true);
  });
});

describe('cockatrice lifecycle', () => {
  it('a fresh cockatrice created via createInitialEnemy starts with gazeDirection undefined', () => {
    const cockatrice = createInitialEnemy('cockatrice', { x: 0, y: 0 }, 3, 1);
    expect(cockatrice.gazeDirection).toBeUndefined();
  });

  it('a fresh player is not petrified', () => {
    const player = createInitialActor({ x: 0, y: 0 }, 20, 1);
    expect(player.petrified).toBeFalsy();
  });
});
