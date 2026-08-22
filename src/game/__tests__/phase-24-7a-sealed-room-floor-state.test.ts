import { describe, expect, it, vi } from 'vitest';
import { createRng } from '../mapgen';
import {
  createSealedRoomRng,
  decideSealedRoomFloorState,
  isSealedRoomEligibleFloor,
  SEALED_ROOM_OCCURRENCE_PROBABILITY,
  SEALED_ROOM_GUARDIAN_POSITION_RNG_XOR,
  SEALED_ROOM_RNG_XOR,
} from '../sealed-room';

describe('isSealedRoomEligibleFloor', () => {
  it('uses the inclusive descent depth range 19 through 25', () => {
    expect(isSealedRoomEligibleFloor(18, 'descent')).toBe(false);
    expect(isSealedRoomEligibleFloor(19, 'descent')).toBe(true);
    expect(isSealedRoomEligibleFloor(25, 'descent')).toBe(true);
    expect(isSealedRoomEligibleFloor(26, 'descent')).toBe(false);
    expect(isSealedRoomEligibleFloor(19, 'ascent')).toBe(false);
  });
});

describe('decideSealedRoomFloorState RNG consumption', () => {
  function countingRng(values: number[]): { rng: () => number; calls: () => number } {
    let callCount = 0;
    return {
      rng: () => values[callCount++],
      calls: () => callCount,
    };
  }

  it.each([
    { depth: 18, leg: 'descent' as const },
    { depth: 26, leg: 'descent' as const },
    { depth: 19, leg: 'ascent' as const },
  ])('returns null with 0 calls on an ineligible floor', ({ depth, leg }) => {
    const counted = countingRng([0, 0]);
    expect(decideSealedRoomFloorState(depth, leg, false, [3], counted.rng)).toBeNull();
    expect(counted.calls()).toBe(0);
  });

  it('short-circuits the already-generated run with 0 calls', () => {
    const counted = countingRng([0, 0]);
    expect(decideSealedRoomFloorState(19, 'descent', true, [3], counted.rng)).toBeNull();
    expect(counted.calls()).toBe(0);
  });

  it('returns null with 0 calls when there are no candidates', () => {
    const counted = countingRng([0, 0]);
    expect(decideSealedRoomFloorState(19, 'descent', false, [], counted.rng)).toBeNull();
    expect(counted.calls()).toBe(0);
  });

  it('returns null with exactly 1 call when the occurrence roll fails', () => {
    const counted = countingRng([SEALED_ROOM_OCCURRENCE_PROBABILITY, 0]);
    expect(decideSealedRoomFloorState(19, 'descent', false, [3, 7], counted.rng)).toBeNull();
    expect(counted.calls()).toBe(1);
  });

  it('selects uniformly with exactly 2 calls when the occurrence roll succeeds', () => {
    const counted = countingRng([SEALED_ROOM_OCCURRENCE_PROBABILITY - 1e-9, 0.75]);
    expect(decideSealedRoomFloorState(25, 'descent', false, [3, 7, 11, 15], counted.rng)).toEqual({ roomIndex: 15 });
    expect(counted.calls()).toBe(2);
  });
});

describe('SEALED_ROOM_RNG_XOR', () => {
  it('does not collide with an existing floor-seed-derived RNG salt', () => {
    const existingSalts = [
      0x51ed270b, 0xd4b82f19, 0x8f3c9d21, 0x1a6f83c5, 0x6a3fc19d,
      0x3f9c5e82, 0x9b1ea472, 0x73d5a8c1, 0xc8462f5b, 0x2be79164,
      0xf52c4a07, 0x2f7b91d4, 0x6c1e83fa, 0x94b2d1c7, 0xa39f6e52,
      0xe61c8b3d, 0x91b6d8e4, 0xc7d4a19e, 0xd4e8a273, 0xa3c17f05,
      0x5c2e91d3, 0x8f31c2a6, 0x7c3a91e6, 0x6b2f4d97, 0x2d84b6f1,
      0x7a19e3c8, 0x4e7bc218, 0x9f1a5d63, 0x5e2f8b41, 0x8b1c4f6d,
      0xa47d2c19, 0xd1e9736c, 0x17c4a9ed, SEALED_ROOM_GUARDIAN_POSITION_RNG_XOR,
    ];
    expect(existingSalts).not.toContain(SEALED_ROOM_RNG_XOR);
  });
});

describe('createSealedRoomRng', () => {
  it('uses the injected RNG factory with the salted floor seed', () => {
    const stream = () => 0.25;
    const createRngFn = vi.fn(() => stream);
    expect(createSealedRoomRng(12345, createRngFn)).toBe(stream);
    expect(createRngFn).toHaveBeenCalledOnce();
    expect(createRngFn).toHaveBeenCalledWith(12345 ^ SEALED_ROOM_RNG_XOR);
  });

  it('is deterministic for the same floor seed', () => {
    const rngA = createSealedRoomRng(777, createRng);
    const rngB = createSealedRoomRng(777, createRng);
    expect([rngA(), rngA(), rngA()]).toEqual([rngB(), rngB(), rngB()]);
  });

  it('produces different sequences for different floor seeds', () => {
    const rngA = createSealedRoomRng(777, createRng);
    const rngB = createSealedRoomRng(778, createRng);
    expect([rngA(), rngA(), rngA()]).not.toEqual([rngB(), rngB(), rngB()]);
  });
});
