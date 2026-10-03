import { describe, expect, it } from 'vitest';
import type { Stroke } from '@whiteboard/shared';
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
      { type: 'add-local', stroke: stroke('mine') },
      { type: 'remote-start', stroke: stroke('b') },
      { type: 'reset', elements: [stroke('server')] },
    ]);
    expect(state.committed.map((s) => s.id)).toEqual(['server']);
    expect(state.live).toEqual([]);
  });
});
