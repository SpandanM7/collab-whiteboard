import { isClosedShape } from '@whiteboard/shared';
import type {
  Arrowhead,
  BoardElement,
  ClosedShape,
  ClosedShapeType,
  LineRoute,
  LineShape,
  Point,
  Shape,
  Stroke,
} from '@whiteboard/shared';

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
  if (path.length === 1) return Math.hypot(p.x - path[0].x, p.y - path[0].y);
  let best = Infinity;
  const last = closed ? path.length : path.length - 1;
  for (let i = 0; i < last; i++) {
    best = Math.min(best, distanceToSegment(p, path[i], path[(i + 1) % path.length]));
  }
  return best;
}

/** Ray casting: true if `p` is inside the closed polygon. */
function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The corners a closed shape spans, whichever way the user dragged. */
export function normalizedBox(shape: { start: Point; end: Point }): Rect {
  return {
    left: Math.min(shape.start.x, shape.end.x),
    top: Math.min(shape.start.y, shape.end.y),
    right: Math.max(shape.start.x, shape.end.x),
    bottom: Math.max(shape.start.y, shape.end.y),
  };
}

// A five-pointed star with its inner corners at this fraction of the outer radius.
const STAR_INNER = 0.42;
const UNIT_STAR = Array.from({ length: 10 }, (_, i) => {
  const angle = -Math.PI / 2 + (i * Math.PI) / 5;
  const r = i % 2 === 0 ? 1 : STAR_INNER;
  return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
});
const STAR_TOP = Math.min(...UNIT_STAR.map((p) => p.y));
const STAR_BOTTOM = Math.max(...UNIT_STAR.map((p) => p.y));

/**
 * The corners of a shape made of straight edges, in drawing order, stretched to fill its box.
 * Null for the curved shapes (ellipse, cylinder).
 */
export function polygonPoints(type: ClosedShapeType, box: Rect): Point[] | null {
  const { left: l, top: t, right: r, bottom: b } = box;
  const w = r - l;
  const cx = (l + r) / 2;
  const cy = (t + b) / 2;
  switch (type) {
    case 'rect':
      return [
        { x: l, y: t },
        { x: r, y: t },
        { x: r, y: b },
        { x: l, y: b },
      ];
    case 'diamond':
      return [
        { x: cx, y: t },
        { x: r, y: cy },
        { x: cx, y: b },
        { x: l, y: cy },
      ];
    case 'triangle':
      return [
        { x: cx, y: t },
        { x: r, y: b },
        { x: l, y: b },
      ];
    case 'hexagon':
      return [
        { x: l + w / 4, y: t },
        { x: r - w / 4, y: t },
        { x: r, y: cy },
        { x: r - w / 4, y: b },
        { x: l + w / 4, y: b },
        { x: l, y: cy },
      ];
    case 'star':
      return UNIT_STAR.map((p) => ({
        x: cx + (p.x * w) / 2,
        y: t + ((p.y - STAR_TOP) / (STAR_BOTTOM - STAR_TOP)) * (b - t),
      }));
    case 'ellipse':
    case 'cylinder':
      return null;
  }
}

/** How far a rounded corner is cut back from its vertex, for a shape of this box. */
export function cornerRadius(box: Rect): number {
  return Math.min(32, 0.25 * Math.min(box.right - box.left, box.bottom - box.top));
}

/** Half-height of a cylinder's top and bottom ellipses. */
export function cylinderCap(box: Rect): number {
  return Math.min((box.bottom - box.top) / 4, (box.right - box.left) / 4);
}

const ELLIPSE_SEGMENTS = 64;

/** Points along an ellipse from angle `from` to `to` (radians, clockwise on screen). */
function arcPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  segments: number,
): Point[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / segments;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  });
}

function ellipseOutline(box: Rect): Point[] {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const rx = (box.right - box.left) / 2;
  const ry = (box.bottom - box.top) / 2;
  return arcPoints(cx, cy, rx, ry, 0, Math.PI * 2, ELLIPSE_SEGMENTS).slice(0, -1);
}

/** A cylinder's outer edge: the back half of the lid, then the front half of the base. */
function cylinderSilhouette(box: Rect): Point[] {
  const cx = (box.left + box.right) / 2;
  const rx = (box.right - box.left) / 2;
  const cap = cylinderCap(box);
  const half = ELLIPSE_SEGMENTS / 2;
  return [
    ...arcPoints(cx, box.top + cap, rx, cap, Math.PI, Math.PI * 2, half),
    ...arcPoints(cx, box.bottom - cap, rx, cap, 0, Math.PI, half),
  ];
}

/**
 * Closed loops along a closed shape's visible lines, for hit testing. The first one is the
 * shape's silhouette (what a fill covers).
 */
function closedOutlines(shape: ClosedShape): Point[][] {
  const box = normalizedBox(shape);
  const polygon = polygonPoints(shape.type, box);
  if (polygon) return [polygon];
  if (shape.type === 'ellipse') return [ellipseOutline(box)];
  const lid = ellipseOutline({ ...box, bottom: box.top + 2 * cylinderCap(box) });
  return [cylinderSilhouette(box), lid];
}

