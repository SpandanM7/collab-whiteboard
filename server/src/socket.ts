import type { Server, Socket } from 'socket.io';
import type { z } from 'zod';
import {
  CLIENT_EVENTS,
  LIMITS,
  SERVER_EVENTS,
  boardClearPayload,
  cursorMovePayload,
  elementAddPayload,
  elementDeletePayload,
  elementsAddPayload,
  elementsDeletePayload,
  elementsReorderPayload,
  elementsUpdatePayload,
  laserMovePayload,
  pointCountOf,
  roomJoinPayload,
  strokeEndPayload,
  strokePointsPayload,
  strokeStartPayload,
} from '@whiteboard/shared';
import type {
  ClientToServerEvents,
  ElementInput,
  ErrorCode,
  ServerToClientEvents,
} from '@whiteboard/shared';
import { TokenBucket } from './rateLimit.ts';
import type { RateLimit } from './rateLimit.ts';
import type { Result, Rooms } from './rooms.ts';

export type AppServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

type SocketData = { boardId?: string };

const channel = (boardId: string) => `board:${boardId}`;

export const DEFAULT_RATE_LIMIT: RateLimit = {
  burst: LIMITS.eventBurst,
  perSecond: LIMITS.eventsPerSecond,
};

/** Rate-limit errors are sent at most this often, so a flood does not become a reply flood. */
const RATE_ERROR_INTERVAL_MS = 1_000;

/** Wires one connection's events to the rooms module. Every payload is validated first. */
export function registerSocketHandlers(
  socket: AppSocket,
  rooms: Rooms,
  rateLimit: RateLimit = DEFAULT_RATE_LIMIT,
): void {
  const sendError = (code: ErrorCode, message: string) =>
    socket.emit(SERVER_EVENTS.error, { code, message });

  // Runs before every incoming event, so a flood is dropped before it is parsed or applied.
  const bucket = new TokenBucket(rateLimit);
  let lastRateError = -Infinity;
  const rateLimited = () => {
    const now = Date.now();
    if (now - lastRateError >= RATE_ERROR_INTERVAL_MS) {
      lastRateError = now;
      sendError('rate_limited', 'You are sending too fast. Some changes were dropped.');
    }
  };
  socket.use((_packet, next) => {
    if (bucket.take()) {
      next();
      return;
    }
    rateLimited();
  });

  /**
   * A batch carrying stroke points pays for them on top of the event's own token, so moving a
   * big drawing is paced like drawing it was. False (and an error) when the bucket is short.
   */
  const payForPoints = (elements: ElementInput[]): boolean => {
    const points = elements.reduce((sum, e) => sum + pointCountOf(e), 0);
    const extra = Math.floor(points / LIMITS.pointsPerToken);
    if (extra === 0 || bucket.take(extra)) return true;
    rateLimited();
    return false;
  };

  // A transport-level error must not surface as an unhandled 'error' event.
  socket.on('error', (err) => console.error('Socket error:', err));

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
    if (rooms.leave(boardId, socket.id)) {
      socket.to(channel(boardId)).emit(SERVER_EVENTS.participantLeft, { clientId: socket.id });
    }
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
      // Also covers a rename: re-joining the same board updates the entry, and receivers upsert.
      const self = rooms.participant(boardId, socket.id);
      if (self) socket.to(channel(boardId)).emit(SERVER_EVENTS.participantJoined, self);
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
    CLIENT_EVENTS.elementAdd,
    guarded(elementAddPayload, (payload, boardId) => {
      if (!payForPoints([payload])) return;
      const element = unwrap(rooms.addElement(boardId, socket.id, payload));
      if (!element) return;
      socket.to(channel(boardId)).emit(SERVER_EVENTS.elementAdded, element);
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
    CLIENT_EVENTS.elementsAdd,
    guarded(elementsAddPayload, ({ elements }, boardId) => {
      if (!payForPoints(elements)) return;
      const result = unwrap(rooms.addElements(boardId, socket.id, elements));
      if (!result) return;
      if (result.added.length > 0) {
        socket.to(channel(boardId)).emit(SERVER_EVENTS.elementsAdded, { elements: result.added });
      }
      if (result.error) sendError(result.error.code, result.error.message);
    }),
  );

  socket.on(
    CLIENT_EVENTS.elementsUpdate,
    guarded(elementsUpdatePayload, ({ elements }, boardId) => {
      if (!payForPoints(elements)) return;
      const result = unwrap(rooms.updateElements(boardId, socket.id, elements));
      if (!result) return;
      if (result.updated.length > 0) {
        socket
          .to(channel(boardId))
          .emit(SERVER_EVENTS.elementsUpdated, { elements: result.updated });
      }
      if (result.error) sendError(result.error.code, result.error.message);
    }),
  );

  socket.on(
    CLIENT_EVENTS.elementsDelete,
    guarded(elementsDeletePayload, ({ ids }, boardId) => {
      const removed = unwrap(rooms.deleteElements(boardId, socket.id, ids));
      if (!removed || removed.length === 0) return;
      socket.to(channel(boardId)).emit(SERVER_EVENTS.elementsDeleted, { ids: removed });
    }),
  );

  socket.on(
    CLIENT_EVENTS.elementsReorder,
    guarded(elementsReorderPayload, ({ ids, to }, boardId) => {
      const moved = unwrap(rooms.reorderElements(boardId, socket.id, ids, to));
      if (!moved || moved.length === 0) return;
      socket.to(channel(boardId)).emit(SERVER_EVENTS.elementsReordered, { ids: moved, to });
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

  socket.on(
    CLIENT_EVENTS.cursorMove,
    guarded(cursorMovePayload, ({ point }, boardId) => {
      const result = rooms.moveCursor(boardId, socket.id, point);
      if (!result.ok) {
        sendError(result.error.code, result.error.message);
        return;
      }
      // Volatile: a stale cursor position is worthless, so drop it rather than queue it.
      socket
        .to(channel(boardId))
        .volatile.emit(SERVER_EVENTS.cursorMoved, { clientId: socket.id, point });
    }),
  );

  socket.on(
    CLIENT_EVENTS.laserMove,
    guarded(laserMovePayload, (payload, boardId) => {
      const result = rooms.pointLaser(boardId, socket.id);
      if (!result.ok) {
        sendError(result.error.code, result.error.message);
        return;
      }
      // Volatile like cursors: a trail fades within a second, so a late batch is worthless.
      socket
        .to(channel(boardId))
        .volatile.emit(SERVER_EVENTS.laserMoved, { ...payload, clientId: socket.id });
    }),
  );

  socket.on('disconnect', leaveCurrentRoom);
}
