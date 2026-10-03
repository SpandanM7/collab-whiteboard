import type { Point, Stroke } from '@whiteboard/shared';
import { strokeBounds } from './geometry.ts';
import type { Rect } from './geometry.ts';

/**
 * Where this person is looking at the board. It is purely local: strokes stay in board space and
 * only this changes. `screen = board * scale + (x, y)`, with screen measured from the top-left
 * corner of the canvas.
 */
export type View = { x: number; y: number; scale: number };
export type Size = { width: number; height: number };
/** Screen space kept clear of floating UI (top bar, toolbar) when framing content. */
export type Insets = { top: number; right: number; bottom: number; left: number };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
/** The view a fresh board opens with: board space equals screen pixels. */
export const HOME_VIEW: View = { x: 0, y: 0, scale: 1 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function toBoardPoint(screen: Point, view: View): Point {
  return { x: (screen.x - view.x) / view.scale, y: (screen.y - view.y) / view.scale };
}

export function toScreenPoint(board: Point, view: View): Point {
  return { x: board.x * view.scale + view.x, y: board.y * view.scale + view.y };
}

/** Zooms to `scale` (clamped) while the board point under `anchor` (a screen point) stays put. */
export function zoomAt(view: View, anchor: Point, scale: number): View {
  const next = clampScale(scale);
  const board = toBoardPoint(anchor, view);
  return { scale: next, x: anchor.x - board.x * next, y: anchor.y - board.y * next };
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/** The part of the board currently on screen, in board space. */
export function visibleRect(view: View, size: Size): Rect {
  return {
    left: -view.x / view.scale,
    top: -view.y / view.scale,
    right: (size.width - view.x) / view.scale,
    bottom: (size.height - view.y) / view.scale,
  };
}

/** The box around everything drawn, or null for an empty board. */
export function contentBounds(strokes: Stroke[]): Rect | null {
  let bounds: Rect | null = null;
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    const b = strokeBounds(stroke);
    bounds = bounds
      ? {
          left: Math.min(bounds.left, b.left),
          top: Math.min(bounds.top, b.top),
          right: Math.max(bounds.right, b.right),
          bottom: Math.max(bounds.bottom, b.bottom),
        }
      : b;
  }
  return bounds;
}

/** Centers `bounds` in the free area of the screen, zooming out (never in past 100%) to fit it. */
export function fitView(bounds: Rect, size: Size, insets: Insets): View {
  const availWidth = Math.max(1, size.width - insets.left - insets.right);
  const availHeight = Math.max(1, size.height - insets.top - insets.bottom);
  const width = Math.max(1, bounds.right - bounds.left);
  const height = Math.max(1, bounds.bottom - bounds.top);
  const scale = clampScale(Math.min(availWidth / width, availHeight / height, 1));
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  return {
    scale,
    x: insets.left + availWidth / 2 - centerX * scale,
    y: insets.top + availHeight / 2 - centerY * scale,
  };
}

/** Moves the view so `board` is at the middle of the screen, keeping the zoom. */
export function centerOn(view: View, board: Point, size: Size): View {
  return {
    scale: view.scale,
    x: size.width / 2 - board.x * view.scale,
    y: size.height / 2 - board.y * view.scale,
  };
}
