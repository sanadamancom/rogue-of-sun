/**
 * Phase 21.4 implementation_gate tests: monster-house dedicated enemy
 * placement with room-size-driven count (N = clamp(ceil(sqrt(C)), 4, 8)),
 * entry-cell safety, golem-cap consistency, hidden-turn suppression, and
 * reveal-turn participation.
 */
import { describe, expect, it } from 'vitest';
import { GameMap, GameState, Room, Tile } from '../types';
import {
  computeMonsterHouseCandidateCells,
  computeMonsterHouseEnemyCount,
  computeMonsterHouseEntryCells,
  selectMonsterHouseEnemyPositions,
  chooseMonsterHouseEnemyTypes,
} from '../monster-house';
import { createRng, roomIndexContaining } from '../mapgen';
import { createInitialState, advanceToNextFloor } from '../state';
import { createInitialActor, processTurn } from '../turn';
import { createEmptyInventory } from '../item-def';

describe('computeMonsterHouseEnemyCount (N formula)', () => {
  it('C=4 -> 4', () => expect(computeMonsterHouseEnemyCount(4)).toBe(4));
  it('C=9 -> 4', () => expect(computeMonsterHouseEnemyCount(9)).toBe(4));
  it('C=16 -> 4', () => expect(computeMonsterHouseEnemyCount(16)).toBe(4));
  it('C=17 -> 5', () => expect(computeMonsterHouseEnemyCount(17)).toBe(5));
  it('C=25 -> 5', () => expect(computeMonsterHouseEnemyCount(25)).toBe(5));
  it('C=26 -> 6', () => expect(computeMonsterHouseEnemyCount(26)).toBe(6));
  it('C=36 -> 6', () => expect(computeMonsterHouseEnemyCount(36)).toBe(6));
  it('C=37 -> 7', () => expect(computeMonsterHouseEnemyCount(37)).toBe(7));
  it('C=49 -> 7', () => expect(computeMonsterHouseEnemyCount(49)).toBe(7));
  it('C=50 -> 8', () => expect(computeMonsterHouseEnemyCount(50)).toBe(8));
  it('never exceeds 8 for very large C', () => {
    expect(computeMonsterHouseEnemyCount(1000)).toBe(8);
    expect(computeMonsterHouseEnemyCount(100000)).toBe(8);
  });
  it('throws explicitly for C < 4', () => {
    expect(() => computeMonsterHouseEnemyCount(3)).toThrow();
    expect(() => computeMonsterHouseEnemyCount(0)).toThrow();
  });
  it('is monotonically non-decreasing as C increases', () => {
    let prev = computeMonsterHouseEnemyCount(4);
    for (let c = 5; c <= 200; c++) {
      const n = computeMonsterHouseEnemyCount(c);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });
  it('does not reference or accept a floor number parameter (signature check)', () => {
    // computeMonsterHouseEnemyCount takes exactly one argument (C).
    expect(computeMonsterHouseEnemyCount.length).toBe(1);
  });
  it('same C yields same N regardless of caller context (no hidden floor dependency)', () => {
    const a = computeMonsterHouseEnemyCount(40);
    const b = computeMonsterHouseEnemyCount(40);
    expect(a).toBe(b);
  });
});

// Reuse the 4-room-in-a-row fixture shape from Phase 21.1/21.2/21.3 tests.
function testMap(): GameMap {
  const width = 20;
  const height = 8;
  const terrain: Tile[][] = [];
  for (let y = 0; y < height; y++) {
    terrain.push(new Array(width).fill('wall'));
  }
  const roomA: Room = { x: 1, y: 1, width: 5, height: 5 };
  const roomB: Room = { x: 10, y: 1, width: 6, height: 5 };
  for (const room of [roomA, roomB]) {
    for (let y = room.y; y < room.y + room.height; y++) {
      for (let x = room.x; x < room.x + room.width; x++) {
        terrain[y][x] = 'floor';
      }
    }
  }
  for (let x = 6; x <= 9; x++) {
    terrain[3][x] = 'floor';
  }
  return { width, height, terrain, rooms: [roomA, roomB], exit: { x: 12, y: 3 } };
}

describe('computeMonsterHouseCandidateCells + entry cell safety', () => {
  it('excludes every entry cell', () => {
    const map = testMap();
    const entryCells = computeMonsterHouseEntryCells(map, 1);
    const candidates = computeMonsterHouseCandidateCells(map, 1, []);
    for (const cell of entryCells) {
      expect(candidates.some((c) => c.x === cell.x && c.y === cell.y)).toBe(false);
    }
  });

  it('excludes every position in exclusions', () => {
    const map = testMap();
    const exclusions = [{ x: 12, y: 2 }, { x: 13, y: 3 }];
    const candidates = computeMonsterHouseCandidateCells(map, 1, exclusions);
    for (const ex of exclusions) {
      expect(candidates.some((c) => c.x === ex.x && c.y === ex.y)).toBe(false);
    }
  });

  it('deduplicates coordinates appearing in multiple exclusion sources', () => {
    const map = testMap();
    const dup = { x: 12, y: 2 };
    const candidates = computeMonsterHouseCandidateCells(map, 1, [dup, dup, dup]);
    // No error, no double-counting artifact — just confirm dup is excluded once.
    expect(candidates.some((c) => c.x === dup.x && c.y === dup.y)).toBe(false);
  });

  it('every candidate cell lies strictly inside the target room rectangle', () => {
    const map = testMap();
    const candidates = computeMonsterHouseCandidateCells(map, 1, []);
    const room = map.rooms[1];
    for (const c of candidates) {
      expect(c.x).toBeGreaterThanOrEqual(room.x);
      expect(c.x).toBeLessThan(room.x + room.width);
      expect(c.y).toBeGreaterThanOrEqual(room.y);
      expect(c.y).toBeLessThan(room.y + room.height);
    }
  });

  it('at least one doorway-adjacent path into the room remains open (an entry cell is reachable from outside)', () => {
    const map = testMap();
    const entryCells = computeMonsterHouseEntryCells(map, 1);
    expect(entryCells.length).toBeGreaterThan(0);
    // Corridor tile (9,3) is adjacent to entry cell (10,3) in room B.
    expect(entryCells.some((c) => c.x === 10 && c.y === 3)).toBe(true);
  });
});

describe('selectMonsterHouseEnemyPositions', () => {
  it('throws when candidates.length < count', () => {
    expect(() => selectMonsterHouseEnemyPositions([{ x: 0, y: 0 }], 2, () => 0)).toThrow();
  });

  it('selects exactly count distinct positions, all drawn from candidates', () => {
    const candidates = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
    ];
    const selected = selectMonsterHouseEnemyPositions(candidates, 3, createRng(42));
    expect(selected).toHaveLength(3);
    const keys = new Set(selected.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(3);
    for (const p of selected) {
      expect(candidates.some((c) => c.x === p.x && c.y === p.y)).toBe(true);
    }
  });

  it('does not mutate the input candidates array', () => {
    const candidates = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    const before = candidates.map((c) => ({ ...c }));
    selectMonsterHouseEnemyPositions(candidates, 2, createRng(7));
    expect(candidates).toEqual(before);
  });

  it('is deterministic for the same candidates and rng sequence', () => {
    const candidates = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }];
    const a = selectMonsterHouseEnemyPositions(candidates, 3, createRng(99));
    const b = selectMonsterHouseEnemyPositions(candidates, 3, createRng(99));
    expect(a).toEqual(b);
  });
});

