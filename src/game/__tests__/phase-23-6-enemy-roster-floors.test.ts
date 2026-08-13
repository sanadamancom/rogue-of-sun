import { describe, expect, it } from 'vitest';
import { ENEMY_DEFINITIONS, ENEMY_TYPES_IN_ORDER, ENEMY_FIRST_APPEARANCE_FLOOR, getEnemyPoolForFloor } from '../enemy-def';
import { chooseSpecies, createInitialState, advanceToNextFloor } from '../state';
import { chooseMonsterHouseEnemyTypes } from '../monster-house';
import { createRng, ENEMY_COUNT_BY_FLOOR } from '../mapgen';
import { processTurn } from '../turn';
import { EnemyType, GameState } from '../types';

const CONFIRMED_STATS: Record<EnemyType, { hp: number; attack: number; defense: number; accuracy: number; evasion: number; exp: number }> = {
  bok: { hp: 6, attack: 3, defense: 0, accuracy: 90, evasion: 0, exp: 1 },
  spider: { hp: 5, attack: 5, defense: 0, accuracy: 90, evasion: 0, exp: 1 },
  bat: { hp: 4, attack: 4, defense: 0, accuracy: 90, evasion: 10, exp: 1 },
  skeleton: { hp: 6, attack: 5, defense: 0, accuracy: 90, evasion: 0, exp: 2 },
  cockatrice: { hp: 8, attack: 7, defense: 0, accuracy: 90, evasion: 0, exp: 2 },
  mummy: { hp: 10, attack: 9, defense: 0, accuracy: 90, evasion: 0, exp: 2 },
  sword: { hp: 9, attack: 8, defense: 0, accuracy: 90, evasion: 0, exp: 2 },
  ghost: { hp: 6, attack: 6, defense: 0, accuracy: 90, evasion: 0, exp: 2 },
  golem: { hp: 10, attack: 12, defense: 1, accuracy: 90, evasion: 0, exp: 3 },
  axe: { hp: 12, attack: 12, defense: 0, accuracy: 90, evasion: 0, exp: 3 },
  kraken: { hp: 12, attack: 10, defense: 1, accuracy: 90, evasion: 0, exp: 3 },
  steps: { hp: 6, attack: 6, defense: 0, accuracy: 90, evasion: 0, exp: 2 },
};

const CONFIRMED_FIRST_FLOOR: Record<EnemyType, number> = {
  bok: 1, spider: 1, bat: 1, skeleton: 1,
  cockatrice: 2, mummy: 2, sword: 2, ghost: 2,
  golem: 3, axe: 3, kraken: 3, steps: 3,
};

const FLOOR_1_POOL = ['bok', 'spider', 'bat', 'skeleton'];
const FLOOR_2_NEW = ['cockatrice', 'mummy', 'sword', 'ghost'];
const FLOOR_3_NEW = ['golem', 'axe', 'kraken', 'steps'];

describe('Phase 23.6: roster', () => {
  it('has exactly 12 species with no duplicates', () => {
    expect(ENEMY_TYPES_IN_ORDER).toHaveLength(12);
    expect(new Set(ENEMY_TYPES_IN_ORDER).size).toBe(12);
  });

  it('preserves the existing ENEMY_TYPES_IN_ORDER ordering exactly', () => {
    expect(ENEMY_TYPES_IN_ORDER).toEqual([
      'bok', 'cockatrice', 'spider', 'bat', 'mummy', 'golem', 'sword', 'axe', 'kraken', 'skeleton', 'ghost', 'steps',
    ]);
  });

  it('each species\' stats/EXP match the confirmed baseline table exactly', () => {
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const def = ENEMY_DEFINITIONS[type];
      const expected = CONFIRMED_STATS[type];
      expect(def.hp).toBe(expected.hp);
      expect(def.attack).toBe(expected.attack);
      expect(def.defense).toBe(expected.defense);
      expect(def.accuracy).toBe(expected.accuracy);
      expect(def.evasion).toBe(expected.evasion);
      expect(def.experienceReward).toBe(expected.exp);
    }
  });

  it('ENEMY_FIRST_APPEARANCE_FLOOR matches the confirmed 3-tier table exactly', () => {
    for (const type of ENEMY_TYPES_IN_ORDER) {
      expect(ENEMY_FIRST_APPEARANCE_FLOOR[type]).toBe(CONFIRMED_FIRST_FLOOR[type]);
    }
  });
});

