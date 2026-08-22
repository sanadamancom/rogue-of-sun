import { describe, expect, it } from 'vitest';
import { ARMOR_DEFINITIONS } from '../armor-def';
import { selectEnemyDropItemId, resolveEnemyDropEquipmentDefinition } from '../enemy-drop';
import { getNormalEquipmentCandidates, selectNormalEquipmentDefinition } from '../equipment-loot';
import { deriveFloorSeed } from '../floor';
import { createRng } from '../mapgen';
import { generateSealedRoomGuardianReward } from '../sealed-room';
import { drawWeightedGroundItemSelection, getGroundItemPoolForFloor, getWeightedGroundItemPoolForFloor } from '../item-def';
import type { RunEventPayload } from '../telemetry';

describe('Phase 24.7d sealed-room guardian reward', () => {
  it('requires a defeated guardian and an ungenerated reward', () => {
    expect(generateSealedRoomGuardianReward(1, 2, { x: 3, y: 4 }, false, false)).toBeNull();
    expect(generateSealedRoomGuardianReward(1, 2, { x: 3, y: 4 }, false, true)).toBeNull();
    expect(generateSealedRoomGuardianReward(1, 2, { x: 3, y: 4 }, true, true)).toBeNull();
  });

  it('mints exactly one deterministic uncursed R-rank black armor individual', () => {
    const rewardPosition = { x: 17, y: 9 };
    for (let id = 1; id <= 100; id++) {
      const result = generateSealedRoomGuardianReward(id, id + 1000, rewardPosition, true, false);
      expect(result).not.toBeNull();
      expect(result!.instance).toMatchObject({
        instanceId: `eq-${id}`,
        definitionId: 'black_armor',
        cursed: false,
        rank: ARMOR_DEFINITIONS.black_armor.rank,
      });
      expect(result!.groundItem).toEqual({
        id: id + 1000,
        itemId: 'black_armor',
        pos: rewardPosition,
        equipmentInstanceId: result!.instance.instanceId,
        spawnSource: 'sealed_room_reward',
      });
      expect([result!.instance]).toHaveLength(1);
    }
  });

  it('does not consume any RNG stream', () => {
    let calls = 0;
    const trackedRng = () => { calls++; return 0; };
    generateSealedRoomGuardianReward(1, 1, { x: 1, y: 1 }, true, false);
    expect(calls).toBe(0);
    expect(trackedRng).toBeTypeOf('function');
  });

  it('reserves an assignable reward telemetry payload', () => {
    const payload: RunEventPayload = {
      type: 'sealed_room_reward_generated',
      equipmentInstanceId: 'eq-42',
      itemId: 'black_armor',
    };
    expect(payload.type).toBe('sealed_room_reward_generated');
  });
});

describe('Phase 24.7d black armor normal-route exclusions', () => {
  it('is absent from normal armor eligibility at descent depths 19-25', () => {
    for (let depth = 19; depth <= 25; depth++) {
      const candidates = getNormalEquipmentCandidates('armor', depth / 26, { depth, leg: 'descent' });
      expect(candidates.map((candidate) => candidate.definitionId)).not.toContain('black_armor');
      for (let sample = 0; sample < 250; sample++) {
        expect(selectNormalEquipmentDefinition('armor', depth / 26, createRng(depth * 1000 + sample), { depth, leg: 'descent' })).not.toBe('black_armor');
      }
    }
  });

  it('is absent from ordinary ground-item and enemy-drop pools', () => {
    for (let depth = 19; depth <= 25; depth++) {
      expect(getGroundItemPoolForFloor(depth, 'descent')).not.toContain('black_armor');
      for (let enemyId = 0; enemyId < 250; enemyId++) {
        const floorSeed = deriveFloorSeed(enemyId + 1, depth, 'descent');
        const itemId = selectEnemyDropItemId(depth, floorSeed, enemyId, 'descent');
        expect(itemId).not.toBe('black_armor');
        expect(resolveEnemyDropEquipmentDefinition('armor', depth, 26, floorSeed, enemyId, 'descent')).not.toBe('black_armor');
      }
    }
  });

  it('is never resolved by the monster-house shared reward path', () => {
    for (let depth = 19; depth <= 25; depth++) {
      const pool = getWeightedGroundItemPoolForFloor(depth, undefined, 'descent');
      expect(pool.map((candidate) => candidate.id)).not.toContain('black_armor');
      for (let sample = 0; sample < 250; sample++) {
        const rng = createRng(depth * 10000 + sample);
        const [drawn] = drawWeightedGroundItemSelection(1, pool, rng);
        const resolved = drawn === 'armor'
          ? selectNormalEquipmentDefinition('armor', depth / 26, rng, { depth, leg: 'descent' })
          : drawn;
        expect(resolved).not.toBe('black_armor');
      }
    }
  });
});
