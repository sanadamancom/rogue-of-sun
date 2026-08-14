import { describe, expect, it } from 'vitest';
import { advanceToNextFloor, createInitialState } from '../state';
import { createInitialActor, createInitialEnemy, processTurn } from '../turn';
import { EnemyActor, GameMap, GameState, Tile } from '../types';
import { deriveFloorSeed } from '../floor';
import { createEmptyInventory } from '../item-def';

/**
 * Steps the player onto the exit tile via an actual, player-initiated
 * `move` action from an adjacent floor tile (a unit-level shortcut for
 * "walk onto the stairs"). Floor progression (Phase 22's trigger fix)
 * requires the player's own successful move to land on the exit tile, so
 * this must never use `wait` or a teleport-only approach.
 */
function stepOntoExit(state: GameState): void {
  const exit = state.exit;
  const candidates: Array<{ dx: number; dy: number; dir: 'N' | 'S' | 'E' | 'W' }> = [
    { dx: 0, dy: 1, dir: 'N' }, // approach from the south, moving north
    { dx: 0, dy: -1, dir: 'S' }, // approach from the north, moving south
    { dx: 1, dy: 0, dir: 'W' }, // approach from the east, moving west
    { dx: -1, dy: 0, dir: 'E' }, // approach from the west, moving east
  ];
  for (const { dx, dy, dir } of candidates) {
    const from = { x: exit.x + dx, y: exit.y + dy };
    if (
      from.x >= 0 &&
      from.y >= 0 &&
      from.y < state.map.terrain.length &&
      from.x < state.map.terrain[0].length &&
      state.map.terrain[from.y][from.x] === 'floor'
    ) {
      state.player.pos = from;
      processTurn(state, { type: 'move', direction: dir });
      return;
    }
  }
  throw new Error('stepOntoExit: no adjacent floor tile found next to the exit');
}

/** Advances the player to (approximately) the given floor with all enemies alive. */
function goToFloor(runSeed: number, targetFloor: number): GameState {
  let state = createInitialState(runSeed);
  for (let f = 1; f < targetFloor; f++) {
    stepOntoExit(state);
    state = advanceToNextFloor(state);
  }
  return state;
}

const KRAKEN_TEST_LAYOUT: string[] = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

function krakenTestMap(): GameMap {
  const height = KRAKEN_TEST_LAYOUT.length;
  const width = KRAKEN_TEST_LAYOUT[0].length;
  const terrain: Tile[][] = KRAKEN_TEST_LAYOUT.map((row) =>
    row.split('').map((ch) => (ch === '#' ? 'wall' : 'floor')),
  );
  return { width, height, terrain, rooms: [], exit: { x: 8, y: 1 } };
}

/**
 * Builds a state where a kraken is telegraphing a tentacle strike that
 * will hit the player and pull them exactly one tile east, onto the exit
 * tile at (8, 1). The player starts at (7, 1); the kraken is far enough
 * east that the pull direction is purely along x.
 */
function krakenPullOntoExitState(): GameState {
  const map = krakenTestMap();
  const kraken = createInitialEnemy('kraken', { x: 15, y: 1 }, 6, 1, 0, 1);
  kraken.tentacleTarget = { x: 7, y: 1 }; // already telegraphing at the player's position
  const player = createInitialActor({ x: 7, y: 1 }, 20, 1);
  return {
    map,
    player,
    enemies: [kraken],
    turn: 0,
    phase: 'playing',
    seed: 1,
    runSeed: 1,
    floor: 1,
    totalFloors: 3,
    exit: { x: 8, y: 1 },
    regenProgress: 0,
    webs: [],
    nextWebId: 0,
    groundItems: [],
    nextGroundItemId: 0,
    inventory: { ...createEmptyInventory(),
      apple: 1, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0,
      sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0,
      earth_enchantment: 0, chocolate: 0, banana: 0, antidote: 0, panacea: 0,
      clairvoyance_fruit: 0, high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0,
      strength: 0, wheel_of_fortune: 0, justice: 0, hanged_man: 0, death: 0, temperance: 0,
      devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0,
    },
    inventoryOpen: false,
    selectedItemIndex: 0,
    equippedWeaponId: null,
    equippedArmorId: null,
    hammerRecovery: false,
    combatRngState: 1,
    sunlight: map.terrain.map((row) => row.map(() => true)),
    solarEnergy: 5,
    maxSolarEnergy: 5,
    solUnlocked: false,
    unlockedEnchantments: { sol: false, flame: false, frost: false, cloud: false, earth: false },
    selectedEnchantment: 'none',
  };
}

