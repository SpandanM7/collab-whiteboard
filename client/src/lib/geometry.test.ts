import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import { arrowHead, elementBounds, elementHit, shapeBounds, shapeHit } from './geometry.ts';

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
