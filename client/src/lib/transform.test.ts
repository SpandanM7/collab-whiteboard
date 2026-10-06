import { describe, expect, it } from 'vitest';
import { LIMITS } from '@whiteboard/shared';
import type { Shape, Stroke, TextElement } from '@whiteboard/shared';
import {
  isIdentity,
  mapPoint,
  roundCoord,
  roundElement,
  transformElement,
  translation,
} from './transform.ts';
import type { Transform } from './transform.ts';

const stroke: Stroke = {
  id: 's',
  type: 'stroke',
  authorId: 'a',
  color: '#000000',
  width: 4,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 20 },
  ],
  createdAt: 0,
};

const rect: Shape = {
  id: 'r',
  type: 'rect',
  authorId: 'a',
  color: '#000000',
  width: 2,
  start: { x: 10, y: 10 },
  end: { x: 30, y: 50 },
  createdAt: 0,
};

const text: TextElement = {
  id: 't',
  type: 'text',
  authorId: 'a',
  color: '#000000',
  start: { x: 0, y: 0 },
  text: 'ab',
  fontSize: 20,
  createdAt: 0,
};

const scale = (sx: number, sy: number, origin = { x: 0, y: 0 }): Transform => ({
  origin,
  sx,
  sy,
  dx: 0,
  dy: 0,
});

describe('mapPoint', () => {
  it('moves, then scales around the origin', () => {
    expect(mapPoint({ x: 5, y: 5 }, translation(3, -2))).toEqual({ x: 8, y: 3 });
    expect(mapPoint({ x: 15, y: 10 }, scale(2, 3, { x: 10, y: 10 }))).toEqual({ x: 20, y: 10 });
  });

  it('mirrors with a negative scale', () => {
    expect(mapPoint({ x: 4, y: 0 }, scale(-1, 1))).toEqual({ x: -4, y: 0 });
  });

  it('rounds to hundredths and stays inside the board', () => {
    expect(mapPoint({ x: 1 / 3, y: 2 / 3 }, translation(0, 0))).toEqual({ x: 0.33, y: 0.67 });
    const far = mapPoint({ x: LIMITS.maxCoordinate, y: 0 }, translation(500, 0));
    expect(far.x).toBe(LIMITS.maxCoordinate);
  });
});

describe('transformElement', () => {
  it('moves every point of a stroke and keeps its width', () => {
    const moved = transformElement(stroke, translation(5, 5));
    expect(moved.points).toEqual([
      { x: 5, y: 5 },
      { x: 15, y: 25 },
    ]);
    expect(moved.width).toBe(4);
    expect(stroke.points[0]).toEqual({ x: 0, y: 0 }); // the original is untouched
  });

  it('maps both corners of a shape, flipping when scaled past its origin', () => {
    const flipped = transformElement(rect, scale(-1, 1, { x: 10, y: 10 }));
    expect(flipped).toMatchObject({ start: { x: 10, y: 10 }, end: { x: -10, y: 50 } });
  });

  it('scales text evenly by the smaller factor and keeps it upright', () => {
    const grown = transformElement(text, scale(2, 3));
    expect(grown.fontSize).toBe(40);
    expect(grown.start).toEqual({ x: 0, y: 0 });
    const mirrored = transformElement(text, scale(-1, 1));
    expect(mirrored.fontSize).toBe(20);
    expect(mirrored.start.x).toBeLessThan(0);
  });

  it('keeps text within the allowed font sizes', () => {
    expect(transformElement(text, scale(100, 100)).fontSize).toBe(LIMITS.maxFontSize);
    expect(transformElement(text, scale(0.01, 0.01)).fontSize).toBe(LIMITS.minFontSize);
  });
});

describe('helpers', () => {
  it('recognizes a transform that changes nothing', () => {
    expect(isIdentity(translation(0, 0))).toBe(true);
    expect(isIdentity(translation(1, 0))).toBe(false);
    expect(isIdentity(scale(1, 2))).toBe(false);
  });

  it('rounds an element for sending', () => {
    expect(roundCoord(1.23456)).toBe(1.23);
    expect(roundElement({ ...rect, start: { x: 1.004, y: 2.006 } }).start).toEqual({
      x: 1,
      y: 2.01,
    });
  });
});
