import type { AddressInfo } from 'node:net';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, LIMITS, SERVER_EVENTS } from '@whiteboard/shared';
import type {
  ClientToServerEvents,
  ErrorPayload,
  RoomStatePayload,
  ServerToClientEvents,
} from '@whiteboard/shared';
import { createApp } from './app.ts';
import type { RateLimit } from './rateLimit.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const BOARD = 'board-abcdef';
const identity = (name: string) => ({ boardId: BOARD, name, color: '#112233' });

let app: ReturnType<typeof createApp>;
let clients: Client[] = [];
let url = '';

async function start(rateLimit?: RateLimit) {
  app = createApp({ port: 0, clientUrl: 'http://localhost:5173' }, rateLimit);
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
}

/** Connects and joins the board, resolving with the room:state the server sends back. */
async function join(name: string): Promise<{ client: Client; state: RoomStatePayload }> {
  const client: Client = connect(url, { transports: ['websocket'], reconnection: false });
  clients.push(client);
  const state = new Promise<RoomStatePayload>((resolve) =>
    client.once(SERVER_EVENTS.roomState, resolve),
  );
  client.on('connect', () => client.emit(CLIENT_EVENTS.roomJoin, identity(name)));
  return { client, state: await state };
}

const next = <T>(client: Client, event: keyof ServerToClientEvents) =>
  new Promise<T>((resolve) => (client as Socket).once(event, resolve));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
  for (const c of clients) c.disconnect();
  clients = [];
  await new Promise((resolve) => app.io.close(resolve));
});

describe('board:clear', () => {
  beforeEach(() => start());

  it('empties the board for everyone and for later joiners', async () => {
    const a = await join('Ann');
    const b = await join('Bob');

    a.client.emit(CLIENT_EVENTS.strokeStart, {
      id: 'stroke-1',
      color: '#000000',
      width: 4,
      point: { x: 1, y: 2 },
    });
    await next(b.client, SERVER_EVENTS.strokeStart);
    a.client.emit(CLIENT_EVENTS.strokeEnd, { id: 'stroke-1' });
    await next(b.client, SERVER_EVENTS.strokeEnd);

    const cleared = next(b.client, SERVER_EVENTS.boardCleared);
    a.client.emit(CLIENT_EVENTS.boardClear, {});
    await cleared;

    const late = await join('Cy');
    expect(late.state.board.elements).toEqual([]);
  });

  it('is rejected from a socket that has not joined a board', async () => {
    const client: Client = connect(url, { transports: ['websocket'], reconnection: false });
    clients.push(client);
    const error = next<ErrorPayload>(client, SERVER_EVENTS.error);
    client.on('connect', () => client.emit(CLIENT_EVENTS.boardClear, {}));
    expect((await error).code).toBe('not_in_room');
  });
});

describe('validation', () => {
  beforeEach(() => start());

  it('answers bad payloads with an error and keeps serving the socket', async () => {
    const { client } = await join('Ann');
    const bad: unknown[] = [
      null,
      'nope',
      { id: 'x', points: [] },
      {
        id: 'x',
        points: Array.from({ length: LIMITS.maxPointsPerMessage + 1 }, () => ({ x: 0, y: 0 })),
      },
      { id: '../etc', points: [{ x: 0, y: 0 }] },
      { id: 'x', points: [{ x: Infinity, y: 0 }] },
    ];
    for (const payload of bad) {
      const error = next<ErrorPayload>(client, SERVER_EVENTS.error);
      (client as Socket).emit(CLIENT_EVENTS.strokePoints, payload);
      expect((await error).code).toBe('invalid_payload');
    }

    // Still alive: a valid event is accepted afterwards.
    const error = next<ErrorPayload>(client, SERVER_EVENTS.error);
    client.emit(CLIENT_EVENTS.strokeEnd, { id: 'never-started' });
    expect((await error).code).toBe('unknown_stroke');
  });

  it('rejects an eleventh participant with room_full', async () => {
    for (let i = 0; i < LIMITS.maxRoomSize; i++) await join(`User ${i}`);
    const extra: Client = connect(url, { transports: ['websocket'], reconnection: false });
    clients.push(extra);
    const error = next<ErrorPayload>(extra, SERVER_EVENTS.error);
    extra.on('connect', () => extra.emit(CLIENT_EVENTS.roomJoin, identity('Late')));
    expect((await error).code).toBe('room_full');
  });
});

describe('rate limiting', () => {
  beforeEach(() => start({ burst: 5, perSecond: 1 }));

  it('drops events over the limit and sends one rate_limited error', async () => {
    const { client } = await join('Ann'); // the join itself used one token
    const errors: ErrorPayload[] = [];
    client.on(SERVER_EVENTS.error, (e) => errors.push(e));

    for (let i = 0; i < 30; i++) client.emit(CLIENT_EVENTS.cursorMove, { point: { x: i, y: i } });
    await sleep(200);

    expect(errors.filter((e) => e.code === 'rate_limited')).toHaveLength(1);
    // Other sockets are unaffected: each socket has its own bucket.
    const other = await join('Bob');
    expect(other.state.participants).toHaveLength(2);
  });

  it('does not drop cursor moves that stay under the limit', async () => {
    const a = await join('Ann');
    const b = await join('Bob');
    const moved = next(b.client, SERVER_EVENTS.cursorMoved);
    a.client.emit(CLIENT_EVENTS.cursorMove, { point: { x: 5, y: 5 } });
    await moved;
  });
});
