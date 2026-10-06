import { describe, expect, it } from 'vitest';
import type { BoardElement, Shape } from '@whiteboard/shared';
import { History, sameElement } from './history.ts';

const rect = (id: string, x = 0, color = '#000000'): Shape => ({
  id,
  type: 'rect',
  authorId: 'me',
  color,
  width: 2,
  start: { x, y: 0 },
  end: { x: x + 10, y: 10 },
  createdAt: 1,
});

const board = (...elements: BoardElement[]) => new Map(elements.map((e) => [e.id, e]));

describe('sameElement', () => {
  it('ignores the author and time the server sets', () => {
    expect(sameElement(rect('a'), { ...rect('a'), authorId: 'server-id', createdAt: 99 })).toBe(
      true,
    );
    expect(sameElement(rect('a'), rect('a', 5))).toBe(false);
  });
});

describe('History', () => {
  it('undoes an add by removing it, and redoes it by adding it again', () => {
    const history = new History();
    const a = rect('a');
    history.record([{ id: 'a', before: null, after: a }]);
    expect(history.canUndo).toBe(true);

    const undo = history.undo(board(a))!;
    expect(undo.remove).toEqual(['a']);
    expect(history.canRedo).toBe(true);

    const redo = history.redo(board())!;
    expect(redo.add).toEqual([a]);
    expect(redo.restored).toEqual(['a']);
  });

  it('undoes a delete by bringing the elements back in their order', () => {
    const history = new History();
    const [a, b] = [rect('a'), rect('b')];
    history.record([
      { id: 'a', before: a, after: null },
      { id: 'b', before: b, after: null },
    ]);
    expect(history.undo(board())!.add.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('undoes a change by restoring the old version', () => {
    const history = new History();
    const [before, after] = [rect('a'), rect('a', 50)];
    history.record([{ id: 'a', before, after }]);
    expect(history.undo(board(after))!.update).toEqual([before]);
  });

  it("does not undo over someone else's later change", () => {
    const history = new History();
    const [before, after] = [rect('a'), rect('a', 50)];
    history.record([{ id: 'a', before, after }]);
    const theirs = rect('a', 50, '#ff0000');
    // Nothing of this step is still ours, so there is nothing to undo.
    expect(history.undo(board(theirs))).toBeNull();
    expect(history.canUndo).toBe(false);
  });

  it('does not resurrect an element someone else deleted', () => {
    const history = new History();
    history.record([{ id: 'a', before: rect('a'), after: rect('a', 50) }]);
    expect(history.undo(board())).toBeNull();
  });

  it('undoes what it still can of a step and skips the rest', () => {
    const history = new History();
    history.record([
      { id: 'a', before: null, after: rect('a') },
      { id: 'b', before: null, after: rect('b') },
    ]);
    const plan = history.undo(board(rect('a'), rect('b', 99)))!;
    expect(plan.remove).toEqual(['a']);
  });

  it('skips steps others have overtaken and undoes the one before', () => {
    const history = new History();
    history.record([{ id: 'a', before: null, after: rect('a') }]);
    history.record([{ id: 'b', before: null, after: rect('b') }]);
    // b was erased by someone else; undo goes on to a.
    expect(history.undo(board(rect('a')))!.remove).toEqual(['a']);
  });

  it('merges records of one group into a single step', () => {
    const history = new History();
    history.record([{ id: 'a', before: rect('a'), after: null }], { group: 'erase-1' });
    history.record([{ id: 'b', before: rect('b'), after: null }], { group: 'erase-1' });
    history.record([{ id: 'c', before: rect('c'), after: null }], { group: 'erase-2' });
    expect(history.undo(board())!.add.map((e) => e.id)).toEqual(['c']);
    expect(history.undo(board(rect('c')))!.add.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('merges nudges within the time window, keeping the first before', () => {
    const history = new History();
    const [p0, p1, p2] = [rect('a', 0), rect('a', 1), rect('a', 2)];
    history.record([{ id: 'a', before: p0, after: p1 }], { group: 'nudge', window: 500, now: 0 });
    history.record([{ id: 'a', before: p1, after: p2 }], { group: 'nudge', window: 500, now: 300 });
    expect(history.undo(board(p2))!.update).toEqual([p0]);
  });

  it('starts a new step once the window has passed', () => {
    const history = new History();
    const [p0, p1, p2] = [rect('a', 0), rect('a', 1), rect('a', 2)];
    history.record([{ id: 'a', before: p0, after: p1 }], { group: 'nudge', window: 500, now: 0 });
    history.record([{ id: 'a', before: p1, after: p2 }], { group: 'nudge', window: 500, now: 900 });
    expect(history.undo(board(p2))!.update).toEqual([p1]);
  });

  it('drops a merged step that ends where it started', () => {
    const history = new History();
    const [p0, p1] = [rect('a', 0), rect('a', 1)];
    history.record([{ id: 'a', before: p0, after: p1 }], { group: 'nudge', now: 0 });
    history.record([{ id: 'a', before: p1, after: p0 }], { group: 'nudge', now: 10 });
    expect(history.canUndo).toBe(false);
  });

  it('forgets what could be redone once something new is recorded', () => {
    const history = new History();
    history.record([{ id: 'a', before: null, after: rect('a') }]);
    history.undo(board(rect('a')));
    history.record([{ id: 'b', before: null, after: rect('b') }]);
    expect(history.canRedo).toBe(false);
  });

  it('keeps at most the configured number of steps', () => {
    const history = new History(2);
    for (const id of ['a', 'b', 'c']) history.record([{ id, before: null, after: rect(id) }]);
    const all = board(rect('a'), rect('b'), rect('c'));
    expect(history.undo(all)!.remove).toEqual(['c']);
    expect(history.undo(all)!.remove).toEqual(['b']);
    expect(history.undo(all)).toBeNull();
  });

  it('clear empties both stacks', () => {
    const history = new History();
    history.record([{ id: 'a', before: null, after: rect('a') }]);
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
