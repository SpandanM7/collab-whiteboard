import { beforeEach, describe, expect, it } from 'vitest';
import type { BoardElement, ElementAddPayload, Participant } from '@whiteboard/shared';
import { DEFAULT_ROOM_LIMITS, Rooms } from './rooms.ts';
import type { Result, RoomLimits } from './rooms.ts';

const BOARD = 'board-0001';
const alice: Participant = { clientId: 'alice', name: 'Alice', color: '#ff0000' };
const bob: Participant = { clientId: 'bob', name: 'Bob', color: '#0000ff' };

const pointsOf = (element?: BoardElement) => (element?.type === 'stroke' ? element.points : []);

const rect = (id: string): ElementAddPayload => ({
  id,
  type: 'rect',
  color: '#000000',
  width: 2,
  start: { x: 0, y: 0 },
  end: { x: 10, y: 20 },
});

const start = (id: string) => ({ id, color: '#000000', width: 4, point: { x: 0, y: 0 } });

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
}

function expectError<T>(result: Result<T>, code: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

function makeRooms(limits: Partial<RoomLimits> = {}) {
  let t = 1000;
  return new Rooms({ ...DEFAULT_ROOM_LIMITS, ...limits }, () => t++);
}

describe('join', () => {
  it('creates the board on first join and returns its state', () => {
    const rooms = makeRooms();
    const { board, participants } = expectOk(rooms.join(BOARD, alice));
    expect(board.id).toBe(BOARD);
    expect(board.elements).toEqual([]);
    expect(participants).toEqual([alice]);
    expect(rooms.boardCount).toBe(1);
  });

  it('returns existing strokes to a later joiner', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    const { board, participants } = expectOk(rooms.join(BOARD, bob));
    expect(board.elements.map((e) => e.id)).toEqual(['s1']);
    expect(participants.map((p) => p.clientId)).toEqual(['alice', 'bob']);
  });

  it('returns a snapshot that later changes do not mutate', () => {
    const rooms = makeRooms();
    const { board } = expectOk(rooms.join(BOARD, alice));
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expect(board.elements).toHaveLength(0);
  });

  it('rejects joins beyond the room size, but lets an existing member rejoin', () => {
    const rooms = makeRooms({ maxRoomSize: 2 });
    expectOk(rooms.join(BOARD, alice));
    expectOk(rooms.join(BOARD, bob));
    expectError(
      rooms.join(BOARD, { clientId: 'carol', name: 'Carol', color: '#00ff00' }),
      'room_full',
    );
    expectOk(rooms.join(BOARD, alice));
    expect(rooms.memberCount(BOARD)).toBe(2);
  });

  it('rejects new boards beyond the board limit, but still admits joiners to existing ones', () => {
    const rooms = makeRooms({ maxBoards: 1 });
    expectOk(rooms.join(BOARD, alice));
    expectError(rooms.join('board-0002', bob), 'server_full');
    expectOk(rooms.join(BOARD, bob));
  });

  it('frees a seat when someone leaves', () => {
    const rooms = makeRooms({ maxRoomSize: 1 });
    expectOk(rooms.join(BOARD, alice));
    rooms.leave(BOARD, 'alice');
    expectOk(rooms.join(BOARD, bob));
  });

  it('keeps the board after everyone leaves', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    rooms.leave(BOARD, 'alice');
    const { board } = expectOk(rooms.join(BOARD, alice));
    expect(board.elements).toHaveLength(1);
  });
});

