import { describe, expect, it } from 'vitest';
import { deriveFloorSeed } from '../floor';
import { getEnemyPopulationForDepth } from '../enemy-depth-bands';
import { choosePlacement, createRng, generateMap } from '../mapgen';
import {
  buildMonsterHouseFloorState,
  createMonsterHouseRng,
  extractMonsterHouseCandidateRooms,
} from '../monster-house';
import { extractSealedRoomCandidateRooms } from '../sealed-room';
import { advanceRunFloor, buildFloorState, createInitialState } from '../state';
import type { GameState } from '../types';

const longRunConfig = { totalFloors: 26, runDepthTier: 'deep' as const };

function build(seed: number, depth: number, leg: GameState['leg'] = 'descent'): GameState {
  return buildFloorState(seed, depth, 0, depth, longRunConfig, undefined, undefined, undefined, leg, 'depth');
}

describe('Phase 24.7e1 sealed-room production floor wiring', () => {
  it('always tags ineligible depths and ascent floors with null', () => {
    for (const depth of [1, 18, 26]) {
      for (const seed of [1, 17, 99]) expect(build(seed, depth).map.sealedRoom).toBeNull();
    }
    for (const depth of [19, 22, 25]) {
      for (const seed of [1, 17, 99]) expect(build(seed, depth, 'ascent').map.sealedRoom).toBeNull();
    }
  });

  it('selects only sealed-room candidates and never overlaps a monster house', () => {
    let generatedCount = 0;
    for (let seed = 1; seed <= 500; seed++) {
      for (let depth = 19; depth <= 25; depth++) {
        const state = build(seed, depth);
        const sealedRoom = state.map.sealedRoom;
        if (!sealedRoom) continue;
        generatedCount++;
        const candidates = extractSealedRoomCandidateRooms(state.map, state.player.pos, state.exit, []);
        expect(candidates).toContain(sealedRoom.roomIndex);
        expect(state.map.monsterHouse?.roomIndex).not.toBe(sealedRoom.roomIndex);
      }
    }
    expect(generatedCount).toBeGreaterThan(0);
  });

  it('carries the run cap after the first generated room and prevents a second', () => {
    let chain: GameState[] | undefined;
    for (let seed = 1; seed <= 500 && !chain; seed++) {
      const states: GameState[] = [build(seed, 19)];
      while (states[states.length - 1].floor < 25) {
        const next = advanceRunFloor(states[states.length - 1]);
        if (next === 'runComplete') throw new Error('run ended before depth 25');
        states.push(next);
      }
      if (states.some((state) => state.map.sealedRoom !== null)) chain = states;
    }
    expect(chain).toBeDefined();

    const firstGenerated = chain!.findIndex((state) => state.map.sealedRoom !== null);
    expect(firstGenerated).toBeGreaterThanOrEqual(0);
    expect(chain!.slice(0, firstGenerated).every((state) => state.sealedRoomGeneratedThisRun === false)).toBe(true);
    expect(chain!.slice(firstGenerated).every((state) => state.sealedRoomGeneratedThisRun === true)).toBe(true);
    expect(chain!.filter((state) => state.map.sealedRoom !== null)).toHaveLength(1);
  });

  it('leaves monster-house selection byte-identical when no sealed room is generated', () => {
    for (const [seed, depth, leg] of [[1, 18, 'descent'], [17, 22, 'ascent']] as const) {
      const state = build(seed, depth, leg);
      expect(state.map.sealedRoom).toBeNull();

      const floorSeed = deriveFloorSeed(seed, depth, leg);
      const generated = generateMap(floorSeed);
      expect(generated.ok && generated.map).toBeTruthy();
      const map = generated.map!;
      const placement = choosePlacement(
        map,
        createRng(floorSeed ^ 0x51ed270b),
        getEnemyPopulationForDepth(depth).initialEnemyCount,
      );
      expect(extractMonsterHouseCandidateRooms(map, placement.start, placement.exit, []))
        .toEqual(extractMonsterHouseCandidateRooms(map, placement.start, placement.exit));
      const expected = buildMonsterHouseFloorState(
        map,
        depth,
        leg,
        placement.start,
        placement.exit,
        createMonsterHouseRng(floorSeed, createRng),
        [],
      );
      expect(state.map.monsterHouse).toEqual(expected);
    }
  });

  it('defaults an omitted carried cap identically to explicit false', () => {
    const absent = createInitialState(731, longRunConfig);
    delete absent.sealedRoomGeneratedThisRun;
    const explicit = createInitialState(731, longRunConfig);
    explicit.sealedRoomGeneratedThisRun = false;

    expect(advanceRunFloor(absent)).toEqual(advanceRunFloor(explicit));
  });
});
