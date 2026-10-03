import type { Point } from '@whiteboard/shared';

/** Maps a pointer event to board space. Identity for now; pan/zoom will go here. */
export function toBoard(e: { clientX: number; clientY: number }): Point {
  return { x: e.clientX, y: e.clientY };
}

/** Maps a board-space point to viewport pixels (the inverse of `toBoard`). */
export function toScreen(p: Point): Point {
  return { x: p.x, y: p.y };
}