describe('strokes', () => {
  let rooms: Rooms;
  beforeEach(() => {
    rooms = makeRooms();
    rooms.join(BOARD, alice);
    rooms.join(BOARD, bob);
  });

  it('records the author from the connection, not the payload', () => {
    const stroke = expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expect(stroke.authorId).toBe('alice');
    expect(stroke.points).toEqual([{ x: 0, y: 0 }]);
  });

  it('appends points in order and finishes the stroke', () => {
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expectOk(
      rooms.appendPoints(BOARD, 'alice', 's1', [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    );
    expectOk(rooms.appendPoints(BOARD, 'alice', 's1', [{ x: 3, y: 3 }]));
    expectOk(rooms.endStroke(BOARD, 'alice', 's1'));

    const { board } = expectOk(rooms.join(BOARD, bob));
    expect(pointsOf(board.elements[0]).map((p) => p.x)).toEqual([0, 1, 2, 3]);
  });

  it('rejects appending after the stroke ended', () => {
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expectOk(rooms.endStroke(BOARD, 'alice', 's1'));
    expectError(rooms.appendPoints(BOARD, 'alice', 's1', [{ x: 1, y: 1 }]), 'unknown_stroke');
    expectError(rooms.endStroke(BOARD, 'alice', 's1'), 'unknown_stroke');
  });

  it('rejects extending someone else’s stroke', () => {
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expectError(rooms.appendPoints(BOARD, 'bob', 's1', [{ x: 1, y: 1 }]), 'unknown_stroke');
    expectError(rooms.endStroke(BOARD, 'bob', 's1'), 'unknown_stroke');
  });

  it('rejects points for a stroke that was never started', () => {
    expectError(rooms.appendPoints(BOARD, 'alice', 'nope', [{ x: 1, y: 1 }]), 'unknown_stroke');
  });

  it('rejects a duplicate stroke id', () => {
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expectError(rooms.startStroke(BOARD, 'bob', start('s1')), 'duplicate_id');
  });

  it('stops accepting points past the per-stroke limit', () => {
    const small = makeRooms({ maxPointsPerStroke: 3 });
    small.join(BOARD, alice);
    expectOk(small.startStroke(BOARD, 'alice', start('s1')));
    expectOk(
      small.appendPoints(BOARD, 'alice', 's1', [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    );
    expectError(small.appendPoints(BOARD, 'alice', 's1', [{ x: 3, y: 3 }]), 'stroke_too_large');
  });

  it('refuses new strokes once the board is full', () => {
    const small = makeRooms({ maxElementsPerBoard: 2 });
    small.join(BOARD, alice);
    expectOk(small.startStroke(BOARD, 'alice', start('s1')));
    expectOk(small.startStroke(BOARD, 'alice', start('s2')));
    expectError(small.startStroke(BOARD, 'alice', start('s3')), 'board_full');
  });

  it('can no longer extend a stroke after its author leaves, but keeps it on the board', () => {
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    rooms.leave(BOARD, 'alice');
    rooms.join(BOARD, alice);
    expectError(rooms.appendPoints(BOARD, 'alice', 's1', [{ x: 1, y: 1 }]), 'unknown_stroke');
    expect(expectOk(rooms.join(BOARD, bob)).board.elements).toHaveLength(1);
  });

  it('rejects operations from clients who have not joined', () => {
    expectError(rooms.startStroke(BOARD, 'mallory', start('s1')), 'not_in_room');
    expectError(rooms.startStroke('board-9999', 'alice', start('s1')), 'not_in_room');
    expectError(rooms.deleteElement(BOARD, 'mallory', 's1'), 'not_in_room');
    expectError(rooms.clearBoard(BOARD, 'mallory'), 'not_in_room');
  });
});

describe('shapes', () => {
  let rooms: Rooms;
  beforeEach(() => {
    rooms = makeRooms();
    rooms.join(BOARD, alice);
    rooms.join(BOARD, bob);
  });

  it('stores a shape with the sender as author and a server timestamp', () => {
    const shape = expectOk(rooms.addElement(BOARD, 'alice', rect('r1')));
    expect(shape).toMatchObject({ id: 'r1', type: 'rect', authorId: 'alice' });
    expect(shape.createdAt).toBeGreaterThan(0);
    const { board } = expectOk(rooms.join(BOARD, bob));
    expect(board.elements.map((e) => e.id)).toEqual(['r1']);
  });

  it('keeps drawing order across strokes and shapes', () => {
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expectOk(rooms.addElement(BOARD, 'bob', rect('r1')));
    const { board } = expectOk(rooms.join(BOARD, bob));
    expect(board.elements.map((e) => e.id)).toEqual(['s1', 'r1']);
  });

  it('rejects a duplicate id, including one used by a stroke', () => {
    expectOk(rooms.addElement(BOARD, 'alice', rect('r1')));
    expectError(rooms.addElement(BOARD, 'bob', rect('r1')), 'duplicate_id');
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expectError(rooms.addElement(BOARD, 'alice', rect('s1')), 'duplicate_id');
  });

  it('counts shapes toward the element limit', () => {
    const small = makeRooms({ maxElementsPerBoard: 2 });
    small.join(BOARD, alice);
    expectOk(small.addElement(BOARD, 'alice', rect('r1')));
    expectOk(small.addElement(BOARD, 'alice', rect('r2')));
    expectError(small.addElement(BOARD, 'alice', rect('r3')), 'board_full');
    expectError(small.startStroke(BOARD, 'alice', start('s1')), 'board_full');
  });

  it('requires membership', () => {
    expectError(rooms.addElement(BOARD, 'stranger', rect('r1')), 'not_in_room');
  });

  it('cannot be extended or ended like a stroke', () => {
    expectOk(rooms.addElement(BOARD, 'alice', rect('r1')));
    expectError(rooms.appendPoints(BOARD, 'alice', 'r1', [{ x: 1, y: 1 }]), 'unknown_stroke');
    expectError(rooms.endStroke(BOARD, 'alice', 'r1'), 'unknown_stroke');
  });

  it('can be deleted by anyone without disturbing the point budget', () => {
    expectOk(rooms.addElement(BOARD, 'alice', rect('r1')));
    expect(expectOk(rooms.deleteElement(BOARD, 'bob', 'r1'))).toBe(true);
    expect(expectOk(rooms.join(BOARD, bob)).board.elements).toEqual([]);
  });
});

describe('delete and clear', () => {
  let rooms: Rooms;
  beforeEach(() => {
    rooms = makeRooms();
    rooms.join(BOARD, alice);
    rooms.join(BOARD, bob);
    rooms.startStroke(BOARD, 'alice', start('s1'));
    rooms.startStroke(BOARD, 'alice', start('s2'));
  });

  it('deletes any participant’s element and reports it', () => {
    expect(expectOk(rooms.deleteElement(BOARD, 'bob', 's1'))).toBe(true);
    const { board } = expectOk(rooms.join(BOARD, bob));
    expect(board.elements.map((e) => e.id)).toEqual(['s2']);
  });

  it('reports false, not an error, when the element is already gone', () => {
    expectOk(rooms.deleteElement(BOARD, 'alice', 's1'));
    expect(expectOk(rooms.deleteElement(BOARD, 'bob', 's1'))).toBe(false);
  });

  it('frees the id after delete, and stops accepting points for it', () => {
    expectOk(rooms.deleteElement(BOARD, 'alice', 's1'));
    expectError(rooms.appendPoints(BOARD, 'alice', 's1', [{ x: 1, y: 1 }]), 'unknown_stroke');
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
  });

  it('clears every element, including strokes in progress', () => {
    expectOk(rooms.clearBoard(BOARD, 'bob'));
    expect(expectOk(rooms.join(BOARD, bob)).board.elements).toEqual([]);
    expectError(rooms.appendPoints(BOARD, 'alice', 's1', [{ x: 1, y: 1 }]), 'unknown_stroke');
  });

  it('lets a cleared board accept elements again up to the limit', () => {
    const small = makeRooms({ maxElementsPerBoard: 1 });
    small.join(BOARD, alice);
    expectOk(small.startStroke(BOARD, 'alice', start('s1')));
    expectError(small.startStroke(BOARD, 'alice', start('s2')), 'board_full');
    expectOk(small.clearBoard(BOARD, 'alice'));
    expectOk(small.startStroke(BOARD, 'alice', start('s2')));
  });
});

describe('activity timestamps', () => {
  it('bumps lastActiveAt on changes', () => {
    const rooms = makeRooms();
    const { board } = expectOk(rooms.join(BOARD, alice));
    const joinedAt = board.lastActiveAt;
    rooms.startStroke(BOARD, 'alice', start('s1'));
    const later = expectOk(rooms.join(BOARD, alice)).board;
    expect(later.lastActiveAt).toBeGreaterThan(joinedAt);
    expect(later.createdAt).toBe(board.createdAt);
  });
});

describe('participants', () => {
  it('lists everyone in the room, in join order', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    const { participants } = expectOk(rooms.join(BOARD, bob));
    expect(participants).toEqual([alice, bob]);
  });

  it('keeps participants of different boards apart', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    const { participants } = expectOk(rooms.join('board-0002', bob));
    expect(participants).toEqual([bob]);
  });

  it('removes a participant on leave and reports whether they were present', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    rooms.join(BOARD, bob);
    expect(rooms.leave(BOARD, 'alice')).toBe(true);
    expect(rooms.leave(BOARD, 'alice')).toBe(false);
    expect(rooms.leave('board-9999', 'bob')).toBe(false);
    expect(expectOk(rooms.join(BOARD, bob)).participants).toEqual([bob]);
  });

  it('updates the name on rejoin without duplicating the participant', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    const { participants } = expectOk(rooms.join(BOARD, { ...alice, name: 'Alicia' }));
    expect(participants).toEqual([{ ...alice, name: 'Alicia' }]);
  });

  it('only keeps identity fields from the join payload', () => {
    const rooms = makeRooms();
    const sneaky = { ...alice, cursor: { x: 5, y: 5 } };
    expect(expectOk(rooms.join(BOARD, sneaky)).participants).toEqual([alice]);
  });
});

