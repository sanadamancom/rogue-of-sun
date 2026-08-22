import { describe, expect, it } from 'vitest';
import { applyEnemyLevelMultiplier, ENEMY_DEFINITIONS } from '../enemy-def';
import { getEnemyLevelBandForDepth, getEnemyPopulationForDepth } from '../enemy-depth-bands';
import { computeMonsterHouseCandidateCells } from '../monster-house';
import { isSealedRoomGuardian, SEALED_ROOM_GUARDIAN_SPAWN_SOURCE } from '../sealed-room';
import { buildFloorState } from '../state';

const CONFIG = { totalFloors: 26, runDepthTier: 'deep' as const };
const key = (pos: { x: number; y: number }) => `${pos.x},${pos.y}`;

function build(runSeed: number, depth: number) {
  return buildFloorState(runSeed, depth, 0, depth, CONFIG, undefined, undefined, undefined, 'descent', 'depth');
}

describe('Phase 24.7e3 sealed-room guardian production spawn', () => {
  it('leaves floors without a sealed room at their pre-existing normal roster', () => {
    for (const [seed, depth] of [[1, 1], [2, 10], [3, 18], [1, 19]] as const) {
      const state = build(seed, depth);
      expect(state.map.sealedRoom).toBeNull();
      expect(state.enemies.filter((enemy) => enemy.spawnSource === 'normal')).toHaveLength(
        getEnemyPopulationForDepth(depth).initialEnemyCount,
      );
      expect(state.enemies.some(isSealedRoomGuardian)).toBe(false);
    }
  });

  it('appends exactly one canonical golem guardian without collisions', () => {
    let checked = 0;
    for (let runSeed = 1; runSeed <= 1000 && checked < 20; runSeed++) {
      for (let depth = 19; depth <= 25 && checked < 20; depth++) {
        const state = build(runSeed, depth);
        if (!state.map.sealedRoom) continue;
        checked++;

        const guardians = state.enemies.filter(isSealedRoomGuardian);
        expect(guardians).toHaveLength(1);
        const guardian = guardians[0];
        expect(guardian.spawnSource).toBe(SEALED_ROOM_GUARDIAN_SPAWN_SOURCE);
        expect(guardian.type).toBe('golem');
        const band = getEnemyLevelBandForDepth('golem', depth)!;
        expect(band.weights[guardian.level]).toBeGreaterThan(0);
        const expected = applyEnemyLevelMultiplier(ENEMY_DEFINITIONS.golem, guardian.level);
        expect(guardian).toMatchObject({
          hp: expected.hp, maxHp: expected.hp, attack: expected.attack,
          defense: expected.defense, accuracy: expected.accuracy, evasion: expected.evasion,
        });

        const interior = new Set(computeMonsterHouseCandidateCells(
          state.map, state.map.sealedRoom.roomIndex, [],
        ).map(key));
        expect(interior.has(key(guardian.pos))).toBe(true);
        const occupied = [state.player.pos, state.exit,
          ...state.enemies.filter((enemy) => enemy !== guardian).map((enemy) => enemy.pos),
          ...(state.traps ?? []).map((trap) => trap.pos), ...state.groundItems.map((item) => item.pos)];
        expect(occupied.map(key)).not.toContain(key(guardian.pos));
        expect(state.enemies.filter((enemy) => enemy.spawnSource === 'normal')).toHaveLength(
          getEnemyPopulationForDepth(depth).initialEnemyCount,
        );
        expect(state.enemies.filter((enemy) => enemy !== guardian).every((enemy) => !isSealedRoomGuardian(enemy))).toBe(true);
      }
    }
    expect(checked).toBe(20);
  });
});
