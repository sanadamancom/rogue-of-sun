import { bfsDistances, roomIndexContaining } from './mapgen';
import { GameMap, Vec2 } from './types';

/**
 * Deterministically places Otenco on a reachable floor tile maximally far
 * from both the start and stairs. This deliberately consumes no RNG. If a
 * generated map has no legal tile, the caller treats the thrown error as a
 * deterministic generation failure; the current map generator does not yet
 * expose its internal retry loop to floor-specific placement constraints.
 */
export function placeOtencoPosition(map: GameMap, start: Vec2, exit: Vec2, exclusions: Vec2[]): Vec2 {
  const fromStart = bfsDistances(map, start);
  const fromExit = bfsDistances(map, exit);
  const excluded = new Set([start, exit, ...exclusions].map((p) => `${p.x},${p.y}`));
  const candidates: Array<{ pos: Vec2; score: number; roomIndex: number }> = [];

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const key = `${x},${y}`;
      const startDistance = fromStart.get(key);
      const exitDistance = fromExit.get(key);
      if (map.terrain[y][x] !== 'floor' || excluded.has(key) || startDistance === undefined || exitDistance === undefined) continue;
      candidates.push({
        pos: { x, y },
        score: Math.min(startDistance, exitDistance),
        roomIndex: (() => {
          const index = roomIndexContaining(map.rooms, { x, y });
          return index === -1 ? map.rooms.length : index;
        })(),
      });
    }
  }

  if (candidates.length === 0) throw new Error('placeOtencoPosition: generated map has no legal reachable floor tile');

  candidates.sort((a, b) =>
    b.score - a.score || a.roomIndex - b.roomIndex || a.pos.y - b.pos.y || a.pos.x - b.pos.x,
  );
  return candidates[0].pos;
}