describe('cursors', () => {
  const TTL = 10_000;

  /** Rooms on a clock the test controls, so staleness does not depend on call counts. */
  function clockRooms() {
    const clock = { t: 1000 };
    const rooms = new Rooms({ ...DEFAULT_ROOM_LIMITS, cursorTtlMs: TTL }, () => clock.t);
    rooms.join(BOARD, alice);
    rooms.join(BOARD, bob);
    return { rooms, clock };
  }

  const cursorOf = (rooms: Rooms, id: string) => rooms.participant(BOARD, id)?.cursor;

  it('records a member’s cursor and shows it to later joiners', () => {
    const { rooms } = clockRooms();
    expectOk(rooms.moveCursor(BOARD, 'alice', { x: 3, y: 4 }));
    const { participants } = expectOk(
      rooms.join(BOARD, { clientId: 'carol', name: 'Carol', color: '#00ff00' }),
    );
    expect(participants.find((p) => p.clientId === 'alice')?.cursor).toEqual({ x: 3, y: 4 });
    expect(participants.find((p) => p.clientId === 'bob')?.cursor).toBeUndefined();
  });

  it('rejects cursor moves from clients who have not joined', () => {
    const { rooms } = clockRooms();
    expectError(rooms.moveCursor(BOARD, 'mallory', { x: 1, y: 1 }), 'not_in_room');
    expectError(rooms.moveCursor('board-9999', 'alice', { x: 1, y: 1 }), 'not_in_room');
  });

  it('never puts cursors into the board state', () => {
    const { rooms } = clockRooms();
    rooms.moveCursor(BOARD, 'alice', { x: 1, y: 1 });
    const { board } = expectOk(rooms.join(BOARD, bob));
    expect(JSON.stringify(board)).not.toContain('cursor');
  });

  it('keeps the cursor when a member renames themselves', () => {
    const { rooms } = clockRooms();
    rooms.moveCursor(BOARD, 'alice', { x: 3, y: 4 });
    rooms.join(BOARD, { ...alice, name: 'Alicia' });
    expect(cursorOf(rooms, 'alice')).toEqual({ x: 3, y: 4 });
  });

  it('drops cursors that have not moved within the TTL', () => {
    const { rooms, clock } = clockRooms();
    rooms.moveCursor(BOARD, 'alice', { x: 1, y: 1 });
    clock.t += TTL - 1;
    expect(rooms.sweepStaleCursors()).toBe(0);
    expect(cursorOf(rooms, 'alice')).toEqual({ x: 1, y: 1 });

    clock.t += 1;
    expect(rooms.sweepStaleCursors()).toBe(1);
    expect(cursorOf(rooms, 'alice')).toBeUndefined();
    // The participant stays; only the cursor goes.
    expect(rooms.participant(BOARD, 'alice')).toEqual(alice);
  });

  it('keeps a cursor alive while it keeps moving, and only drops the idle one', () => {
    const { rooms, clock } = clockRooms();
    rooms.moveCursor(BOARD, 'alice', { x: 1, y: 1 });
    rooms.moveCursor(BOARD, 'bob', { x: 2, y: 2 });
    clock.t += TTL - 1;
    rooms.moveCursor(BOARD, 'alice', { x: 9, y: 9 });
    clock.t += 5;
    expect(rooms.sweepStaleCursors()).toBe(1);
    expect(cursorOf(rooms, 'alice')).toEqual({ x: 9, y: 9 });
    expect(cursorOf(rooms, 'bob')).toBeUndefined();
  });

  it('sweeps stale cursors across every board', () => {
    const { rooms, clock } = clockRooms();
    rooms.join('board-0002', { clientId: 'carol', name: 'Carol', color: '#00ff00' });
    rooms.moveCursor(BOARD, 'alice', { x: 1, y: 1 });
    rooms.moveCursor('board-0002', 'carol', { x: 1, y: 1 });
    clock.t += TTL;
    expect(rooms.sweepStaleCursors()).toBe(2);
  });

  it('forgets the cursor when its owner leaves', () => {
    const { rooms } = clockRooms();
    rooms.moveCursor(BOARD, 'alice', { x: 1, y: 1 });
    rooms.leave(BOARD, 'alice');
    rooms.join(BOARD, alice);
    expect(cursorOf(rooms, 'alice')).toBeUndefined();
  });
});