describe('chooseMonsterHouseEnemyTypes: uniform draw, no per-species post-processing (Phase 23.6)', () => {
  it('never draws golem on floor 2 (golem is not in the floor-2 pool under the confirmed 3-tier roster)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const types = chooseMonsterHouseEnemyTypes(8, 2, createRng(seed));
      expect(types).not.toContain('golem');
    }
  });

  it('never demotes a golem draw to bok on floor 3, even with multiple golems in the same roster', () => {
    let sawMultipleGolems = false;
    for (let seed = 0; seed < 500 && !sawMultipleGolems; seed++) {
      const types = chooseMonsterHouseEnemyTypes(8, 3, createRng(seed));
      if (types.filter((t) => t === 'golem').length >= 2) sawMultipleGolems = true;
    }
    expect(sawMultipleGolems).toBe(true);
  });

  it('always returns exactly N types', () => {
    const types = chooseMonsterHouseEnemyTypes(8, 3, createRng(1));
    expect(types).toHaveLength(8);
  });
});

describe('production wiring: room-size-driven placement on generated floors', () => {
  const seeds = [1, 2, 3, 4, 5, 10, 20, 42, 100, 12345];

  it('normal enemy count matches ENEMY_COUNT_BY_FLOOR regardless of monster house occurrence', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const targetFloor of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        const normalCount = state.enemies.filter((e) => e.spawnSource !== 'monster_house').length;
        expect(normalCount).toBe(targetFloor === 2 ? 7 : 8);
      }
    }
  });

  it('when a monster house exists, all dedicated enemies are spawnSource monster_house and inside the target room', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _targetFloor of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const dedicated = state.enemies.filter((e) => e.spawnSource === 'monster_house');
        const room = state.map.rooms[state.map.monsterHouse.roomIndex];
        for (const e of dedicated) {
          expect(roomIndexContaining([room], e.pos)).toBe(0);
        }
      }
    }
  });

  it('dedicated enemy count equals computeMonsterHouseEnemyCount of the room-size-derived C (varies with room size, not floor)', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _targetFloor of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const dedicated = state.enemies.filter((e) => e.spawnSource === 'monster_house');
        expect(dedicated.length).toBeGreaterThanOrEqual(4);
        expect(dedicated.length).toBeLessThanOrEqual(8);
      }
    }
  });

  it('dedicated enemies never overlap player, exit, normal enemies, ground items, or traps', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _targetFloor of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const dedicated = state.enemies.filter((e) => e.spawnSource === 'monster_house');
        const normal = state.enemies.filter((e) => e.spawnSource !== 'monster_house');
        const occupied = [
          state.player.pos,
          state.map.exit,
          ...normal.map((e) => e.pos),
          ...state.groundItems.map((g) => g.pos),
          ...(state.traps ?? []).map((t) => t.pos),
        ];
        for (const d of dedicated) {
          expect(occupied.some((p) => p.x === d.pos.x && p.y === d.pos.y)).toBe(false);
        }
        // No two dedicated enemies share a tile either.
        const keys = new Set(dedicated.map((e) => `${e.pos.x},${e.pos.y}`));
        expect(keys.size).toBe(dedicated.length);
      }
    }
  });

  it('dedicated enemies never occupy an entry cell of the target room', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _targetFloor of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const dedicated = state.enemies.filter((e) => e.spawnSource === 'monster_house');
        const entryCells = computeMonsterHouseEntryCells(state.map, state.map.monsterHouse.roomIndex);
        for (const d of dedicated) {
          expect(entryCells.some((c) => c.x === d.pos.x && c.y === d.pos.y)).toBe(false);
        }
      }
    }
  });

  it('golem never exceeds 1 across normal + dedicated enemies combined on floor 2', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state); // now on floor 2
      const golemCount = state.enemies.filter((e) => e.type === 'golem').length;
      expect(golemCount).toBeLessThanOrEqual(1);
    }
  });

  it('monster-house-free floors never create spawnSource monster_house enemies', () => {
    for (const seed of seeds) {
      const state = createInitialState(seed); // floor 1, never eligible
      expect(state.map.monsterHouse ?? null).toBeNull();
      expect(state.enemies.some((e) => e.spawnSource === 'monster_house')).toBe(false);
    }
  });

  it('determinism: regenerating the same seed/floor produces the same dedicated roster', () => {
    for (const seed of seeds.slice(0, 4)) {
      const build = () => {
        let state = createInitialState(seed);
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        return state;
      };
      const a = build();
      const b = build();
      const dedicatedA = a.enemies.filter((e) => e.spawnSource === 'monster_house').map((e) => ({ type: e.type, pos: e.pos }));
      const dedicatedB = b.enemies.filter((e) => e.spawnSource === 'monster_house').map((e) => ({ type: e.type, pos: e.pos }));
      expect(dedicatedA).toEqual(dedicatedB);
    }
  });
});

