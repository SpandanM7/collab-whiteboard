import { CLIENT_EVENTS, LIMITS } from '@whiteboard/shared';
import type {
  ElementDeletePayload,
  Stroke,
  StrokeEndPayload,
  StrokePointsPayload,
  StrokeStartPayload,
} from '@whiteboard/shared';

/**
 * Work done while the socket was not joined (or on a connection that has since dropped), kept so
 * it can be replayed once the server is reachable. Pure state and rules, no sockets: the hook
 * paces and sends what this produces, and the replay uses only the existing event contract.
 *
 * Two kinds of work are pending:
 * - strokes the server has not fully received (drawn offline, or cut off by a disconnect), and
 * - erases of strokes the server may still hold.
 * Clearing the board is never queued: replaying it later could wipe other people's new work.
 */

/** One socket emit, as data so it can be paced by the hook and inspected by tests. */
export type Outgoing =
  | { event: typeof CLIENT_EVENTS.elementDelete; payload: ElementDeletePayload }
  | { event: typeof CLIENT_EVENTS.strokeStart; payload: StrokeStartPayload }
  | { event: typeof CLIENT_EVENTS.strokePoints; payload: StrokePointsPayload }
  | { event: typeof CLIENT_EVENTS.strokeEnd; payload: StrokeEndPayload };

/** The messages that bring one pending item up to date on the server, in order. */
export type Job = { kind: 'stroke' | 'delete'; id: string; messages: Outgoing[] };

export type Reconciled = {
  /** What the board should show: the server's elements plus the pending work on top. */
  elements: Stroke[];
  /** What to send so the server catches up with `elements`. */
  jobs: Job[];
  /** Pending strokes given up on because the board is full. */
  dropped: number;
};

/** Cuts a stroke to what the server accepts, so one huge stroke cannot be rejected as a whole. */
function limitStroke(stroke: Stroke): Stroke {
  return stroke.points.length > LIMITS.maxPointsPerStroke
    ? { ...stroke, points: stroke.points.slice(0, LIMITS.maxPointsPerStroke) }
    : stroke;
}

/**
 * Messages that (re)draw a whole stroke as a new author. `replaceServerCopy` first deletes the
 * id on the server, for a truncated copy left by a socket that dropped mid-stroke: only the
 * original author could extend it, and that socket is gone.
 */
export function strokeJob(stroke: Stroke, replaceServerCopy: boolean): Job {
  const { id, color, width, points } = stroke;
  const messages: Outgoing[] = [];
  const [first, ...rest] = points;
  if (!first) return { kind: 'stroke', id, messages };

  if (replaceServerCopy) messages.push({ event: CLIENT_EVENTS.elementDelete, payload: { id } });
  messages.push({ event: CLIENT_EVENTS.strokeStart, payload: { id, color, width, point: first } });
  for (let i = 0; i < rest.length; i += LIMITS.maxPointsPerMessage) {
    messages.push({
      event: CLIENT_EVENTS.strokePoints,
      payload: { id, points: rest.slice(i, i + LIMITS.maxPointsPerMessage) },
    });
  }
  messages.push({ event: CLIENT_EVENTS.strokeEnd, payload: { id } });
  return { kind: 'stroke', id, messages };
}

type Entry = { stroke: Stroke; onServer: boolean };

export class PendingSync {
  /** Insertion order is drawing order. */
  private readonly strokes = new Map<string, Entry>();
  private readonly deletes = new Set<string>();

  /** How many changes the server has not confirmed yet. */
  get size(): number {
    return this.strokes.size + this.deletes.size;
  }

  /**
   * Remembers a finished stroke the server does not fully have. `onServer` is true when it was
   * started on a connection that has since dropped, so the server may hold a partial copy.
   * Returns the job to send right away if the socket is currently joined.
   */
  addStroke(stroke: Stroke, onServer: boolean): Job {
    this.strokes.set(stroke.id, { stroke, onServer });
    return strokeJob(limitStroke(stroke), onServer);
  }

  /** The user erased `id`. Returns the pending entry, if the stroke was one. */
  removeStroke(id: string): { onServer: boolean } | undefined {
    const entry = this.strokes.get(id);
    this.strokes.delete(id);
    return entry && { onServer: entry.onServer };
  }

  /** Remembers an erase of a stroke the server may still hold, to send once joined. */
  queueDelete(id: string): void {
    this.deletes.add(id);
  }

  /** Whether a job still has to be sent (it may have been erased or cleared meanwhile). */
  isActive(job: Job): boolean {
    return job.kind === 'stroke' ? this.strokes.has(job.id) : this.deletes.has(job.id);
  }

  /** The job's last message went out: the item is no longer pending. */
  resolve(job: Job): void {
    if (job.kind === 'stroke') this.strokes.delete(job.id);
    else this.deletes.delete(job.id);
  }

  clear(): void {
    this.strokes.clear();
    this.deletes.clear();
  }

  /**
   * Merges pending work with the server's authoritative elements (a `room:state`). Nothing is
   * duplicated, because ids are stable: a stroke the server already has in full counts as
   * synced, a truncated copy is replaced, and anything missing is replayed on top.
   */
  reconcile(serverElements: Stroke[]): Reconciled {
    const serverById = new Map(serverElements.map((element) => [element.id, element]));
    const jobs: Job[] = [];

    // Erases made while offline. An id the server no longer has (e.g. after a restart or
    // someone else erased it first) needs nothing.
    for (const id of [...this.deletes]) {
      if (serverById.has(id)) {
        jobs.push({
          kind: 'delete',
          id,
          messages: [{ event: CLIENT_EVENTS.elementDelete, payload: { id } }],
        });
      } else {
        this.deletes.delete(id);
      }
    }

    let count = serverElements.length - this.deletes.size;
    const replayed: Stroke[] = [];
    const replaced = new Set<string>();
    let dropped = 0;

    for (const [id, { stroke }] of [...this.strokes]) {
      const copy = serverById.get(id);
      if (copy && copy.points.length >= stroke.points.length) {
        this.strokes.delete(id); // the server already has all of it
        continue;
      }
      if (!copy && count >= LIMITS.maxElementsPerBoard) {
        this.strokes.delete(id);
        dropped++;
        continue;
      }
      const limited = limitStroke(stroke);
      jobs.push(strokeJob(limited, copy !== undefined));
      replayed.push(limited);
      if (copy) replaced.add(id);
      else count++;
    }

    const elements = serverElements
      .filter((element) => !this.deletes.has(element.id) && !replaced.has(element.id))
      .concat(replayed);
    return { elements, jobs, dropped };
  }
}