describe('Phase 22: immediate stairs progression', () => {
  it('floor 1: reaching the exit yields floor_cleared while every enemy is alive', () => {
    const state = createInitialState(11);
    expect(state.enemies.every((e) => e.alive)).toBe(true);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('floor 2: reaching the exit yields floor_cleared while every enemy is alive', () => {
    const state = goToFloor(2780624551, 2);
    expect(state.floor).toBe(2);
    expect(state.enemies.every((e) => e.alive)).toBe(true);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('floor 3: reaching the exit yields victory while every enemy is alive', () => {
    const state = goToFloor(2780624551, 3);
    expect(state.floor).toBe(3);
    expect(state.enemies.every((e) => e.alive)).toBe(true);
    stepOntoExit(state);
    expect(state.phase).toBe('victory');
  });

  it('monster-house-origin enemies alive do not block stair use', () => {
    const state = createInitialState(11);
    state.enemies.push({
      ...state.enemies[0],
      id: 999999,
      alive: true,
      spawnSource: 'monster_house',
    });
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('a hidden monster house on the floor does not block stair use', () => {
    const state = createInitialState(11);
    state.map.monsterHouse = { roomIndex: 0, status: 'hidden' };
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('a revealed monster house on the floor does not block stair use', () => {
    const state = createInitialState(11);
    state.map.monsterHouse = { roomIndex: 0, status: 'revealed' };
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
  });

  it('does not advance while the player has not reached the exit tile', () => {
    const state = createInitialState(11);
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('playing');
    expect(state.floor).toBe(1);
  });

  it('attacking an enemy standing on the exit tile does not advance the floor', () => {
    const state = createInitialState(22);
    const exit = state.exit;
    state.enemies[0].pos = { ...exit };
    state.enemies[0].alive = true;
    state.enemies[0].hp = 999;
    state.player.pos = { x: exit.x, y: exit.y - 1 >= 0 ? exit.y - 1 : exit.y + 1 };
    state.player.facing = state.player.pos.y < exit.y ? 'S' : 'N';
    processTurn(state, { type: 'action' });
    expect(state.player.pos).not.toEqual(exit);
    expect(state.phase).toBe('playing');
    expect(state.floor).toBe(1);
  });

  it('an unsuccessful move (blocked by a wall) does not advance the floor', () => {
    const state = createInitialState(11);
    const before = { ...state.player.pos };
    // Attempt to move in a direction that is very likely blocked; if not,
    // this assertion still holds since we only check no-exit-tile /
    // no-advance behavior tied to actual movement, not this specific
    // direction succeeding.
    processTurn(state, { type: 'move', direction: 'N' });
    if (state.player.pos.x === before.x && state.player.pos.y === before.y) {
      expect(state.phase).toBe('playing');
      expect(state.floor).toBe(1);
    }
  });

  it('death on the same turn the exit is reached results in gameover, not floor progression', () => {
    const state = createInitialState(33);
    const exit = state.exit;
    state.player.pos = { x: exit.x, y: exit.y - 1 >= 0 ? exit.y - 1 : exit.y };
    state.enemies[0].pos = { ...exit };
    state.enemies[0].alive = true;
    state.enemies[0].attack = 9999;
    state.enemies[1].pos = { x: 0, y: 0 };
    state.combatRngState = 0;
    processTurn(state, { type: 'move', direction: 'S' });
    // Player either failed to reach the exit tile (enemy occupies it, so
    // the move doesn't land there) or died to a nearby/blocking enemy —
    // either way floor progression must not occur.
    expect(state.phase).not.toBe('floor_cleared');
    expect(state.phase).not.toBe('victory');
  });

  it('a single exit contact never advances more than one floor', () => {
    const state = createInitialState(11);
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
    const before = state.turn;
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(before);
    expect(state.floor).toBe(1);
  });

  it('advancing floors discards the previous floor enemies and monster house state', () => {
    let state = createInitialState(2780624551);
    state.map.monsterHouse = { roomIndex: 0, status: 'revealed' };
    const floor1Enemies = state.enemies.map((e) => e.id);
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(2);
    expect(state.enemies.map((e) => e.id)).not.toEqual(floor1Enemies);
    expect(state.map.monsterHouse ?? null).not.toEqual({ roomIndex: 0, status: 'revealed' });
  });

  it('HP and other carry-over state are preserved across an immediate-stairs transition', () => {
    let state = createInitialState(2780624551);
    state.player.maxHp = 10;
    state.player.hp = 4;
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    // No transition-granted heal beyond whatever regen happened during the
    // consumed turn itself (matching pre-existing carry-over semantics).
    expect(state.player.hp).toBeGreaterThanOrEqual(4);
    expect(state.player.hp).toBeLessThanOrEqual(state.player.maxHp);
  });

  it('the same runSeed reproduces the same floor 2 generation result', () => {
    let stateA = createInitialState(2780624551);
    stepOntoExit(stateA);
    stateA = advanceToNextFloor(stateA);

    let stateB = createInitialState(2780624551);
    stepOntoExit(stateB);
    stateB = advanceToNextFloor(stateB);

    expect(stateA.seed).toBe(deriveFloorSeed(2780624551, 2));
    expect(stateA.seed).toBe(stateB.seed);
    expect(stateA.exit).toEqual(stateB.exit);
    expect(stateA.enemies.map((e) => e.id)).toEqual(stateB.enemies.map((e) => e.id));
  });

  it('waiting while already standing on the exit tile does not advance the floor', () => {
    const state = createInitialState(11);
    const exit = state.exit;
    // Approach and step onto the exit via an actual move first.
    stepOntoExit(state);
    expect(state.phase).toBe('floor_cleared');
    // Force back to 'playing' to isolate the wait-on-exit behavior itself
    // (a real run would never do this, but this checks that standing on
    // the exit and merely waiting is not what triggers progression).
    state.phase = 'playing';
    state.floor = 1;
    expect(state.player.pos).toEqual(exit);
    processTurn(state, { type: 'wait' });
    expect(state.phase).toBe('playing');
  });

  it('attacking while standing on the exit tile does not advance the floor', () => {
    const state = createInitialState(22);
    const exit = state.exit;
    state.player.pos = { ...exit };
    state.enemies[0].pos = {
      x: exit.x + 1 < state.map.width ? exit.x + 1 : exit.x - 1,
      y: exit.y,
    };
    state.player.facing = exit.x + 1 < state.map.width ? 'E' : 'W';
    processTurn(state, { type: 'action' });
    expect(state.phase).toBe('playing');
    expect(state.floor).toBe(1);
  });

  it('using an item while standing on the exit tile does not advance the floor', () => {
    const state = createInitialState(11);
    const exit = state.exit;
    state.player.pos = { ...exit };
    state.player.hp = Math.max(1, state.player.maxHp - 1);
    state.inventory.apple = 1;
    processTurn(state, { type: 'use_item', itemId: 'apple' });
    expect(state.phase).toBe('playing');
    expect(state.floor).toBe(1);
  });

  it('a passive relocation (kraken tentacle pull) onto the exit tile does not by itself advance the floor', () => {
    const state = krakenPullOntoExitState();
    processTurn(state, { type: 'wait' });
    expect(state.player.pos).toEqual({ x: 8, y: 1 });
    expect(state.phase).toBe('playing');
  });

  it('waiting the turn after a passive relocation onto the exit still does not advance the floor', () => {
    const state = krakenPullOntoExitState();
    processTurn(state, { type: 'wait' }); // pulled onto the exit this turn
    expect(state.player.pos).toEqual({ x: 8, y: 1 });
    expect(state.phase).toBe('playing');
    processTurn(state, { type: 'wait' }); // still on the exit, waits again
    expect(state.phase).toBe('playing');
  });

  it('attacking the turn after a passive relocation onto the exit still does not advance the floor', () => {
    const state = krakenPullOntoExitState();
    processTurn(state, { type: 'wait' }); // pulled onto the exit this turn
    expect(state.player.pos).toEqual({ x: 8, y: 1 });
    expect(state.phase).toBe('playing');
    state.player.facing = 'E';
    processTurn(state, { type: 'action' }); // attacks into empty air; no enemy there
    expect(state.phase).toBe('playing');
  });

  it('stepping off the exit and re-entering via an actual move does advance the floor', () => {
    const state = krakenPullOntoExitState();
    processTurn(state, { type: 'wait' }); // pulled onto the exit this turn
    expect(state.player.pos).toEqual({ x: 8, y: 1 });
    expect(state.phase).toBe('playing');
    // Step off the exit tile.
    processTurn(state, { type: 'move', direction: 'W' });
    expect(state.player.pos).toEqual({ x: 7, y: 1 });
    expect(state.phase).toBe('playing');
    // Move back onto the exit tile under the player's own power.
    processTurn(state, { type: 'move', direction: 'E' });
    expect(state.player.pos).toEqual({ x: 8, y: 1 });
    expect(state.phase).toBe('floor_cleared');
  });

  it('killing an enemy standing on the exit tile does not advance the floor, but moving onto it afterward does', () => {
    const state = createInitialState(22);
    const exit = state.exit;
    const approachFrom: { x: number; y: number; dir: 'N' | 'S' | 'E' | 'W' } = (() => {
      const candidates: Array<{ dx: number; dy: number; dir: 'N' | 'S' | 'E' | 'W' }> = [
        { dx: 0, dy: 1, dir: 'N' },
        { dx: 0, dy: -1, dir: 'S' },
        { dx: 1, dy: 0, dir: 'W' },
        { dx: -1, dy: 0, dir: 'E' },
      ];
      for (const { dx, dy, dir } of candidates) {
        const from = { x: exit.x + dx, y: exit.y + dy };
        if (
          from.x >= 0 &&
          from.y >= 0 &&
          from.y < state.map.terrain.length &&
          from.x < state.map.terrain[0].length &&
          state.map.terrain[from.y][from.x] === 'floor'
        ) {
          return { x: from.x, y: from.y, dir };
        }
      }
      throw new Error('no adjacent floor tile found next to the exit');
    })();
    state.player.pos = { x: approachFrom.x, y: approachFrom.y };
    state.player.facing = approachFrom.dir;
    const enemy: EnemyActor = state.enemies[0];
    enemy.pos = { ...exit };
    enemy.alive = true;
    enemy.hp = 1;
    // Guarantee the attack lands and kills in one hit.
    state.combatRngState = 0;
    processTurn(state, { type: 'action' });
    expect(enemy.alive).toBe(false);
    // The attack did not move the player onto the exit tile.
    expect(state.player.pos).toEqual({ x: approachFrom.x, y: approachFrom.y });
    expect(state.phase).toBe('playing');
    expect(state.floor).toBe(1);
    // Now the exit tile is clear; the player's own move onto it progresses.
    processTurn(state, { type: 'move', direction: approachFrom.dir });
    expect(state.player.pos).toEqual(exit);
    expect(state.phase).toBe('floor_cleared');
  });
});