describe('replaying a stroke after its author dropped', () => {
  // The client replays unsynced work as a new author. This pins down the protocol it relies on.
  it('lets a new member replace the truncated copy a departed author left behind', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expectOk(rooms.appendPoints(BOARD, 'alice', 's1', [{ x: 1, y: 1 }]));
    rooms.leave(BOARD, 'alice');

    rooms.join(BOARD, bob);
    expectError(rooms.appendPoints(BOARD, 'bob', 's1', [{ x: 2, y: 2 }]), 'unknown_stroke');
    expectError(rooms.startStroke(BOARD, 'bob', start('s1')), 'duplicate_id');

    expect(expectOk(rooms.deleteElement(BOARD, 'bob', 's1'))).toBe(true);
    expectOk(rooms.startStroke(BOARD, 'bob', start('s1')));
    expectOk(
      rooms.appendPoints(BOARD, 'bob', 's1', [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    );
    expectOk(rooms.endStroke(BOARD, 'bob', 's1'));

    const { board } = expectOk(rooms.join(BOARD, bob));
    expect(board.elements).toHaveLength(1);
    expect(pointsOf(board.elements[0])).toHaveLength(3);
    expect(board.elements[0]?.authorId).toBe('bob');
  });

  it('treats erasing an id the server never saw as a no-op', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    expect(expectOk(rooms.deleteElement(BOARD, 'alice', 'never-sent'))).toBe(false);
  });
});

