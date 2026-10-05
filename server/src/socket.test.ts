import type { AddressInfo } from 'node:net';
import { io as connect } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, LIMITS, SERVER_EVENTS } from '@whiteboard/shared';
import type {
  BoardElement,
  ClientToServerEvents,
  ElementAddedPayload,
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
  app = createApp({ port: 0, clientOrigins: ['http://localhost:5173'] }, rateLimit);
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

const pointsOf = (element?: BoardElement) => (element?.type === 'stroke' ? element.points : []);

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

describe('replaying an unsynced stroke', () => {
  beforeEach(() => start());

  it('replaces the partial copy left by a dropped author, for everyone', async () => {
    const watcher = await join('Wes');
    const ann = await join('Ann');
    const id = 'stroke-1';
    const p = (x: number) => ({ x, y: 0 });
    const base = { id, color: '#000000', width: 4 };

    ann.client.emit(CLIENT_EVENTS.strokeStart, { ...base, point: p(0) });
    const sawPoints = next(watcher.client, SERVER_EVENTS.strokePoints);
    ann.client.emit(CLIENT_EVENTS.strokePoints, { id, points: [p(1)] });
    await sawPoints;
    ann.client.disconnect();

    // Ann comes back as a new socket and replays the whole stroke.
    const again = await join('Ann');
    expect(pointsOf(again.state.board.elements[0])).toHaveLength(2);
    const ended = next(watcher.client, SERVER_EVENTS.strokeEnd);
    again.client.emit(CLIENT_EVENTS.elementDelete, { id });
    again.client.emit(CLIENT_EVENTS.strokeStart, { ...base, point: p(0) });
    again.client.emit(CLIENT_EVENTS.strokePoints, { id, points: [p(1), p(2), p(3)] });
    again.client.emit(CLIENT_EVENTS.strokeEnd, { id });
    await ended;

    const late = await join('Cy');
    expect(late.state.board.elements).toHaveLength(1);
    expect(pointsOf(late.state.board.elements[0])).toHaveLength(4);
  });
});

describe('element:add', () => {
  beforeEach(() => start());

  const shape = {
    id: 'shape-1',
    type: 'ellipse' as const,
    color: '#112233',
    width: 3,
    fill: '#ffeecc',
    start: { x: 0, y: 0 },
    end: { x: 40, y: 20 },
  };

  it('relays the stored shape to others (not the sender) and restores it for later joiners', async () => {
    const a = await join('Ann');
    const b = await join('Bob');
    let echoed = false;
    a.client.on(SERVER_EVENTS.elementAdded, () => (echoed = true));

    const relayed = next<ElementAddedPayload>(b.client, SERVER_EVENTS.elementAdded);
    a.client.emit(CLIENT_EVENTS.elementAdd, shape);
    expect(await relayed).toMatchObject({ ...shape, authorId: a.client.id });

    const late = await join('Cy');
    expect(late.state.board.elements).toMatchObject([shape]);
    expect(echoed).toBe(false);
  });

  it('ignores an authorId sent by the client', async () => {
    const a = await join('Ann');
    const b = await join('Bob');
    const relayed = next<ElementAddedPayload>(b.client, SERVER_EVENTS.elementAdded);
    (a.client as Socket).emit(CLIENT_EVENTS.elementAdd, { ...shape, authorId: 'someone-else' });
    expect((await relayed).authorId).toBe(a.client.id);
  });

  it.each([
    ['unknown type', { ...shape, type: 'trapezoid' }],
    ['bad color', { ...shape, color: 'red' }],
    ['coordinate out of range', { ...shape, end: { x: 1e9, y: 0 } }],
    ['missing end point', { ...shape, end: undefined }],
  ])('rejects %s without relaying it', async (_label, payload) => {
    const a = await join('Ann');
    const b = await join('Bob');
    let relayed = false;
    b.client.on(SERVER_EVENTS.elementAdded, () => (relayed = true));
    const error = next<ErrorPayload>(a.client, SERVER_EVENTS.error);
    (a.client as Socket).emit(CLIENT_EVENTS.elementAdd, payload);
    expect((await error).code).toBe('invalid_payload');
    await sleep(50);
    expect(relayed).toBe(false);
  });
});

describe('http', () => {
  beforeEach(() => start());

  it('answers /health for the host and 404s everything else', async () => {
    const ok = await fetch(`${url}/health`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: 'ok' });
    expect((await fetch(`${url}/`)).status).toBe(404);
  });

  it('still serves the socket handshake next to the health route', async () => {
    const { state } = await join('Ann');
    expect(state.board.id).toBe(BOARD);
  });
});

describe('origin check', () => {
  async function tryConnect(origin: string | undefined, origins: string[]) {
    app = createApp({ port: 0, clientOrigins: origins });
    await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
    url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
    const client: Client = connect(url, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: origin ? { Origin: origin } : {},
    });
    clients.push(client);
    return new Promise<boolean>((resolve) => {
      client.on('connect', () => resolve(true));
      client.on('connect_error', () => resolve(false));
    });
  }

  it('accepts any configured origin, including a preview pattern', async () => {
    const origins = ['https://app.example.com', 'https://wb-*-team.vercel.app'];
    expect(await tryConnect('https://wb-git-fix-team.vercel.app', origins)).toBe(true);
  });

  it('rejects other browser origins but allows clients that send no Origin', async () => {
    expect(await tryConnect('https://evil.example.com', ['https://app.example.com'])).toBe(false);
  });
});
