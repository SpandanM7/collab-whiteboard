import type { BoardElement, Point, ReorderTarget, Stroke } from '@whiteboard/shared';
import { reorderList } from '../lib/pendingSync.ts';

/**
 * Board elements as the client sees them. Finished elements (`committed`, strokes and shapes) are
 * drawn from a cached layer; strokes other people are still drawing (`live`) are redrawn every
 * frame, so a stream of incoming points never forces the cache to be rebuilt. Shapes are never
 * live: they arrive whole, on release.
 */
export type BoardState = { committed: BoardElement[]; live: Stroke[] };

export type BoardAction =
  | { type: 'reset'; elements: BoardElement[] }
  | { type: 'add-local'; element: BoardElement }
  | { type: 'remote-add'; element: BoardElement }
  | { type: 'add-many'; elements: BoardElement[] }
  | { type: 'update'; elements: BoardElement[] }
  | { type: 'reorder'; ids: string[]; to: ReorderTarget }
  | { type: 'remote-start'; stroke: Stroke }
  | { type: 'remote-points'; id: string; points: Point[] }
  | { type: 'remote-end'; id: string }
  | { type: 'delete'; ids: string[] }
  | { type: 'clear' };

export const initialBoardState: BoardState = { committed: [], live: [] };

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'reset':
      return { committed: action.elements, live: [] };

    // Upsert: after a reconnect, room:state can already hold the partial copy of a stroke that
    // is still being finished locally; the local copy is the complete one.
    case 'add-local': {
      const { element } = action;
      const committed = state.committed.some((e) => e.id === element.id)
        ? state.committed.map((e) => (e.id === element.id ? element : e))
        : [...state.committed, element];
      return { ...state, committed };
    }

    // A shape someone else finished. An id we already hold is a duplicate delivery: ignore it.
    case 'remote-add': {
      const known = [...state.committed, ...state.live].some((e) => e.id === action.element.id);
      return known ? state : { ...state, committed: [...state.committed, action.element] };
    }

    // Finished elements arriving together (someone pasted or undid an erase), or added locally.
    case 'add-many': {
      const known = new Set([...state.committed, ...state.live].map((e) => e.id));
      const fresh = action.elements.filter((e) => !known.has(e.id));
      return fresh.length === 0 ? state : { ...state, committed: [...state.committed, ...fresh] };
    }

    // New versions of elements, each keeping its place in the stack. Ids we do not have are
    // ignored (deleted here first). A stroke still drawing that gets replaced is finished.
    case 'update': {
      const next = new Map(action.elements.map((e) => [e.id, e]));
      let changed = false;
      const committed = state.committed.map((e) => {
        const replacement = next.get(e.id);
        if (!replacement || replacement === e) return e;
        changed = true;
        return replacement;
      });
      const finished = state.live.filter((s) => next.has(s.id));
      if (!changed && finished.length === 0) return state;
      return {
        committed: [...committed, ...finished.map((s) => next.get(s.id)!)],
        live: finished.length > 0 ? state.live.filter((s) => !next.has(s.id)) : state.live,
      };
    }

    case 'reorder': {
      const committed = reorderList(state.committed, action.ids, action.to);
      const same = committed.every((e, i) => e === state.committed[i]);
      return same ? state : { ...state, committed };
    }

    case 'remote-start': {
      const known = [...state.committed, ...state.live].some((s) => s.id === action.stroke.id);
      return known ? state : { ...state, live: [...state.live, action.stroke] };
    }

    case 'remote-points': {
      const live = state.live.find((s) => s.id === action.id);
      if (live) {
        const grown = { ...live, points: [...live.points, ...action.points] };
        return { ...state, live: state.live.map((s) => (s === live ? grown : s)) };
      }
      // A stroke that was still being drawn when we joined arrives inside room:state as
      // committed. Move it to the live layer so it keeps rendering incrementally.
      const committed = state.committed.find((e) => e.id === action.id);
      if (committed?.type !== 'stroke') return state;
      const grown = { ...committed, points: [...committed.points, ...action.points] };
      return {
        committed: state.committed.filter((s) => s !== committed),
        live: [...state.live, grown],
      };
    }

    case 'remote-end': {
      const done = state.live.find((s) => s.id === action.id);
      if (!done) return state;
      return {
        committed: [...state.committed, done],
        live: state.live.filter((s) => s !== done),
      };
    }

    case 'delete': {
      const removed = new Set(action.ids);
      const committed = state.committed.filter((s) => !removed.has(s.id));
      const live = state.live.filter((s) => !removed.has(s.id));
      const unchanged =
        committed.length === state.committed.length && live.length === state.live.length;
      return unchanged ? state : { committed, live };
    }

    case 'clear':
      return state.committed.length === 0 && state.live.length === 0 ? state : initialBoardState;
  }
}
