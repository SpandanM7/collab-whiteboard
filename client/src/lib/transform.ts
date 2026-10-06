import { LIMITS } from '@whiteboard/shared';
import type { BoardElement, Point } from '@whiteboard/shared';
import { textBox } from './geometry.ts';

/**
 * A move and/or resize: `p' = origin + (p - origin) * (sx, sy) + (dx, dy)`. A negative scale
 * mirrors (dragging a handle past the opposite side flips the selection).
 */
export type Transform = { origin: Point; sx: number; sy: number; dx: number; dy: number };

export const IDENTITY: Transform = { origin: { x: 0, y: 0 }, sx: 1, sy: 1, dx: 0, dy: 0 };

export function translation(dx: number, dy: number): Transform {
  return { ...IDENTITY, dx, dy };
}

export function isIdentity(t: Transform): boolean {
  return t.sx === 1 && t.sy === 1 && t.dx === 0 && t.dy === 0;
}

/**
 * Coordinates are kept to 1/100 of a board unit: invisible at any zoom, and it keeps a moved
 * 5,000-point stroke well inside one socket message.
 */
export function roundCoord(v: number): number {
  return Math.round(v * 100) / 100;
}

const clampCoord = (v: number) =>
  Math.max(-LIMITS.maxCoordinate, Math.min(LIMITS.maxCoordinate, roundCoord(v)));

export function mapPoint(p: Point, t: Transform): Point {
  return {
    x: clampCoord(t.origin.x + (p.x - t.origin.x) * t.sx + t.dx),
    y: clampCoord(t.origin.y + (p.y - t.origin.y) * t.sy + t.dy),
  };
}

const clampFont = (size: number) =>
  Math.max(LIMITS.minFontSize, Math.min(LIMITS.maxFontSize, roundCoord(size)));

/**
 * The element moved and resized by `t`. Line widths stay as they are (like most whiteboards);
 * text keeps its proportions, scaling its font by the smaller of the two factors.
 */
export function transformElement<T extends BoardElement>(element: T, t: Transform): T {
  switch (element.type) {
    case 'stroke':
      return { ...element, points: element.points.map((p) => mapPoint(p, t)) };
    case 'text': {
      const box = textBox(element);
      const a = mapPoint({ x: box.left, y: box.top }, t);
      const b = mapPoint({ x: box.right, y: box.bottom }, t);
      const scale = Math.min(Math.abs(t.sx), Math.abs(t.sy));
      return {
        ...element,
        start: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
        fontSize: scale === 1 ? element.fontSize : clampFont(element.fontSize * scale),
      };
    }
    default:
      return { ...element, start: mapPoint(element.start, t), end: mapPoint(element.end, t) };
  }
}

/** The element with its coordinates rounded, as it should be stored and sent. */
export function roundElement<T extends BoardElement>(element: T): T {
  const round = (p: Point) => ({ x: roundCoord(p.x), y: roundCoord(p.y) });
  switch (element.type) {
    case 'stroke':
      return { ...element, points: element.points.map(round) };
    case 'text':
      return { ...element, start: round(element.start) };
    default:
      return { ...element, start: round(element.start), end: round(element.end) };
  }
}
