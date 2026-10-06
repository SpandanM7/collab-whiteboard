import { describe, expect, it } from 'vitest';
import type { BoardElement, LineShape, Shape, Stroke } from '@whiteboard/shared';
import {
  ALL_HANDLES,
  CORNERS,
  elementsInRect,
  handleAt,
  handleCursor,
  handlePoint,
  lineEndAt,
  moveDelta,
  pickElement,
  resizeTransform,
  selectionBounds,
  visibleHandles,
} from './selection.ts';
import { mapPoint } from './transform.ts';

const base = { authorId: 'a', color: '#000000', width: 2, createdAt: 0 };
const rect = (id: string, x: number, y: number, w = 20, h = 20, fill?: string): Shape => ({
  ...base,
  id,
  type: 'rect',
  start: { x, y },
  end: { x: x + w, y: y + h },
  ...(fill ? { fill } : {}),
});
const line = (id: string): LineShape => ({
  ...base,
  id,
  type: 'line',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 0 },
});
const stroke = (id: string): Stroke => ({
  ...base,
  id,
  type: 'stroke',
  points: [
    { x: 50, y: 50 },
    { x: 60, y: 60 },
  ],
});

const box = { left: 0, top: 0, right: 100, bottom: 50 };

describe('pickElement', () => {
  it('picks the topmost element whose outline is under the pointer', () => {
    const elements: BoardElement[] = [rect('below', 0, 0), rect('above', 0, 0)];
    expect(pickElement(elements, { x: 0, y: 10 }, 2)?.id).toBe('above');
  });

  it('prefers a line or outline over the inside of a hollow shape', () => {
    const elements: BoardElement[] = [line('l'), rect('box', -50, -50, 200, 200)];
    expect(pickElement(elements, { x: 50, y: 0 }, 2)?.id).toBe('l');
  });

  it('falls back to the inside of a hollow shape', () => {
    expect(pickElement([rect('box', 0, 0, 100, 100)], { x: 50, y: 50 }, 2)?.id).toBe('box');
  });

  it('finds nothing on empty board space', () => {
    expect(pickElement([rect('box', 0, 0)], { x: 500, y: 500 }, 2)).toBeNull();
  });
});

describe('elementsInRect', () => {
  it('selects only elements that are entirely inside, in stacking order', () => {
    const elements: BoardElement[] = [rect('a', 10, 10), stroke('s'), rect('b', 90, 90, 50, 50)];
    expect(elementsInRect(elements, { left: 0, top: 0, right: 100, bottom: 100 })).toEqual([
      'a',
      's',
    ]);
  });
});

describe('selectionBounds', () => {
  it('spans every element, ignoring line width', () => {
    expect(selectionBounds([rect('a', 0, 0), rect('b', 50, 60)])).toEqual({
      left: 0,
      top: 0,
      right: 70,
      bottom: 80,
    });
    expect(selectionBounds([])).toBeNull();
  });
});

describe('handles', () => {
  it('places handles on the corners and edge midpoints', () => {
    expect(handlePoint(box, 'nw')).toEqual({ x: 0, y: 0 });
    expect(handlePoint(box, 'e')).toEqual({ x: 100, y: 25 });
    expect(handlePoint(box, 's')).toEqual({ x: 50, y: 50 });
  });

  it('shows only corners when proportions are locked or the frame is small', () => {
    expect(visibleHandles(200, 200, true)).toEqual(CORNERS);
    expect(visibleHandles(200, 200, false)).toEqual(ALL_HANDLES);
    expect(visibleHandles(20, 200, false)).not.toContain('n');
    expect(visibleHandles(200, 20, false)).not.toContain('e');
  });

  it('finds the handle under the pointer', () => {
    expect(handleAt(box, { x: 98, y: 48 }, 5, ALL_HANDLES)).toBe('se');
    expect(handleAt(box, { x: 50, y: 1 }, 5, ALL_HANDLES)).toBe('n');
    expect(handleAt(box, { x: 50, y: 25 }, 5, ALL_HANDLES)).toBeNull();
    expect(handleAt(box, { x: 50, y: 1 }, 5, CORNERS)).toBeNull();
  });

  it('finds the end of a line under the pointer', () => {
    expect(lineEndAt(line('l'), { x: 98, y: 2 }, 5)).toBe('end');
    expect(lineEndAt(line('l'), { x: 1, y: 0 }, 5)).toBe('start');
    expect(lineEndAt(line('l'), { x: 50, y: 0 }, 5)).toBeNull();
  });

  it('has a resize cursor for every handle', () => {
    expect(handleCursor('nw')).toBe('nwse-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('w')).toBe('ew-resize');
  });
});

describe('resizeTransform', () => {
  const corner = (t: ReturnType<typeof resizeTransform>) => ({
    nw: mapPoint({ x: 0, y: 0 }, t),
    se: mapPoint({ x: 100, y: 50 }, t),
  });
  const free = { keepAspect: false, fromCenter: false };

  it('moves the dragged corner and keeps the opposite one', () => {
    const t = resizeTransform(box, 'se', { x: 200, y: 150 }, free);
    expect(corner(t)).toEqual({ nw: { x: 0, y: 0 }, se: { x: 200, y: 150 } });
  });

  it('changes one side only for an edge handle', () => {
    const t = resizeTransform(box, 'w', { x: -50, y: 999 }, free);
    expect(corner(t)).toEqual({ nw: { x: -50, y: 0 }, se: { x: 100, y: 50 } });
  });

  it('keeps proportions with Shift, following the bigger pull', () => {
    const t = resizeTransform(box, 'se', { x: 300, y: 60 }, { ...free, keepAspect: true });
    expect(t.sx).toBeCloseTo(3);
    expect(t.sy).toBeCloseTo(3);
  });

  it('resizes around the middle with Alt', () => {
    const t = resizeTransform(box, 'e', { x: 150, y: 25 }, { ...free, fromCenter: true });
    expect(corner(t)).toEqual({ nw: { x: -50, y: 0 }, se: { x: 150, y: 50 } });
  });

  it('flips when dragged past the opposite side', () => {
    const t = resizeTransform(box, 'e', { x: -100, y: 25 }, free);
    expect(t.sx).toBeLessThan(0);
  });

  it('never collapses to nothing', () => {
    const t = resizeTransform(box, 'e', { x: 0, y: 25 }, free);
    expect(Math.abs(t.sx * 100)).toBeGreaterThanOrEqual(1);
  });

  it('leaves a zero-width side alone instead of dividing by zero', () => {
    const flat = { left: 0, top: 0, right: 100, bottom: 0 };
    const t = resizeTransform(flat, 'se', { x: 200, y: 40 }, free);
    expect(t.sx).toBe(2);
    expect(t.sy).toBe(1);
  });
});

describe('moveDelta', () => {
  const from = { x: 0, y: 0 };

  it('follows the pointer', () => {
    expect(moveDelta(box, from, { x: 7, y: -3 }, { axisLock: false, grid: false })).toEqual({
      x: 7,
      y: -3,
    });
  });

  it('locks to the main axis with Shift', () => {
    expect(moveDelta(box, from, { x: 30, y: 8 }, { axisLock: true, grid: false })).toEqual({
      x: 30,
      y: 0,
    });
  });

  it('lands the frame corner on the grid', () => {
    const offGrid = { left: 3, top: 7, right: 50, bottom: 50 };
    expect(moveDelta(offGrid, from, { x: 12, y: 12 }, { axisLock: false, grid: true })).toEqual({
      x: 17,
      y: 13,
    });
  });
});
