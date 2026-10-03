import { describe, expect, it } from 'vitest';
import type { Stroke } from '@whiteboard/shared';
import { rectContains, rectsIntersect, strokeBounds } from './geometry.ts';
import {
  HOME_VIEW,
  MAX_SCALE,
  MIN_SCALE,
  centerOn,
  clampScale,
  contentBounds,
  fitView,
  panBy,
  toBoardPoint,
  toScreenPoint,
  visibleRect,
  zoomAt,
} from './view.ts';

const stroke = (points: { x: number; y: number }[], width = 4): Stroke => ({
  id: 'a',
  type: 'stroke',
  authorId: 'x',
  color: '#000',
  width,
  points,
  createdAt: 0,
});

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

describe('view maths', () => {
  it('maps board and screen points both ways', () => {
    const view = { x: 30, y: -10, scale: 2 };
    const board = { x: 15, y: 40 };
    const screen = toScreenPoint(board, view);
    expect(screen).toEqual({ x: 60, y: 70 });
    expect(toBoardPoint(screen, view)).toEqual(board);
  });

  it('the home view leaves coordinates unchanged', () => {
    expect(toBoardPoint({ x: 12, y: 34 }, HOME_VIEW)).toEqual({ x: 12, y: 34 });
  });

  it('clamps the zoom range', () => {
    expect(clampScale(100)).toBe(MAX_SCALE);
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it('zooming keeps the board point under the anchor fixed', () => {
    const view = { x: 40, y: 25, scale: 1 };
    const anchor = { x: 200, y: 120 };
    const before = toBoardPoint(anchor, view);
    const next = zoomAt(view, anchor, 2.5);
    expect(next.scale).toBe(2.5);
    const after = toBoardPoint(anchor, next);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zooming past the limit stops at the limit and still keeps the anchor fixed', () => {
    const anchor = { x: 90, y: 60 };
    const next = zoomAt(HOME_VIEW, anchor, 99);
    expect(next.scale).toBe(MAX_SCALE);
    expect(toBoardPoint(anchor, next).x).toBeCloseTo(90);
  });

  it('panning shifts the view without zooming', () => {
    expect(panBy({ x: 5, y: 5, scale: 2 }, 10, -3)).toEqual({ x: 15, y: 2, scale: 2 });
  });

  it('reports the visible board area', () => {
    expect(visibleRect({ x: -100, y: -50, scale: 2 }, { width: 400, height: 200 })).toEqual({
      left: 50,
      top: 25,
      right: 250,
      bottom: 125,
    });
  });

  it('centers a board point on screen', () => {
    const view = centerOn(
      { x: 0, y: 0, scale: 2 },
      { x: 500, y: 300 },
      { width: 400, height: 200 },
    );
    expect(toScreenPoint({ x: 500, y: 300 }, view)).toEqual({ x: 200, y: 100 });
    expect(view.scale).toBe(2);
  });
});

describe('content bounds', () => {
  it('includes shapes, not just strokes', () => {
    const bounds = contentBounds([
      stroke([{ x: 0, y: 0 }], 2),
      {
        id: 'r1',
        type: 'rect',
        authorId: 'a',
        color: '#000000',
        width: 4,
        start: { x: 300, y: 200 },
        end: { x: 100, y: 120 },
        createdAt: 0,
      },
    ]);
    expect(bounds).toEqual({ left: -1, top: -1, right: 302, bottom: 202 });
  });

  it('is null for an empty board', () => {
    expect(contentBounds([])).toBeNull();
  });

  it('covers every stroke including line width', () => {
    const bounds = contentBounds([
      stroke([{ x: 0, y: 0 }], 10),
      stroke([
        { x: 100, y: 50 },
        { x: 200, y: 80 },
      ]),
    ]);
    expect(bounds).toEqual({ left: -5, top: -5, right: 202, bottom: 82 });
  });

  it('refreshes the cached box when a stroke grows', () => {
    const s = stroke([{ x: 0, y: 0 }], 2);
    expect(strokeBounds(s).right).toBe(1);
    s.points.push({ x: 50, y: 0 });
    expect(strokeBounds(s).right).toBe(51);
  });
});

describe('rect helpers', () => {
  const a = { left: 0, top: 0, right: 10, bottom: 10 };
  it('detects overlap and containment', () => {
    expect(rectsIntersect(a, { left: 5, top: 5, right: 20, bottom: 20 })).toBe(true);
    expect(rectsIntersect(a, { left: 11, top: 0, right: 20, bottom: 10 })).toBe(false);
    expect(rectContains(a, { left: 1, top: 1, right: 9, bottom: 9 })).toBe(true);
    expect(rectContains(a, { left: 1, top: 1, right: 11, bottom: 9 })).toBe(false);
  });
});

describe('fitView', () => {
  const size = { width: 400, height: 800 };

  it('zooms out to fit wide content and centers it', () => {
    const bounds = { left: 0, top: 0, right: 2000, bottom: 1000 };
    const view = fitView(bounds, size, noInsets);
    expect(view.scale).toBeCloseTo(0.2);
    expect(rectContains(visibleRect(view, size), bounds)).toBe(true);
    const center = toScreenPoint({ x: 1000, y: 500 }, view);
    expect(center.x).toBeCloseTo(200);
    expect(center.y).toBeCloseTo(400);
  });

  it('never zooms in past 100%', () => {
    const view = fitView({ left: 0, top: 0, right: 40, bottom: 40 }, size, noInsets);
    expect(view.scale).toBe(1);
  });

  it('keeps content out of the insets', () => {
    const insets = { top: 60, right: 10, bottom: 100, left: 10 };
    const bounds = { left: 0, top: 0, right: 2000, bottom: 2000 };
    const view = fitView(bounds, size, insets);
    const topLeft = toScreenPoint({ x: 0, y: 0 }, view);
    const bottomRight = toScreenPoint({ x: 2000, y: 2000 }, view);
    expect(topLeft.x).toBeGreaterThanOrEqual(10 - 0.001);
    expect(bottomRight.x).toBeLessThanOrEqual(390 + 0.001);
    expect(topLeft.y).toBeGreaterThanOrEqual(60 - 0.001);
    expect(bottomRight.y).toBeLessThanOrEqual(700 + 0.001);
  });

  it('stops at the minimum zoom for enormous content', () => {
    const view = fitView({ left: 0, top: 0, right: 1e6, bottom: 1e6 }, size, noInsets);
    expect(view.scale).toBe(MIN_SCALE);
  });
});