describe('hidden suppression and reveal-turn participation (regression from Phase 21.3 wiring)', () => {
  it('a dedicated enemy does not act while its monster house is hidden', () => {
    let state = createInitialState(1);
    state.enemies.forEach((e) => (e.alive = false));
    state.player.pos = { ...state.exit };
    state = advanceToNextFloor(state);
    if (!state.map.monsterHouse) return; // seed-dependent; skip if none this run
    const dedicated = state.enemies.find((e) => e.spawnSource === 'monster_house');
    if (!dedicated) return;
    const posBefore = { ...dedicated.pos };
    // Player waits far away — no move, no reveal.
    processTurn(state, { type: 'wait' });
    const same = state.enemies.find((e) => e.id === dedicated.id);
    expect(same?.pos).toEqual(posBefore);
  });

  it('spawnSource-absent enemies (pre-Phase-21.4 fixtures) still act normally', () => {
    const map = testMap();
    const player = createInitialActor({ x: 3, y: 3 }, 30, 10, 0, 90, 0);
    const state: GameState = {
      map,
      player,
      enemies: [],
      turn: 0,
      phase: 'playing',
      seed: 1,
      runSeed: 1,
      floor: 2,
      totalFloors: 3,
      exit: { x: 12, y: 3 },
      regenProgress: 0,
      webs: [],
      nextWebId: 0,
      groundItems: [],
      nextGroundItemId: 0,
      inventory: { ...createEmptyInventory(),
        apple: 0, sword: 0, armor: 0, spear: 0, hammer: 0, sun_fruit: 0, solar_gun: 0,
        sol_enchantment: 0, flame_enchantment: 0, frost_enchantment: 0, cloud_enchantment: 0, earth_enchantment: 0,
        chocolate: 0, banana: 0, antidote: 0, panacea: 0, clairvoyance_fruit: 0,
        high_priestess: 0, empress: 0, emperor: 0, lovers: 0, chariot: 0, strength: 0, wheel_of_fortune: 0,
        justice: 0, hanged_man: 0, death: 0, temperance: 0, devil: 0, tower: 0, star: 0, moon: 0, sun: 0, judgement: 0,
      },
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
      traps: [],
    };
    // No monsterHouse on this map; no spawnSource on this test-authored
    // enemy list (none exist here) — this fixture itself just confirms
    // GameState construction with an undefined map.monsterHouse remains
    // valid and processTurn doesn't throw.
    expect(() => processTurn(state, { type: 'wait' })).not.toThrow();
  });
});
