/**
 * Phase 21.5 implementation_gate tests: monster-house dedicated reward
 * placement (MONSTER_HOUSE_REWARD_COUNT=3, degrade-not-throw capacity
 * contract, entry-cell/occupant exclusion, existing pickup path reuse).
 */
import { describe, expect, it } from 'vitest';
import {
  computeMonsterHouseEntryCells,
  MONSTER_HOUSE_REWARD_COUNT,
  selectMonsterHouseRewardPositions,
} from '../monster-house';
import { createRng, roomIndexContaining } from '../mapgen';
import { createInitialState, advanceToNextFloor } from '../state';
import { processTurn } from '../turn';

describe('MONSTER_HOUSE_REWARD_COUNT', () => {
  it('is 3', () => {
    expect(MONSTER_HOUSE_REWARD_COUNT).toBe(3);
  });
});

describe('selectMonsterHouseRewardPositions: degrade-not-throw capacity contract', () => {
  it('returns all candidates (fewer than count) instead of throwing when capacity is short', () => {
    const candidates = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const result = selectMonsterHouseRewardPositions(candidates, 3, createRng(1));
    expect(result).toHaveLength(2);
  });

  it('returns an empty array and consumes no RNG for zero candidates', () => {
    let calls = 0;
    const rng = () => { calls++; return 0.5; };
    const result = selectMonsterHouseRewardPositions([], 3, rng);
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it('returns exactly count distinct positions when candidates.length >= count', () => {
    const candidates = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }];
    const result = selectMonsterHouseRewardPositions(candidates, 3, createRng(7));
    expect(result).toHaveLength(3);
    const keys = new Set(result.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(3);
  });

  it('does not mutate the input candidates array', () => {
    const candidates = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const before = candidates.map((c) => ({ ...c }));
    selectMonsterHouseRewardPositions(candidates, 3, createRng(3));
    expect(candidates).toEqual(before);
  });

  it('is deterministic for the same candidates and rng sequence', () => {
    const candidates = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }];
    const a = selectMonsterHouseRewardPositions(candidates, 3, createRng(11));
    const b = selectMonsterHouseRewardPositions(candidates, 3, createRng(11));
    expect(a).toEqual(b);
  });
});

