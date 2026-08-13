import { describe, expect, it } from 'vitest';
import { ENEMY_COUNT_BY_FLOOR, ENEMY_COUNT_PER_FLOOR, choosePlacement, createRng, generateMap } from '../mapgen';
import { advanceToNextFloor, buildRosterPreviewFloorState, createInitialState } from '../state';
import { ENEMY_TYPES_IN_ORDER, getEnemyPoolForFloor } from '../enemy-def';
import { deriveFloorSeed } from '../floor';

describe('Phase 15.5: ENEMY_COUNT_BY_FLOOR canonical values', () => {
  it('is exactly {1:6, 2:7, 3:8}', () => {
    expect(ENEMY_COUNT_BY_FLOOR).toEqual({ 1: 6, 2: 7, 3: 8 });
  });
});

describe('Phase 15.5: normal generation uses the per-floor count', () => {
  // Phase 21.4 correction: ENEMY_COUNT_BY_FLOOR (6/7/8) counts NORMAL
  // enemies only — it was never a fixed total for state.enemies, but the
  // distinction was invisible before Phase 21.4 introduced dedicated
  // monster-house enemies (spawnSource: 'monster_house') that also live
  // in state.enemies. These assertions now filter to
  // spawnSource !== 'monster_house' (which also correctly includes any
  // enemy with spawnSource absent, matching every enemy's default
  // treatment as normal — see monster-house.ts/turn.ts's hidden-check).
  // The expected values themselves (6/7/8) are unchanged.
  const isNormalEnemy = (e: { spawnSource?: 'normal' | 'monster_house' }) => e.spawnSource !== 'monster_house';

  it('floor 1 always generates exactly 6 enemies', () => {
    for (let seed = 0; seed < 60; seed++) {
      const state = createInitialState(seed);
      expect(state.enemies.filter(isNormalEnemy)).toHaveLength(6);
    }
  });

  it('floor 2 always generates exactly 7 enemies', () => {
    for (let seed = 0; seed < 60; seed++) {
      let state = createInitialState(seed);
      state.enemies.forEach((e) => (e.alive = false));
      state.player.pos = { ...state.exit };
      state = advanceToNextFloor(state);
      expect(state.enemies.filter(isNormalEnemy)).toHaveLength(7);
    }
  });

  it('floor 3 always generates exactly 8 enemies', () => {
    for (let seed = 0; seed < 60; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor < 3; floor++) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
      }
      expect(state.floor).toBe(3);
      expect(state.enemies.filter(isNormalEnemy)).toHaveLength(8);
    }
  });
});

describe('Phase 15.5: enemyCount resolution order', () => {
  it('an explicit enemyCount override takes priority over the per-floor normal value', () => {
    // buildRosterPreviewFloorState always passes an explicit override
    // (ENEMY_TYPES_IN_ORDER.length = 10, grown from 9 by Phase 23.1's
    // skeleton addition), which must win over floor 1's normal value of
    // 6.
    const state = buildRosterPreviewFloorState(42);
    expect(state.enemies).toHaveLength(ENEMY_TYPES_IN_ORDER.length);
    expect(state.enemies).toHaveLength(10);
  });

  it('choosePlacement itself still defaults to ENEMY_COUNT_PER_FLOOR when no count is passed (unrelated to floor resolution, which is state.ts\'s responsibility)', () => {
    const floorSeed = deriveFloorSeed(1, 1);
    const result = generateMap(floorSeed);
    if (!result.ok || !result.map) throw new Error('map generation failed');
    const rng = createRng(floorSeed ^ 0x51ed270b);
    const placement = choosePlacement(result.map, rng);
    expect(placement.enemies).toHaveLength(ENEMY_COUNT_PER_FLOOR);
  });

  it('enemyCount=0 is honored as a valid override (not treated as "no override")', () => {
    const floorSeed = deriveFloorSeed(1, 1);
    const result = generateMap(floorSeed);
    if (!result.ok || !result.map) throw new Error('map generation failed');
    const rng = createRng(floorSeed ^ 0x51ed270b);
    const placement = choosePlacement(result.map, rng, 0);
    expect(placement.enemies).toHaveLength(0);
  });
});

describe('Phase 15.5: unsupported floor numbers fall back to ENEMY_COUNT_PER_FLOOR', () => {
  it('ENEMY_COUNT_BY_FLOOR has no entry for floor 0 or floor 4+', () => {
    expect(ENEMY_COUNT_BY_FLOOR[0]).toBeUndefined();
    expect(ENEMY_COUNT_BY_FLOOR[4]).toBeUndefined();
    expect(ENEMY_COUNT_BY_FLOOR[99]).toBeUndefined();
  });

  it('the resolution formula falls back to ENEMY_COUNT_PER_FLOOR for an undefined floor (defensive; TOTAL_FLOORS=3 means this never triggers in normal play)', () => {
    const enemyCount: number | undefined = undefined;
    const floor = 4;
    const resolved = enemyCount ?? ENEMY_COUNT_BY_FLOOR[floor] ?? ENEMY_COUNT_PER_FLOOR;
    expect(resolved).toBe(ENEMY_COUNT_PER_FLOOR);
    expect(resolved).toBe(2);
  });
});

