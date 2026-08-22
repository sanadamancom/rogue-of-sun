import { describe, expect, it } from 'vitest';
import {
  getEligibleEnemySpeciesForDepth,
  getEnemyLevelBandForDepth,
  getEnemyPopulationForDepth,
  resolveSingleEnemySpawnForDepth,
} from '../enemy-depth-bands';
import type { GameEvent } from '../events';
import { createRng, ENEMY_COUNT_BY_FLOOR } from '../mapgen';
import { getReinforcementRule } from '../reinforcement';
import { buildFloorState, createInitialState } from '../state';
import { resolveRegularReinforcement } from '../turn';
import type { EnemyLevel, GameState } from '../types';

const longRunConfig = { totalFloors: 26, runDepthTier: 'deep' as const };

function triggerReinforcement(state: GameState): { events: GameEvent[]; spawned: GameState['enemies'][number] } {
  state.floorTurn = getReinforcementRule(state.floor).cadenceTurns;
  const events: GameEvent[] = [];
  resolveRegularReinforcement(state, events);
  const spawned = state.enemies.find((enemy) => enemy.spawnSource === 'reinforcement');
  expect(spawned).toBeDefined();
  return { events, spawned: spawned! };
}

describe('Phase 24.6c4e single depth spawn resolution', () => {
  it('is deterministic for the same depth and RNG seed', () => {
    for (const depth of [1, 4, 12, 20, 26]) {
      expect(resolveSingleEnemySpawnForDepth(depth, createRng(24604))).toEqual(
        resolveSingleEnemySpawnForDepth(depth, createRng(24604)),
      );
    }
  });
});

describe('Phase 24.6c4e reinforcement production wiring', () => {
  it('preserves legacy short-run species, level, events, cap, and RNG isolation across seeds', () => {
    for (const seed of [1, 42, 314159, 0xffffffff]) {
      const run = () => {
        const state = createInitialState(seed);
        const combatBefore = state.combatRngState;
        const { events, spawned } = triggerReinforcement(state);
        return {
          type: spawned.type,
          level: spawned.level,
          events,
          combatBefore,
          combatAfter: state.combatRngState,
        };
      };
      const result = run();
      expect(result).toEqual(run());
      expect(result.level).toBe(1);
      expect(result.combatAfter).toBe(result.combatBefore);

      const capped = createInitialState(seed);
      capped.floorTurn = getReinforcementRule(capped.floor).cadenceTurns;
      while (capped.enemies.filter((enemy) => enemy.alive && enemy.spawnSource !== 'monster_house').length < ENEMY_COUNT_BY_FLOOR[capped.floor] + 2) {
        capped.enemies.push({ ...capped.enemies[0], id: capped.enemies.length });
      }
      const events: GameEvent[] = [];
      resolveRegularReinforcement(capped, events);
      expect(events).toEqual([]);
    }
  });

  it.each([4, 12, 20])('uses the canonical cap and eligible species at depth %i', (depth) => {
    const eligible = new Set(getEligibleEnemySpeciesForDepth(depth).map(({ type }) => type));
    for (const leg of ['descent', 'ascent'] as const) {
      const state = buildFloorState(24604, depth, 0, depth, longRunConfig, undefined, undefined, undefined, leg, 'depth');
      const { events, spawned } = triggerReinforcement(state);
      expect(eligible.has(spawned.type)).toBe(true);
      expect(getEnemyLevelBandForDepth(spawned.type, depth)).not.toBeNull();
      expect(events).toEqual([
        { type: 'reinforcement_spawned', floor: depth, enemyType: spawned.type, reinforcementOrdinal: 1 },
      ]);

      const cap = getEnemyPopulationForDepth(depth).initialEnemyCount + getReinforcementRule(depth).capBonus;
      while (state.enemies.filter((enemy) => enemy.alive && enemy.spawnSource !== 'monster_house').length < cap) {
        state.enemies.push({ ...state.enemies[0], id: state.enemies.length });
      }
      state.floorTurn = (state.floorTurn ?? 0) + getReinforcementRule(depth).cadenceTurns;
      const cappedEvents: GameEvent[] = [];
      resolveRegularReinforcement(state, cappedEvents);
      expect(cappedEvents).toEqual([]);
    }
  });

  it.each(['descent', 'ascent'] as const)('produces depth-band levels on the %s leg', (leg) => {
    const levels = new Set<EnemyLevel>();
    for (let seed = 1; seed <= 200; seed++) {
      const state = buildFloorState(seed, 12, 0, 12, longRunConfig, undefined, undefined, undefined, leg, 'depth');
      levels.add(triggerReinforcement(state).spawned.level);
    }
    expect(levels.has(2)).toBe(true);
    expect(levels.has(3)).toBe(true);
  });
});
