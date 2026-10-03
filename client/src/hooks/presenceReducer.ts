import { LIMITS } from '@whiteboard/shared';
import type { Participant, Point } from '@whiteboard/shared';

/** A remote cursor and when it last moved (client clock), so idle ones can be hidden. */
export type CursorState = { point: Point; at: number };

export type PresenceState = {
  /** Everyone else in the room (never includes the local user). */
  participants: Participant[];
  cursors: Record<string, CursorState>;
};

export type PresenceAction =
  | { type: 'reset'; participants: Participant[]; selfId: string | undefined; now: number }
  | { type: 'joined'; participant: Participant; selfId: string | undefined; now: number }
  | { type: 'left'; clientId: string }
  | { type: 'cursor'; clientId: string; point: Point; now: number }
  | { type: 'expire'; now: number };

export const initialPresenceState: PresenceState = { participants: [], cursors: {} };

export function presenceReducer(state: PresenceState, action: PresenceAction): PresenceState {
  switch (action.type) {
    // Replaces everything: used for room:state after join/reconnect and on disconnect.
    case 'reset': {
      const others = action.participants.filter((p) => p.clientId !== action.selfId);
      const cursors: Record<string, CursorState> = {};
      for (const { clientId, cursor } of others) {
        if (cursor) cursors[clientId] = { point: cursor, at: action.now };
      }
      return {
        participants: others.map(({ clientId, name, color }) => ({ clientId, name, color })),
        cursors,
      };
    }

    // Also sent when someone renames, so it updates in place rather than appending.
    case 'joined': {
      const { cursor, ...participant } = action.participant;
      if (participant.clientId === action.selfId) return state;
      const exists = state.participants.some((p) => p.clientId === participant.clientId);
      const participants = exists
        ? state.participants.map((p) => (p.clientId === participant.clientId ? participant : p))
        : [...state.participants, participant];
      const cursors =
        cursor && !state.cursors[participant.clientId]
          ? { ...state.cursors, [participant.clientId]: { point: cursor, at: action.now } }
          : state.cursors;
      return { participants, cursors };
    }

    case 'left': {
      if (!state.participants.some((p) => p.clientId === action.clientId)) return state;
      const cursors = { ...state.cursors };
      delete cursors[action.clientId];
      return {
        participants: state.participants.filter((p) => p.clientId !== action.clientId),
        cursors,
      };
    }

    case 'cursor': {
      // Ignore stragglers for someone we do not know (e.g. one that arrives after they left).
      if (!state.participants.some((p) => p.clientId === action.clientId)) return state;
      return {
        ...state,
        cursors: { ...state.cursors, [action.clientId]: { point: action.point, at: action.now } },
      };
    }

    case 'expire': {
      const live = Object.entries(state.cursors).filter(
        ([, c]) => action.now - c.at < LIMITS.cursorTtlMs,
      );
      if (live.length === Object.keys(state.cursors).length) return state;
      return { ...state, cursors: Object.fromEntries(live) };
    }
  }
}
