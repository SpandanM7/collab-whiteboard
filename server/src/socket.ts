import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  boardClearPayload,
  elementDeletePayload,
  roomJoinPayload,
  strokeEndPayload,
  strokePointsPayload,
  strokeStartPayload,
} from '@whiteboard/shared';
import type { ClientToServerEvents, ErrorCode, ServerToClientEvents } from '@whiteboard/shared';
import type { Result, Rooms } from './rooms.ts';

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

type SocketData = { boardId?: string };

const channel = (boardId: string) => `board:${boardId}`;

/** Wires one connection's events to the rooms module. Every payload is validated first. */
export function registerSocketHandlers(socket: AppSocket, rooms: Rooms): void {
  const sendError = (code: ErrorCode, message: string) =>
    socket.emit(SERVER_EVENTS.error, { code, message });

  /**
   * Validates the raw payload, then runs `handler` with the joined board id. Invalid input and
   * unexpected exceptions become `error` events; neither can take the process down.
   */
  const guarded =
    <S extends z.ZodType>(schema: S, handler: (payload: z.infer<S>, boardId: string) => void) =>
    (raw: unknown): void => {
      try {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          sendError('invalid_payload', parsed.error.issues[0]?.message ?? 'Invalid payload.');
          return;
        }
        const boardId = socket.data.boardId;
        if (!boardId) {
          sendError('not_in_room', 'Join a board first.');
          return;
        }
        handler(parsed.data, boardId);
      } catch (err) {
        console.error('Unhandled error in socket handler:', err);
        sendError('internal', 'Something went wrong on the server.');
      }
    };

  /** Reports a failed rooms operation to the sender; returns the value on success. */
  const unwrap = <T>(result: Result<T>): T | undefined => {
    if (result.ok) return result.value;
    sendError(result.error.code, result.error.message);
    return undefined;
  };

  const leaveCurrentRoom = () => {
    const boardId = socket.data.boardId;
    if (!boardId) return;
    rooms.leave(boardId, socket.id);
    void socket.leave(channel(boardId));
    socket.data.boardId = undefined;
  };

  // room:join is the one event that does not need an existing room, so it skips `guarded`.
  socket.on(CLIENT_EVENTS.roomJoin, (raw: unknown) => {
    try {
      const parsed = roomJoinPayload.safeParse(raw);
      if (!parsed.success) {
        sendError('invalid_payload', parsed.error.issues[0]?.message ?? 'Invalid payload.');
        return;
      }
      const { boardId, name, color } = parsed.data;
      if (socket.data.boardId && socket.data.boardId !== boardId) leaveCurrentRoom();

      const snapshot = unwrap(rooms.join(boardId, { clientId: socket.id, name, color }));
      if (!snapshot) return;
      socket.data.boardId = boardId;
      void socket.join(channel(boardId));
      socket.emit(SERVER_EVENTS.roomState, snapshot);
    } catch (err) {
      console.error('Unhandled error in room:join:', err);
      sendError('internal', 'Something went wrong on the server.');
    }
  });

  socket.on(
    CLIENT_EVENTS.strokeStart,
    guarded(strokeStartPayload, (payload, boardId) => {
      if (!unwrap(rooms.startStroke(boardId, socket.id, payload))) return;
      socket
        .to(channel(boardId))
        .emit(SERVER_EVENTS.strokeStart, { ...payload, authorId: socket.id });
    }),
  );

  socket.on(
    CLIENT_EVENTS.strokePoints,
    guarded(strokePointsPayload, (payload, boardId) => {
      if (!unwrap(rooms.appendPoints(boardId, socket.id, payload.id, payload.points))) return;
      socket
        .to(channel(boardId))
        .emit(SERVER_EVENTS.strokePoints, { ...payload, authorId: socket.id });
    }),
  );

  socket.on(
    CLIENT_EVENTS.strokeEnd,
    guarded(strokeEndPayload, (payload, boardId) => {
      if (!unwrap(rooms.endStroke(boardId, socket.id, payload.id))) return;
      socket
        .to(channel(boardId))
        .emit(SERVER_EVENTS.strokeEnd, { ...payload, authorId: socket.id });
    }),
  );

  socket.on(
    CLIENT_EVENTS.elementDelete,
    guarded(elementDeletePayload, (payload, boardId) => {
      if (!unwrap(rooms.deleteElement(boardId, socket.id, payload.id))) return;
      socket.to(channel(boardId)).emit(SERVER_EVENTS.elementDeleted, { id: payload.id });
    }),
  );

  socket.on(
    CLIENT_EVENTS.boardClear,
    guarded(boardClearPayload, (_payload, boardId) => {
      const result = rooms.clearBoard(boardId, socket.id);
      if (!result.ok) {
        sendError(result.error.code, result.error.message);
        return;
      }
      socket.to(channel(boardId)).emit(SERVER_EVENTS.boardCleared, {});
    }),
  );

  socket.on('disconnect', leaveCurrentRoom);
}
