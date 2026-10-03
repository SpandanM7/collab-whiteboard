# collab-whiteboard

A real-time collaborative whiteboard. Create a board, share the link, and draw together with live
cursors and presence. No account needed.

**Live demo:** _coming soon (placeholder, filled in at deploy)_

![Demo GIF](docs/demo.gif)
<!-- Placeholder: record a short two-window GIF and save it as docs/demo.gif -->

## Features

- Freehand pen and whole-stroke eraser, color picker, adjustable stroke width
- Real-time sync: remote strokes appear while they are being drawn
- Live cursors with name labels, plus a participant list (names are editable)
- Clear board (with confirmation), synced to everyone
- Share button that copies the board link (with a manual-copy fallback)
- Connection states (connecting / connected / reconnecting); drawing pauses while offline
- Automatic rejoin and full board state on reconnect
- Server-side validation, size limits and per-socket rate limiting
- Works with mouse, touch and pen (pointer events)

## Tech stack

- **Client:** React, Vite, TypeScript, HTML Canvas
- **Server:** Node.js, Socket.IO, TypeScript
- **Shared:** zod schemas and inferred types for the socket event contract
- **Tooling:** npm workspaces, Vitest, ESLint, Prettier

The server keeps boards in memory (no database); boards are lost when it restarts. See
[SPEC.md](SPEC.md) for the full spec and the socket event contract (section 8).

## Run locally

Requires Node.js 20.12 or newer.

```
npm install
```

Create the env files (see [Environment variables](#environment-variables)):

| Windows (PowerShell)                                                                   | macOS / Linux                                                              |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `Copy-Item server/.env.example server/.env; Copy-Item client/.env.example client/.env` | `cp server/.env.example server/.env && cp client/.env.example client/.env` |

Then start both server and client:

```
npm run dev
```

Open http://localhost:5173, click **New board**, and open the same link in a second tab or window.

Other commands: `npm test` (Vitest), `npm run build`, `npm run format`.
Install dependencies into one package with `npm install <pkg> -w server` (or `-w client`) from
the repo root.

## Environment variables

| Variable          | Where  | Example                 | Purpose                                      |
| ----------------- | ------ | ----------------------- | -------------------------------------------- |
| `VITE_SERVER_URL` | client | `http://localhost:3001` | Socket.IO server the client connects to      |
| `PORT`            | server | `3001`                  | Port the server listens on                   |
| `CLIENT_URL`      | server | `http://localhost:5173` | Allowed browser origin (CORS and WebSockets) |

Copy the `.env.example` files; never commit `.env`.

## Limits

Enforced by the server (`shared/src/limits.ts`): 200 points per message, 20,000 points per stroke,
5,000 elements per board, 10 participants per room, 200 boards in memory, and 100 events per
second per socket (burst of 150).

## Project structure

```
client/   React + Vite app (@whiteboard/client)
server/   Socket.IO server: rooms (state and rules), socket handlers, rate limiting
shared/   Event names, zod schemas, types and limits (@whiteboard/shared)
SPEC.md   Product spec and socket event contract
```

## Deployment

The client is a static site and the server is a long-running Node process, deployed separately.
Free-tier servers cold-start (up to about a minute), so the first connection can be slow; the
client shows a "Connecting to server" message while it waits. Deployment steps are added at
milestone M5.
