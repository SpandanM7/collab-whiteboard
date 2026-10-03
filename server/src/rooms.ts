import { LIMITS } from '@whiteboard/shared';
import type {
  Board,
  ErrorCode,
  Participant,
  Point,
  Stroke,
  StrokeStartPayload,
} from '@whiteboard/shared';

export type RoomLimits = {
  maxPointsPerStroke: number;
  maxElementsPerBoard: number;
  maxRoomSize: number;
  maxBoards: number;
};

export const DEFAULT_ROOM_LIMITS: RoomLimits = {
  maxPointsPerStroke: LIMITS.maxPointsPerStroke,
  maxElementsPerBoard: LIMITS.maxElementsPerBoard,
  maxRoomSize: LIMITS.maxRoomSize,
  maxBoards: LIMITS.maxBoards,
};

export type RoomError = { code: ErrorCode; message: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: RoomError };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (code: ErrorCode, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});

export type RoomSnapshot = { board: Board; participants: Participant[] };

type Room = {
  board: Board;
  /** Index into `board.elements` by id; holds the same objects. */
  byId: Map<string, Stroke>;
  /** Strokes still being drawn: stroke id -> author client id. */
  active: Map<string, string>;
  members: Map<string, Participant>;
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
        active: new Map(),
        members: new Map(),
      };
      this.rooms.set(boardId, room);
    }

    if (!room.members.has(participant.clientId) && room.members.size >= this.limits.maxRoomSize) {
      return fail('room_full', `This board already has ${this.limits.maxRoomSize} participants.`);
    }
    room.members.set(participant.clientId, participant);
    this.touch(room);

    return ok({
      board: { ...room.board, elements: [...room.board.elements] },
      participants: [...room.members.values()],
    });
  }

  /** Removes a participant. Their strokes stay on the board, but can no longer be extended. */
  leave(boardId: string, clientId: string): void {
    const room = this.rooms.get(boardId);
    if (!room?.members.delete(clientId)) return;
    for (const [strokeId, authorId] of room.active) {
      if (authorId === clientId) room.active.delete(strokeId);
    }
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
    this.touch(r);
    return ok(stroke);
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
    for (const p of points) s.points.push(p);
    this.touch(stroke.value.room);
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

    if (!r.byId.delete(id)) return ok(false);
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
    r.active.clear();
    this.touch(r);
    return ok(undefined);
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
    if (!stroke || room.value.active.get(id) !== clientId) {
      return fail('unknown_stroke', 'No such stroke in progress.');
    }
    return ok({ room: room.value, stroke });
  }

  private touch(room: Room): void {
    room.board.lastActiveAt = this.now();
  }
}
