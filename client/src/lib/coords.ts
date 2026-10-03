import type { Point } from '@whiteboard/shared';
import { toBoardPoint, toScreenPoint } from './view.ts';
import type { View } from './view.ts';

type Origin = { left: number; top: number };

/**
 * Maps a pointer event to board space: relative to the canvas's own box (not the window, so a
 * moved or resized canvas cannot offset strokes), then through the current view (pan and zoom).
 */
export function toBoard(
  e: { clientX: number; clientY: number },
  origin: Origin,
  view: View,
): Point {
  return toBoardPoint({ x: e.clientX - origin.left, y: e.clientY - origin.top }, view);
}

/** Maps a board-space point to viewport pixels (the inverse of `toBoard`). */
export function toScreen(p: Point, view: View): Point {
  return toScreenPoint(p, view);
}
