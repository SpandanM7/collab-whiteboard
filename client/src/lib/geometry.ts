import type { BoardElement, Point, Shape, Stroke } from '@whiteboard/shared';

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

/** Straight-line distance to the closest point of a polyline (or closed loop). */
function distanceToPath(p: Point, path: Point[], closed: boolean): number {
  let best = Infinity;
  const last = closed ? path.length : path.length - 1;
  for (let i = 0; i < last; i++) {
    best = Math.min(best, distanceToSegment(p, path[i], path[(i + 1) % path.length]));
  }
  return best;
}

/** The corners a rect or ellipse spans, whichever way the user dragged. */
function normalizedBox(shape: Shape): Rect {
  return {
    left: Math.min(shape.start.x, shape.end.x),
    top: Math.min(shape.start.y, shape.end.y),
    right: Math.max(shape.start.x, shape.end.x),
    bottom: Math.max(shape.start.y, shape.end.y),
  };
}

/** The two barbs of an arrow's head, in board space. They are drawn from `end` back along the line. */
export function arrowHead(start: Point, end: Point, width: number): [Point, Point] {
  const length = Math.max(12, width * 4);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const spread = Math.PI / 7;
  const barb = (offset: number): Point => ({
    x: end.x - length * Math.cos(angle + offset),
    y: end.y - length * Math.sin(angle + offset),
  });
  return [barb(spread), barb(-spread)];
}

const ELLIPSE_SEGMENTS = 64;

function ellipseOutline(box: Rect): Point[] {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const rx = (box.right - box.left) / 2;
  const ry = (box.bottom - box.top) / 2;
  return Array.from({ length: ELLIPSE_SEGMENTS }, (_, i) => {
    const t = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

/** The shape's bounding box in board space, outline width (and an arrow's head) included. */
export function shapeBounds(shape: Shape): Rect {
  let { left, top, right, bottom } = normalizedBox(shape);
  if (shape.type === 'arrow') {
    for (const barb of arrowHead(shape.start, shape.end, shape.width)) {
      left = Math.min(left, barb.x);
      right = Math.max(right, barb.x);
      top = Math.min(top, barb.y);
      bottom = Math.max(bottom, barb.y);
    }
  }
  const pad = shape.width / 2;
  return { left: left - pad, top: top - pad, right: right + pad, bottom: bottom + pad };
}

/**
 * True if `p` is within `radius` of the shape's outline, or inside it when it is filled. Hollow
 * shapes are only hit on their outline, so they can be erased without clearing what is inside.
 */
export function shapeHit(shape: Shape, p: Point, radius: number): boolean {
  const reach = radius + shape.width / 2;
  switch (shape.type) {
    case 'line':
      return distanceToSegment(p, shape.start, shape.end) <= reach;
    case 'arrow': {
      const [a, b] = arrowHead(shape.start, shape.end, shape.width);
      return (
        distanceToSegment(p, shape.start, shape.end) <= reach ||
        distanceToSegment(p, shape.end, a) <= reach ||
        distanceToSegment(p, shape.end, b) <= reach
      );
    }
    case 'rect': {
      const box = normalizedBox(shape);
      if (
        shape.fill &&
        p.x >= box.left &&
        p.x <= box.right &&
        p.y >= box.top &&
        p.y <= box.bottom
      ) {
        return true;
      }
      const corners = [
        { x: box.left, y: box.top },
        { x: box.right, y: box.top },
        { x: box.right, y: box.bottom },
        { x: box.left, y: box.bottom },
      ];
      return distanceToPath(p, corners, true) <= reach;
    }
    case 'ellipse': {
      const box = normalizedBox(shape);
      const rx = (box.right - box.left) / 2;
      const ry = (box.bottom - box.top) / 2;
      if (shape.fill && rx > 0 && ry > 0) {
        const nx = (p.x - (box.left + box.right) / 2) / rx;
        const ny = (p.y - (box.top + box.bottom) / 2) / ry;
        if (nx * nx + ny * ny <= 1) return true;
      }
      return distanceToPath(p, ellipseOutline(box), true) <= reach;
    }
  }
}

export function elementBounds(element: BoardElement): Rect {
  return element.type === 'stroke' ? strokeBounds(element) : shapeBounds(element);
}

export function elementHit(element: BoardElement, p: Point, radius: number): boolean {
  return element.type === 'stroke' ? strokeHit(element, p, radius) : shapeHit(element, p, radius);
}
