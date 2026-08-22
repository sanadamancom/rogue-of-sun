import { describe, expect, it, vi } from 'vitest';
import { applyEnemyLevelMultiplier, ENEMY_DEFINITIONS } from '../enemy-def';
import { createRng } from '../mapgen';
import {
  createSealedRoomGuardianLevelRng,
  createSealedRoomRng,
  isSealedRoomGuardian,
  resolveSealedRoomGuardianLevel,
  SEALED_ROOM_GUARDIAN_LEVEL_RNG_XOR,
  SEALED_ROOM_GUARDIAN_SPAWN_SOURCE,
  SEALED_ROOM_RNG_XOR,
} from '../sealed-room';
import { createInitialEnemy } from '../turn';

describe('Phase 24.7c sealed-room guardian', () => {
  it('uses the canonical golem level boundaries at depths 19 through 25', () => {
    expect(resolveSealedRoomGuardianLevel(19, () => 0.999)).toBe(1);
    for (const depth of [20, 21, 22, 23]) {
      expect(resolveSealedRoomGuardianLevel(depth, () => 0.299999)).toBe(1);
      expect(resolveSealedRoomGuardianLevel(depth, () => 0.3)).toBe(2);
    }
    for (const depth of [24, 25]) {
      expect(resolveSealedRoomGuardianLevel(depth, () => 0)).toBe(2);
      expect(resolveSealedRoomGuardianLevel(depth, () => 0.699999)).toBe(2);
      expect(resolveSealedRoomGuardianLevel(depth, () => 0.7)).toBe(3);
    }
    expect(() => resolveSealedRoomGuardianLevel(14, () => 0)).toThrow(RangeError);
    expect(() => resolveSealedRoomGuardianLevel(27, () => 0)).toThrow(RangeError);
  });

  it('derives a dedicated, collision-free guardian level stream', () => {
    const existingSalts = [
      0x51ed270b, 0xd4b82f19, 0x8f3c9d21, 0x1a6f83c5, 0x6a3fc19d,
      0x3f9c5e82, 0x9b1ea472, 0x73d5a8c1, 0xc8462f5b, 0x2be79164,
      0xf52c4a07, 0x2f7b91d4, 0x6c1e83fa, 0x94b2d1c7, 0xa39f6e52,
      0xe61c8b3d, 0x91b6d8e4, 0xc7d4a19e, 0xd4e8a273, 0xa3c17f05,
      0x5c2e91d3, 0x8f31c2a6, 0x7c3a91e6, 0x6b2f4d97, 0x2d84b6f1,
      0x7a19e3c8, 0x4e7bc218, 0x9f1a5d63, 0x5e2f8b41, 0x8b1c4f6d,
      0xa47d2c19, 0xd1e9736c, 0x17c4a9ed, SEALED_ROOM_RNG_XOR,
    ];
    expect(existingSalts).not.toContain(SEALED_ROOM_GUARDIAN_LEVEL_RNG_XOR);
    const factory = vi.fn(createRng);
    createSealedRoomGuardianLevelRng(12345, factory);
    expect(factory).toHaveBeenCalledWith(12345 ^ SEALED_ROOM_GUARDIAN_LEVEL_RNG_XOR);
    const occurrence = createSealedRoomRng(12345, createRng);
    const guardian = createSealedRoomGuardianLevelRng(12345, createRng);
    expect(guardian()).not.toBe(occurrence());
  });

  it('recognizes only the dedicated spawn source', () => {
    expect(isSealedRoomGuardian({ spawnSource: SEALED_ROOM_GUARDIAN_SPAWN_SOURCE })).toBe(true);
    for (const spawnSource of ['normal', 'monster_house', 'reinforcement', undefined] as const) {
      expect(isSealedRoomGuardian({ spawnSource })).toBe(false);
    }
  });

  it.each([1, 2, 3] as const)('uses canonical golem stats at level %i', (level) => {
    const expected = applyEnemyLevelMultiplier(ENEMY_DEFINITIONS.golem, level);
    const enemy = createInitialEnemy(
      'golem', { x: 1, y: 1 }, expected.hp, expected.attack, 0, 1,
      expected.defense, expected.accuracy, expected.evasion, level,
    );
    enemy.spawnSource = SEALED_ROOM_GUARDIAN_SPAWN_SOURCE;
    expect({
      hp: enemy.hp, maxHp: enemy.maxHp, attack: enemy.attack,
      defense: enemy.defense, accuracy: enemy.accuracy, evasion: enemy.evasion,
    }).toEqual({
      hp: expected.hp, maxHp: expected.hp, attack: expected.attack,
      defense: expected.defense, accuracy: expected.accuracy, evasion: expected.evasion,
    });
    expect(isSealedRoomGuardian(enemy)).toBe(true);
    expect(enemy.alive).toBe(true);
    enemy.alive = false;
    expect(isSealedRoomGuardian(enemy) && !enemy.alive).toBe(true);
  });
});
