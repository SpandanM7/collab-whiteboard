import { isShape } from '@whiteboard/shared';
import type { BoardElement, LineShape, Point } from '@whiteboard/shared';
import { coreBounds, elementHit, rectContains, shapeContains, unionRects } from './geometry.ts';
import type { Rect } from './geometry.ts';
import { snapToGrid } from './shapeDrag.ts';
import type { Transform } from './transform.ts';

/** The eight resize handles of a selection frame, by compass direction. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type LineEnd = 'start' | 'end';

export const CORNERS: readonly Handle[] = ['nw', 'ne', 'se', 'sw'];
export const ALL_HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * The topmost element under `p`. Lines, outlines and text win first; failing that, a closed shape
 * whose inside contains `p` (so a hollow box can be grabbed by its middle).
 */
export function pickElement(
  elements: readonly BoardElement[],
  p: Point,
  radius: number,
): BoardElement | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (elementHit(elements[i], p, radius)) return elements[i];
  }
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    if (isShape(element) && shapeContains(element, p)) return element;
  }
  return null;
}

/** Ids of the elements lying entirely inside `rect` (a marquee), in stacking order. */
export function elementsInRect(elements: readonly BoardElement[], rect: Rect): string[] {
  return elements.filter((e) => rectContains(rect, coreBounds(e))).map((e) => e.id);
}

/** The frame around a selection, or null for an empty one. */
export function selectionBounds(elements: readonly BoardElement[]): Rect | null {
  return unionRects(elements.map(coreBounds));
}

/** Where each handle sits on `bounds`. */
export function handlePoint(bounds: Rect, handle: Handle): Point {
  const cx = (bounds.left + bounds.right) / 2;
  const cy = (bounds.top + bounds.bottom) / 2;
  const x = handle.includes('w') ? bounds.left : handle.includes('e') ? bounds.right : cx;
  const y = handle.includes('n') ? bounds.top : handle.includes('s') ? bounds.bottom : cy;
  return { x, y };
}

/**
 * The handles worth showing. Corners always; edge handles only when the proportions may change
 * and the frame is big enough on screen that they do not crowd the corners.
 */
export function visibleHandles(screenWidth: number, screenHeight: number, lockAspect: boolean) {
  if (lockAspect) return CORNERS;
  return ALL_HANDLES.filter((h) => {
    if (h === 'n' || h === 's') return screenWidth >= 40;
    if (h === 'e' || h === 'w') return screenHeight >= 40;
    return true;
  });
}

/** The handle within `tolerance` of `p` (corners take priority), or null. */
export function handleAt(
  bounds: Rect,
  p: Point,
  tolerance: number,
  handles: readonly Handle[],
): Handle | null {
  let best: Handle | null = null;
  let bestDistance = Infinity;
  for (const handle of handles) {
    const at = handlePoint(bounds, handle);
    const distance = Math.hypot(p.x - at.x, p.y - at.y);
    // A corner wins a tie with an edge handle, which matters on a tiny frame.
    const bias = CORNERS.includes(handle) ? 0.5 : 0;
    if (distance <= tolerance && distance - bias < bestDistance) {
      best = handle;
      bestDistance = distance - bias;
    }
  }
  return best;
}

/** Which end of a line or arrow is within `tolerance` of `p`, if either. */
export function lineEndAt(shape: LineShape, p: Point, tolerance: number): LineEnd | null {
  const toEnd = Math.hypot(p.x - shape.end.x, p.y - shape.end.y);
  const toStart = Math.hypot(p.x - shape.start.x, p.y - shape.start.y);
  if (toEnd <= tolerance && toEnd <= toStart) return 'end';
  if (toStart <= tolerance) return 'start';
  return null;
}

export type ResizeOptions = {
  /** Shift, or forced when the selection holds text: keep the proportions. */
  keepAspect: boolean;
  /** Alt: resize around the middle instead of the opposite side. */
  fromCenter: boolean;
};

/**
 * The transform that drags `handle` of `bounds` to `pointer`. The opposite side (or the middle)
 * stays put; past it the selection flips. The result never collapses below one board unit.
 */
export function resizeTransform(
  bounds: Rect,
  handle: Handle,
  pointer: Point,
  { keepAspect, fromCenter }: ResizeOptions,
): Transform {
  const cx = (bounds.left + bounds.right) / 2;
  const cy = (bounds.top + bounds.bottom) / 2;
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const movesX = handle.includes('e') || handle.includes('w');
  const movesY = handle.includes('n') || handle.includes('s');
  const corner = movesX && movesY;

  // The fixed point, and the original position of the edge being dragged.
  const ax = fromCenter || !movesX ? cx : handle.includes('w') ? bounds.right : bounds.left;
  const ay = fromCenter || !movesY ? cy : handle.includes('n') ? bounds.bottom : bounds.top;
  const edgeX = handle.includes('w') ? bounds.left : bounds.right;
  const edgeY = handle.includes('n') ? bounds.top : bounds.bottom;

  const factor = (to: number, anchor: number, edge: number) =>
    Math.abs(edge - anchor) < 1e-9 ? 1 : (to - anchor) / (edge - anchor);
  let sx = movesX ? factor(pointer.x, ax, edgeX) : 1;
  let sy = movesY ? factor(pointer.y, ay, edgeY) : 1;

  if (keepAspect) {
    if (corner) {
      // Follow whichever side the pointer pulled further, keeping each side's direction.
      const s = Math.max(Math.abs(sx), Math.abs(sy));
      sx = Math.sign(sx || 1) * s;
      sy = Math.sign(sy || 1) * s;
    } else if (movesX) {
      sy = Math.abs(sx);
    } else {
      sx = Math.abs(sy);
    }
  }

  // Never thinner than one board unit, so the shape cannot vanish (or divide by zero on undo).
  const minScale = (size: number) => (size > 1e-9 ? 1 / size : 0);
  if (width > 1e-9 && Math.abs(sx) < minScale(width)) sx = Math.sign(sx || 1) * minScale(width);
  if (height > 1e-9 && Math.abs(sy) < minScale(height)) {
    sy = Math.sign(sy || 1) * minScale(height);
  }
  // An axis no handle moves is anchored in the middle, so keep-aspect growth there is even.
  return { origin: { x: ax, y: ay }, sx, sy, dx: 0, dy: 0 };
}

export type MoveOptions = {
  /** Shift: move along the axis the pointer travelled further on. */
  axisLock: boolean;
  /** Snap the frame's top-left corner to the grid. */
  grid: boolean;
};

/** How far a selection with frame `bounds` moves when dragged from `from` to `to`. */
export function moveDelta(
  bounds: Rect,
  from: Point,
  to: Point,
  { axisLock, grid }: MoveOptions,
): Point {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (axisLock) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  if (grid) {
    const corner = snapToGrid({ x: bounds.left + dx, y: bounds.top + dy });
    if (!axisLock || dx !== 0) dx = corner.x - bounds.left;
    if (!axisLock || dy !== 0) dy = corner.y - bounds.top;
  }
  return { x: dx, y: dy };
}

/** The line with one end moved to `p`. */
export function moveLineEnd(shape: LineShape, end: LineEnd, p: Point): LineShape {
  return end === 'start' ? { ...shape, start: p } : { ...shape, end: p };
}

/** The CSS cursor for hovering or dragging a handle. */
export function handleCursor(handle: Handle): string {
  switch (handle) {
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
  }
}
