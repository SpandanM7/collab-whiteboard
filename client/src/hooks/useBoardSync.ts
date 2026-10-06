import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { CLIENT_EVENTS, LIMITS, SERVER_EVENTS } from '@whiteboard/shared';
import type {
  BoardElement,
  ClientToServerEvents,
  ErrorCode,
  Point,
  ReorderTarget,
  ServerToClientEvents,
  Stroke,
} from '@whiteboard/shared';
import type { Identity } from '../lib/identity.ts';
import { PendingSync, takeFromOutbox } from '../lib/pendingSync.ts';
import type { Job, Outgoing, OutboxItem } from '../lib/pendingSync.ts';
import { boardReducer, initialBoardState } from './boardReducer.ts';
import { initialPresenceState, presenceReducer } from './presenceReducer.ts';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** How long local points are collected before being sent as one `stroke:points` message. */
const BATCH_INTERVAL_MS = 25;

/**
 * Sending queued work: at most this many rate-limit tokens per interval (about 50 per second).
 * The server allows 100 per second per socket, and live drawing and cursor updates share that.
 */
const OUTBOX_BATCH = 5;
const OUTBOX_INTERVAL_MS = 100;

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

export type Toast = { id: number; message: string; kind: 'error' | 'info' };

const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined;

function sendMessage(socket: AppSocket, message: Outgoing): void {
  switch (message.event) {
    case CLIENT_EVENTS.elementAdd:
      socket.emit(message.event, message.payload);
      break;
    case CLIENT_EVENTS.elementDelete:
      socket.emit(message.event, message.payload);
      break;
    case CLIENT_EVENTS.strokeStart:
      socket.emit(message.event, message.payload);
      break;
    case CLIENT_EVENTS.strokePoints:
      socket.emit(message.event, message.payload);
      break;
    case CLIENT_EVENTS.strokeEnd:
      socket.emit(message.event, message.payload);
      break;
    case CLIENT_EVENTS.elementsAdd:
      socket.emit(message.event, message.payload);
      break;
    case CLIENT_EVENTS.elementsUpdate:
      socket.emit(message.event, message.payload);
      break;
    case CLIENT_EVENTS.elementsDelete:
      socket.emit(message.event, message.payload);
      break;
    case CLIENT_EVENTS.elementsReorder:
      socket.emit(message.event, message.payload);
      break;
  }
}