describe('Phase 15.5: enemy species pool is unaffected by the count change', () => {
  it('every spawned enemy on every floor is still within that floor\'s unlocked species pool', () => {
    for (let seed = 0; seed < 40; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        const pool = getEnemyPoolForFloor(state.floor);
        for (const enemy of state.enemies) {
          expect(pool).toContain(enemy.type);
        }
        if (floor < 3) {
          state.enemies.forEach((e) => (e.alive = false));
          state.player.pos = { ...state.exit };
          state = advanceToNextFloor(state);
        }
      }
    }
  });
});

describe('Phase 15.5: interaction with Phase 15.4b ground item / trap generation', () => {
  it('groundItems still land between 2 and 6 per floor after the enemy count increase', () => {
    // Phase 21.5 correction: same normal-vs-total distinction as
    // phase-15-4-random-ground-items.test.ts — filter out dedicated
    // monster-house rewards before checking the 2-6 bound.
    for (let seed = 0; seed < 100; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        const normalGroundItems = state.groundItems.filter((item) => item.spawnSource !== 'monster_house');
        expect(normalGroundItems.length).toBeGreaterThanOrEqual(2);
        expect(normalGroundItems.length).toBeLessThanOrEqual(6);
        if (floor < 3) {
          state.enemies.forEach((e) => (e.alive = false));
          state.player.pos = { ...state.exit };
          state = advanceToNextFloor(state);
        }
      }
    }
  });

  it('no coordinate overlap between enemies, groundItems, traps, start, or exit, across many seeds', () => {
    for (let seed = 0; seed < 100; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= 3; floor++) {
        const occupied = new Map<string, string>();
        const claim = (pos: { x: number; y: number }, label: string) => {
          const key = `${pos.x},${pos.y}`;
          expect(occupied.has(key)).toBe(false);
          occupied.set(key, label);
        };
        claim(state.player.pos, 'start');
        for (const enemy of state.enemies) claim(enemy.pos, 'enemy');
        for (const item of state.groundItems) claim(item.pos, 'item');
        for (const trap of state.traps ?? []) claim(trap.pos, 'trap');
        if (floor < 3) {
          state.enemies.forEach((e) => (e.alive = false));
          state.player.pos = { ...state.exit };
          state = advanceToNextFloor(state);
        }
      }
    }
  });
});

describe('Phase 15.5: robustness (1000 seeds per floor, 300 multi-floor runs)', () => {
  it('floor 1 generation never throws across 1000 seeds', () => {
    expect(() => {
      for (let seed = 0; seed < 1000; seed++) {
        createInitialState(seed);
      }
    }).not.toThrow();
  });

  const isNormalEnemy = (e: { spawnSource?: 'normal' | 'monster_house' }) => e.spawnSource !== 'monster_house';

  it('a full 3-floor run never throws across 300 seeds, and every floor has the correct enemy count', () => {
    for (let seed = 0; seed < 300; seed++) {
      let state = createInitialState(seed);
      expect(state.enemies.filter(isNormalEnemy)).toHaveLength(6);
      for (let floor = 1; floor < 3; floor++) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
      }
      expect(state.floor).toBe(3);
      expect(state.enemies.filter(isNormalEnemy)).toHaveLength(8);
    }
  });

  it('every enemy is on a floor tile, not on start/exit, and not adjacent to start, across 1000 seeds', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const state = createInitialState(seed);
      for (const enemy of state.enemies) {
        expect(state.map.terrain[enemy.pos.y][enemy.pos.x]).toBe('floor');
        expect(enemy.pos).not.toEqual(state.player.pos);
        expect(enemy.pos).not.toEqual(state.exit);
        const dx = Math.abs(enemy.pos.x - state.player.pos.x);
        const dy = Math.abs(enemy.pos.y - state.player.pos.y);
        expect(dx > 1 || dy > 1).toBe(true);
      }
    }
  });
});

describe('Phase 15.5: determinism', () => {
  it('the same seed reproduces identical enemy count, species, and positions', () => {
    for (const seed of [1, 7, 42, 999, 123456]) {
      const a = createInitialState(seed);
      const b = createInitialState(seed);
      expect(a.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
        b.enemies.map((e) => ({ type: e.type, pos: e.pos })),
      );
    }
  });

  it('carrying player stats across floors does not change the next floor\'s enemy count or positions', () => {
    for (const seed of [1, 7, 42]) {
      let stateA = createInitialState(seed);
      stateA.enemies.forEach((e) => (e.alive = false));
      stateA.player.pos = { ...stateA.exit };
      stateA = advanceToNextFloor(stateA);

      let stateB = createInitialState(seed);
      stateB.player.hp = 1; // different carried HP
      stateB.enemies.forEach((e) => (e.alive = false));
      stateB.player.pos = { ...stateB.exit };
      stateB = advanceToNextFloor(stateB);

      expect(stateA.enemies.map((e) => ({ type: e.type, pos: e.pos }))).toEqual(
        stateB.enemies.map((e) => ({ type: e.type, pos: e.pos })),
      );
    }
  });

  it('different seeds do not all collapse to the same enemy layout', () => {
    const results = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const state = createInitialState(seed);
      results.add(JSON.stringify(state.enemies.map((e) => ({ type: e.type, pos: e.pos }))));
    }
    expect(results.size).toBeGreaterThan(1);
  });
});
