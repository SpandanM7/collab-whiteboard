import { describe, expect, it } from 'vitest';
import { LIMITS } from '@whiteboard/shared';
import type { Participant } from '@whiteboard/shared';
import { initialPresenceState, presenceReducer } from './presenceReducer.ts';
import type { PresenceAction, PresenceState } from './presenceReducer.ts';

const ana: Participant = { clientId: 'ana', name: 'Ana', color: '#e03131' };
const ben: Participant = { clientId: 'ben', name: 'Ben', color: '#1c7ed6' };

const run = (actions: PresenceAction[], from: PresenceState = initialPresenceState) =>
  actions.reduce(presenceReducer, from);

const reset = (participants: Participant[], now = 0): PresenceAction => ({
  type: 'reset',
  participants,
  selfId: 'me',
  now,
});

describe('presenceReducer', () => {
  it('replaces everything on reset and leaves the local user out', () => {
    const me: Participant = { clientId: 'me', name: 'Me', color: '#000000' };
    const state = run([reset([ana]), reset([me, { ...ben, cursor: { x: 1, y: 2 } }], 50)]);
    expect(state.participants).toEqual([ben]);
    expect(state.cursors).toEqual({ ben: { point: { x: 1, y: 2 }, at: 50 } });
  });

  it('adds joiners once and updates them in place on a rename', () => {
    const state = run([
      reset([]),
      { type: 'joined', participant: ana, selfId: 'me', now: 0 },
      { type: 'joined', participant: ben, selfId: 'me', now: 0 },
      { type: 'joined', participant: { ...ana, name: 'Anna' }, selfId: 'me', now: 0 },
    ]);
    expect(state.participants.map((p) => p.name)).toEqual(['Anna', 'Ben']);
  });

  it('ignores participant:joined for the local user', () => {
    const state = run([
      reset([]),
      { type: 'joined', participant: { ...ana, clientId: 'me' }, selfId: 'me', now: 0 },
    ]);
    expect(state.participants).toEqual([]);
  });

  it('removes a participant and their cursor on left', () => {
    const state = run([
      reset([ana, ben]),
      { type: 'cursor', clientId: 'ana', point: { x: 1, y: 1 }, now: 0 },
      { type: 'left', clientId: 'ana' },
    ]);
    expect(state.participants).toEqual([ben]);
    expect(state.cursors).toEqual({});
  });

  it('ignores a late cursor from someone who already left', () => {
    const state = run([
      reset([ana]),
      { type: 'left', clientId: 'ana' },
      { type: 'cursor', clientId: 'ana', point: { x: 1, y: 1 }, now: 0 },
    ]);
    expect(state.cursors).toEqual({});
  });

  it('hides cursors idle for the TTL but keeps the participant', () => {
    const base = run([
      reset([ana, ben]),
      { type: 'cursor', clientId: 'ana', point: { x: 1, y: 1 }, now: 0 },
      { type: 'cursor', clientId: 'ben', point: { x: 2, y: 2 }, now: 5_000 },
    ]);
    expect(presenceReducer(base, { type: 'expire', now: LIMITS.cursorTtlMs - 1 })).toBe(base);

    const later = presenceReducer(base, { type: 'expire', now: LIMITS.cursorTtlMs });
    expect(Object.keys(later.cursors)).toEqual(['ben']);
    expect(later.participants).toHaveLength(2);

    // A fresh move brings the cursor back.
    const back = presenceReducer(later, {
      type: 'cursor',
      clientId: 'ana',
      point: { x: 3, y: 3 },
      now: LIMITS.cursorTtlMs + 1,
    });
    expect(back.cursors.ana.point).toEqual({ x: 3, y: 3 });
  });
});
