import { toElementInput } from '@whiteboard/shared';
import type { BoardElement } from '@whiteboard/shared';

/**
 * Per-user undo and redo. Pure state, no sockets: the caller applies the plans it returns using
 * the normal board operations, so an undo syncs like any other edit.
 *
 * An entry is a list of element changes, each a before/after snapshot (null = not on the board).
 * Undo moves the board back to `before`, but only for elements still exactly as this person left
 * them: an element someone else has changed or deleted since is not touched, so undo never
 * overwrites a collaborator's work.
 */

export type Change = { id: string; before: BoardElement | null; after: BoardElement | null };

type Entry = { changes: Change[]; group?: string; at: number };

/** What to send to bring the board to one side of an entry. */
export type Plan = {
  add: BoardElement[];
  update: BoardElement[];
  remove: string[];
  /** Ids that exist afterwards, to select them again. */
  restored: string[];
};

/** Same content, ignoring the author and time the server sets. */
export function sameElement(a: BoardElement, b: BoardElement): boolean {
  if (a === b) return true;
  return JSON.stringify(toElementInput(a)) === JSON.stringify(toElementInput(b));
}

const sameOrBothNull = (a: BoardElement | null, b: BoardElement | null) =>
  a === null || b === null ? a === b : sameElement(a, b);

/**
 * The plan that takes elements from `from` to `to` for every change, skipping changes whose
 * element is no longer in the `from` state (someone else got there first).
 */
function plan(
  changes: Change[],
  direction: 'undo' | 'redo',
  current: ReadonlyMap<string, BoardElement>,
): Plan {
  const result: Plan = { add: [], update: [], remove: [], restored: [] };
  const ordered = direction === 'undo' ? [...changes].reverse() : changes;
  for (const change of ordered) {
    const expected = direction === 'undo' ? change.after : change.before;
    const target = direction === 'undo' ? change.before : change.after;
    const now = current.get(change.id) ?? null;
    if (!sameOrBothNull(now, expected)) continue;
    if (target === null) {
      result.remove.push(change.id);
    } else {
      (now === null ? result.add : result.update).push(target);
      result.restored.push(change.id);
    }
  }
  // Re-added elements go back in their original drawing order.
  if (direction === 'undo') result.add.reverse();
  return result;
}

const isEmpty = (p: Plan) => p.add.length + p.update.length + p.remove.length === 0;

export type RecordOptions = {
  /**
   * Consecutive records with the same group become one step: an eraser drag, or a burst of
   * arrow-key nudges.
   */
  group?: string;
  /** Only merge with an entry recorded at most this long ago (default: no time limit). */
  window?: number;
  now?: number;
};

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private readonly limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** A new edit: it becomes the next undo step, and anything that could be redone is dropped. */
  record(changes: Change[], { group, window = Infinity, now = Date.now() }: RecordOptions = {}) {
    if (changes.length === 0) return;
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    if (group !== undefined && top?.group === group && now - top.at <= window) {
      for (const change of changes) {
        const existing = top.changes.find((c) => c.id === change.id);
        if (existing) existing.after = change.after;
        else top.changes.push({ ...change });
      }
      // A nudge right then left again is no change at all.
      top.changes = top.changes.filter((c) => !sameOrBothNull(c.before, c.after));
      top.at = now;
      if (top.changes.length === 0) this.undoStack.pop();
      return;
    }
    this.undoStack.push({ changes: changes.map((c) => ({ ...c })), group, at: now });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }

  /**
   * The plan for the latest step that still has anything to undo, or null. Steps that others
   * have entirely overtaken are dropped on the way.
   */
  undo(current: ReadonlyMap<string, BoardElement>): Plan | null {
    return this.step(this.undoStack, this.redoStack, 'undo', current);
  }

  redo(current: ReadonlyMap<string, BoardElement>): Plan | null {
    return this.step(this.redoStack, this.undoStack, 'redo', current);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private step(
    from: Entry[],
    to: Entry[],
    direction: 'undo' | 'redo',
    current: ReadonlyMap<string, BoardElement>,
  ): Plan | null {
    while (from.length > 0) {
      const entry = from.pop()!;
      const result = plan(entry.changes, direction, current);
      if (isEmpty(result)) continue;
      // A later step must not merge into one that has been undone and redone.
      to.push({ changes: entry.changes, at: entry.at });
      return result;
    }
    return null;
  }
}
