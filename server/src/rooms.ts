import { LIMITS, pointCountOf } from '@whiteboard/shared';
import type {
  Board,
  BoardElement,
  ElementInput,
  ErrorCode,
  Participant,
  Point,
  ReorderTarget,
  Stroke,
  StrokeStartPayload,
} from '@whiteboard/shared';

export type RoomLimits = {
  maxPointsPerStroke: number;
  maxElementsPerBoard: number;
  maxPointsPerBoard: number;
  maxRoomSize: number;
  maxBoards: number;
  /** An empty board untouched for this long is dropped by `evictIdleBoards`. */
  boardIdleTtlMs: number;
  /** A cursor with no update for this long is dropped by `sweepStaleCursors`. */
  cursorTtlMs: number;
};

export const DEFAULT_ROOM_LIMITS: RoomLimits = {
  maxPointsPerStroke: LIMITS.maxPointsPerStroke,
  maxElementsPerBoard: LIMITS.maxElementsPerBoard,
  maxPointsPerBoard: LIMITS.maxPointsPerBoard,
  maxRoomSize: LIMITS.maxRoomSize,
  maxBoards: LIMITS.maxBoards,
  boardIdleTtlMs: LIMITS.boardIdleTtlMs,
  cursorTtlMs: LIMITS.cursorTtlMs,
};

export type RoomError = { code: ErrorCode; message: string };
export type Failure = { ok: false; error: RoomError };
export type Result<T> = { ok: true; value: T } | Failure;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: ErrorCode, message: string): Failure => ({
  ok: false,
  error: { code, message },
});

export type RoomSnapshot = { board: Board; participants: Participant[] };

type Room = {
  board: Board;
  /** Index into `board.elements` by id; holds the same objects. */
  byId: Map<string, BoardElement>;
  /** Total points over all strokes, kept in step so the board's size is checked in O(1). */
  pointCount: number;
  /** Strokes still being drawn: stroke id -> author client id. */
  active: Map<string, string>;
  /** Members' identity only; cursors live in `cursors` because they are ephemeral. */
  members: Map<string, Participant>;
  /** Last known cursor per member and when it arrived. Never part of the board. */
  cursors: Map<string, { point: Point; at: number }>;
};

/**
 * In-memory board state, keyed by board id. Pure state and rules: no sockets in here, so the
 * sync layer can be swapped for Yjs later without touching the transport.
 * Boards are kept after everyone leaves so a lone user who refreshes gets their board back.
 */
export class Rooms {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly limits: RoomLimits = DEFAULT_ROOM_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  get boardCount(): number {
    return this.rooms.size;
  }

  memberCount(boardId: string): number {
    return this.rooms.get(boardId)?.members.size ?? 0;
  }

  /** Adds a participant, creating the board on first join. Rejoining the same id is allowed. */
  join(boardId: string, participant: Participant): Result<RoomSnapshot> {
    let room = this.rooms.get(boardId);
    if (!room) {
      if (this.rooms.size >= this.limits.maxBoards) {
        return fail('server_full', 'The server is holding too many boards. Try again later.');
      }
      const t = this.now();
      room = {
        board: { id: boardId, elements: [], createdAt: t, lastActiveAt: t },
        byId: new Map(),
        pointCount: 0,
        active: new Map(),
        members: new Map(),
        cursors: new Map(),
      };
      this.rooms.set(boardId, room);
    }

    if (!room.members.has(participant.clientId) && room.members.size >= this.limits.maxRoomSize) {
      return fail('room_full', `This board already has ${this.limits.maxRoomSize} participants.`);
    }
    // Store only the identity fields; a cursor in the payload must not be persisted here.
    room.members.set(participant.clientId, {
      clientId: participant.clientId,
      name: participant.name,
      color: participant.color,
    });
    this.touch(room);

    return ok({
      board: { ...room.board, elements: [...room.board.elements] },
      participants: this.participantsOf(room),
    });
  }

  /** The participant as others should see them (identity plus current cursor, if any). */
  participant(boardId: string, clientId: string): Participant | undefined {
    const room = this.rooms.get(boardId);
    const member = room?.members.get(clientId);
    if (!room || !member) return undefined;
    return this.withCursor(room, member);
  }

  /**
   * Removes a participant. Their strokes stay on the board, but can no longer be extended.
   * Returns whether they were in the room, so callers only announce real departures.
   */
  leave(boardId: string, clientId: string): boolean {
    const room = this.rooms.get(boardId);
    if (!room?.members.delete(clientId)) return false;
    room.cursors.delete(clientId);
    for (const [strokeId, authorId] of room.active) {
      if (authorId === clientId) room.active.delete(strokeId);
    }
    return true;
  }

