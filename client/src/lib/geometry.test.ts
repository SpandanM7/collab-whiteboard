import { describe, expect, it } from 'vitest';
import type { LineShape, Shape } from '@whiteboard/shared';
import {
  arrowHead,
  cylinderCap,
  dotRadius,
  elementBounds,
  elementHit,
  headLength,
  lineHeadOutlines,
  lineHeads,
  linePath,
  polygonPoints,
  shapeBounds,
  shapeHit,
} from './geometry.ts';

const base = {
  id: 's',
  authorId: 'a',
  color: '#000000',
  width: 2,
  start: { x: 0, y: 0 },
  end: { x: 100, y: 50 },
  createdAt: 0,
};
const rect = (extra: Partial<Shape> = {}) => ({ ...base, type: 'rect', ...extra }) as Shape;
const ellipse = (extra: Partial<Shape> = {}) => ({ ...base, type: 'ellipse', ...extra }) as Shape;
const line = (extra: Partial<Shape> = {}) => ({ ...base, type: 'line', ...extra }) as Shape;
const arrow = (extra: Partial<Shape> = {}) => ({ ...base, type: 'arrow', ...extra }) as Shape;

describe('shapeBounds', () => {
  it('pads a rect by half the outline width', () => {
    expect(shapeBounds(rect())).toEqual({ left: -1, top: -1, right: 101, bottom: 51 });
  });

  it('does not care which corner was dragged first', () => {
    const flipped = rect({ start: { x: 100, y: 50 }, end: { x: 0, y: 0 } });
    expect(shapeBounds(flipped)).toEqual(shapeBounds(rect()));
  });

  it('grows to include the barbs of an arrow head', () => {
    // Drawn right to left: the barbs sit above and below the line near its left end.
    const a = arrow({ start: { x: 100, y: 0 }, end: { x: 0, y: 0 }, width: 2 });
    const bounds = shapeBounds(a);
    expect(bounds.left).toBeCloseTo(-1);
    expect(bounds.top).toBeLessThan(-1);
    expect(bounds.bottom).toBeGreaterThan(1);
  });
});

describe('arrowHead', () => {
  it('puts both barbs behind the tip, on either side of the line', () => {
    const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 2);
    expect(a.x).toBeLessThan(100);
    expect(b.x).toBeCloseTo(a.x);
    expect(a.y).toBeCloseTo(-b.y);
    expect(a.y).not.toBe(0);
  });

  it('scales with the line width', () => {
    const small = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 2)[0];
    const big = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 20)[0];
    expect(100 - big.x).toBeGreaterThan(100 - small.x);
  });

  it('does not blow up for a zero-length arrow', () => {
    const [a, b] = arrowHead({ x: 5, y: 5 }, { x: 5, y: 5 }, 2);
    expect(Number.isFinite(a.x + a.y + b.x + b.y)).toBe(true);
  });
});

describe('shapeHit', () => {
  it('hits a hollow rect only on its outline', () => {
    expect(shapeHit(rect(), { x: 50, y: 0 }, 0)).toBe(true); // top edge
    expect(shapeHit(rect(), { x: 50, y: 25 }, 0)).toBe(false); // inside
    expect(shapeHit(rect(), { x: 50, y: 25 }, 30)).toBe(true); // inside, with a big eraser
    expect(shapeHit(rect(), { x: 200, y: 25 }, 5)).toBe(false); // outside
  });

  it('hits a filled rect anywhere inside', () => {
    expect(shapeHit(rect({ fill: '#ff0000' }), { x: 50, y: 25 }, 0)).toBe(true);
  });

  it('hits a hollow ellipse on its outline, not its middle', () => {
    expect(shapeHit(ellipse(), { x: 100, y: 25 }, 0)).toBe(true); // right-most point
    expect(shapeHit(ellipse(), { x: 50, y: 25 }, 0)).toBe(false);
  });

  it('hits a filled ellipse inside, but not in its bounding-box corner', () => {
    const filled = ellipse({ fill: '#ff0000' });
    expect(shapeHit(filled, { x: 50, y: 25 }, 0)).toBe(true);
    expect(shapeHit(filled, { x: 2, y: 2 }, 0)).toBe(false);
  });

  it('hits a line near the segment but not beyond its ends', () => {
    expect(shapeHit(line(), { x: 50, y: 25 }, 0)).toBe(true);
    expect(shapeHit(line(), { x: 50, y: 40 }, 3)).toBe(false);
    expect(shapeHit(line(), { x: 150, y: 75 }, 3)).toBe(false);
  });

  it('hits an arrow on its head as well as its shaft', () => {
    const a = arrow({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } });
    const [barb] = arrowHead(a.start, a.end, a.width);
    expect(shapeHit(a, { x: 50, y: 0 }, 0)).toBe(true);
    expect(shapeHit(a, { x: (barb.x + 100) / 2, y: barb.y / 2 }, 0)).toBe(true);
  });

  it('copes with a degenerate (zero-size) shape', () => {
    const dot = rect({ start: { x: 5, y: 5 }, end: { x: 5, y: 5 }, fill: '#ff0000' });
    expect(shapeHit(dot, { x: 5, y: 5 }, 0)).toBe(true);
    expect(shapeHit(dot, { x: 50, y: 5 }, 0)).toBe(false);
  });
});