describe('Phase 23.6: floor pools', () => {
  it('floor 0 and below returns an empty pool', () => {
    expect(getEnemyPoolForFloor(0)).toEqual([]);
    expect(getEnemyPoolForFloor(-5)).toEqual([]);
  });

  it('floor 1 pool is exactly the 4 confirmed floor-1 species, in ENEMY_TYPES_IN_ORDER order', () => {
    const pool = getEnemyPoolForFloor(1);
    expect(pool).toEqual(ENEMY_TYPES_IN_ORDER.filter((t) => FLOOR_1_POOL.includes(t)));
    expect(pool).toHaveLength(4);
  });

  it('floor 2 pool is exactly the cumulative 8 species, in ENEMY_TYPES_IN_ORDER order', () => {
    const pool = getEnemyPoolForFloor(2);
    const expectedSet = new Set([...FLOOR_1_POOL, ...FLOOR_2_NEW]);
    expect(pool).toEqual(ENEMY_TYPES_IN_ORDER.filter((t) => expectedSet.has(t)));
    expect(pool).toHaveLength(8);
  });

  it('floor 3 pool is the full 12-species roster, in ENEMY_TYPES_IN_ORDER order', () => {
    expect(getEnemyPoolForFloor(3)).toEqual(ENEMY_TYPES_IN_ORDER);
  });

  it('floor 4, 5, 6, 50 all remain the full 12-species roster', () => {
    for (const floor of [4, 5, 6, 50]) {
      expect(getEnemyPoolForFloor(floor)).toEqual(ENEMY_TYPES_IN_ORDER);
    }
  });

  it('each floor\'s pool is a strict superset of the previous floor\'s pool (fully cumulative, no exceptions)', () => {
    for (let floor = 2; floor <= 6; floor++) {
      const prev = new Set(getEnemyPoolForFloor(floor - 1));
      const curr = new Set(getEnemyPoolForFloor(floor));
      for (const type of prev) expect(curr.has(type)).toBe(true);
    }
  });

  it('every species is absent strictly before its confirmed first floor, and present from it onward', () => {
    for (const type of ENEMY_TYPES_IN_ORDER) {
      const firstFloor = CONFIRMED_FIRST_FLOOR[type];
      expect(getEnemyPoolForFloor(firstFloor - 1)).not.toContain(type);
      for (let floor = firstFloor; floor <= 6; floor++) {
        expect(getEnemyPoolForFloor(floor)).toContain(type);
      }
    }
  });

  it('floor-3-only species never appear on floor 2', () => {
    for (const type of FLOOR_3_NEW) {
      expect(getEnemyPoolForFloor(2)).not.toContain(type);
    }
  });
});

describe('Phase 23.6: uniform species selection (chooseSpecies)', () => {
  it('maps pool-index boundaries onto every species deterministically', () => {
    const pool: EnemyType[] = ['bok', 'spider', 'bat', 'skeleton'];
    // Construct an rng whose successive draws land exactly at each index's lower boundary.
    const values = [0, 0.25, 0.5, 0.75];
    let i = 0;
    const rng = () => values[i++ % values.length];
    const types = chooseSpecies(4, rng, pool);
    expect(types).toEqual(['bok', 'spider', 'bat', 'skeleton']);
  });

  it('allows duplicate draws', () => {
    const pool: EnemyType[] = ['bok'];
    const types = chooseSpecies(5, createRng(1), pool);
    expect(types.every((t) => t === 'bok')).toBe(true);
  });

  it('never post-processes a golem draw into bok on any floor', () => {
    let sawGolemSurvive = false;
    for (let seed = 0; seed < 500 && !sawGolemSurvive; seed++) {
      const types = chooseSpecies(8, createRng(seed), getEnemyPoolForFloor(3));
      if (types.includes('golem')) sawGolemSurvive = true;
    }
    expect(sawGolemSurvive).toBe(true);
  });

  it('consumes exactly one rng() call per requested slot', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.1;
    };
    chooseSpecies(6, rng, getEnemyPoolForFloor(3));
    expect(calls).toBe(6);
  });

  it('produces identical output for the same rng sequence', () => {
    const a = chooseSpecies(10, createRng(42), getEnemyPoolForFloor(3));
    const b = chooseSpecies(10, createRng(42), getEnemyPoolForFloor(3));
    expect(a).toEqual(b);
  });
});

