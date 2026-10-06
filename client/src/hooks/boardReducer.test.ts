import { describe, expect, it } from 'vitest';
import type { BoardElement, Shape, Stroke } from '@whiteboard/shared';
import { boardReducer, initialBoardState } from './boardReducer.ts';
import type { BoardAction, BoardState } from './boardReducer.ts';

const stroke = (id: string, xs: number[] = [0]): Stroke => ({
  id,
  type: 'stroke',
  authorId: 'remote',
  color: '#000000',
  width: 4,
  points: xs.map((x) => ({ x, y: 0 })),
  createdAt: 0,
});

const rect = (id: string): Shape => ({
  id,
  type: 'rect',
  authorId: 'remote',
  color: '#000000',
  width: 2,
  start: { x: 0, y: 0 },
  end: { x: 10, y: 10 },
  createdAt: 0,
});

const pointsOf = (element?: BoardElement) => (element?.type === 'stroke' ? element.points : []);

const run = (actions: BoardAction[], from: BoardState = initialBoardState) =>
  actions.reduce(boardReducer, from);

describe('boardReducer', () => {
  it('grows a remote stroke incrementally, then commits it on end', () => {
    const mid = run([
      { type: 'remote-start', stroke: stroke('s1') },
      { type: 'remote-points', id: 's1', points: [{ x: 1, y: 0 }] },
      { type: 'remote-points', id: 's1', points: [{ x: 2, y: 0 }] },
    ]);
    expect(mid.committed).toEqual([]);
    expect(mid.live[0].points.map((p) => p.x)).toEqual([0, 1, 2]);

    const done = boardReducer(mid, { type: 'remote-end', id: 's1' });
    expect(done.live).toEqual([]);
    expect(done.committed.map((s) => s.id)).toEqual(['s1']);
  });

  it('leaves the committed list untouched while remote points stream in', () => {
    const base = run([{ type: 'reset', elements: [stroke('old')] }]);
    const next = run(
      [
        { type: 'remote-start', stroke: stroke('s1') },
        { type: 'remote-points', id: 's1', points: [{ x: 1, y: 0 }] },
      ],
      base,
    );
    expect(next.committed).toBe(base.committed);
  });

  it('moves a stroke that arrived mid-draw in room:state to the live layer on new points', () => {
    const state = run([
      { type: 'reset', elements: [stroke('s1', [0, 1])] },
      { type: 'remote-points', id: 's1', points: [{ x: 2, y: 0 }] },
    ]);
    expect(state.committed).toEqual([]);
    expect(state.live[0].points.map((p) => p.x)).toEqual([0, 1, 2]);
  });

  it('ignores points and ends for unknown strokes, and duplicate starts', () => {
    const base = run([{ type: 'remote-start', stroke: stroke('s1') }]);
    expect(boardReducer(base, { type: 'remote-points', id: 'nope', points: [] })).toBe(base);
    expect(boardReducer(base, { type: 'remote-end', id: 'nope' })).toBe(base);
    expect(boardReducer(base, { type: 'remote-start', stroke: stroke('s1') })).toBe(base);
  });

  it('deletes from both layers, and returns the same state when nothing matched', () => {
    const base = run([
      { type: 'reset', elements: [stroke('a'), stroke('b')] },
      { type: 'remote-start', stroke: stroke('c') },
    ]);
    const next = boardReducer(base, { type: 'delete', ids: ['a', 'c'] });
    expect(next.committed.map((s) => s.id)).toEqual(['b']);
    expect(next.live).toEqual([]);
    expect(boardReducer(next, { type: 'delete', ids: ['zzz'] })).toBe(next);
  });

  it('clears everything, including strokes in progress', () => {
    const state = run([
      { type: 'reset', elements: [stroke('a')] },
      { type: 'remote-start', stroke: stroke('b') },
      { type: 'clear' },
    ]);
    expect(state).toEqual({ committed: [], live: [] });
  });

  it('replaces local state on reset (reconnect) and drops in-progress strokes', () => {
    const state = run([
      { type: 'add-local', element: stroke('mine') },
      { type: 'remote-start', stroke: stroke('b') },
      { type: 'reset', elements: [stroke('server')] },
    ]);
    expect(state.committed.map((s) => s.id)).toEqual(['server']);
    expect(state.live).toEqual([]);
  });

  it('does not duplicate a local stroke the server already sent back in room:state', () => {
    const partial = stroke('s1', [0, 1]);
    const state = run([
      { type: 'reset', elements: [partial] },
      { type: 'add-local', element: stroke('s1', [0, 1, 2, 3]) },
    ]);
    expect(state.committed).toHaveLength(1);
    expect(pointsOf(state.committed[0])).toHaveLength(4);
  });

  describe('shapes', () => {
    it('adds a remote shape straight to the committed layer', () => {
      const state = run([
        { type: 'reset', elements: [stroke('old')] },
        { type: 'remote-add', element: rect('r1') },
      ]);
      expect(state.committed.map((e) => e.id)).toEqual(['old', 'r1']);
      expect(state.live).toEqual([]);
    });

    it('ignores a shape it already has (duplicate delivery)', () => {
      const once = run([{ type: 'remote-add', element: rect('r1') }]);
      expect(boardReducer(once, { type: 'remote-add', element: rect('r1') })).toBe(once);
    });

    it('merges a local shape with the same id instead of duplicating it', () => {
      const state = run([
        { type: 'add-local', element: rect('r1') },
        { type: 'add-local', element: rect('r1') },
      ]);
      expect(state.committed).toHaveLength(1);
    });

    it('ignores stroke points aimed at a shape', () => {
      const state = run([{ type: 'reset', elements: [rect('r1')] }]);
      const next = boardReducer(state, {
        type: 'remote-points',
        id: 'r1',
        points: [{ x: 1, y: 1 }],
      });
      expect(next).toBe(state);
    });

    it('deletes shapes like strokes', () => {
      const state = run([
        { type: 'reset', elements: [rect('r1'), stroke('s1')] },
        { type: 'delete', ids: ['r1'] },
      ]);
      expect(state.committed.map((e) => e.id)).toEqual(['s1']);
    });
  });
});

