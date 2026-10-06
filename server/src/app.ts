import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@whiteboard/shared';
import type { Config } from './config.ts';
import { originMatcher } from './origins.ts';
import type { RateLimit } from './rateLimit.ts';
import { Rooms } from './rooms.ts';
import { DEFAULT_RATE_LIMIT, registerSocketHandlers } from './socket.ts';

/**
 * Largest accepted socket message. The biggest legitimate one is a single full stroke (5,000
 * points, coordinates rounded to 0.01) in an element batch: about 170 KB.
 */
const MAX_MESSAGE_BYTES = 256 * 1024;

/** How often idle cursors are swept. Well under the TTL so they expire promptly. */
const CURSOR_SWEEP_INTERVAL_MS = 2_000;

/** How often boards nobody has used for a while are dropped to free memory. */
const BOARD_SWEEP_INTERVAL_MS = 60_000;

export function createApp(config: Config, rateLimit: RateLimit = DEFAULT_RATE_LIMIT) {
  // Plain HTTP only answers the host's health check; everything else is the socket server's.
  const httpServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url?.split('?')[0] === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end('{"status":"ok"}');
      return;
    }
    res.writeHead(404).end();
  });
  const rooms = new Rooms();
  const isAllowedOrigin = originMatcher(config.clientOrigins);

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    cors: {
      origin: (origin, callback) => callback(null, origin !== undefined && isAllowedOrigin(origin)),
    },
    // CORS headers only protect HTTP long-polling; WebSocket upgrades ignore them. Browsers
    // always send Origin, so reject any browser connection from another site. Requests with
    // no Origin (non-browser clients) cannot be abused for cross-site attacks.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, origin === undefined || isAllowedOrigin(origin));
    },
  });

  io.on('connection', (socket) => registerSocketHandlers(socket, rooms, rateLimit));

  // Clients hide idle cursors on their own timer; this keeps stale ones out of room:state.
  const sweepTimer = setInterval(() => rooms.sweepStaleCursors(), CURSOR_SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  // Boards are kept after everyone leaves, but not forever: memory on a small host is finite.
  const boardTimer = setInterval(() => rooms.evictIdleBoards(), BOARD_SWEEP_INTERVAL_MS);
  boardTimer.unref();
  httpServer.on('close', () => {
    clearInterval(sweepTimer);
    clearInterval(boardTimer);
  });

  return { httpServer, io, rooms };
}
