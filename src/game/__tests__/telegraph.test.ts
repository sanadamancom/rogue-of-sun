import { describe, expect, it } from 'vitest';
import { getCockatriceTelegraph, getKrakenTelegraph } from '../telegraph';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { GameMap, GameState, Tile } from '../types';

// Open layout with a large clear room, matching the style of the other
// enemy-behavior unit tests. Retained only for these telegraph-specific
// unit tests; production maps come from mapgen.ts.
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

function baseState(map: GameMap): GameState {
  return {
    map,
    player: createInitialActor({ x: 10, y: 5 }, 20, 1),
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
    inventory: { apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0 },
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: null,
    equippedArmorId: null,
    hammerRecovery: false,
    solarEnergy: 5,
    maxSolarEnergy: 5,
  };
}

describe('getCockatriceTelegraph (reticle-only)', () => {
  it('returns null when the cockatrice is not aiming', () => {
    const map = testMap();
    const cockatrice = createInitialEnemy('cockatrice', { x: 5, y: 5 }, 3, 1, 0, 0);
    expect(getCockatriceTelegraph(map, cockatrice)).toBeNull();
  });

  it('the target tile is fixed at the tile the player occupied when aiming started', () => {
    const map = testMap();
    const state = baseState(map);
    state.player.pos = { x: 8, y: 5 };
    const cockatrice = createInitialEnemy('cockatrice', { x: 5, y: 5 }, 3, 1, 0, 0);
    state.enemies = [cockatrice];
    processTurn(state, { type: 'wait' }); // aims (distance 3, east)

    const telegraph = getCockatriceTelegraph(map, cockatrice);
    expect(telegraph).not.toBeNull();
    expect(telegraph!.targetTile).toEqual({ x: 8, y: 5 });
  });

  it('the target tile does not change after the player moves away', () => {
    const map = testMap();
    const state = baseState(map);
    state.player.pos = { x: 8, y: 5 };
    const cockatrice = createInitialEnemy('cockatrice', { x: 5, y: 5 }, 3, 1, 0, 0);
    state.enemies = [cockatrice];
    processTurn(state, { type: 'wait' }); // aims at (8,5)

    // Player steps off the line entirely (would miss at fire time), but
    // the telegraphed target tile shown to the renderer must stay put.
    state.player.pos = { x: 8, y: 2 };
    const telegraph = getCockatriceTelegraph(map, cockatrice)!;
    expect(telegraph.targetTile).toEqual({ x: 8, y: 5 });
  });

  it("does not re-derive the target tile from the player's current position", () => {
    const map = testMap();
    const cockatrice = createInitialEnemy('cockatrice', { x: 5, y: 5 }, 3, 1, 0, 0);
    cockatrice.gazeDirection = 'E';
    cockatrice.gazeTargetTile = { x: 8, y: 5 };
    // No GameState/player is even consulted by the getter — passing only
    // the map and the enemy proves the target tile comes solely from the
    // enemy's own recorded state.
    const telegraph = getCockatriceTelegraph(map, cockatrice)!;
    expect(telegraph.targetTile).toEqual({ x: 8, y: 5 });
  });

  it('returns null again immediately after firing (hit or miss)', () => {
    const map = testMap();
    const state = baseState(map);
    state.player.pos = { x: 8, y: 5 };
    const cockatrice = createInitialEnemy('cockatrice', { x: 5, y: 5 }, 3, 1, 0, 0);
    state.enemies = [cockatrice];
    processTurn(state, { type: 'wait' }); // aim
    processTurn(state, { type: 'wait' }); // fire
    expect(getCockatriceTelegraph(map, cockatrice)).toBeNull();
  });

  it('tracks independent target tiles for two cockatrices', () => {
    const map = testMap();
    const a = createInitialEnemy('cockatrice', { x: 5, y: 5 }, 3, 1, 0, 0);
    a.gazeDirection = 'E';
    a.gazeTargetTile = { x: 8, y: 5 };
    const b = createInitialEnemy('cockatrice', { x: 5, y: 8 }, 3, 1, 0, 1);
    b.gazeDirection = undefined;
    b.gazeTargetTile = undefined;
    expect(getCockatriceTelegraph(map, a)!.targetTile).toEqual({ x: 8, y: 5 });
    expect(getCockatriceTelegraph(map, b)).toBeNull();
  });

  it('a fresh cockatrice created via createInitialEnemy has no target tile (Enter/N/new-floor reset)', () => {
    const cockatrice = createInitialEnemy('cockatrice', { x: 0, y: 0 }, 3, 1);
    expect(cockatrice.gazeTargetTile).toBeUndefined();
    expect(getCockatriceTelegraph(testMap(), cockatrice)).toBeNull();
  });
});

