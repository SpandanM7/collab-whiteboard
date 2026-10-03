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
- Pan and zoom, per person (an infinite canvas): wheel or trackpad, Space + drag, the Hand tool, two-finger drag and pinch on touch screens, zoom buttons, and Fit all. Markers at the screen edge point to people who are off screen; click one to jump to them
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

Mobile layout checks (phone, landscape phone, tablet, desktop; Playwright): run `npx playwright install chromium` once, then `npm run test:e2e -w client`. They start their own client on port 5199 and work without the server.
Install dependencies into one package with `npm install <pkg> -w server` (or `-w client`) from
the repo root.

## Environment variables

| Variable          | Where  | Example                 | Purpose                                  |
| ----------------- | ------ | ----------------------- | ---------------------------------------- |
| `VITE_SERVER_URL` | client | `http://localhost:3001` | Socket.IO server the client connects to  |
| `PORT`            | server | `3001`                  | Port the server listens on               |
| `CLIENT_URL`      | server | `http://localhost:5173` | Allowed browser origins, comma-separated |

Copy the `.env.example` files; never commit `.env`.

## Limits

Enforced by the server (`shared/src/limits.ts`), sized for a small free instance: 200 points per
message, 5,000 points per stroke, 2,000 elements and 100,000 points per board, 10 participants per
room, 30 boards in memory (an empty board is dropped after 6 hours idle), and 100 events per second
per socket (burst of 150).

## Project structure

```
client/   React + Vite app (@whiteboard/client)
server/   Socket.IO server: rooms (state and rules), socket handlers, rate limiting
shared/   Event names, zod schemas, types and limits (@whiteboard/shared)
SPEC.md   Product spec and socket event contract
```

## Deployment

The client is a static site on **Vercel** and the server is a long-running Node process on
**Render** (free plan). They live in one repo but deploy separately: each host only rebuilds when
files it depends on change.

| Changed in `main`                     | Vercel (client) | Render (server) |
| ------------------------------------- | --------------- | --------------- |
| `client/**` only                      | deploys         | skipped         |
| `server/**` only                      | skipped         | deploys         |
| `shared/**`, `package.json`, lockfile | deploys         | deploys         |

A server deploy restarts the process and **wipes every board** (they live in memory), so batch
server changes and avoid busy times. Client deploys never touch boards.

### Keep client and server compatible

The two sides go live minutes apart, and open browser tabs keep the old client until reloaded.
Every change to the socket contract (`shared/`) must work in both directions during that gap:

- Adding an event or an optional field: deploy the **server first**, then the client.
- Removing something: stop using it in the **client first**, then remove it from the server.
- Never rename or change the meaning of an event or field in one step: add the new one, migrate,
  and remove the old one in a later release.

### First-time setup

1. **Render (server).** Push the repo to GitHub. In Render choose _New > Blueprint_, pick the repo
   (it reads `render.yaml`), and when asked for `CLIENT_URL` enter a placeholder such as
   `https://example.com` for now. Create it, wait for the first deploy, and copy the service URL
   (`https://collab-whiteboard-server.onrender.com`). Open `<that URL>/health`: it should show
   `{"status":"ok"}` (the first request can take about a minute while the instance wakes).
2. **Vercel (client).** _Add New > Project_, import the same repo, and set **Root Directory** to
   `client` (leave _Include source files outside of the Root Directory_ on, so `shared/` is
   found). The framework is detected as Vite. Add the environment variable `VITE_SERVER_URL` with
   the Render URL (no trailing slash, `https://`) for **Production and Preview**, then deploy.
   If the first deployment shows as canceled/skipped, use _Redeploy_ once.
3. **Connect them.** In Render, set `CLIENT_URL` to the Vercel production URL (for example
   `https://collab-whiteboard.vercel.app`). To allow preview deployments and a custom domain, list
   several origins separated by commas; a `*` inside the hostname matches one label:
   `https://whiteboard.example.com,https://collab-whiteboard-*-yourteam.vercel.app`. Saving the
   variable redeploys the server.
4. **Check it.** Open the Vercel URL in two browsers, create a board, open the board link in the
   second one, and draw. Reload a board URL directly (it must not 404). Stop and restart the
   server from the Render dashboard to see the reconnect behaviour.
5. **Gate deploys on CI (recommended).** In Render, set _Auto-Deploy_ to _After CI checks pass_
   (`.github/workflows/ci.yml` runs typecheck, lint, tests and build). In Vercel, enable _Deployment
   Checks_ for the production branch if your plan has them.

### Things to know on the free plan

- The server **sleeps after 15 minutes without traffic** and takes about a minute to wake. The
  client shows a "Connecting to the server" banner and lets people draw meanwhile; their strokes
  sync and merge once the server is up. An open tab counts as traffic and keeps the server awake,
  which uses the monthly instance-hour allowance.
- Boards are **in memory only**. A restart, redeploy or crash empties them; the client keeps
  working and re-uploads whatever the user drew while offline, but boards that were already synced
  are gone. Tell users that boards are temporary.
- `VITE_SERVER_URL` is read at build time: after changing it in Vercel, redeploy the client.
- Environment changes do not redeploy by themselves on Vercel; Render redeploys when you save them.