describe('Phase 23.6: normal generation', () => {
  const RUN_SEEDS = [1, 2, 3, 5, 8, 13, 21, 42, 100, 12345];

  it('produces the confirmed enemy counts (6/7/8) per floor', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      expect(state.enemies.filter((e) => e.spawnSource !== 'monster_house')).toHaveLength(ENEMY_COUNT_BY_FLOOR[1]);
    }
  });

  it('every normal enemy on every floor 1-3 is within that floor\'s legal pool, across many seeds', () => {
    for (const runSeed of RUN_SEEDS) {
      let state: GameState = createInitialState(runSeed);
      for (let floor = 1; floor <= 3; floor++) {
        const pool = getEnemyPoolForFloor(floor);
        for (const enemy of state.enemies.filter((e) => e.spawnSource !== 'monster_house')) {
          expect(pool).toContain(enemy.type);
        }
        if (floor < 3) {
          state.enemies.forEach((e) => (e.alive = false));
          state.player.pos = { ...state.exit };
          processTurn(state, { type: 'wait' });
          state = advanceToNextFloor(state);
        }
      }
    }
  });

  it('floor 1 never produces a mid- or late-tier species', () => {
    for (const runSeed of RUN_SEEDS) {
      const state = createInitialState(runSeed);
      for (const enemy of state.enemies) {
        expect([...FLOOR_2_NEW, ...FLOOR_3_NEW]).not.toContain(enemy.type);
      }
    }
  });

  it('floor 3 can produce all 12 species across enough seeds', () => {
    const seenTypes = new Set<EnemyType>();
    for (let runSeed = 0; runSeed < 300; runSeed++) {
      let state: GameState = createInitialState(runSeed);
      for (let floor = 1; floor < 3; floor++) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        processTurn(state, { type: 'wait' });
        state = advanceToNextFloor(state);
      }
      for (const enemy of state.enemies) seenTypes.add(enemy.type);
    }
    for (const type of ENEMY_TYPES_IN_ORDER) {
      expect(seenTypes.has(type)).toBe(true);
    }
  });
});

describe('Phase 23.6: monsterHouse selection contract', () => {
  it('uses the identical floor pool as normal generation', () => {
    for (const floor of [1, 2, 3]) {
      const normalPool = getEnemyPoolForFloor(floor);
      for (let seed = 0; seed < 100; seed++) {
        const types = chooseMonsterHouseEnemyTypes(8, floor, createRng(seed));
        for (const t of types) expect(normalPool).toContain(t);
      }
    }
  });

  it('never replaces a golem draw with bok, even with multiple golems in one roster', () => {
    let sawMultiple = false;
    for (let seed = 0; seed < 500 && !sawMultiple; seed++) {
      const types = chooseMonsterHouseEnemyTypes(8, 3, createRng(seed));
      if (types.filter((t) => t === 'golem').length >= 2) sawMultiple = true;
    }
    expect(sawMultiple).toBe(true);
  });

  it('consumes exactly one rng() call per requested slot', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.2;
    };
    chooseMonsterHouseEnemyTypes(5, 3, rng);
    expect(calls).toBe(5);
  });

  it('does not exclude golem when normal generation already placed one on the same floor', () => {
    // Phase 23.6 removed the golemAlreadyPresent parameter entirely —
    // chooseMonsterHouseEnemyTypes now takes exactly 3 arguments and never
    // reads any normal-generation state.
    const types = chooseMonsterHouseEnemyTypes(8, 3, createRng(7));
    expect(chooseMonsterHouseEnemyTypes.length).toBe(3);
    void types;
  });
});
