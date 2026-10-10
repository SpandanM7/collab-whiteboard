import { isClosedShape } from '@whiteboard/shared';
import type {
  Arrowhead,
  BoardElement,
  ClosedShape,
  LineShape,
  Point,
  Shape,
  Stroke,
  StrokeStyle,
  TextElement,
} from '@whiteboard/shared';
import {
  cornerRadius,
  cylinderCap,
  lineHeadOutlines,
  lineHeads,
  linePath,
  normalizedBox,
  polygonPoints,
} from './geometry.ts';
import { alignOf, cssFont, fontOf, layoutText } from './textLayout.ts';

/**
 * The part of the canvas API that drawing uses. A real canvas context fits it, and so does the
 * SVG export's recorder, so the PNG and SVG exports come from this one drawing code.
 */
export type DrawContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'quadraticCurveTo'
  | 'arc'
  | 'ellipse'
  | 'fill'
  | 'stroke'
  | 'clip'
  | 'setLineDash'
  | 'fillText'
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'globalAlpha'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
>;

/** Draws one stroke, smoothing the polyline with quadratic curves through segment midpoints. */
export function drawStroke(ctx: DrawContext, stroke: Stroke): void {
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

/** The dash pattern for an outline style; dots rely on round caps. */
export function dashPattern(style: StrokeStyle | undefined, width: number): number[] {
  switch (style) {
    case 'dashed':
      return [width * 3 + 6, width * 2 + 6];
    case 'dotted':
      return [0, width * 2 + 4];
    default:
      return [];
  }
}

/** Traces a polygon whose corners are cut back by `radius` and joined with a curve. */
function traceRounded(ctx: DrawContext, points: Point[], radius: number): void {
  const n = points.length;
  const toward = (from: Point, to: Point, distance: number): Point => {
    const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return {
      x: from.x + ((to.x - from.x) * distance) / length,
      y: from.y + ((to.y - from.y) * distance) / length,
    };
  };
  const edge = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n];
    const corner = points[i];
    const next = points[(i + 1) % n];
    // A third of each edge at most, so short edges (a star's) keep their shape.
    const cut = Math.min(radius, edge(prev, corner) / 3, edge(corner, next) / 3);
    const enter = toward(corner, prev, cut);
    const leave = toward(corner, next, cut);
    if (i === 0) ctx.moveTo(enter.x, enter.y);
    else ctx.lineTo(enter.x, enter.y);
    ctx.quadraticCurveTo(corner.x, corner.y, leave.x, leave.y);
  }
  ctx.closePath();
}

/** Traces the outline a closed shape's fill covers. */
function traceClosed(ctx: DrawContext, shape: ClosedShape): void {
  const box = normalizedBox(shape);
  const polygon = polygonPoints(shape.type, box);
  if (polygon) {
    if (shape.rounded) {
      traceRounded(ctx, polygon, cornerRadius(box));
      return;
    }
    ctx.moveTo(polygon[0].x, polygon[0].y);
    for (const p of polygon.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    return;
  }
  const cx = (box.left + box.right) / 2;
  const rx = (box.right - box.left) / 2;
  if (shape.type === 'ellipse') {
    const ry = (box.bottom - box.top) / 2;
    ctx.ellipse(cx, box.top + ry, rx, ry, 0, 0, Math.PI * 2);
    return;
  }
  // Cylinder: the back of the lid, down the right side, the front of the base, up the left.
  const cap = cylinderCap(box);
  ctx.ellipse(cx, box.top + cap, rx, cap, 0, Math.PI, Math.PI * 2);
  ctx.ellipse(cx, box.bottom - cap, rx, cap, 0, 0, Math.PI);
  ctx.closePath();
}

/** Fills the current path with diagonal lines (and the other diagonal too for `cross`). */
function hatch(ctx: DrawContext, shape: ClosedShape, color: string): void {
  const box = normalizedBox(shape);
  const gap = Math.max(8, shape.width * 3);
  const size = box.right - box.left + (box.bottom - box.top);
  ctx.save();
  ctx.clip();
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, shape.width / 2);
  ctx.beginPath();
  for (let d = 0; d <= size; d += gap) {
    ctx.moveTo(box.left + d, box.top);
    ctx.lineTo(box.left + d - size, box.top + size);
    if (shape.fillStyle === 'cross') {
      ctx.moveTo(box.right - d, box.top);
      ctx.lineTo(box.right - d + size, box.top + size);
    }
  }
  ctx.stroke();
  ctx.restore();
}

function drawClosed(ctx: DrawContext, shape: ClosedShape): void {
  ctx.beginPath();
  traceClosed(ctx, shape);
  if (shape.fill) {
    if (shape.fillStyle === 'hatch' || shape.fillStyle === 'cross') {
      hatch(ctx, shape, shape.fill);
      // Hatching replaced the current path with its lines; the outline needs the shape again.
      ctx.beginPath();
      traceClosed(ctx, shape);
    } else {
      ctx.fillStyle = shape.fill;
      ctx.fill();
    }
  }
  ctx.stroke();
  if (shape.type === 'cylinder') {
    // The front edge of the lid, which the silhouette does not include.
    const box = normalizedBox(shape);
    const cap = cylinderCap(box);
    ctx.beginPath();
    ctx.ellipse(
      (box.left + box.right) / 2,
      box.top + cap,
      (box.right - box.left) / 2,
      cap,
      0,
      0,
      Math.PI,
    );
    ctx.stroke();
  }
}

function drawHead(ctx: DrawContext, kind: Arrowhead, outline: Point[]): void {
  if (outline.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  for (const p of outline.slice(1)) ctx.lineTo(p.x, p.y);
  if (kind === 'triangle' || kind === 'dot') {
    ctx.closePath();
    ctx.fill();
  }
  ctx.stroke();
}

function drawLine(ctx: DrawContext, shape: LineShape): void {
  const path = linePath(shape);
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (const p of path.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  // Heads are always solid, even on a dashed line.
  ctx.setLineDash([]);
  ctx.fillStyle = shape.color;
  const heads = lineHeads(shape);
  const [tail, head] = lineHeadOutlines(shape);
  drawHead(ctx, heads.start, tail);
  drawHead(ctx, heads.end, head);
}

/** Draws any shape: fill first (if any), then the outline on top, then any arrow heads. */
export function drawShape(ctx: DrawContext, shape: Shape): void {
  ctx.save();
  ctx.globalAlpha = shape.opacity ?? 1;
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dashPattern(shape.strokeStyle, shape.width));
  if (isClosedShape(shape)) drawClosed(ctx, shape);
  else drawLine(ctx, shape);
  ctx.restore();
}

/** Draws a text block: each line on its own row, aligned inside the block. */
export function drawText(ctx: DrawContext, text: TextElement): void {
  const layout = layoutText(text);
  const align = alignOf(text);
  ctx.save();
  ctx.globalAlpha = text.opacity ?? 1;
  ctx.fillStyle = text.color;
  ctx.font = cssFont(fontOf(text), text.fontSize);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const x =
    align === 'left'
      ? text.start.x
      : align === 'center'
        ? text.start.x + layout.width / 2
        : text.start.x + layout.width;
  layout.lines.forEach((line, i) => {
    ctx.fillText(line, x, text.start.y + layout.lineHeight * (i + 0.5));
  });
  ctx.restore();
}

export function drawElement(ctx: DrawContext, element: BoardElement): void {
  switch (element.type) {
    case 'stroke':
      drawStroke(ctx, element);
      break;
    case 'text':
      drawText(ctx, element);
      break;
    default:
      drawShape(ctx, element);
  }
}
