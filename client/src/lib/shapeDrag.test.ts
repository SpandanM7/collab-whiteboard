import { describe, expect, it } from 'vitest';
import { GRID_SIZE, dragReadout, dragShape, gridStep, snapAngle, snapToGrid } from './shapeDrag.ts';

const free = { shift: false, alt: false };
const shift = { shift: true, alt: false };
const alt = { shift: false, alt: true };
const origin = { x: 100, y: 100 };

describe('snapToGrid', () => {
  it('rounds to the nearest grid point', () => {
    expect(snapToGrid({ x: 29, y: -11 })).toEqual({ x: 20, y: -20 });
    expect(snapToGrid({ x: 31, y: 9 })).toEqual({ x: 40, y: 0 });
  });
});

describe('snapAngle', () => {
  it('makes a nearly horizontal line exactly horizontal, keeping its length', () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 100, y: 3 });
    expect(p.y).toBe(0);
    expect(p.x).toBeCloseTo(Math.hypot(100, 3));
  });

  it('makes a nearly vertical line exactly vertical', () => {
    expect(snapAngle({ x: 0, y: 0 }, { x: -2, y: -80 }).x).toBe(0);
  });

  it('snaps to 45 degrees', () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 50, y: 47 });
    expect(p.x).toBeCloseTo(p.y);
  });

  it('leaves a zero-length line alone', () => {
    expect(snapAngle(origin, origin)).toEqual(origin);
  });
});

describe('dragShape', () => {
  it('spans from where the drag began to the pointer', () => {
    expect(dragShape('rect', origin, { x: 160, y: 130 }, free, false)).toEqual({
      start: origin,
      end: { x: 160, y: 130 },
    });
  });

  it('Shift makes a box square, in the direction dragged', () => {
    expect(dragShape('ellipse', origin, { x: 40, y: 130 }, shift, false)).toEqual({
      start: origin,
      end: { x: 40, y: 160 },
    });
  });

  it('Alt grows a box from its center', () => {
    expect(dragShape('rect', origin, { x: 130, y: 120 }, alt, false)).toEqual({
      start: { x: 70, y: 80 },
      end: { x: 130, y: 120 },
    });
  });

  it('Shift snaps a line or arrow to 15 degree steps', () => {
    const { start, end } = dragShape('arrow', origin, { x: 200, y: 104 }, shift, false);
    expect(start).toEqual(origin);
    expect(end.y).toBe(100);
  });

  it('Alt makes the drag start the middle of a line', () => {
    expect(dragShape('line', origin, { x: 150, y: 100 }, alt, false)).toEqual({
      start: { x: 50, y: 100 },
      end: { x: 150, y: 100 },
    });
  });

  it('with the grid on, both corners land on grid points', () => {
    const { start, end } = dragShape('rect', { x: 103, y: 96 }, { x: 167, y: 151 }, free, true);
    expect(start).toEqual({ x: 100, y: 100 });
    expect(end).toEqual({ x: 160, y: 160 });
  });
});

describe('dragReadout', () => {
  it('shows width and height for a box', () => {
    expect(dragReadout('rect', { x: 0, y: 0 }, { x: -120.4, y: 80.6 })).toBe('120 × 81');
  });

  it('shows length and angle for a line, counter-clockwise from the right', () => {
    expect(dragReadout('line', { x: 0, y: 0 }, { x: 100, y: 0 })).toBe('100 · 0°');
    expect(dragReadout('arrow', { x: 0, y: 0 }, { x: 0, y: -50 })).toBe('50 · 90°');
    expect(dragReadout('arrow', { x: 0, y: 0 }, { x: 0, y: 50 })).toBe('50 · 270°');
  });
});

describe('gridStep', () => {
  it('is the grid size at normal zoom, and grows when dots would crowd together', () => {
    expect(gridStep(1)).toBe(GRID_SIZE);
    expect(gridStep(0.5)).toBe(GRID_SIZE * 5);
    expect(gridStep(0.1)).toBe(GRID_SIZE * 25);
  });
});