/**
 * Board sync. Drawing never waits for the server: strokes made while not joined (still
 * connecting, or the connection dropped) stay on screen as pending work and are replayed after
 * the next `room:state`, merged with the server's board by stroke id (see `PendingSync`).
 */
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

  const [pendingSync] = useState(() => new PendingSync());
  /** Changes the server has not confirmed yet (drives the status pill and the unload warning). */
  const [unsynced, setUnsynced] = useState(0);
  /** Goes up whenever the board is cleared (by anyone), so undo history can be dropped. */
  const [clearCount, setClearCount] = useState(0);

  const socketRef = useRef<AppSocket | null>(null);
  /** True between receiving room:state and the next disconnect: the server knows about us. */
  const joinedRef = useRef(false);
  /** Counts socket connections; a new socket is a new author id as far as the server cares. */
  const connectionRef = useRef(0);
  /**
   * The local stroke being drawn. `connection` is the connection it was announced on, or null
   * when it began while not joined (the server has never heard of it).
   */
  const liveRef = useRef<{ id: string; connection: number | null } | null>(null);
  const pendingRef = useRef<{ id: string; points: Point[] } | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Replay queue: jobs being sent to the server, and how far into the current job we are. */
  const outboxRef = useRef<OutboxItem[]>([]);
  const outboxTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Latest identity, read when (re)joining so a reconnect uses the current name. */
  const identityRef = useRef(identity);
  const cursorRef = useRef<{
    latest: Point | null;
    lastSentAt: number;
    timer: ReturnType<typeof setTimeout> | undefined;
  }>({ latest: null, lastSentAt: 0, timer: undefined });

  const showToast = useCallback((message: string, kind: Toast['kind'] = 'error') => {
    setToast({ id: ++toastIdRef.current, message, kind });
  }, []);

  /** Whether the stroke being drawn is known to the server on the current connection. */
  const isLive = useCallback((id: string) => {
    const live = liveRef.current;
    return joinedRef.current && live?.id === id && live.connection === connectionRef.current;
  }, []);

  const flushPoints = useCallback(() => {
    clearTimeout(flushTimerRef.current);
    flushTimerRef.current = undefined;
    const pending = pendingRef.current;
    pendingRef.current = null;
    const socket = socketRef.current;
    if (!pending || !socket || !isLive(pending.id)) return;
    for (let i = 0; i < pending.points.length; i += LIMITS.maxPointsPerMessage) {
      socket.emit(CLIENT_EVENTS.strokePoints, {
        id: pending.id,
        points: pending.points.slice(i, i + LIMITS.maxPointsPerMessage),
      });
    }
  }, [isLive]);

  const resetOutbox = useCallback(() => {
    clearTimeout(outboxTimerRef.current);
    outboxTimerRef.current = undefined;
    outboxRef.current = [];
  }, []);

  /** Sends queued replay messages a few at a time. Pauses when not joined; room:state restarts it. */
  const drainOutbox = useCallback(
    function drain() {
      clearTimeout(outboxTimerRef.current);
      outboxTimerRef.current = undefined;
      const socket = socketRef.current;
      if (!socket || !joinedRef.current) return;

      const outbox = outboxRef.current;
      const { messages, finished } = takeFromOutbox(
        outbox,
        (job) => pendingSync.isActive(job),
        OUTBOX_BATCH,
      );
      for (const message of messages) sendMessage(socket, message);
      for (const job of finished) pendingSync.resolve(job);
      setUnsynced(pendingSync.size);
      if (outbox.length > 0) outboxTimerRef.current = setTimeout(drain, OUTBOX_INTERVAL_MS);
    },
    [pendingSync],
  );

  const startOutbox = useCallback(
    (jobs: Job[]) => {
      outboxRef.current = jobs.map((job) => ({ job, next: 0 }));
      drainOutbox();
    },
    [drainOutbox],
  );

  const enqueueJob = useCallback(
    (job: Job) => {
      outboxRef.current.push({ job, next: 0 });
      if (outboxTimerRef.current === undefined) drainOutbox();
    },
    [drainOutbox],
  );

  useEffect(() => {
    if (!serverUrl) return;

    const socket: AppSocket = io(serverUrl, { reconnectionDelayMax: 5000 });
    socketRef.current = socket;
    let everConnected = false;

    socket.on('connect', () => {
      connectionRef.current += 1;
      // Fires on the first connection and on every reconnect: always (re)join the room.
      socket.emit(CLIENT_EVENTS.roomJoin, { boardId, ...identityRef.current });
    });

    // Sent on first join and again after every reconnect (and rename), replacing what we had.
    // The server's board wins, with our unsynced work merged on top and replayed afterwards, so
    // nothing is duplicated, left stale, or lost.
    socket.on(SERVER_EVENTS.roomState, ({ board: state, participants }) => {
      everConnected = true;
      joinedRef.current = true;
      const { elements, jobs, dropped } = pendingSync.reconcile(state.elements);
      dispatch({ type: 'reset', elements });
      dispatchPresence({ type: 'reset', participants, selfId: socket.id, now: Date.now() });
      setStatus('connected');
      setBlocked(null);
      setUnsynced(pendingSync.size);
      startOutbox(jobs);
      if (dropped > 0) {
        showToast(
          `${dropped} of your offline ${dropped === 1 ? 'drawing' : 'drawings'} couldn't be saved ` +
            'because the board is full.',
        );
      }
    });

    socket.on('connect_error', () => {
      setStatus(everConnected ? 'reconnecting' : 'connecting');
    });

    socket.on('disconnect', (reason) => {
      joinedRef.current = false;
      pendingRef.current = null;
      // Unsent work stays in pendingSync; the next room:state plans its replay from scratch.
      resetOutbox();
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
    socket.on(SERVER_EVENTS.elementAdded, (element) => dispatch({ type: 'remote-add', element }));
    socket.on(SERVER_EVENTS.elementDeleted, ({ id }) => dispatch({ type: 'delete', ids: [id] }));
    socket.on(SERVER_EVENTS.elementsAdded, ({ elements }) =>
      dispatch({ type: 'add-many', elements }),
    );
    socket.on(SERVER_EVENTS.elementsUpdated, ({ elements }) =>
      dispatch({ type: 'update', elements }),
    );
    socket.on(SERVER_EVENTS.elementsDeleted, ({ ids }) => dispatch({ type: 'delete', ids }));
    socket.on(SERVER_EVENTS.elementsReordered, ({ ids, to }) =>
      dispatch({ type: 'reorder', ids, to }),
    );
    socket.on(SERVER_EVENTS.boardCleared, () => {
      // Whatever we had not uploaded yet was drawn before this clear; do not resurrect it.
      pendingSync.clear();
      resetOutbox();
      setUnsynced(0);
      setClearCount((n) => n + 1);
      dispatch({ type: 'clear' });
    });
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
      else if (!QUIET_ERRORS.has(code)) showToast(message);
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
      liveRef.current = null;
      joinedRef.current = false;
      // Pending work belongs to this board; another board must not receive it.
      pendingSync.clear();
      resetOutbox();
      setUnsynced(0);
      socketRef.current = null;
      socket.disconnect();
    };
  }, [boardId, pendingSync, resetOutbox, startOutbox, showToast]);

  // Closing the tab with unsynced work would lose it: let the browser ask first.
  useEffect(() => {
    if (unsynced === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsynced]);

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

  /** A local stroke began. It is already on screen; this tells everyone else, if we can. */
  const startStroke = useCallback(
    (stroke: Stroke) => {
      const joined = joinedRef.current;
      liveRef.current = { id: stroke.id, connection: joined ? connectionRef.current : null };
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
      // Not announced on this connection: the whole stroke is replayed when it is finished.
      if (!isLive(id)) return;
      if (pendingRef.current?.id !== id) flushPoints();
      const pending = (pendingRef.current ??= { id, points: [] });
      pending.points.push(...points);
      flushTimerRef.current ??= setTimeout(flushPoints, BATCH_INTERVAL_MS);
    },
    [flushPoints, isLive],
  );

  /** The local stroke was completed: keep it, and make sure the server ends up with all of it. */
  const finishStroke = useCallback(
    (stroke: Stroke) => {
      dispatch({ type: 'add-local', element: stroke });
      flushPoints();
      const live = liveRef.current?.id === stroke.id ? liveRef.current : null;
      const announcedHere = isLive(stroke.id);
      if (live) liveRef.current = null;

      if (announcedHere) {
        emitIfJoined((socket) => socket.emit(CLIENT_EVENTS.strokeEnd, { id: stroke.id }));
        return;
      }
      // Drawn offline, or the connection changed mid-stroke: replay it as a whole. A stroke that
      // was announced on an older connection may have left a partial copy on the server.
      const job = pendingSync.addStroke(stroke, live !== null && live.connection !== null);
      setUnsynced(pendingSync.size);
      if (joinedRef.current) enqueueJob(job);
    },
    [emitIfJoined, enqueueJob, flushPoints, isLive, pendingSync],
  );

  /** Hands a job to the outbox when joined; otherwise it waits for the next room:state. */
  const submit = useCallback(
    (job: Job) => {
      if (joinedRef.current) enqueueJob(job);
    },
    [enqueueJob],
  );

  /**
   * Finished elements: a shape or text just made, or something pasted, duplicated or restored by
   * undo. They are already on screen; each stays pending until sent, so a dropped connection
   * cannot lose it.
   */
  const addElements = useCallback(
    (elements: BoardElement[]) => {
      if (elements.length === 0) return;
      dispatch({ type: 'add-many', elements });
      for (const element of elements) {
        // Erased offline and brought back before the erase went out: the server still has it.
        const job = pendingSync.cancelDelete(element.id)
          ? pendingSync.update(element)
          : pendingSync.addElement(element);
        submit(job);
      }
      setUnsynced(pendingSync.size);
    },
    [pendingSync, submit],
  );

  /** New versions of elements on the board (moved, resized, restyled, text edited, undone). */
  const updateElements = useCallback(
    (elements: BoardElement[]) => {
      if (elements.length === 0) return;
      dispatch({ type: 'update', elements });
      for (const element of elements) submit(pendingSync.update(element));
      setUnsynced(pendingSync.size);
    },
    [pendingSync, submit],
  );

  /** Moves elements to the top or bottom of the stack, for everyone. */
  const reorderElements = useCallback(
    (ids: string[], to: ReorderTarget) => {
      if (ids.length === 0) return;
      dispatch({ type: 'reorder', ids, to });
      submit(pendingSync.queueReorder(ids, to));
      setUnsynced(pendingSync.size);
    },
    [pendingSync, submit],
  );

  /** The local stroke was cancelled (e.g. pointercancel): remove it everywhere. */
  const cancelStroke = useCallback(
    (id: string) => {
      flushPoints();
      const live = liveRef.current?.id === id ? liveRef.current : null;
      if (live) liveRef.current = null;
      if (joinedRef.current) {
        emitIfJoined((socket) => socket.emit(CLIENT_EVENTS.elementDelete, { id }));
      } else if (live !== null && live.connection !== null) {
        // Announced before the connection dropped: the server holds a partial copy to remove.
        pendingSync.queueDelete(id);
        setUnsynced(pendingSync.size);
      }
    },
    [emitIfJoined, flushPoints, pendingSync],
  );

  const deleteElements = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      dispatch({ type: 'delete', ids });
      const joined = joinedRef.current;
      if (joined) {
        // Sent straight away: removing the pending entries below cancels any queued add or
        // update of these ids, so nothing sent later can bring them back.
        emitIfJoined((socket) => {
          if (ids.length === 1) {
            socket.emit(CLIENT_EVENTS.elementDelete, { id: ids[0] });
            return;
          }
          for (let i = 0; i < ids.length; i += LIMITS.maxIdsPerMessage) {
            socket.emit(CLIENT_EVENTS.elementsDelete, {
              ids: ids.slice(i, i + LIMITS.maxIdsPerMessage),
            });
          }
        });
      }
      for (const id of ids) {
        const entry = pendingSync.removeElement(id);
        if (joined) continue;
        if (!entry || entry.onServer) {
          // The server may still hold it (a synced stroke, or a partial copy): erase it there
          // once we are back. A stroke the server never heard of needs nothing.
          pendingSync.queueDelete(id);
        }
      }
      setUnsynced(pendingSync.size);
    },
    [emitIfJoined, pendingSync],
  );

  /** Online only: replaying a clear later could wipe what others drew in the meantime. */
  const clearBoard = useCallback(() => {
    dispatch({ type: 'clear' });
    setClearCount((n) => n + 1);
    pendingSync.clear();
    resetOutbox();
    setUnsynced(0);
    emitIfJoined((socket) => socket.emit(CLIENT_EVENTS.boardClear, {}));
  }, [emitIfJoined, pendingSync, resetOutbox]);

  return {
    elements: board.committed,
    liveStrokes: board.live,
    participants: presence.participants,
    cursors: presence.cursors,
    status,
    blocked,
    unsynced,
    toast,
    showToast,
    dismissToast: useCallback(() => setToast(null), []),
    clearCount,
    moveCursor,
    startStroke,
    addPoints,
    finishStroke,
    addElements,
    updateElements,
    reorderElements,
    cancelStroke,
    deleteElements,
    clearBoard,
  };
}
