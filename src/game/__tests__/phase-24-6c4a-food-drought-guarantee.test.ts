import { describe, expect, it } from 'vitest';
import { advanceToNextFloor, createInitialState } from '../state';
import type { GameState, GroundItem, Vec2 } from '../types';

function normalItems(state: GameState): GroundItem[] {
  return state.groundItems.filter((item) => item.spawnSource !== 'monster_house');
}

function floorTwo(seed: number, drought: number): GameState {
  const state = createInitialState(seed);
  state.foodDroughtFloors = drought;
  return advanceToNextFloor(state);
}

function findSeed(predicate: (state: GameState) => boolean): number {
  for (let seed = 1; seed <= 20_000; seed += 1) {
    const state = floorTwo(seed, 0);
    if (predicate(state)) return seed;
  }
  throw new Error('No matching deterministic floor-2 seed found');
}

function key(pos: Vec2): string {
  return `${pos.x},${pos.y}`;
}

describe('Phase 24.6c4a food drought guarantee', () => {
  it('starts a brand-new run at zero', () => {
    expect(createInitialState(1234).foodDroughtFloors).toBe(0);
  });

  it('increments consecutive chocolate-free descent floors and carries the value', () => {
    let seed = 0;
    for (let candidate = 1; candidate <= 20_000; candidate += 1) {
      let probe = createInitialState(candidate);
      const counters: number[] = [];
      for (let floor = 2; floor <= 4; floor += 1) {
        probe = advanceToNextFloor(probe);
        counters.push(probe.foodDroughtFloors ?? -1);
      }
      if (counters.join(',') === '1,2,3') {
        seed = candidate;
        break;
      }
    }
    expect(seed).not.toBe(0);

    let state = createInitialState(seed);
    state = advanceToNextFloor(state);
    expect(state.foodDroughtFloors).toBe(1);
    state = advanceToNextFloor(state);
    expect(state.foodDroughtFloors).toBe(2);
    state = advanceToNextFloor(state);
    expect(state.foodDroughtFloors).toBe(3);

    const legacy = createInitialState(seed);
    delete legacy.foodDroughtFloors;
    expect(advanceToNextFloor(legacy).foodDroughtFloors).toBe(1);
  });

  it('resets after normally generated chocolate and carries zero onward', () => {
    let seed = 0;
    for (let candidate = 1; candidate <= 20_000; candidate += 1) {
      const floor2 = advanceToNextFloor(createInitialState(candidate));
      const floor3 = advanceToNextFloor(floor2);
      if (floor2.foodDroughtFloors === 1 && floor3.groundItems.some((item) => item.itemId === 'chocolate')) {
        seed = candidate;
        break;
      }
    }
    expect(seed).not.toBe(0);

    const drought = advanceToNextFloor(createInitialState(seed));
    expect(drought.foodDroughtFloors).toBe(1);
    const reset = advanceToNextFloor(drought);
    expect(reset.groundItems.some((item) => item.itemId === 'chocolate')).toBe(true);
    expect(reset.foodDroughtFloors).toBe(0);
  });

  it('adds a reserved guaranteed chocolate without changing the normal draw', () => {
    const seed = findSeed((state) => !normalItems(state).some((item) => item.itemId === 'chocolate'));
    const baseline = floorTwo(seed, 2);
    const guaranteed = floorTwo(seed, 3);
    const baselineNormal = normalItems(baseline);
    const guaranteedNormal = normalItems(guaranteed);

    expect(guaranteedNormal[0].itemId).toBe('chocolate');
    expect(guaranteedNormal.length).toBe(baselineNormal.length + 1);
    expect(guaranteedNormal.slice(1).map((item) => item.itemId)).toEqual(baselineNormal.map((item) => item.itemId));
    expect(guaranteedNormal.slice(1).map((item) => item.equipmentInstanceId ?? null))
      .toEqual(baselineNormal.map((item) => item.equipmentInstanceId ?? null));
    expect(guaranteed.foodDroughtFloors).toBe(0);

    const occupied = new Set([
      key(guaranteed.player.pos),
      key(guaranteed.exit),
      ...guaranteed.enemies.map((enemy) => key(enemy.pos)),
      ...(guaranteed.traps ?? []).map((trap) => key(trap.pos)),
    ]);
    expect(occupied.has(key(guaranteedNormal[0].pos))).toBe(false);
    expect(new Set(guaranteedNormal.map((item) => key(item.pos))).size).toBe(guaranteedNormal.length);
  });

  it('keeps every existing per-floor stream result isolated from the guarantee', () => {
    const seed = findSeed((state) => !normalItems(state).some((item) => item.itemId === 'chocolate'));
    const baseline = floorTwo(seed, 2);
    const guaranteed = floorTwo(seed, 3);

    // Count/selection and all conditional equipment/card/accessory results
    // are represented by this ordered normal-item signature. Placement uses
    // the same stream but is allowed to select different cells because the
    // guaranteed cell is now an additional required exclusion.
    const signature = (items: GroundItem[]) => items.map((item) => ({
      itemId: item.itemId,
      equipmentInstanceId: item.equipmentInstanceId ?? null,
    }));
    expect(signature(normalItems(guaranteed).slice(1))).toEqual(signature(normalItems(baseline)));
    expect(guaranteed.enemies).toEqual(baseline.enemies);
    expect(guaranteed.traps).toEqual(baseline.traps);
  });
});
