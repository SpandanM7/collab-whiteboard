import { isClosedShapeType } from '@whiteboard/shared';
import type { Point, ShapeType } from '@whiteboard/shared';

/** Board units between grid lines (at 100% zoom, one grid square is this many pixels). */
export const GRID_SIZE = 20;
/** Shift snaps lines and arrows to multiples of this angle (15 degrees). */
export const ANGLE_STEP = Math.PI / 12;

/** Modifier keys held while dragging out a shape. */
export type DragModifiers = {
  /** Lines snap to 15 degree steps; boxes become squares and circles. */
  shift: boolean;
  /** The drag starts from the shape's center instead of a corner (or a line's middle). */
  alt: boolean;
};

export function snapToGrid(p: Point, size: number = GRID_SIZE): Point {
  return { x: Math.round(p.x / size) * size, y: Math.round(p.y / size) * size };
}

/** `p` moved onto the nearest ray from `origin` at a multiple of `step`, keeping its distance. */
export function snapAngle(origin: Point, p: Point, step: number = ANGLE_STEP): Point {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return p;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  // Round off float noise so a horizontal line is exactly horizontal.
  const clean = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    x: clean(origin.x + length * Math.cos(angle)),
    y: clean(origin.y + length * Math.sin(angle)),
  };
}

/**
 * The start and end of a shape dragged from `origin` (where the pointer went down) to `pointer`,
 * after grid snapping and modifier keys. With the grid on, both points land on grid lines.
 */
export function dragShape(
  type: ShapeType,
  origin: Point,
  pointer: Point,
  mods: DragModifiers,
  grid: boolean,
): { start: Point; end: Point } {
  const o = grid ? snapToGrid(origin) : origin;
  let p = grid ? snapToGrid(pointer) : pointer;

  if (!isClosedShapeType(type)) {
    if (mods.shift) p = snapAngle(o, p);
    // Alt: the origin is the middle of the line, so the tail mirrors the head.
    const start = mods.alt ? { x: 2 * o.x - p.x, y: 2 * o.y - p.y } : o;
    return { start, end: p };
  }

  let dx = p.x - o.x;
  let dy = p.y - o.y;
  if (mods.shift) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * size;
    dy = (dy < 0 ? -1 : 1) * size;
  }
  const start = mods.alt ? { x: o.x - dx, y: o.y - dy } : o;
  return { start, end: { x: o.x + dx, y: o.y + dy } };
}

/**
 * What to show beside the pointer while dragging: "width × height" for a box, and
 * "length · angle" for a line (degrees counter-clockwise from pointing right, as on a protractor).
 */
export function dragReadout(type: ShapeType, start: Point, end: Point): string {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (isClosedShapeType(type)) return `${Math.round(Math.abs(dx))} × ${Math.round(Math.abs(dy))}`;
  const degrees = (Math.round((-Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360;
  return `${Math.round(Math.hypot(dx, dy))} · ${degrees}°`;
}

/**
 * The spacing of grid dots at this zoom: the base grid, or a multiple of it once the dots would be
 * closer than `minPixels` on screen (so zooming out never fills the screen with dots).
 */
export function gridStep(scale: number, minPixels = 12): number {
  let step = GRID_SIZE;
  while (step * scale < minPixels) step *= 5;
  return step;
}
