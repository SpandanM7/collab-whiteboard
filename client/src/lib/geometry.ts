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