describe('board point budget', () => {
  it('rejects points beyond the per-board total, across strokes', () => {
    const rooms = makeRooms({ maxPointsPerBoard: 5 });
    rooms.join(BOARD, alice);
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1'))); // 1 point
    expectOk(
      rooms.appendPoints(BOARD, 'alice', 's1', [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ); // 3
    expectOk(rooms.startStroke(BOARD, 'alice', start('s2'))); // 4
    expectError(
      rooms.appendPoints(BOARD, 'alice', 's2', [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
      'board_full',
    );
    expectOk(rooms.appendPoints(BOARD, 'alice', 's2', [{ x: 1, y: 0 }])); // exactly 5
    expectOk(rooms.endStroke(BOARD, 'alice', 's2'));
    expectError(rooms.startStroke(BOARD, 'alice', start('s3')), 'board_full');
  });

  it('frees budget when strokes are erased or the board is cleared', () => {
    const rooms = makeRooms({ maxPointsPerBoard: 2 });
    rooms.join(BOARD, alice);
    expectOk(rooms.startStroke(BOARD, 'alice', start('s1')));
    expectOk(rooms.appendPoints(BOARD, 'alice', 's1', [{ x: 1, y: 0 }]));
    expectError(rooms.startStroke(BOARD, 'alice', start('s2')), 'board_full');

    expectOk(rooms.deleteElement(BOARD, 'alice', 's1'));
    expectOk(rooms.startStroke(BOARD, 'alice', start('s2')));
    expectOk(rooms.appendPoints(BOARD, 'alice', 's2', [{ x: 1, y: 0 }]));
    expectError(rooms.startStroke(BOARD, 'alice', start('s3')), 'board_full');

    expectOk(rooms.clearBoard(BOARD, 'alice'));
    expectOk(rooms.startStroke(BOARD, 'alice', start('s3')));
  });
});

describe('evictIdleBoards', () => {
  function clocked(boardIdleTtlMs: number) {
    const clock = { t: 0 };
    const rooms = new Rooms({ ...DEFAULT_ROOM_LIMITS, boardIdleTtlMs }, () => clock.t);
    return { rooms, clock };
  }

  it('drops an empty board once it has been idle past the TTL', () => {
    const { rooms, clock } = clocked(100);
    rooms.join(BOARD, alice);
    rooms.leave(BOARD, 'alice');
    clock.t = 99;
    expect(rooms.evictIdleBoards()).toBe(0);
    clock.t = 100;
    expect(rooms.evictIdleBoards()).toBe(1);
    expect(rooms.boardCount).toBe(0);
  });

  it('keeps a board that still has someone in it, however idle', () => {
    const { rooms, clock } = clocked(100);
    rooms.join(BOARD, alice);
    clock.t = 10_000;
    expect(rooms.evictIdleBoards()).toBe(0);
  });

  it('frees a slot so a new board can be created again', () => {
    const clock = { t: 0 };
    const rooms = new Rooms(
      { ...DEFAULT_ROOM_LIMITS, maxBoards: 1, boardIdleTtlMs: 100 },
      () => clock.t,
    );
    rooms.join('board-aaaaaaa', alice);
    rooms.leave('board-aaaaaaa', 'alice');
    expectError(rooms.join('board-bbbbbbb', bob), 'server_full');
    clock.t = 200;
    rooms.evictIdleBoards();
    expectOk(rooms.join('board-bbbbbbb', bob));
  });
});

describe('batch element operations', () => {
  const strokeInput = (id: string, n: number) => ({
    id,
    type: 'stroke' as const,
    color: '#000000',
    width: 2,
    points: Array.from({ length: n }, (_, i) => ({ x: i, y: i })),
  });
  const text = (id: string, value = 'hi') => ({
    id,
    type: 'text' as const,
    color: '#000000',
    start: { x: 0, y: 0 },
    text: value,
    fontSize: 20,
  });
  const ids = (rooms: Rooms) => expectOk(rooms.join(BOARD, alice)).board.elements.map((e) => e.id);

  it('adds a complete stroke and a text in one step, authored by the sender', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    const { added, error } = expectOk(
      rooms.addElements(BOARD, 'alice', [strokeInput('s', 3), text('t')]),
    );
    expect(error).toBeUndefined();
    expect(added.map((e) => [e.id, e.authorId])).toEqual([
      ['s', 'alice'],
      ['t', 'alice'],
    ]);
    // A complete stroke is not in progress: nobody can append to it.
    expectError(rooms.appendPoints(BOARD, 'alice', 's', [{ x: 1, y: 1 }]), 'unknown_stroke');
  });

  it('skips ids the board already has, so a replay never duplicates', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    expectOk(rooms.addElement(BOARD, 'alice', rect('r')));
    const { added } = expectOk(rooms.addElements(BOARD, 'alice', [rect('r'), rect('r2')]));
    expect(added.map((e) => e.id)).toEqual(['r2']);
    expect(ids(rooms)).toEqual(['r', 'r2']);
  });

  it('adds what fits and reports board_full for the rest', () => {
    const rooms = makeRooms({ maxElementsPerBoard: 2 });
    rooms.join(BOARD, alice);
    const { added, error } = expectOk(
      rooms.addElements(BOARD, 'alice', [rect('a'), rect('b'), rect('c')]),
    );
    expect(added).toHaveLength(2);
    expect(error?.code).toBe('board_full');
  });

  it('counts added stroke points against the board budget', () => {
    const rooms = makeRooms({ maxPointsPerBoard: 5 });
    rooms.join(BOARD, alice);
    const { added, error } = expectOk(
      rooms.addElements(BOARD, 'alice', [strokeInput('a', 3), strokeInput('b', 3)]),
    );
    expect(added.map((e) => e.id)).toEqual(['a']);
    expect(error?.code).toBe('board_full');
  });

  it('replaces elements in place, keeping author, time and stacking order', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    rooms.join(BOARD, bob);
    const original = expectOk(rooms.addElement(BOARD, 'alice', rect('a')));
    expectOk(rooms.addElement(BOARD, 'alice', rect('b')));
    const moved = { ...rect('a'), start: { x: 50, y: 50 }, end: { x: 60, y: 60 } };
    const { updated } = expectOk(rooms.updateElements(BOARD, 'bob', [moved]));
    expect(updated[0]).toMatchObject({
      ...moved,
      authorId: 'alice',
      createdAt: original.createdAt,
    });
    const { board } = expectOk(rooms.join(BOARD, alice));
    expect(board.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(board.elements[0]).toMatchObject({ start: { x: 50, y: 50 } });
  });

  it('does not bring back an element someone else deleted', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    expectOk(rooms.addElement(BOARD, 'alice', rect('a')));
    expectOk(rooms.deleteElement(BOARD, 'alice', 'a'));
    const { updated } = expectOk(rooms.updateElements(BOARD, 'alice', [rect('a')]));
    expect(updated).toEqual([]);
    expect(ids(rooms)).toEqual([]);
  });

  it('keeps the point budget in step when a stroke is replaced', () => {
    const rooms = makeRooms({ maxPointsPerBoard: 6 });
    rooms.join(BOARD, alice);
    expectOk(rooms.addElements(BOARD, 'alice', [strokeInput('a', 4)]));
    // Growing past the budget is refused; shrinking frees room for another stroke.
    const grown = expectOk(rooms.updateElements(BOARD, 'alice', [strokeInput('a', 7)]));
    expect(grown.updated).toEqual([]);
    expect(grown.error?.code).toBe('board_full');
    expectOk(rooms.updateElements(BOARD, 'alice', [strokeInput('a', 2)]));
    const { added } = expectOk(rooms.addElements(BOARD, 'alice', [strokeInput('b', 4)]));
    expect(added).toHaveLength(1);
  });

  it('finishes a stroke in progress when it is replaced', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    expectOk(rooms.startStroke(BOARD, 'alice', start('s')));
    expectOk(rooms.updateElements(BOARD, 'alice', [strokeInput('s', 3)]));
    expectError(rooms.appendPoints(BOARD, 'alice', 's', [{ x: 1, y: 1 }]), 'unknown_stroke');
  });

  it('deletes several elements and reports only the ones that existed', () => {
    const rooms = makeRooms({ maxPointsPerBoard: 4 });
    rooms.join(BOARD, alice);
    expectOk(rooms.addElements(BOARD, 'alice', [strokeInput('a', 4), rect('b'), rect('c')]));
    expect(expectOk(rooms.deleteElements(BOARD, 'alice', ['a', 'c', 'zzz']))).toEqual(['a', 'c']);
    expect(ids(rooms)).toEqual(['b']);
    // The deleted stroke's points are free again.
    expect(expectOk(rooms.addElements(BOARD, 'alice', [strokeInput('d', 4)])).added).toHaveLength(
      1,
    );
  });

  it('moves elements to the front or back, keeping their relative order', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    expectOk(rooms.addElements(BOARD, 'alice', ['a', 'b', 'c', 'd'].map(rect)));
    expect(expectOk(rooms.reorderElements(BOARD, 'alice', ['c', 'a', 'x'], 'front'))).toEqual([
      'a',
      'c',
    ]);
    expect(ids(rooms)).toEqual(['b', 'd', 'a', 'c']);
    expectOk(rooms.reorderElements(BOARD, 'alice', ['c', 'd'], 'back'));
    expect(ids(rooms)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('requires membership for every batch operation', () => {
    const rooms = makeRooms();
    rooms.join(BOARD, alice);
    expectError(rooms.addElements(BOARD, 'bob', [rect('a')]), 'not_in_room');
    expectError(rooms.updateElements(BOARD, 'bob', [rect('a')]), 'not_in_room');
    expectError(rooms.deleteElements(BOARD, 'bob', ['a']), 'not_in_room');
    expectError(rooms.reorderElements(BOARD, 'bob', ['a'], 'front'), 'not_in_room');
  });
});