describe('getKrakenTelegraph (reticle-only)', () => {
  it('returns null when the kraken is not telegraphing', () => {
    const map = testMap();
    const kraken = createInitialEnemy('kraken', { x: 5, y: 5 }, 6, 2, 0, 0);
    expect(getKrakenTelegraph(map, kraken)).toBeNull();
  });

  it('the center tile matches the existing telegraphed center', () => {
    const map = testMap();
    const state = baseState(map);
    state.player.pos = { x: 8, y: 5 };
    const kraken = createInitialEnemy('kraken', { x: 5, y: 5 }, 6, 2, 0, 0);
    state.enemies = [kraken];
    processTurn(state, { type: 'wait' }); // telegraphs at (8,5)

    const telegraph = getKrakenTelegraph(map, kraken);
    expect(telegraph).not.toBeNull();
    expect(telegraph!.center).toEqual(kraken.tentacleTarget);
    expect(telegraph!.center).toEqual({ x: 8, y: 5 });
  });

  it('the center tile is shown even when it sits behind a wall (walls do not hide the reticle)', () => {
    const map = testMap();
    map.terrain[5][7] = 'wall'; // between kraken and the telegraphed center
    const kraken = createInitialEnemy('kraken', { x: 5, y: 5 }, 6, 2, 0, 0);
    kraken.tentacleTarget = { x: 8, y: 5 };
    const telegraph = getKrakenTelegraph(map, kraken)!;
    expect(telegraph.center).toEqual({ x: 8, y: 5 });
  });

  it('returns null again immediately after the strike resolves', () => {
    const map = testMap();
    const state = baseState(map);
    state.player.pos = { x: 8, y: 5 };
    const kraken = createInitialEnemy('kraken', { x: 5, y: 5 }, 6, 2, 0, 0);
    state.enemies = [kraken];
    processTurn(state, { type: 'wait' }); // telegraph
    processTurn(state, { type: 'wait' }); // strike
    expect(getKrakenTelegraph(map, kraken)).toBeNull();
  });

  it('tracks independent target tiles for two krakens', () => {
    const map = testMap();
    const a = createInitialEnemy('kraken', { x: 5, y: 5 }, 6, 2, 0, 0);
    a.tentacleTarget = { x: 8, y: 5 };
    const b = createInitialEnemy('kraken', { x: 15, y: 8 }, 6, 2, 0, 1);
    b.tentacleTarget = undefined;
    expect(getKrakenTelegraph(map, a)!.center).toEqual({ x: 8, y: 5 });
    expect(getKrakenTelegraph(map, b)).toBeNull();
  });

  it('a fresh kraken created via createInitialEnemy has no telegraphed center (Enter/N/new-floor reset)', () => {
    const kraken = createInitialEnemy('kraken', { x: 0, y: 0 }, 6, 2);
    expect(kraken.tentacleTarget).toBeUndefined();
    expect(getKrakenTelegraph(testMap(), kraken)).toBeNull();
  });
});

describe('mixed cockatrice + kraken telegraphs in the same state', () => {
  it('handles both species telegraphing independently at once', () => {
    const map = testMap();
    const state = baseState(map);
    state.player.pos = { x: 8, y: 5 };
    const cockatrice = createInitialEnemy('cockatrice', { x: 5, y: 5 }, 3, 1, 0, 0);
    const kraken = createInitialEnemy('kraken', { x: 12, y: 5 }, 6, 2, 0, 1);
    state.enemies = [cockatrice, kraken];
    processTurn(state, { type: 'wait' }); // both telegraph this turn

    const cockatriceTelegraph = getCockatriceTelegraph(map, cockatrice);
    const krakenTelegraph = getKrakenTelegraph(map, kraken);
    expect(cockatriceTelegraph).not.toBeNull();
    expect(krakenTelegraph).not.toBeNull();
    expect(cockatriceTelegraph!.targetTile).toEqual({ x: 8, y: 5 });
    expect(krakenTelegraph!.center).toEqual({ x: 8, y: 5 });
  });
});

describe('shared telegraph rendering regressions', () => {
  it('a non-telegraphing bok produces no cockatrice/kraken telegraph', () => {
    const map = testMap();
    const bok = createInitialEnemy('bok', { x: 5, y: 5 }, 3, 1, 0, 0);
    expect(getCockatriceTelegraph(map, bok)).toBeNull();
    expect(getKrakenTelegraph(map, bok)).toBeNull();
  });

  it("does not affect other enemies' per-instance state (bat retreating) in the same state", () => {
    const map = testMap();
    const state = baseState(map);
    state.player.pos = { x: 8, y: 5 };
    const cockatrice = createInitialEnemy('cockatrice', { x: 5, y: 5 }, 3, 1, 0, 0);
    const bat = createInitialEnemy('bat', { x: 9, y: 5 }, 2, 1, 0, 1);
    bat.retreating = true;
    state.enemies = [cockatrice, bat];
    processTurn(state, { type: 'wait' });
    getCockatriceTelegraph(map, cockatrice); // read-only, must not mutate anything
    expect(bat.retreating).toBe(false); // bat still resolves its own retreat normally
  });
});

describe('attack range and hit detection unaffected by the reticle-only display change', () => {
  it('cockatrice still hits when the player stays on the aimed line (unchanged behavior)', () => {
    const map = testMap();
    const state = baseState(map);
    state.player.pos = { x: 8, y: 5 };
    const cockatrice = createInitialEnemy('cockatrice', { x: 5, y: 5 }, 3, 1, 0, 0);
    state.enemies = [cockatrice];
    processTurn(state, { type: 'wait' }); // aim
    const result = processTurn(state, { type: 'wait' }); // fire
    const fireEvent = result.events.find((e) => e.type === 'cockatrice_gaze_fire');
    expect(fireEvent).toMatchObject({ hit: true });
  });

  it('kraken still hits the full cross area (unchanged behavior)', () => {
    const map = testMap();
    const state = baseState(map);
    state.player.pos = { x: 8, y: 4 }; // north cell of the (8,5) cross, not the center
    const kraken = createInitialEnemy('kraken', { x: 5, y: 5 }, 6, 2, 0, 0);
    kraken.tentacleTarget = { x: 8, y: 5 };
    state.enemies = [kraken];
    const result = processTurn(state, { type: 'wait' }); // strikes immediately (already telegraphing)
    const strikeEvent = result.events.find((e) => e.type === 'kraken_tentacle_strike');
    expect(strikeEvent).toMatchObject({ hit: true });
  });
});
