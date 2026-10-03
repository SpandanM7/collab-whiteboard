import type { BoardElement, Shape, Stroke } from '@whiteboard/shared';
import { arrowHead } from './geometry.ts';

/** Draws one stroke, smoothing the polyline with quadratic curves through segment midpoints. */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, color, width } = stroke;
  if (points.length === 0) return;

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/** Draws a rect, ellipse, line or arrow: fill first (if any), then the outline on top. */
export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  const { start, end, color, width } = shape;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.beginPath();
  switch (shape.type) {
    case 'rect':
      ctx.rect(
        Math.min(start.x, end.x),
        Math.min(start.y, end.y),
        Math.abs(end.x - start.x),
        Math.abs(end.y - start.y),
      );
      break;
    case 'ellipse':
      ctx.ellipse(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        Math.abs(end.x - start.x) / 2,
        Math.abs(end.y - start.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
      break;
    case 'line':
    case 'arrow':
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      if (shape.type === 'arrow') {
        const [a, b] = arrowHead(start, end, width);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(end.x, end.y);
        ctx.lineTo(b.x, b.y);
      }
      break;
  }
  if ((shape.type === 'rect' || shape.type === 'ellipse') && shape.fill) {
    ctx.fillStyle = shape.fill;
    ctx.fill();
  }
  ctx.stroke();
}

export function drawElement(ctx: CanvasRenderingContext2D, element: BoardElement): void {
  if (element.type === 'stroke') drawStroke(ctx, element);
  else drawShape(ctx, element);
}
