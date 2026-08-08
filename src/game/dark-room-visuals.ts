/**
 * Phase 17.2 visibility fix — pure, unit-testable helpers for the dark
 * room's cool blue-violet rendering, split out from main.ts's drawTerrain
 * so the distance-band logic itself (not just the color table) can be
 * tested directly. No Canvas/DOM/Phaser dependency; `chebyshevDistance`
 * is the same distance metric visibility.ts already uses for FOV radius,
 * re-imported here rather than reimplemented.
 */
import { Vec2 } from './types';
import { chebyshevDistance } from './visibility';

export type DarkRoomBand = 'outside' | 'near' | 'middle' | 'edge';

/**
 * Which of the 4 cool-hue tiers a `currently_visible` dark-room tile
 * falls into this turn:
 *  - `outside`: the player is not standing inside the dark room, but
 *    this tile (inside the dark room) is visible anyway from a normal
 *    room/corridor vantage point (fixed_specification.
 *    visibility_outside_dark_room) — a single flat tier, since there's
 *    no meaningful "distance travelled inside the dark room" yet.
 *  - `near`/`middle`/`edge`: the player IS inside the dark room, banded
 *    by Chebyshev distance from the player to this tile (0–1 / 2 / 3+),
 *    per visibility_inside_dark_room.distance_bands. Never called for a
 *    tile more than radius 3 away in that case, since
 *    computeCorridorVisibility(..., DARK_ROOM_VISIBILITY_RADIUS) already
 *    excludes it — the `> 2` fallback to `'edge'` below is defensive
 *    only and never actually reached in production.
 */
export function darkRoomBand(playerInsideDarkRoom: boolean, playerPos: Vec2, tilePos: Vec2): DarkRoomBand {
  if (!playerInsideDarkRoom) return 'outside';
  const distance = chebyshevDistance(playerPos, tilePos);
  if (distance <= 1) return 'near';
  if (distance === 2) return 'middle';
  return 'edge';
}

/**
 * Cool blue-violet wall/floor fill per band (Phase 17.2 fix
 * visual_design.color_direction: "青紫または濃紺系の色相…単純な黒化や灰
 * 色化だけで済ませない"). `outside` intentionally reuses `near`'s values
 * (same entry point brightness whether first glimpsed from outside or
 * from just inside the doorway) but is kept as its own named tier so it
 * can be tuned independently later without touching the inside bands.
 *
 * Every wall value's each RGB channel is strictly greater than
 * EXPLORED_DIM_WALL_COLOR's (0x161616), and every floor value's each
 * channel is strictly greater than EXPLORED_DIM_FLOOR_COLOR's (0x0a0a0a)
 * — even at `edge`, the darkest tier — so a dark room's
 * currently_visible edge tile never reads as dim/explored_not_visible or
 * unexplored (implementation_gate.rendering_state: "edgeがunexploredと同
 * 一表示にならない"). Wall is always brighter than floor within a tier
 * (matches the ordinary/explored palettes) so shape stays legible.
 */
export const DARK_ROOM_WALL_COLOR: Record<DarkRoomBand, number> = {
  outside: 0x40407a,
  near: 0x40407a,
  middle: 0x30305c,
  edge: 0x242444,
};

export const DARK_ROOM_FLOOR_COLOR: Record<DarkRoomBand, number> = {
  outside: 0x22224a,
  near: 0x22224a,
  middle: 0x181838,
  edge: 0x14142c,
};
