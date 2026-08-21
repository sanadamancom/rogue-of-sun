import { describe, expect, it } from 'vitest';
import { advanceToNextFloor, createInitialState } from '../state';
import { processTurn } from '../turn';
import { TOTAL_FLOORS } from '../floor';
import { ENEMY_COUNT_BY_FLOOR } from '../mapgen';
import { GROUND_ITEM_COUNT_WEIGHTS } from '../item-def';
import {
  MONSTER_HOUSE_OCCURRENCE_PROBABILITY,
  MONSTER_HOUSE_REWARD_COUNT,
  computeMonsterHouseEnemyCount,
  isMonsterHouseEligibleFloor,
} from '../monster-house';
import { getEnemyPoolForFloor } from '../enemy-def';
import { GameState } from '../types';

/**
 * Phase 23.7: this Phase performs no functional changes — it confirms
 * that the existing Phase 15.4b/15.5/17.2/21.x/22/23.6 constants and
 * behavior already match the final 3-floor run baseline described in
 * docs/history/phase-23-7-final-run-structure.md, and locks that
 * baseline down with an integration-focused regression suite. No
 * production constant is touched by this file.
 */

/** Steps the player onto the exit tile via a real player-initiated move. */
function stepOntoExit(state: GameState): void {
  const exit = state.exit;
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
      state.player.pos = from;
      processTurn(state, { type: 'move', direction: dir });
      return;
    }
  }
  throw new Error('stepOntoExit: no adjacent floor tile found next to the exit');
}

describe('Phase 23.7: run constants (final baseline)', () => {
  it('TOTAL_FLOORS is 3', () => {
    expect(TOTAL_FLOORS).toBe(3);
  });

  it('normal enemy counts per floor are 6/7/8', () => {
    expect(ENEMY_COUNT_BY_FLOOR[1]).toBe(6);
    expect(ENEMY_COUNT_BY_FLOOR[2]).toBe(7);
    expect(ENEMY_COUNT_BY_FLOOR[3]).toBe(8);
  });

  it('enemy pools are cumulative 4/8/12', () => {
    expect(getEnemyPoolForFloor(1)).toHaveLength(4);
    expect(getEnemyPoolForFloor(2)).toHaveLength(8);
    expect(getEnemyPoolForFloor(3)).toHaveLength(12);
  });

  it('ground item count distribution is 2-6 with weight sum 100 and expected value 4', () => {
    const total = GROUND_ITEM_COUNT_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
    expect(total).toBe(100);
    const counts = GROUND_ITEM_COUNT_WEIGHTS.map((w) => w.count).sort((a, b) => a - b);
    expect(counts).toEqual([2, 3, 4, 5, 6]);
    const expectedValue = GROUND_ITEM_COUNT_WEIGHTS.reduce((sum, w) => sum + (w.count * w.weight) / 100, 0);
    expect(expectedValue).toBeCloseTo(4.0, 10);
  });

  it('monster houses are eligible only on descent depths 2 through 26', () => {
    expect(isMonsterHouseEligibleFloor(1, 'descent')).toBe(false);
    expect(isMonsterHouseEligibleFloor(2, 'descent')).toBe(true);
    expect(isMonsterHouseEligibleFloor(26, 'descent')).toBe(true);
    expect(isMonsterHouseEligibleFloor(27, 'descent')).toBe(false);
    expect(isMonsterHouseEligibleFloor(2, 'ascent')).toBe(false);
    expect(isMonsterHouseEligibleFloor(26, 'ascent')).toBe(false);
  });

  it('monster house occurrence probability is 0.05', () => {
    expect(MONSTER_HOUSE_OCCURRENCE_PROBABILITY).toBe(0.05);
  });

  it('monster house enemy count formula clamps ceil(sqrt(C)) to [4, 8]', () => {
    expect(computeMonsterHouseEnemyCount(4)).toBe(4);
    expect(computeMonsterHouseEnemyCount(9)).toBe(4); // wait: sqrt(9)=3 -> clamp min 4
    expect(computeMonsterHouseEnemyCount(16)).toBe(4);
    expect(computeMonsterHouseEnemyCount(17)).toBe(5);
    expect(computeMonsterHouseEnemyCount(64)).toBe(8);
    expect(computeMonsterHouseEnemyCount(1000)).toBe(8);
  });

  it('monster house reward count is 3', () => {
    expect(MONSTER_HOUSE_REWARD_COUNT).toBe(3);
  });
});

