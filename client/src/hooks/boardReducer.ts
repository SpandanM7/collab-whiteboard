import type { Point, Stroke } from '@whiteboard/shared';

/**
 * Board elements as the client sees them. Finished strokes (`committed`) are drawn from a cached
 * layer; strokes other people are still drawing (`live`) are redrawn every frame, so a stream of
 * incoming points never forces the cache to be rebuilt.
 */
export type BoardState = { committed: Stroke[]; live: Stroke[] };

export type BoardAction =
  | { type: 'reset'; elements: Stroke[] }
  | { type: 'add-local'; stroke: Stroke }
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
      const { stroke } = action;
      const committed = state.committed.some((s) => s.id === stroke.id)
        ? state.committed.map((s) => (s.id === stroke.id ? stroke : s))
        : [...state.committed, stroke];
      return { ...state, committed };
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
      const committed = state.committed.find((s) => s.id === action.id);
      if (!committed) return state;
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
