import { describe, expect, it } from 'vitest';
import { getEnemyPopulationForDepth } from '../enemy-depth-bands';
import { deriveFloorSeed } from '../floor';
import {
  choosePlacement,
  computeStartAndExit,
  createRng,
  generateMap,
} from '../mapgen';
import { computeMonsterHouseCandidateCells } from '../monster-house';
import { buildFloorState } from '../state';

const LONG_RUN_CONFIG = { totalFloors: 26, runDepthTier: 'deep' as const };
const positionKey = (pos: { x: number; y: number }) => `${pos.x},${pos.y}`;

describe('Phase 24.7e2 sealed-room normal-placement exclusion', () => {
  it('keeps choosePlacement default behavior and shares its start/exit computation', () => {
    const generated = generateMap(12345);
    expect(generated.ok).toBe(true);
    const map = generated.map!;
    const omitted = choosePlacement(map, createRng(67890), 8);
    const empty = choosePlacement(map, createRng(67890), 8, []);
    const computed = computeStartAndExit(map);

    expect(empty).toEqual(omitted);
    expect({ start: computed.start, exit: computed.exit }).toEqual({
      start: omitted.start,
      exit: omitted.exit,
    });
  });

  it('removes every excluded room-interior cell from enemy candidates', () => {
    const generated = generateMap(24680);
    const map = generated.map!;
    const excluded = computeMonsterHouseCandidateCells(map, 1, []);
    const placement = choosePlacement(map, createRng(13579), 20, excluded);
    const excludedKeys = new Set(excluded.map(positionKey));

    expect(placement.enemies.every((pos) => !excludedKeys.has(positionKey(pos)))).toBe(true);
  });

  it('keeps normal enemies, traps, and ground items outside generated sealed rooms', () => {
    let generatedCount = 0;
    for (let runSeed = 1; runSeed <= 1000; runSeed++) {
      for (let depth = 19; depth <= 25; depth++) {
        const state = buildFloorState(
          runSeed,
          depth,
          0,
          depth,
          LONG_RUN_CONFIG,
          undefined,
          undefined,
          undefined,
          'descent',
          'depth',
        );
        if (!state.map.sealedRoom) continue;

        generatedCount++;
        const interiorKeys = new Set(
          computeMonsterHouseCandidateCells(state.map, state.map.sealedRoom.roomIndex, []).map(positionKey),
        );
        const isInside = (pos: { x: number; y: number }) => interiorKeys.has(positionKey(pos));

        expect(state.enemies.some((enemy) => enemy.spawnSource !== 'sealed_room_guardian' && isInside(enemy.pos))).toBe(false);
        expect((state.traps ?? []).some((trap) => isInside(trap.pos))).toBe(false);
        expect(state.groundItems.some((item) => isInside(item.pos))).toBe(false);
        expect(state.enemies.filter((enemy) => enemy.spawnSource === 'normal')).toHaveLength(
          getEnemyPopulationForDepth(depth).initialEnemyCount,
        );
      }
    }
    expect(generatedCount).toBeGreaterThan(0);
  });

  it('preserves expected enemy counts when no sealed room is generated', () => {
    for (const [runSeed, depth] of [[1, 1], [2, 10], [3, 18]] as const) {
      const state = buildFloorState(
        runSeed,
        depth,
        0,
        depth,
        LONG_RUN_CONFIG,
        undefined,
        undefined,
        undefined,
        'descent',
        'depth',
      );
      expect(state.map.sealedRoom).toBeNull();
      expect(state.enemies.filter((enemy) => enemy.spawnSource === 'normal')).toHaveLength(
        getEnemyPopulationForDepth(depth).initialEnemyCount,
      );
      expect(generateMap(deriveFloorSeed(runSeed, depth, 'descent')).ok).toBe(true);
    }
  });
});