/** The polyline a line or arrow follows: straight, or in right angles for an elbow. */
export function linePath(shape: { start: Point; end: Point; route?: LineRoute }): Point[] {
  const { start, end } = shape;
  if (shape.route !== 'elbow' || start.x === end.x || start.y === end.y) return [start, end];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const midX = start.x + dx / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  const midY = start.y + dy / 2;
  return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
}

/** The heads a line or arrow has, with the defaults for absent fields filled in. */
export function lineHeads(shape: LineShape): { start: Arrowhead; end: Arrowhead } {
  return {
    start: shape.startHead ?? 'none',
    end: shape.endHead ?? (shape.type === 'arrow' ? 'arrow' : 'none'),
  };
}

export function headLength(width: number): number {
  return Math.max(12, width * 4);
}

/** The two barbs of an arrow's head, in board space. They are drawn from `end` back along the line. */
export function arrowHead(start: Point, end: Point, width: number): [Point, Point] {
  const length = headLength(width);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const spread = Math.PI / 7;
  const barb = (offset: number): Point => ({
    x: end.x - length * Math.cos(angle + offset),
    y: end.y - length * Math.sin(angle + offset),
  });
  return [barb(spread), barb(-spread)];
}

export function dotRadius(width: number): number {
  return Math.max(4, width * 1.5);
}

/**
 * The lines a head is drawn with, ending at `tip` and pointing away from `from`. An open arrow
 * is two barbs; a triangle is its closed outline (it is also filled); a bar crosses the tip; a
 * dot is a circle around the tip.
 */
export function headOutline(kind: Arrowhead, from: Point, tip: Point, width: number): Point[] {
  switch (kind) {
    case 'none':
      return [];
    case 'arrow': {
      const [a, b] = arrowHead(from, tip, width);
      return [a, tip, b];
    }
    case 'triangle': {
      const [a, b] = arrowHead(from, tip, width);
      return [a, tip, b, a];
    }
    case 'bar': {
      const angle = Math.atan2(tip.y - from.y, tip.x - from.x) + Math.PI / 2;
      const half = headLength(width) / 2;
      const dx = half * Math.cos(angle);
      const dy = half * Math.sin(angle);
      return [
        { x: tip.x - dx, y: tip.y - dy },
        { x: tip.x + dx, y: tip.y + dy },
      ];
    }
    case 'dot': {
      const r = dotRadius(width);
      return arcPoints(tip.x, tip.y, r, r, 0, Math.PI * 2, 16);
    }
  }
}

/** Both heads of a line, tail first, as outlines; a missing head is an empty list. */
export function lineHeadOutlines(shape: LineShape): [Point[], Point[]] {
  const path = linePath(shape);
  const heads = lineHeads(shape);
  return [
    headOutline(heads.start, path[1], path[0], shape.width),
    headOutline(heads.end, path[path.length - 2], path[path.length - 1], shape.width),
  ];
}

function boundsOf(points: Point[], pad: number): Rect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p.x);
    right = Math.max(right, p.x);
    top = Math.min(top, p.y);
    bottom = Math.max(bottom, p.y);
  }
  return { left: left - pad, top: top - pad, right: right + pad, bottom: bottom + pad };
}

/** The shape's bounding box in board space, outline width (and any heads) included. */
export function shapeBounds(shape: Shape): Rect {
  const pad = shape.width / 2;
  if (!isClosedShape(shape)) {
    return boundsOf([...linePath(shape), ...lineHeadOutlines(shape).flat()], pad);
  }
  const box = normalizedBox(shape);
  return {
    left: box.left - pad,
    top: box.top - pad,
    right: box.right + pad,
    bottom: box.bottom + pad,
  };
}

function insideEllipse(p: Point, box: Rect): boolean {
  const rx = (box.right - box.left) / 2;
  const ry = (box.bottom - box.top) / 2;
  if (rx <= 0 || ry <= 0) return false;
  const nx = (p.x - (box.left + box.right) / 2) / rx;
  const ny = (p.y - (box.top + box.bottom) / 2) / ry;
  return nx * nx + ny * ny <= 1;
}

/**
 * True if `p` is within `radius` of the shape's outline, or inside it when it is filled. Hollow
 * shapes are only hit on their outline, so they can be erased without clearing what is inside.
 */
export function shapeHit(shape: Shape, p: Point, radius: number): boolean {
  const reach = radius + shape.width / 2;
  if (!isClosedShape(shape)) {
    if (distanceToPath(p, linePath(shape), false) <= reach) return true;
    return lineHeadOutlines(shape).some(
      (head) => head.length > 0 && distanceToPath(p, head, false) <= reach,
    );
  }
  const outlines = closedOutlines(shape);
  if (shape.fill) {
    const inside =
      shape.type === 'ellipse'
        ? insideEllipse(p, normalizedBox(shape))
        : insidePolygon(p, outlines[0]);
    if (inside) return true;
  }
  return outlines.some((outline) => distanceToPath(p, outline, true) <= reach);
}

export function elementBounds(element: BoardElement): Rect {
  return element.type === 'stroke' ? strokeBounds(element) : shapeBounds(element);
}

export function elementHit(element: BoardElement, p: Point, radius: number): boolean {
  return element.type === 'stroke' ? strokeHit(element, p, radius) : shapeHit(element, p, radius);
}