  /** Records a member's cursor. Cursors are relayed and kept for new joiners, never persisted. */
  moveCursor(boardId: string, clientId: string, point: Point): Result<void> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    room.value.cursors.set(clientId, { point, at: this.now() });
    return ok(undefined);
  }

  /** Drops boards nobody is in that have been idle past the TTL. Returns how many were dropped. */
  evictIdleBoards(): number {
    const cutoff = this.now() - this.limits.boardIdleTtlMs;
    let dropped = 0;
    for (const [boardId, room] of this.rooms) {
      if (room.members.size === 0 && room.board.lastActiveAt <= cutoff) {
        this.rooms.delete(boardId);
        dropped++;
      }
    }
    return dropped;
  }

  /** Drops cursors that have not moved within the TTL. Returns how many were dropped. */
  sweepStaleCursors(): number {
    const cutoff = this.now() - this.limits.cursorTtlMs;
    let dropped = 0;
    for (const room of this.rooms.values()) {
      for (const [clientId, cursor] of room.cursors) {
        if (cursor.at <= cutoff) {
          room.cursors.delete(clientId);
          dropped++;
        }
      }
    }
    return dropped;
  }

  startStroke(boardId: string, clientId: string, payload: StrokeStartPayload): Result<Stroke> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    const r = room.value;

    if (r.byId.has(payload.id)) return fail('duplicate_id', 'An element with that id exists.');
    if (r.board.elements.length >= this.limits.maxElementsPerBoard) {
      return fail(
        'board_full',
        `A board holds at most ${this.limits.maxElementsPerBoard} elements.`,
      );
    }

    if (r.pointCount >= this.limits.maxPointsPerBoard) return this.boardTooBig();

    const stroke: Stroke = {
      id: payload.id,
      type: 'stroke',
      authorId: clientId,
      color: payload.color,
      width: payload.width,
      points: [payload.point],
      createdAt: this.now(),
    };
    r.board.elements.push(stroke);
    r.byId.set(stroke.id, stroke);
    r.active.set(stroke.id, clientId);
    r.pointCount += 1;
    this.touch(r);
    return ok(stroke);
  }

  /**
   * Adds a finished element in one step (a shape, a text, or a complete stroke); these are not
   * streamed. The author is the sender, and `createdAt` is the server's clock. Returns the stored
   * element, which is what gets relayed.
   */
  addElement(boardId: string, clientId: string, payload: ElementInput): Result<BoardElement> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    const r = room.value;

    if (r.byId.has(payload.id)) return fail('duplicate_id', 'An element with that id exists.');
    const full = this.checkRoomFor(r, pointCountOf(payload));
    if (full) return full;
    return ok(this.insert(r, payload, clientId));
  }

  /**
   * Adds several finished elements, in order. Ids the board already has are skipped (a replay
   * after a reconnect must not duplicate anything). Elements that no longer fit are skipped too,
   * and reported as `board_full` alongside the ones that were added.
   */
  addElements(
    boardId: string,
    clientId: string,
    inputs: ElementInput[],
  ): Result<{ added: BoardElement[]; error?: RoomError }> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    const r = room.value;

    const added: BoardElement[] = [];
    let error: RoomError | undefined;
    for (const input of inputs) {
      if (r.byId.has(input.id)) continue;
      const full = this.checkRoomFor(r, pointCountOf(input));
      if (full) {
        error = full.error;
        continue;
      }
      added.push(this.insert(r, input, clientId));
    }
    return ok({ added, error });
  }

  /**
   * Replaces existing elements by id, keeping each one's place in the stacking order, author and
   * creation time. Ids not on the board are skipped: an element someone deleted stays deleted.
   * A stroke still being drawn is finished by its replacement. A replacement that would take the
   * board over its point budget is skipped and reported as `board_full`.
   */
  updateElements(
    boardId: string,
    clientId: string,
    inputs: ElementInput[],
  ): Result<{ updated: BoardElement[]; error?: RoomError }> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    const r = room.value;

    const updated: BoardElement[] = [];
    let error: RoomError | undefined;
    for (const input of inputs) {
      const current = r.byId.get(input.id);
      if (!current) continue;
      const delta = pointCountOf(input) - pointCountOf(current);
      if (delta > 0 && r.pointCount + delta > this.limits.maxPointsPerBoard) {
        error = this.boardTooBig().error;
        continue;
      }
      const next = {
        ...input,
        authorId: current.authorId,
        createdAt: current.createdAt,
      } as BoardElement;
      const index = r.board.elements.indexOf(current);
      r.board.elements[index] = next;
      r.byId.set(next.id, next);
      r.pointCount += delta;
      r.active.delete(next.id);
      updated.push(next);
    }
    if (updated.length > 0) this.touch(r);
    return ok({ updated, error });
  }

  /** Removes several elements. Resolves to the ids that were actually there. */
  deleteElements(boardId: string, clientId: string, ids: string[]): Result<string[]> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    const r = room.value;

    const removed = new Set<string>();
    for (const id of ids) {
      const element = r.byId.get(id);
      if (!element) continue;
      r.byId.delete(id);
      r.active.delete(id);
      r.pointCount -= pointCountOf(element);
      removed.add(id);
    }
    if (removed.size === 0) return ok([]);
    r.board.elements = r.board.elements.filter((e) => !removed.has(e.id));
    this.touch(r);
    return ok([...removed]);
  }

  /**
   * Moves elements to the top or the bottom of the stack, keeping their order relative to each
   * other. Resolves to the ids that exist, in stacking order.
   */
  reorderElements(
    boardId: string,
    clientId: string,
    ids: string[],
    to: ReorderTarget,
  ): Result<string[]> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    const r = room.value;

    const wanted = new Set(ids);
    const moved = r.board.elements.filter((e) => wanted.has(e.id));
    if (moved.length === 0) return ok([]);
    const rest = r.board.elements.filter((e) => !wanted.has(e.id));
    r.board.elements = to === 'front' ? [...rest, ...moved] : [...moved, ...rest];
    this.touch(r);
    return ok(moved.map((e) => e.id));
  }

  /** Appends points to a stroke the client is currently drawing. */
  appendPoints(boardId: string, clientId: string, id: string, points: Point[]): Result<Stroke> {
    const stroke = this.activeStroke(boardId, clientId, id);
    if (!stroke.ok) return stroke;
    const s = stroke.value.stroke;

    if (s.points.length + points.length > this.limits.maxPointsPerStroke) {
      return fail(
        'stroke_too_large',
        `A stroke holds at most ${this.limits.maxPointsPerStroke} points.`,
      );
    }
    const r = stroke.value.room;
    if (r.pointCount + points.length > this.limits.maxPointsPerBoard) return this.boardTooBig();
    for (const p of points) s.points.push(p);
    r.pointCount += points.length;
    this.touch(r);
    return ok(s);
  }

  endStroke(boardId: string, clientId: string, id: string): Result<Stroke> {
    const stroke = this.activeStroke(boardId, clientId, id);
    if (!stroke.ok) return stroke;
    stroke.value.room.active.delete(id);
    this.touch(stroke.value.room);
    return ok(stroke.value.stroke);
  }

  /**
   * Removes an element. Resolves to false when it was already gone (two users erasing the same
   * stroke is normal, not an error), so callers know whether there is anything to relay.
   */
  deleteElement(boardId: string, clientId: string, id: string): Result<boolean> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    const r = room.value;

    const removed = r.byId.get(id);
    if (!removed) return ok(false);
    r.byId.delete(id);
    r.pointCount -= pointCountOf(removed);
    r.board.elements = r.board.elements.filter((e) => e.id !== id);
    r.active.delete(id);
    this.touch(r);
    return ok(true);
  }

  clearBoard(boardId: string, clientId: string): Result<void> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    const r = room.value;

    r.board.elements = [];
    r.byId.clear();
    r.pointCount = 0;
    r.active.clear();
    this.touch(r);
    return ok(undefined);
  }

  /** Why one more element with `points` points does not fit, or null if it does. */
  private checkRoomFor(r: Room, points: number): Failure | null {
    if (r.board.elements.length >= this.limits.maxElementsPerBoard) {
      return fail(
        'board_full',
        `A board holds at most ${this.limits.maxElementsPerBoard} elements.`,
      );
    }
    if (points > 0 && r.pointCount + points > this.limits.maxPointsPerBoard) {
      return this.boardTooBig();
    }
    return null;
  }

  private insert(r: Room, input: ElementInput, clientId: string): BoardElement {
    const element = { ...input, authorId: clientId, createdAt: this.now() } as BoardElement;
    r.board.elements.push(element);
    r.byId.set(element.id, element);
    r.pointCount += pointCountOf(element);
    this.touch(r);
    return element;
  }

  private boardTooBig(): Failure {
    return fail(
      'board_full',
      `A board holds at most ${this.limits.maxPointsPerBoard.toLocaleString('en-US')} points.`,
    );
  }

  private memberRoom(boardId: string, clientId: string): Result<Room> {
    const room = this.rooms.get(boardId);
    if (!room?.members.has(clientId)) return fail('not_in_room', 'Join a board first.');
    return ok(room);
  }

  private activeStroke(
    boardId: string,
    clientId: string,
    id: string,
  ): Result<{ room: Room; stroke: Stroke }> {
    const room = this.memberRoom(boardId, clientId);
    if (!room.ok) return room;
    const stroke = room.value.byId.get(id);
    if (stroke?.type !== 'stroke' || room.value.active.get(id) !== clientId) {
      return fail('unknown_stroke', 'No such stroke in progress.');
    }
    return ok({ room: room.value, stroke });
  }

  private participantsOf(room: Room): Participant[] {
    return [...room.members.values()].map((m) => this.withCursor(room, m));
  }

  private withCursor(room: Room, member: Participant): Participant {
    const cursor = room.cursors.get(member.clientId);
    return cursor ? { ...member, cursor: cursor.point } : { ...member };
  }

  private touch(room: Room): void {
    room.board.lastActiveAt = this.now();
  }
}
