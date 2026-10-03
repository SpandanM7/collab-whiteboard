import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { CLIENT_EVENTS, LIMITS, SERVER_EVENTS } from '@whiteboard/shared';
import type {
  ClientToServerEvents,
  ErrorCode,
  Point,
  ServerToClientEvents,
  Stroke,
} from '@whiteboard/shared';
import type { Identity } from '../lib/identity.ts';
import { boardReducer, initialBoardState } from './boardReducer.ts';
import { initialPresenceState, presenceReducer } from './presenceReducer.ts';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** How long local points are collected before being sent as one `stroke:points` message. */
const BATCH_INTERVAL_MS = 25;

/** Local cursor updates are sent at most this often (SPEC FR-4: about 30 to 60 ms). */
const CURSOR_INTERVAL_MS = 40;
/** How often idle remote cursors are checked for expiry. */
const CURSOR_EXPIRY_CHECK_MS = 1000;

/** Errors that are expected during a rejoin or a race between users: logged, not shown. */
const QUIET_ERRORS: ReadonlySet<ErrorCode> = new Set([
  'unknown_stroke',
  'duplicate_id',
  'not_in_room',
]);

/** Errors that mean we have no usable board at all, so the UI blocks instead of toasting. */
const JOIN_ERRORS: ReadonlySet<ErrorCode> = new Set(['room_full', 'server_full']);

export type Toast = { id: number; message: string };

const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;

export function useBoardSync(boardId: string, identity: Identity) {
  const [board, dispatch] = useReducer(boardReducer, initialBoardState);
  const [presence, dispatchPresence] = useReducer(presenceReducer, initialPresenceState);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  /** Why we cannot use this board at all (full room, bad config). Null while all is well. */
  const [blocked, setBlocked] = useState<string | null>(
    serverUrl ? null : 'VITE_SERVER_URL is not set. Copy client/.env.example to client/.env.',
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const toastIdRef = useRef(0);

  const socketRef = useRef<AppSocket | null>(null);
  /** True between receiving room:state and the next disconnect: the server knows about us. */
  const joinedRef = useRef(false);
  const pendingRef = useRef<{ id: string; points: Point[] } | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Latest identity, read when (re)joining so a reconnect uses the current name. */
  const identityRef = useRef(identity);
  const cursorRef = useRef<{
    latest: Point | null;
    lastSentAt: number;
    timer: ReturnType<typeof setTimeout> | undefined;
  }>({ latest: null, lastSentAt: 0, timer: undefined });

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
      // Fires on the first connection and on every reconnect: always (re)join the room.
      socket.emit(CLIENT_EVENTS.roomJoin, { boardId, ...identityRef.current });
    });

    // Sent on first join and again after every reconnect (and rename), replacing what we had.
    // Board and presence are replaced wholesale, so nothing is duplicated or left stale.
    socket.on(SERVER_EVENTS.roomState, ({ board: state, participants }) => {
      everConnected = true;
      joinedRef.current = true;
      dispatch({ type: 'reset', elements: state.elements });
      dispatchPresence({ type: 'reset', participants, selfId: socket.id, now: Date.now() });
      setStatus('connected');
      setBlocked(null);
    });

    socket.on('connect_error', () => {
      setStatus(everConnected ? 'reconnecting' : 'connecting');
    });

    socket.on('disconnect', (reason) => {
      joinedRef.current = false;
      pendingRef.current = null;
      // Nobody is verifiably present while we are offline; room:state brings the real list back.
      dispatchPresence({ type: 'reset', participants: [], selfId: undefined, now: Date.now() });
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
    socket.on(SERVER_EVENTS.participantJoined, (participant) => {
      dispatchPresence({ type: 'joined', participant, selfId: socket.id, now: Date.now() });
    });
    socket.on(SERVER_EVENTS.participantLeft, ({ clientId }) => {
      dispatchPresence({ type: 'left', clientId });
    });
    socket.on(SERVER_EVENTS.cursorMoved, ({ clientId, point }) => {
      dispatchPresence({ type: 'cursor', clientId, point, now: Date.now() });
    });
    socket.on(SERVER_EVENTS.error, ({ code, message }) => {
      console.warn(`Server error (${code}): ${message}`);
      if (JOIN_ERRORS.has(code)) setBlocked(message);
      else if (!QUIET_ERRORS.has(code)) setToast({ id: ++toastIdRef.current, message });
    });

    const expiryTimer = setInterval(
      () => dispatchPresence({ type: 'expire', now: Date.now() }),
      CURSOR_EXPIRY_CHECK_MS,
    );

    const cursor = cursorRef.current;
    return () => {
      clearInterval(expiryTimer);
      clearTimeout(cursor.timer);
      cursor.timer = undefined;
      cursor.latest = null;
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

  // Renaming re-sends room:join; the server updates our entry and tells everyone else.
  useEffect(() => {
    identityRef.current = identity;
    emitIfJoined((socket) => socket.emit(CLIENT_EVENTS.roomJoin, { boardId, ...identity }));
    // Only a name/color change should re-join; boardId changes recreate the socket instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.name, identity.color]);

  const sendCursor = useCallback(() => {
    const cursor = cursorRef.current;
    cursor.timer = undefined;
    const point = cursor.latest;
    cursor.latest = null;
    if (!point) return;
    cursor.lastSentAt = performance.now();
    emitIfJoined((socket) => socket.emit(CLIENT_EVENTS.cursorMove, { point }));
  }, [emitIfJoined]);

  /** The local pointer moved (board space). Throttled: at most one send per interval. */
  const moveCursor = useCallback(
    (point: Point) => {
      const cursor = cursorRef.current;
      cursor.latest = point;
      if (cursor.timer !== undefined) return;
      const wait = Math.max(0, CURSOR_INTERVAL_MS - (performance.now() - cursor.lastSentAt));
      cursor.timer = setTimeout(sendCursor, wait);
    },
    [sendCursor],
  );

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
    participants: presence.participants,
    cursors: presence.cursors,
    status,
    blocked,
    toast,
    dismissToast: useCallback(() => setToast(null), []),
    moveCursor,
    startStroke,
    addPoints,
    finishStroke,
    cancelStroke,
    deleteElements,
    clearBoard,
  };
}