describe('element dispatch', () => {
  it('uses the stroke code for strokes and the shape code for shapes', () => {
    const stroke = {
      id: 's1',
      type: 'stroke' as const,
      authorId: 'a',
      color: '#000000',
      width: 2,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      createdAt: 0,
    };
    expect(elementBounds(stroke)).toEqual({ left: -1, top: -1, right: 11, bottom: 1 });
    expect(elementHit(stroke, { x: 5, y: 0 }, 0)).toBe(true);
    expect(elementBounds(rect())).toEqual(shapeBounds(rect()));
    expect(elementHit(rect(), { x: 50, y: 0 }, 0)).toBe(true);
  });
});

describe('new shapes', () => {
  const box = { start: { x: 0, y: 0 }, end: { x: 100, y: 100 } };
  const closed = (type: Shape['type'], extra: Partial<Shape> = {}) =>
    ({ ...base, ...box, type, ...extra }) as Shape;

  it('stretches each polygon to fill its box', () => {
    for (const type of ['rect', 'diamond', 'triangle', 'hexagon', 'star'] as const) {
      const points = polygonPoints(type, { left: 0, top: 0, right: 100, bottom: 100 })!;
      expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(type === 'star' ? 2.45 : 0, 1);
      expect(Math.min(...points.map((p) => p.y))).toBeCloseTo(0);
      expect(Math.max(...points.map((p) => p.y))).toBeCloseTo(100);
    }
    expect(polygonPoints('ellipse', { left: 0, top: 0, right: 1, bottom: 1 })).toBeNull();
  });

  it('hits a diamond on its edges, not in its empty corners', () => {
    expect(shapeHit(closed('diamond'), { x: 25, y: 25 }, 0)).toBe(true); // on the top-left edge
    expect(shapeHit(closed('diamond'), { x: 5, y: 5 }, 0)).toBe(false); // box corner
    expect(shapeHit(closed('diamond'), { x: 50, y: 50 }, 0)).toBe(false); // hollow middle
    expect(shapeHit(closed('diamond', { fill: '#ff0000' }), { x: 50, y: 50 }, 0)).toBe(true);
  });

  it('hits a filled triangle inside but not beside its point', () => {
    const t = closed('triangle', { fill: '#ff0000' });
    expect(shapeHit(t, { x: 50, y: 80 }, 0)).toBe(true);
    expect(shapeHit(t, { x: 10, y: 10 }, 0)).toBe(false);
  });

  it('hits a cylinder on the front edge of its lid', () => {
    const c = closed('cylinder');
    const cap = cylinderCap({ left: 0, top: 0, right: 100, bottom: 100 });
    expect(shapeHit(c, { x: 50, y: 2 * cap }, 0)).toBe(true); // lowest point of the lid
    expect(shapeHit(c, { x: 50, y: 70 }, 0)).toBe(false); // hollow body
  });

  it('keeps every shape inside its padded box', () => {
    for (const type of ['ellipse', 'diamond', 'star', 'cylinder'] as const) {
      expect(shapeBounds(closed(type))).toEqual({ left: -1, top: -1, right: 101, bottom: 101 });
    }
  });
});

describe('lines and arrows', () => {
  it('routes an elbow along the longer axis first', () => {
    const wide = linePath({ start: { x: 0, y: 0 }, end: { x: 100, y: 40 }, route: 'elbow' });
    expect(wide).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 100, y: 40 },
    ]);
    const tall = linePath({ start: { x: 0, y: 0 }, end: { x: 30, y: 100 }, route: 'elbow' });
    expect(tall[1]).toEqual({ x: 0, y: 50 });
  });

  it('keeps an elbow that is already straight as one segment', () => {
    expect(linePath({ start: { x: 0, y: 0 }, end: { x: 0, y: 50 }, route: 'elbow' })).toHaveLength(
      2,
    );
  });

  it('gives an arrow an end head by default, and a line none', () => {
    expect(lineHeads(arrow() as LineShape)).toEqual({ start: 'none', end: 'arrow' });
    expect(lineHeads(line() as LineShape)).toEqual({ start: 'none', end: 'none' });
  });

  it('points an elbow arrow head along the last segment', () => {
    const a = arrow({ start: { x: 0, y: 0 }, end: { x: 100, y: 40 }, route: 'elbow' }) as LineShape;
    const [, head] = lineHeadOutlines(a);
    // The last segment runs right, so both barbs sit left of the tip.
    expect(head[0].x).toBeLessThan(100);
    expect(head[2].x).toBeLessThan(100);
    expect(head[1]).toEqual({ x: 100, y: 40 });
  });

  it('hits a head at the start of the line too', () => {
    const a = arrow({
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      startHead: 'bar',
    }) as LineShape;
    expect(shapeHit(a, { x: 0, y: headLength(a.width) / 2 }, 0)).toBe(true);
    expect(shapeHit({ ...a, startHead: 'none' }, { x: 0, y: headLength(a.width) / 2 }, 0)).toBe(
      false,
    );
  });

  it('includes a dot head in the bounds', () => {
    const a = arrow({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, endHead: 'dot' }) as LineShape;
    expect(shapeBounds(a).right).toBeGreaterThan(100 + dotRadius(a.width) - 0.01);
  });
});