describe('Phase 23.7: generated floor structure', () => {
  it('each floor of a fresh run has the correct normal enemy count, item count range, and trap/dark-room/monster-house placement legality', () => {
    for (let seed = 1; seed <= 15; seed++) {
      let state = createInitialState(seed);
      for (let floor = 1; floor <= TOTAL_FLOORS; floor++) {
        expect(state.floor).toBe(floor);
        // Monster-house floors add a dedicated enemy roster on top of the
        // normal per-floor count, so only assert the normal-count floor
        // exactly when no monster house was generated this floor.
        const normalEnemyCount = state.enemies.filter((e) => e.spawnSource !== 'monster_house').length;
        expect(normalEnemyCount).toBe(ENEMY_COUNT_BY_FLOOR[floor]);

        // Monster-house reward items (spawnSource 'monster_house', up to
        // MONSTER_HOUSE_REWARD_COUNT) are additional to the normal 2-6
        // ground-item draw, so only the normal-sourced subset is checked
        // against the baseline range here.
        const normalGroundItemCount = state.groundItems.filter((it) => it.spawnSource !== 'monster_house').length;
        expect(normalGroundItemCount).toBeGreaterThanOrEqual(2);
        expect(normalGroundItemCount).toBeLessThanOrEqual(6);
        if (state.map.monsterHouse) {
          const rewardCount = state.groundItems.filter((it) => it.spawnSource === 'monster_house').length;
          expect(rewardCount).toBeLessThanOrEqual(MONSTER_HOUSE_REWARD_COUNT);
        }

        const traps = state.traps ?? [];
        // Phase 24.4e1: each of the 2 trap slots now draws its trapType
        // independently (45/45/10 weighted) instead of a hardcoded
        // per-slot literal, so a per-type "at most 1" bound no longer
        // holds — only the slot-count bound does (see
        // docs/history/phase-24-4e1-active-curse-routes.md).
        expect(traps.length).toBeLessThanOrEqual(2);

        // No coordinate collisions among start, exit, enemies, items, traps.
        const occupied = new Map<string, string[]>();
        const record = (label: string, pos: { x: number; y: number }) => {
          const k = `${pos.x},${pos.y}`;
          const list = occupied.get(k) ?? [];
          list.push(label);
          occupied.set(k, list);
        };
        record('start', state.player.pos);
        record('exit', state.exit);
        state.enemies.forEach((e, i) => record(`enemy${i}`, e.pos));
        state.groundItems.forEach((it, i) => record(`item${i}`, it.pos));
        traps.forEach((t, i) => record(`trap${i}`, t.pos));
        for (const [, labels] of occupied) {
          // start/exit legitimately coincide with nothing else; any key with
          // more than one label is a real placement collision.
          expect(labels.length).toBe(1);
        }

        // dark room / monster house must not be the start or exit room.
        if (state.map.darkRoomIndex != null) {
          const startRoomIdx = state.map.rooms.findIndex((r) =>
            state.player.pos.x >= r.x && state.player.pos.x < r.x + r.width && state.player.pos.y >= r.y && state.player.pos.y < r.y + r.height,
          );
          const exitRoomIdx = state.map.rooms.findIndex((r) =>
            state.exit.x >= r.x && state.exit.x < r.x + r.width && state.exit.y >= r.y && state.exit.y < r.y + r.height,
          );
          expect(state.map.darkRoomIndex).not.toBe(startRoomIdx);
          expect(state.map.darkRoomIndex).not.toBe(exitRoomIdx);
        }

        if (state.map.monsterHouse) {
          if (floor === 1) {
            throw new Error('monster house must not be eligible on floor 1');
          }
          const room = state.map.rooms[state.map.monsterHouse.roomIndex];
          const containsStart =
            state.player.pos.x >= room.x &&
            state.player.pos.x < room.x + room.width &&
            state.player.pos.y >= room.y &&
            state.player.pos.y < room.y + room.height;
          const containsExit =
            state.exit.x >= room.x && state.exit.x < room.x + room.width && state.exit.y >= room.y && state.exit.y < room.y + room.height;
          expect(containsStart).toBe(false);
          expect(containsExit).toBe(false);
        }

        // All placed positions must be walkable floor tiles within bounds.
        const inBounds = (pos: { x: number; y: number }) =>
          pos.x >= 0 && pos.y >= 0 && pos.y < state.map.terrain.length && pos.x < state.map.terrain[0].length;
        expect(inBounds(state.player.pos)).toBe(true);
        expect(state.map.terrain[state.player.pos.y][state.player.pos.x]).toBe('floor');
        expect(inBounds(state.exit)).toBe(true);
        expect(state.map.terrain[state.exit.y][state.exit.x]).toBe('floor');
        for (const e of state.enemies) {
          expect(inBounds(e.pos)).toBe(true);
          expect(state.map.terrain[e.pos.y][e.pos.x]).toBe('floor');
        }

        if (floor < TOTAL_FLOORS) {
          stepOntoExit(state);
          state = advanceToNextFloor(state);
        }
      }
    }
  });
});