describe('production wiring: reward placement on generated floors', () => {
  const seeds = [1, 2, 3, 4, 5, 10, 20, 42, 100, 12345];

  it('monster house occurrence places up to MONSTER_HOUSE_REWARD_COUNT rewards, all inside the target room', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _f of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const rewards = state.groundItems.filter((i) => i.spawnSource === 'monster_house');
        expect(rewards.length).toBeLessThanOrEqual(MONSTER_HOUSE_REWARD_COUNT);
        const room = state.map.rooms[state.map.monsterHouse.roomIndex];
        for (const r of rewards) {
          expect(roomIndexContaining([room], r.pos)).toBe(0);
        }
      }
    }
  });

  it('no monster house on a floor means no dedicated rewards', () => {
    for (const seed of seeds) {
      const state = createInitialState(seed); // floor 1, never eligible
      expect(state.map.monsterHouse ?? null).toBeNull();
      expect(state.groundItems.some((i) => i.spawnSource === 'monster_house')).toBe(false);
    }
  });

  it('dedicated rewards never overlap each other, entry cells, player/exit, normal or dedicated enemies, traps, or normal ground items', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _f of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const rewards = state.groundItems.filter((i) => i.spawnSource === 'monster_house');
        const normalGroundItems = state.groundItems.filter((i) => i.spawnSource !== 'monster_house');
        const entryCells = computeMonsterHouseEntryCells(state.map, state.map.monsterHouse.roomIndex);
        const occupied = [
          state.player.pos,
          state.map.exit,
          ...state.enemies.map((e) => e.pos),
          ...(state.traps ?? []).map((t) => t.pos),
          ...normalGroundItems.map((i) => i.pos),
        ];
        for (const r of rewards) {
          expect(occupied.some((p) => p.x === r.pos.x && p.y === r.pos.y)).toBe(false);
          expect(entryCells.some((c) => c.x === r.pos.x && c.y === r.pos.y)).toBe(false);
        }
        const keys = new Set(rewards.map((r) => `${r.pos.x},${r.pos.y}`));
        expect(keys.size).toBe(rewards.length);
      }
    }
  });

  it('reward item ids come from the same legal weighted pool as normal ground items (no cards)', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _f of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const rewards = state.groundItems.filter((i) => i.spawnSource === 'monster_house');
        for (const r of rewards) {
          // Card ids are never eligible (floorDropEnabled: false in
          // Phase 20/21) — confirm no reward is a card.
          expect(['high_priestess', 'empress', 'emperor', 'lovers', 'chariot', 'strength', 'wheel_of_fortune',
            'justice', 'hanged_man', 'death', 'temperance', 'devil', 'tower', 'star', 'moon', 'sun', 'judgement',
            'fool'].includes(r.itemId)).toBe(false);
        }
      }
    }
  });

  it('at most one of each enchantment id across normal + reward ground items combined on one floor', () => {
    const enchantmentIds = ['sol_enchantment', 'flame_enchantment', 'frost_enchantment', 'cloud_enchantment', 'earth_enchantment'];
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _f of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        for (const id of enchantmentIds) {
          const count = state.groundItems.filter((i) => i.itemId === id).length;
          expect(count).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('normal ground item count (2-6) is unaffected by monster house rewards', () => {
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _f of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        const normalCount = state.groundItems.filter((i) => i.spawnSource !== 'monster_house').length;
        expect(normalCount).toBeGreaterThanOrEqual(2);
        expect(normalCount).toBeLessThanOrEqual(6);
      }
    }
  });

  it('determinism: regenerating the same seed/floor produces the same reward roster', () => {
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
      const rewardsA = a.groundItems.filter((i) => i.spawnSource === 'monster_house').map((i) => ({ itemId: i.itemId, pos: i.pos }));
      const rewardsB = b.groundItems.filter((i) => i.spawnSource === 'monster_house').map((i) => ({ itemId: i.itemId, pos: i.pos }));
      expect(rewardsA).toEqual(rewardsB);
    }
  });

  it('a reward can be picked up via the existing auto-pickup-on-move path', () => {
    let found = false;
    for (const seed of seeds) {
      let state = createInitialState(seed);
      for (const _f of [2, 3]) {
        state.enemies.forEach((e) => (e.alive = false));
        state.player.pos = { ...state.exit };
        state = advanceToNextFloor(state);
        if (!state.map.monsterHouse) continue;
        const reward = state.groundItems.find((i) => i.spawnSource === 'monster_house');
        if (!reward) continue;
        // Pickup is auto-pickup-on-move (turn.ts), not a separate action
        // type — stepping onto the item's tile collects it as part of
        // that move. Place the player one tile away (matching an open
        // orthogonal neighbor) and move onto the reward's tile.
        const deltas: Array<{ dx: number; dy: number; dir: 'N' | 'S' | 'E' | 'W' }> = [
          { dx: 0, dy: -1, dir: 'S' }, { dx: 0, dy: 1, dir: 'N' }, { dx: -1, dy: 0, dir: 'E' }, { dx: 1, dy: 0, dir: 'W' },
        ];
        let moved = false;
        for (const d of deltas) {
          const from = { x: reward.pos.x + d.dx, y: reward.pos.y + d.dy };
          if (from.x < 0 || from.x >= state.map.width || from.y < 0 || from.y >= state.map.height) continue;
          if (state.map.terrain[from.y][from.x] !== 'floor') continue;
          if (state.enemies.some((e) => e.alive && e.pos.x === from.x && e.pos.y === from.y)) continue;
          const testState = JSON.parse(JSON.stringify(state));
          testState.enemies = testState.enemies.filter(
            (e: any) => !(e.pos.x === reward.pos.x && e.pos.y === reward.pos.y),
          );
          testState.player.pos = from;
          const before = testState.groundItems.length;
          const result = processTurn(testState, { type: 'move', direction: d.dir });
          if (result.consumed && testState.player.pos.x === reward.pos.x && testState.player.pos.y === reward.pos.y) {
            expect(testState.groundItems.length).toBeLessThan(before);
            moved = true;
            found = true;
          }
          break;
        }
        if (moved) break;
      }
      if (found) break;
    }
    expect(found).toBe(true);
  });
});
