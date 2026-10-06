import { useState } from 'react';
import { LIMITS } from '@whiteboard/shared';
import type { BoardElement, ReorderTarget, Stroke } from '@whiteboard/shared';
import { History, sameElement } from '../lib/history.ts';
import type { Change, Plan, RecordOptions } from '../lib/history.ts';
import type { useBoardSync } from './useBoardSync.ts';

type Sync = ReturnType<typeof useBoardSync>;

/** Arrow-key nudges this close together are one undo step. */
const NUDGE_WINDOW_MS = 1000;

/**
 * Every edit this person makes, recorded for undo and redo, then handed to the sync layer. The
 * history is local and per person: undo only reverts your own changes, and never over someone
 * else's newer edit of the same element.
 */
export function useBoardActions(sync: Sync) {
  const [history] = useState(() => new History());
  const [state, setState] = useState({ canUndo: false, canRedo: false });
  const elements = sync.elements;

  const refresh = () => setState({ canUndo: history.canUndo, canRedo: history.canRedo });

  // A cleared board (by anyone) leaves nothing that could sensibly be undone.
  const [seenClears, setSeenClears] = useState(sync.clearCount);
  if (seenClears !== sync.clearCount) {
    setSeenClears(sync.clearCount);
    history.clear();
    setState({ canUndo: false, canRedo: false });
  }

  const current = () => new Map(elements.map((e) => [e.id, e]));

  const record = (changes: Change[], options?: RecordOptions) => {
    history.record(changes, options);
    refresh();
  };

  /** Whether `count` more elements fit on the board; tells the person when they do not. */
  const roomFor = (count: number) => {
    if (elements.length + count <= LIMITS.maxElementsPerBoard) return true;
    sync.showToast(
      `The board is full (${LIMITS.maxElementsPerBoard.toLocaleString('en-US')} elements). ` +
        'Delete something first.',
    );
    return false;
  };

  const apply = (plan: Plan) => {
    if (plan.remove.length > 0) sync.deleteElements(plan.remove);
    if (plan.update.length > 0) sync.updateElements(plan.update);
    if (plan.add.length > 0) {
      sync.addElements(
        plan.add.slice(0, Math.max(0, LIMITS.maxElementsPerBoard - elements.length)),
      );
    }
    refresh();
    return plan.restored;
  };

  return {
    canUndo: state.canUndo,
    canRedo: state.canRedo,

    /** A pen stroke was finished. */
    finishStroke: (stroke: Stroke) => {
      sync.finishStroke(stroke);
      record([{ id: stroke.id, before: null, after: stroke }]);
    },

    /** New elements: a shape or text just made, or a paste or duplicate. False if they do not fit. */
    addElements: (added: BoardElement[]): boolean => {
      if (added.length === 0) return true;
      if (!roomFor(added.length)) return false;
      sync.addElements(added);
      record(added.map((e) => ({ id: e.id, before: null, after: e })));
      return true;
    },

    /** New versions of elements (moved, resized, restyled, edited). */
    updateElements: (next: BoardElement[], options?: RecordOptions) => {
      const now = current();
      const changes = next.flatMap((after) => {
        const before = now.get(after.id);
        return before && !sameElement(before, after) ? [{ id: after.id, before, after }] : [];
      });
      if (changes.length === 0) return;
      sync.updateElements(changes.map((c) => c.after));
      record(changes, options);
    },

    /** Erased or deleted elements. `group` makes one eraser drag a single undo step. */
    deleteElements: (ids: string[], group?: string) => {
      const now = current();
      const changes = ids.flatMap((id) => {
        const before = now.get(id);
        return before ? [{ id, before, after: null }] : [];
      });
      if (changes.length === 0) return;
      sync.deleteElements(changes.map((c) => c.id));
      record(changes, { group });
    },

    /** Stacking order is shared but not part of undo (like a view setting of the board). */
    reorderElements: (ids: string[], to: ReorderTarget) => sync.reorderElements(ids, to),

    /** Reverts this person's latest change still standing. Returns the ids to select. */
    undo: (): string[] => {
      const plan = history.undo(current());
      if (!plan) return [];
      return apply(plan);
    },

    redo: (): string[] => {
      const plan = history.redo(current());
      if (!plan) return [];
      return apply(plan);
    },

    nudgeWindow: NUDGE_WINDOW_MS,
  };
}
