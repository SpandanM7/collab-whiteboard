import { createServer } from 'node:http';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@whiteboard/shared';
import type { Config } from './config.ts';
import { Rooms } from './rooms.ts';
import { registerSocketHandlers } from './socket.ts';

/** Largest accepted socket message. A full 200-point batch is well under 10 KB. */
const MAX_MESSAGE_BYTES = 64 * 1024;

export function createApp(config: Config) {
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

  io.on('connection', (socket) => registerSocketHandlers(socket, rooms));

  return { httpServer, io, rooms };
}