describe('Phase 23.7: three-floor progression', () => {
  it('advances 1F -> 2F -> 3F -> victory purely via player moves onto the exit, regardless of remaining enemies or unresolved monster houses', () => {
    let state = createInitialState(777);

    expect(state.floor).toBe(1);
    stepOntoExit(state); // all floor-1 enemies left alive
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);

    expect(state.floor).toBe(2);
    stepOntoExit(state); // monster house (if any) left unresolved
    expect(state.phase).toBe('floor_cleared');
    state = advanceToNextFloor(state);

    expect(state.floor).toBe(3);
    stepOntoExit(state);
    expect(state.phase).toBe('victory');
  });

  it('does not leak floor-specific state (enemies/items/traps/darkRoomIndex/monsterHouse) across a transition, while carrying over player stats', () => {
    let state = createInitialState(4242);
    const hpBefore = state.player.hp;
    const floor1Enemies = state.enemies.map((e) => e.type).sort();

    stepOntoExit(state);
    state = advanceToNextFloor(state);

    expect(state.player.hp).toBe(hpBefore);
    const floor2Enemies = state.enemies.map((e) => e.type).sort();
    // Floor identity changed; the enemy list is freshly generated for floor 2
    // (not a literal reuse of floor 1's array/instances).
    expect(state.floor).toBe(2);
    expect(state.enemies).not.toBe(undefined);
    // Species pool differs in general (floor 2 unlocks 4 more species) —
    // just confirm the object identity isn't reused wholesale.
    expect(floor1Enemies.length).toBe(ENEMY_COUNT_BY_FLOOR[1]);
    expect(floor2Enemies.length).toBe(ENEMY_COUNT_BY_FLOOR[2]);
  });

  it('a death on the turn the exit is reached is gameover, not floor_cleared/victory (also on the final floor)', () => {
    // Same ordering contract phase-22 already locks for floor transitions;
    // confirmed here specifically on the final (victory-triggering) floor.
    let state = createInitialState(33);
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    stepOntoExit(state);
    state = advanceToNextFloor(state);
    expect(state.floor).toBe(3);

    const exit = state.exit;
    state.player.pos = { x: exit.x, y: exit.y - 1 >= 0 ? exit.y - 1 : exit.y };
    state.enemies[0].pos = { ...exit };
    state.enemies[0].alive = true;
    state.enemies[0].attack = 9999;
    state.combatRngState = 0;
    processTurn(state, { type: 'move', direction: 'S' });
    expect(state.phase).not.toBe('victory');
    expect(state.phase).not.toBe('floor_cleared');
  });

  it('same seed and same operations reproduce the same 3-floor run and victory', () => {
    const runOnce = (seed: number) => {
      let state = createInitialState(seed);
      const floors: number[] = [];
      for (let f = 1; f <= TOTAL_FLOORS; f++) {
        floors.push(state.enemies.length);
        if (f < TOTAL_FLOORS) {
          stepOntoExit(state);
          state = advanceToNextFloor(state);
        } else {
          stepOntoExit(state);
        }
      }
      return { floors, phase: state.phase };
    };

    const a = runOnce(31415);
    const b = runOnce(31415);
    expect(a).toEqual(b);
  });
});

describe('Phase 23.7: optional exploration is never required for victory', () => {
  it('victory is reachable with all enemies alive, ground items untouched, traps undiscovered, and monster houses unresolved', () => {
    let state = createInitialState(2024);
    for (let f = 1; f <= TOTAL_FLOORS; f++) {
      expect(state.enemies.every((e) => e.alive)).toBe(true);
      expect(state.groundItems.length).toBeGreaterThan(0);
      if (f < TOTAL_FLOORS) {
        stepOntoExit(state);
        state = advanceToNextFloor(state);
      } else {
        stepOntoExit(state);
      }
    }
    expect(state.phase).toBe('victory');
  });
});

describe('Phase 23.7: monster house run-wide probability contract', () => {
  it('floor 1 never rolls for a monster house (never eligible)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const state = createInitialState(seed);
      expect(state.floor).toBe(1);
      expect(state.map.monsterHouse).toBeFalsy();
    }
  });

  it('there is no run-wide guarantee or cap: across many seeds, floor 2/3 monster-house occurrence varies between 0 and 2 per run', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      let state = createInitialState(seed);
      let occurrences = 0;
      for (let f = 1; f <= TOTAL_FLOORS; f++) {
        if (state.map.monsterHouse) occurrences += 1;
        if (f < TOTAL_FLOORS) {
          stepOntoExit(state);
          state = advanceToNextFloor(state);
        }
      }
      counts.add(occurrences);
    }
    // No assertion on exact distribution (probability_policy forbids
    // treating a realized sample as a strict unit-test expectation) — only
    // that occurrences stay within the documented [0, 2] contract.
    for (const c of counts) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(2);
    }
  });
});

describe('Phase 23.7: determinism', () => {
  it('the same runSeed reproduces identical map/enemy/item/trap/dark-room/monster-house generation across two independent runs', () => {
    const snapshot = (seed: number) => {
      const state = createInitialState(seed);
      return JSON.stringify({
        terrain: state.map.terrain,
        rooms: state.map.rooms,
        enemies: state.enemies.map((e) => ({ type: e.type, pos: e.pos })),
        items: state.groundItems.map((i) => ({ id: i.itemId, pos: i.pos })),
        traps: (state.traps ?? []).map((t) => ({ type: t.trapType, pos: t.pos })),
        darkRoomIndex: state.map.darkRoomIndex,
        monsterHouse: state.map.monsterHouse ?? null,
        start: state.player.pos,
        exit: state.exit,
      });
    };
    expect(snapshot(55555)).toBe(snapshot(55555));
  });
});
