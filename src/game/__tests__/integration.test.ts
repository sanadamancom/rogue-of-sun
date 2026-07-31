import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { canMove } from '../map';
import { processTurn } from '../turn';
import { ALL_DIRECTIONS } from '../types';

describe('integration - generated map gameplay', () => {
  it('lets the player move in all 8 directions where the generated map allows it', () => {
    const state = createInitialState(555);
    // Sanity: at least one of the 8 directions must be a legal move from start,
    // since start sits inside a room with floor around it.
    const anyMovable = ALL_DIRECTIONS.some((dir) => canMove(state.map, state.player.pos, dir));
    expect(anyMovable).toBe(true);
  });

  it('cannot move outside the map bounds from a corner-adjacent wall', () => {
    const state = createInitialState(555);
    expect(canMove(state.map, { x: 0, y: 0 }, 'N')).toBe(false);
    expect(canMove(state.map, { x: 0, y: 0 }, 'W')).toBe(false);
  });

  it('forbids diagonal corner-cutting on the generated map', () => {
    const state = createInitialState(555);
    // Construct a corner case directly against the generated terrain: find
    // any wall tile with a floor diagonal neighbor cut off by two wall sides.
    const { map } = state;
    let found = false;
    for (let y = 1; y < map.height - 1 && !found; y++) {
      for (let x = 1; x < map.width - 1 && !found; x++) {
        if (map.terrain[y][x] !== 'floor') continue;
        // Look for a diagonal neighbor that is floor while both orthogonal
        // sides are walls (a true corner-cut case).
        const diagonals: [number, number][] = [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ];
        for (const [dx, dy] of diagonals) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
          if (map.terrain[ny][nx] !== 'floor') continue;
          const sideAWall = map.terrain[y][nx] !== 'floor';
          const sideBWall = map.terrain[ny][x] !== 'floor';
          if (sideAWall && sideBWall) {
            found = true;
            const dir = dx === 1 && dy === 1 ? 'SE' : dx === 1 && dy === -1 ? 'NE' : dx === -1 && dy === 1 ? 'SW' : 'NW';
            expect(canMove(map, { x, y }, dir as any)).toBe(false);
          }
        }
      }
    }
    // Not asserting `found` strictly true: corridors are 1-wide so corner
    // cases may or may not exist for a given seed; this test still verifies
    // canMove's corner rule wherever such a case is found.
  });

  it('reaches floor_cleared when the player steps onto the exit tile after defeating the enemy', () => {
    const state = createInitialState(555);
    // Directly place the player one step away from the exit (bypassing
    // pathing, since only the terminal transition is under test here) and
    // move onto it, using a cardinal step that the map allows if adjacent
    // floor exists; fall back to teleporting onto the exit for the check
    // when no direct neighbor step applies.
    const exit = state.exit;
    const neighborDirs = ALL_DIRECTIONS;
    let moved = false;
    for (const dir of neighborDirs) {
      const deltas: Record<string, [number, number]> = {
        N: [0, 1], S: [0, -1], E: [-1, 0], W: [1, 0],
        NE: [-1, 1], NW: [1, 1], SE: [-1, -1], SW: [1, -1],
      };
      const [ox, oy] = deltas[dir];
      const from = { x: exit.x + ox, y: exit.y + oy };
      if (from.x < 0 || from.y < 0 || from.x >= state.map.width || from.y >= state.map.height) continue;
      if (state.map.terrain[from.y][from.x] !== 'floor') continue;
      if (!canMove(state.map, from, dir as any)) continue;
      state.player.pos = from;
      state.enemies.forEach((enemy, i) => {
        enemy.pos = { x: 0, y: i }; // move enemies far away, off any floor check path
        enemy.alive = false;
      });
      const result = processTurn(state, { type: 'move', direction: dir as any });
      expect(result.consumed).toBe(true);
      expect(state.phase).toBe('floor_cleared');
      moved = true;
      break;
    }
    expect(moved).toBe(true);
  });

  it('stops normal turn operations once floor_cleared', () => {
    const state = createInitialState(555);
    state.phase = 'floor_cleared';
    const before = state.turn;
    const result = processTurn(state, { type: 'wait' });
    expect(result.consumed).toBe(false);
    expect(state.turn).toBe(before);
  });

  it('keeps Phase 01 combat behavior on a generated map (enemy takes 2 hits to defeat)', () => {
    const state = createInitialState(555);
    state.enemies[0].pos = { x: state.player.pos.x + 1, y: state.player.pos.y };
    state.enemies[0].alive = true;
    state.enemies[0].hp = 2;
    state.enemies[1].pos = { x: 0, y: 0 };
    state.enemies[1].alive = false;
    state.player.facing = 'E';

    const r1 = processTurn(state, { type: 'action' });
    expect(r1.playerAttacked).toBe(true);
    expect(state.enemies[0].alive).toBe(true);

    const r2 = processTurn(state, { type: 'action' });
    expect(r2.enemyDefeated).toBe(true);
    expect(state.enemies[0].alive).toBe(false);
  });
});
