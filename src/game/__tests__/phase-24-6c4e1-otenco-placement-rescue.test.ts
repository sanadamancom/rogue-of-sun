import { describe, expect, it } from 'vitest';
import { bfsDistances, createRng, generateMap, choosePlacement, roomIndexContaining } from '../mapgen';
import { extractMonsterHouseCandidateRooms } from '../monster-house';
import { placeOtencoPosition } from '../otenco';
import { buildFloorState, createInitialState } from '../state';
import { createInitialEnemy, processTurn } from '../turn';
import { Direction8, Vec2 } from '../types';

const config = { totalFloors: 26, runDepthTier: 'deep' as const };
const key = (p: Vec2) => `${p.x},${p.y}`;

describe('Phase 24.6c4e1 Otenco placement and rescue', () => {
  it('selects the legal maximum-score cell deterministically across generated maps', () => {
    for (const seed of [1, 7, 31, 99]) {
      const generated = generateMap(seed);
      expect(generated.ok && generated.map).toBeTruthy();
      const map = generated.map!;
      const placement = choosePlacement(map, createRng(seed ^ 0x51ed270b), 6);
      const actual = placeOtencoPosition(map, placement.start, placement.exit, placement.enemies);
      const fromStart = bfsDistances(map, placement.start);
      const fromExit = bfsDistances(map, placement.exit);
      const excluded = new Set([placement.start, placement.exit, ...placement.enemies].map(key));
      const scores: number[] = [];
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        const a = fromStart.get(`${x},${y}`);
        const b = fromExit.get(`${x},${y}`);
        if (map.terrain[y][x] === 'floor' && !excluded.has(`${x},${y}`) && a !== undefined && b !== undefined) scores.push(Math.min(a, b));
      }
      expect(map.terrain[actual.y][actual.x]).toBe('floor');
      expect(fromStart.has(key(actual))).toBe(true);
      expect(excluded.has(key(actual))).toBe(false);
      expect(Math.min(fromStart.get(key(actual))!, fromExit.get(key(actual))!)).toBe(Math.max(...scores));
      expect(placeOtencoPosition(map, placement.start, placement.exit, placement.enemies)).toEqual(actual);
    }
  });

  it('excludes an optional room without changing legacy null behavior', () => {
    const generated = generateMap(12).map!;
    const placement = choosePlacement(generated, createRng(12 ^ 0x51ed270b), 2);
    const baseline = extractMonsterHouseCandidateRooms(generated, placement.start, placement.exit, null);
    expect(baseline).toEqual(extractMonsterHouseCandidateRooms(generated, placement.start, placement.exit));
    if (baseline.length > 0) expect(extractMonsterHouseCandidateRooms(generated, placement.start, placement.exit, baseline[0])).toEqual(baseline.slice(1));
  });

  it('places only on descent 26 and reserves the coordinate from generated content', () => {
    const state = buildFloorState(44, 26, 0, 26, config);
    expect(state.otencoState).toBe('sealed');
    expect(state.otencoPos).toBeDefined();
    const pos = state.otencoPos!;
    expect(state.enemies.some((e) => key(e.pos) === key(pos))).toBe(false);
    expect(state.groundItems.some((i) => key(i.pos) === key(pos))).toBe(false);
    expect((state.traps ?? []).some((t) => key(t.pos) === key(pos))).toBe(false);
    expect(state.map.monsterHouse?.roomIndex).not.toBe(roomIndexContaining(state.map.rooms, pos));
    expect(buildFloorState(44, 25, 0, 25, config).otencoPos).toBeUndefined();
    expect(buildFloorState(44, 26, 0, 27, config, undefined, undefined, undefined, 'ascent').otencoPos).toBeUndefined();
  });

  it('rescues on a consumed move and emits exactly one event', () => {
    const state = buildFloorState(55, 26, 0, 26, config);
    const target = state.otencoPos!;
    const steps: Array<[number, number, Direction8]> = [[-1, 0, 'E'], [1, 0, 'W'], [0, -1, 'S'], [0, 1, 'N']];
    const step = steps.find(([dx, dy]) => state.map.terrain[target.y + dy]?.[target.x + dx] === 'floor')!;
    state.player.pos = { x: target.x + step[0], y: target.y + step[1] };
    state.enemies = [];
    state.traps = [];
    const before = state.turn;
    const result = processTurn(state, { type: 'move', direction: step[2] });
    expect(result.consumed).toBe(true);
    expect(state.turn).toBe(before + 1);
    expect(state.otencoState).toBe('rescued');
    expect(state.otencoPos).toBeUndefined();
    expect(result.events.filter((e) => e.type === 'otenco_rescued')).toHaveLength(1);
  });

  it('prioritizes game over when the player dies on the move that reaches Otenco', () => {
    const state = buildFloorState(1, 26, 0, 26, config);
    const target = state.otencoPos!;
    const steps: Array<[number, number, Direction8]> = [[-1, 0, 'E'], [1, 0, 'W'], [0, -1, 'S'], [0, 1, 'N']];
    const floorSteps = steps.filter(([dx, dy]) => state.map.terrain[target.y + dy]?.[target.x + dx] === 'floor');
    const playerStep = floorSteps[0];
    const enemyStep = floorSteps[1];
    state.player.pos = { x: target.x + playerStep[0], y: target.y + playerStep[1] };
    state.player.hp = 1;
    state.enemies = [createInitialEnemy(
      'bok',
      { x: target.x + enemyStep[0], y: target.y + enemyStep[1] },
      10,
      999,
      state.turn,
      1,
      0,
      999,
    )];
    state.traps = [];
    state.combatRngState = 0;

    const result = processTurn(state, { type: 'move', direction: playerStep[2] });

    expect(state.phase).toBe('gameover');
    expect(state.otencoState).toBe('sealed');
    expect(state.otencoPos).toEqual(target);
    expect(result.events.some((e) => e.type === 'otenco_rescued')).toBe(false);
  });

  it('leaves existing production starts sealed and without a coordinate', () => {
    for (const seed of [1, 2, 100]) {
      const state = createInitialState(seed);
      expect(state.floor).toBe(1);
      expect(state.otencoState).toBe('sealed');
      expect(state.otencoPos).toBeUndefined();
    }
  });
});
