import { describe, expect, it } from 'vitest';
import { elementAddPayload } from '@whiteboard/shared';
import { DEFAULT_STYLE, createShape, loadStyle, saveStyle } from './toolStyle.ts';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  };
};

const base = {
  id: 's1',
  authorId: 'local',
  createdAt: 1,
  start: { x: 0, y: 0 },
  end: { x: 50, y: 40 },
};

describe('loadStyle / saveStyle', () => {
  it('starts from the defaults', () => {
    expect(loadStyle(memoryStorage())).toEqual(DEFAULT_STYLE);
  });

  it('returns what was saved', () => {
    const storage = memoryStorage();
    const style = { ...DEFAULT_STYLE, color: '#e03131', rounded: true, endHead: 'dot' as const };
    saveStyle(style, storage);
    expect(loadStyle(storage)).toEqual(style);
  });

  it('keeps valid fields and replaces invalid ones with defaults', () => {
    const storage = memoryStorage({
      'whiteboard:style': JSON.stringify({ color: '#2f9e44', width: 999, strokeStyle: 'wavy' }),
    });
    expect(loadStyle(storage)).toEqual({ ...DEFAULT_STYLE, color: '#2f9e44' });
  });

  it('survives corrupt or blocked storage', () => {
    expect(loadStyle(memoryStorage({ 'whiteboard:style': '{nope' }))).toEqual(DEFAULT_STYLE);
    expect(loadStyle(null)).toEqual(DEFAULT_STYLE);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadStyle(throwing)).toEqual(DEFAULT_STYLE);
    expect(() => saveStyle(DEFAULT_STYLE, throwing)).not.toThrow();
  });
});

describe('createShape', () => {
  it('leaves default options out, so a plain shape looks as it always did', () => {
    expect(createShape('rect', base, DEFAULT_STYLE)).toEqual({
      ...base,
      type: 'rect',
      color: DEFAULT_STYLE.color,
      width: DEFAULT_STYLE.width,
    });
    expect(createShape('arrow', base, DEFAULT_STYLE)).not.toHaveProperty('endHead');
  });

  it('applies fill, fill style, corners, outline style and opacity to closed shapes', () => {
    const style = {
      ...DEFAULT_STYLE,
      fillOn: true,
      fillStyle: 'cross' as const,
      rounded: true,
      strokeStyle: 'dotted' as const,
      opacity: 0.5,
    };
    expect(createShape('diamond', base, style)).toMatchObject({
      type: 'diamond',
      fill: DEFAULT_STYLE.fillColor,
      fillStyle: 'cross',
      rounded: true,
      strokeStyle: 'dotted',
      opacity: 0.5,
    });
  });

  it('only rounds shapes that have corners, and never fills lines', () => {
    const style = { ...DEFAULT_STYLE, fillOn: true, rounded: true };
    expect(createShape('ellipse', base, style)).not.toHaveProperty('rounded');
    expect(createShape('line', base, style)).not.toHaveProperty('fill');
  });

  it('gives arrows their heads and route, and lines only the route', () => {
    const style = {
      ...DEFAULT_STYLE,
      startHead: 'bar' as const,
      endHead: 'triangle' as const,
      route: 'elbow' as const,
    };
    expect(createShape('arrow', base, style)).toMatchObject({
      startHead: 'bar',
      endHead: 'triangle',
      route: 'elbow',
    });
    const line = createShape('line', base, style);
    expect(line).toMatchObject({ route: 'elbow' });
    expect(line).not.toHaveProperty('startHead');
  });

  it('makes shapes the server accepts', () => {
    const style = { ...DEFAULT_STYLE, fillOn: true, fillStyle: 'hatch' as const, opacity: 0.3 };
    for (const type of ['rect', 'star', 'cylinder', 'arrow'] as const) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- set by the server
      const { authorId, createdAt, ...payload } = createShape(type, base, style);
      expect(elementAddPayload.safeParse(payload).success).toBe(true);
    }
  });
});
