import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@whiteboard/shared';
import type { Config } from './config.ts';
import type { RateLimit } from './rateLimit.ts';
import { Rooms } from './rooms.ts';
import { DEFAULT_RATE_LIMIT, registerSocketHandlers } from './socket.ts';

/** Largest accepted socket message. A full 200-point batch is well under 10 KB. */
const MAX_MESSAGE_BYTES = 64 * 1024;

/** How often idle cursors are swept. Well under the TTL so they expire promptly. */
const CURSOR_SWEEP_INTERVAL_MS = 2_000;

export function createApp(config: Config, rateLimit: RateLimit = DEFAULT_RATE_LIMIT) {
  const httpServer = createServer();
  const rooms = new Rooms();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    cors: { origin: config.clientUrl },
    // CORS headers only protect HTTP long-polling; WebSocket upgrades ignore them. Browsers
    // always send Origin, so reject any browser connection from another site. Requests with
    // no Origin (non-browser clients) cannot be abused for cross-site attacks.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, origin === undefined || origin === config.clientUrl);
    },
  });

  io.on('connection', (socket) => registerSocketHandlers(socket, rooms, rateLimit));

  // Clients hide idle cursors on their own timer; this keeps stale ones out of room:state.
  const sweepTimer = setInterval(() => rooms.sweepStaleCursors(), CURSOR_SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  httpServer.on('close', () => clearInterval(sweepTimer));

  return { httpServer, io, rooms };
}
