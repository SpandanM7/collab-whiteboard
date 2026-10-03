import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { CLIENT_EVENTS, LIMITS, SERVER_EVENTS } from '@whiteboard/shared';
import type { ClientToServerEvents, Point, ServerToClientEvents, Stroke } from '@whiteboard/shared';
import { boardReducer, initialBoardState } from './boardReducer.ts';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** How long local points are collected before being sent as one `stroke:points` message. */
const BATCH_INTERVAL_MS = 25;

/** Placeholder identity until M3 adds generated names and colors. */
const GUEST = { name: 'Guest', color: '#1a1a1a' };

const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;

export function useBoardSync(boardId: string) {
  const [board, dispatch] = useReducer(boardReducer, initialBoardState);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(
    serverUrl ? null : 'VITE_SERVER_URL is not set. Copy client/.env.example to client/.env.',
  );

  const socketRef = useRef<AppSocket | null>(null);
  /** True between receiving room:state and the next disconnect: the server knows about us. */
  const joinedRef = useRef(false);
  const pendingRef = useRef<{ id: string; points: Point[] } | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flushPoints = useCallback(() => {
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = undefined;
    const pending = pendingRef.current;
    pendingRef.current = null;
    const socket = socketRef.current;
    if (!pending || !socket || !joinedRef.current) return;
    for (let i = 0; i < pending.points.length; i += LIMITS.maxPointsPerMessage) {
      socket.emit(CLIENT_EVENTS.strokePoints, {
        id: pending.id,
        points: pending.points.slice(i, i + LIMITS.maxPointsPerMessage),
      });
    }
  }, []);

  useEffect(() => {
    if (!serverUrl) return;

    const socket: AppSocket = io(serverUrl, { reconnectionDelayMax: 5000 });
    socketRef.current = socket;
    let everConnected = false;

    socket.on('connect', () => {
      socket.emit(CLIENT_EVENTS.roomJoin, { boardId, ...GUEST });
    });

    // Sent on first join and again after every reconnect, replacing whatever we had.
    socket.on(SERVER_EVENTS.roomState, ({ board: state }) => {
      everConnected = true;
      joinedRef.current = true;
      dispatch({ type: 'reset', elements: state.elements });
      setStatus('connected');
      setError(null);
    });

    socket.on('connect_error', () => {
      setStatus(everConnected ? 'reconnecting' : 'connecting');
    });

    socket.on('disconnect', (reason) => {
      joinedRef.current = false;
      pendingRef.current = null;
      setStatus('reconnecting');
      // The server closed the connection on purpose; the client does not retry that by itself.
      if (reason === 'io server disconnect') socket.connect();
    });

    socket.on(SERVER_EVENTS.strokeStart, ({ id, authorId, color, width, point }) => {
      const stroke: Stroke = {
        id,
        type: 'stroke',
        authorId,
        color,
        width,
        points: [point],
        createdAt: Date.now(),
      };
      dispatch({ type: 'remote-start', stroke });
    });
    socket.on(SERVER_EVENTS.strokePoints, ({ id, points }) => {
      dispatch({ type: 'remote-points', id, points });
    });
    socket.on(SERVER_EVENTS.strokeEnd, ({ id }) => dispatch({ type: 'remote-end', id }));
    socket.on(SERVER_EVENTS.elementDeleted, ({ id }) => dispatch({ type: 'delete', ids: [id] }));
    socket.on(SERVER_EVENTS.boardCleared, () => dispatch({ type: 'clear' }));
    socket.on(SERVER_EVENTS.error, ({ code, message }) => {
      console.warn(`Server error (${code}): ${message}`);
      // Only join failures leave the user without a usable board; surface those.
      if (code === 'room_full' || code === 'server_full') setError(message);
    });

    return () => {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = undefined;
      pendingRef.current = null;
      joinedRef.current = false;
      socketRef.current = null;
      socket.disconnect();
    };
  }, [boardId]);

  const emitIfJoined = useCallback(<T>(send: (socket: AppSocket) => T): T | undefined => {
    const socket = socketRef.current;
    return socket && joinedRef.current ? send(socket) : undefined;
  }, []);

  /** A local stroke began. It is already on screen; this tells everyone else. */
  const startStroke = useCallback(
    (stroke: Stroke) => {
      emitIfJoined((socket) =>
        socket.emit(CLIENT_EVENTS.strokeStart, {
          id: stroke.id,
          color: stroke.color,
          width: stroke.width,
          point: stroke.points[0],
        }),
      );
    },
    [emitIfJoined],
  );

  /** Queues new points of the stroke being drawn; they go out in one batch every ~25 ms. */
  const addPoints = useCallback(
    (id: string, points: Point[]) => {
      if (pendingRef.current?.id !== id) flushPoints();
      const pending = (pendingRef.current ??= { id, points: [] });
      pending.points.push(...points);
      flushTimerRef.current ??= setTimeout(flushPoints, BATCH_INTERVAL_MS);
    },
    [flushPoints],
  );

  /** The local stroke was completed: keep it, and tell the server it is final. */
  const finishStroke = useCallback(
    (stroke: Stroke) => {
      dispatch({ type: 'add-local', stroke });
      flushPoints();
      emitIfJoined((socket) => socket.emit(CLIENT_EVENTS.strokeEnd, { id: stroke.id }));
    },
    [emitIfJoined, flushPoints],
  );

  /** The local stroke was cancelled (e.g. pointercancel): remove it everywhere. */
  const cancelStroke = useCallback(
    (id: string) => {
      flushPoints();
      emitIfJoined((socket) => socket.emit(CLIENT_EVENTS.elementDelete, { id }));
    },
    [emitIfJoined, flushPoints],
  );

  const deleteElements = useCallback(
    (ids: string[]) => {
      dispatch({ type: 'delete', ids });
      emitIfJoined((socket) => {
        for (const id of ids) socket.emit(CLIENT_EVENTS.elementDelete, { id });
      });
    },
    [emitIfJoined],
  );

  const clearBoard = useCallback(() => {
    dispatch({ type: 'clear' });
    emitIfJoined((socket) => socket.emit(CLIENT_EVENTS.boardClear, {}));
  }, [emitIfJoined]);

  return {
    strokes: board.committed,
    liveStrokes: board.live,
    status,
    error,
    startStroke,
    addPoints,
    finishStroke,
    cancelStroke,
    deleteElements,
    clearBoard,
  };
}
