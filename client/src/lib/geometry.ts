import type { Point, Stroke } from '@whiteboard/shared';

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True if `p` is within `radius` of the stroke's visible line (half its width counts as hit). */
export function strokeHit(stroke: Stroke, p: Point, radius: number): boolean {
  const reach = radius + stroke.width / 2;
  const { points } = stroke;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y) <= reach;
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegment(p, points[i - 1], points[i]) <= reach) return true;
  }
  return false;
}

export type Rect = { left: number; top: number; right: number; bottom: number };

const boundsCache = new WeakMap<Stroke, { count: number; rect: Rect }>();

/** The stroke's bounding box in board space, line width included. Cached until the stroke grows. */
export function strokeBounds(stroke: Stroke): Rect {
  const { points, width } = stroke;
  const cached = boundsCache.get(stroke);
  if (cached && cached.count === points.length) return cached.rect;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    if (p.x < left) left = p.x;
    if (p.x > right) right = p.x;
    if (p.y < top) top = p.y;
    if (p.y > bottom) bottom = p.y;
  }
  const pad = width / 2;
  const rect = { left: left - pad, top: top - pad, right: right + pad, bottom: bottom + pad };
  boundsCache.set(stroke, { count: points.length, rect });
  return rect;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.left >= outer.left &&
    inner.right <= outer.right &&
    inner.top >= outer.top &&
    inner.bottom <= outer.bottom
  );
}
