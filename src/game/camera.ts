import { Vec2 } from './types';

/** Standard field camera size (Phase 14.5 UI/input overhaul spec section 6.1). */
export const CAMERA_VIEW_WIDTH = 9;
export const CAMERA_VIEW_HEIGHT = 7;

export interface CameraWindow {
  /** Top-left tile x of the visible window (inclusive, 0-indexed). */
  x0: number;
  /** Top-left tile y of the visible window (inclusive, 0-indexed). */
  y0: number;
  width: number;
  height: number;
}

/**
 * Computes the 9x7 (or given size) camera window for a floor of the
 * given dimensions, keeping the player centered except where the map
 * boundary forces the window to clamp (Phase 14.5 spec 6.1: "プレイヤー
 * は原則中央マスに置く" / "マップ端ではカメラをマップ境界へ固定し、
 * プレイヤーが中央から外れることを許可する"). Pure — never reads or
 * mutates GameState, never affects floor generation, terrain, or actor
 * positions (spec 6.1's "ゲーム内部のフロア寸法、地形...は変更しない").
 * If the map is smaller than the requested view in either axis, the
 * window is clamped to the map's own size on that axis (never larger
 * than the map, never negative-width).
 */
export function computeCameraWindow(
  playerPos: Vec2,
  mapWidth: number,
  mapHeight: number,
  viewWidth: number = CAMERA_VIEW_WIDTH,
  viewHeight: number = CAMERA_VIEW_HEIGHT,
): CameraWindow {
  const width = Math.min(viewWidth, mapWidth);
  const height = Math.min(viewHeight, mapHeight);

  const maxX0 = Math.max(0, mapWidth - width);
  const maxY0 = Math.max(0, mapHeight - height);

  const idealX0 = playerPos.x - Math.floor(width / 2);
  const idealY0 = playerPos.y - Math.floor(height / 2);

  const x0 = Math.min(Math.max(idealX0, 0), maxX0);
  const y0 = Math.min(Math.max(idealY0, 0), maxY0);

  return { x0, y0, width, height };
}

/** True if `pos` (a tile coordinate) falls within `window`. */
export function isWithinCameraWindow(pos: Vec2, window: CameraWindow): boolean {
  return pos.x >= window.x0 && pos.x < window.x0 + window.width && pos.y >= window.y0 && pos.y < window.y0 + window.height;
}
