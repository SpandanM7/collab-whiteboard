import { describe, expect, it, vi } from 'vitest';
import { LASER_LIFETIME_MS, LaserTrails, MAX_TRAIL_POINTS, SELF, fade } from './laser.ts';

const p = (x: number) => ({ x, y: 0 });

describe('fade', () => {
  it('goes from fully visible to gone over the lifetime', () => {
    expect(fade(0)).toBe(1);
    expect(fade(LASER_LIFETIME_MS / 2)).toBeCloseTo(0.5);
    expect(fade(LASER_LIFETIME_MS)).toBe(0);
    expect(fade(LASER_LIFETIME_MS * 3)).toBe(0);
    expect(fade(-5)).toBe(1);
  });
});

describe('LaserTrails', () => {
  it('keeps separate trails per owner and per press', () => {
    const trails = new LaserTrails();
    trails.add(SELF, 'a', [p(1)], 0);
    trails.add(SELF, 'b', [p(2)], 0);
    trails.add('bob', 'a', [p(3)], 0);
    trails.add(SELF, 'a', [p(4)], 10);
    const all = [...trails.all()];
    expect(all).toHaveLength(3);
    expect(all.find((t) => t.owner === SELF && t.id === 'a')!.points.map((q) => q.x)).toEqual([
      1, 4,
    ]);
  });

  it('spreads a batch over the time it was collected in', () => {
    const trails = new LaserTrails();
    trails.add('bob', 'a', [p(1), p(2), p(3), p(4)], 1000, 40);
    const times = [...trails.all()][0].points.map((q) => q.t);
    expect(times).toEqual([970, 980, 990, 1000]);
  });

  it('drops faded points, then the trail, and reports what is left', () => {
    const trails = new LaserTrails();
    trails.add(SELF, 'a', [p(1)], 0);
    trails.add(SELF, 'a', [p(2)], 500);
    expect(trails.prune(LASER_LIFETIME_MS + 1)).toBe(true);
    expect([...trails.all()][0].points.map((q) => q.x)).toEqual([2]);
    expect(trails.prune(LASER_LIFETIME_MS + 600)).toBe(false);
    expect(trails.isEmpty).toBe(true);
  });

  it('caps a long trail by dropping its oldest points', () => {
    const trails = new LaserTrails();
    const many = Array.from({ length: MAX_TRAIL_POINTS + 50 }, (_, i) => p(i));
    trails.add(SELF, 'a', many, 0);
    const points = [...trails.all()][0].points;
    expect(points).toHaveLength(MAX_TRAIL_POINTS);
    expect(points[0].x).toBe(50);
  });

  it('ignores empty batches and tells subscribers about real ones', () => {
    const trails = new LaserTrails();
    const listener = vi.fn();
    const unsubscribe = trails.subscribe(listener);
    trails.add(SELF, 'a', [], 0);
    expect(trails.isEmpty).toBe(true);
    expect(listener).not.toHaveBeenCalled();
    trails.add(SELF, 'a', [p(1)], 0);
    expect(listener).toHaveBeenCalledTimes(1);
    trails.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    trails.add(SELF, 'a', [p(1)], 0);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
