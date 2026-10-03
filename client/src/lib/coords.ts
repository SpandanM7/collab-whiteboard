import type { Point } from '@whiteboard/shared';

type Rect = { left: number; top: number };

/**
 * Maps a pointer event to board space: relative to the canvas's own box, not the window, so a
 * moved or resized canvas (mobile URL bar, rotation, safe areas) cannot offset strokes.
 * Pan/zoom will go here.
 */
export function toBoard(e: { clientX: number; clientY: number }, origin: Rect): Point {
  return { x: e.clientX - origin.left, y: e.clientY - origin.top };
}

/** Maps a board-space point to viewport pixels (the inverse of `toBoard`). */
export function toScreen(p: Point): Point {
  return { x: p.x, y: p.y };
}