describe('batch actions', () => {
  const shape = (id: string, x = 0): BoardElement => ({
    id,
    type: 'rect',
    authorId: 'a',
    color: '#000000',
    width: 2,
    start: { x, y: 0 },
    end: { x: x + 10, y: 10 },
    createdAt: 0,
  });
  const ids = (state: BoardState) => state.committed.map((e) => e.id);

  it('adds several elements, skipping ones already there', () => {
    const state = boardReducer(
      { committed: [shape('a')], live: [] },
      { type: 'add-many', elements: [shape('a'), shape('b'), shape('c')] },
    );
    expect(ids(state)).toEqual(['a', 'b', 'c']);
  });

  it('updates elements in place and ignores unknown ids', () => {
    const start: BoardState = { committed: [shape('a'), shape('b')], live: [] };
    const moved = shape('a', 99);
    const state = boardReducer(start, { type: 'update', elements: [moved, shape('zzz')] });
    expect(ids(state)).toEqual(['a', 'b']);
    expect(state.committed[0]).toBe(moved);
    expect(boardReducer(start, { type: 'update', elements: [shape('zzz')] })).toBe(start);
  });

  it('finishes a live stroke that is replaced', () => {
    const live = {
      id: 's',
      type: 'stroke' as const,
      authorId: 'a',
      color: '#000000',
      width: 2,
      points: [{ x: 0, y: 0 }],
      createdAt: 0,
    };
    const replaced = { ...live, points: [{ x: 5, y: 5 }] };
    const state = boardReducer(
      { committed: [], live: [live] },
      { type: 'update', elements: [replaced] },
    );
    expect(state.live).toEqual([]);
    expect(state.committed).toEqual([replaced]);
  });

  it('reorders, and returns the same state when nothing moves', () => {
    const start: BoardState = { committed: [shape('a'), shape('b'), shape('c')], live: [] };
    expect(ids(boardReducer(start, { type: 'reorder', ids: ['a'], to: 'front' }))).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(boardReducer(start, { type: 'reorder', ids: ['a'], to: 'back' })).toBe(start);
  });
});
