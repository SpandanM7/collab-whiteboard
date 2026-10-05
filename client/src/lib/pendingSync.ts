import { CLIENT_EVENTS, LIMITS } from '@whiteboard/shared';
import type {
  BoardElement,
  ElementAddPayload,
  ElementDeletePayload,
  Shape,
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
 * - elements the server has not fully received (strokes and shapes drawn offline, or a stroke cut
 *   off by a disconnect), and
 * - erases of elements the server may still hold.
 * Clearing the board is never queued: replaying it later could wipe other people's new work.
 */

/** One socket emit, as data so it can be paced by the hook and inspected by tests. */
export type Outgoing =
  | { event: typeof CLIENT_EVENTS.elementAdd; payload: ElementAddPayload }
  | { event: typeof CLIENT_EVENTS.elementDelete; payload: ElementDeletePayload }
  | { event: typeof CLIENT_EVENTS.strokeStart; payload: StrokeStartPayload }
  | { event: typeof CLIENT_EVENTS.strokePoints; payload: StrokePointsPayload }
  | { event: typeof CLIENT_EVENTS.strokeEnd; payload: StrokeEndPayload };

/** The messages that bring one pending item up to date on the server, in order. */
export type Job = { kind: 'stroke' | 'shape' | 'delete'; id: string; messages: Outgoing[] };

export type Reconciled = {
  /** What the board should show: the server's elements plus the pending work on top. */
  elements: BoardElement[];
  /** What to send so the server catches up with `elements`. */
  jobs: Job[];
  /** Pending strokes and shapes given up on because the board is full. */
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

/** A shape goes out as one message, so unlike a stroke it is never left half-sent. */
export function shapeJob(shape: Shape): Job {
  // The server sets the author and the time; everything else (style included) is sent as is.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the payload
  const { authorId, createdAt, ...payload } = shape;
  return {
    kind: 'shape',
    id: shape.id,
    messages: [{ event: CLIENT_EVENTS.elementAdd, payload }],
  };
}

type Entry = { element: BoardElement; onServer: boolean };

export class PendingSync {
  /** Insertion order is drawing order. */
  private readonly elements = new Map<string, Entry>();
  private readonly deletes = new Set<string>();

  /** How many changes the server has not confirmed yet. */
  get size(): number {
    return this.elements.size + this.deletes.size;
  }

  /**
   * Remembers a finished stroke the server does not fully have. `onServer` is true when it was
   * started on a connection that has since dropped, so the server may hold a partial copy.
   * Returns the job to send right away if the socket is currently joined.
   */
  addStroke(stroke: Stroke, onServer: boolean): Job {
    this.elements.set(stroke.id, { element: stroke, onServer });
    return strokeJob(limitStroke(stroke), onServer);
  }

  /** Remembers a finished shape the server does not have. Returns the job to send if joined. */
  addShape(shape: Shape): Job {
    this.elements.set(shape.id, { element: shape, onServer: false });
    return shapeJob(shape);
  }

  /** The user erased `id`. Returns the pending entry, if the element was one. */
  removeElement(id: string): { onServer: boolean } | undefined {
    const entry = this.elements.get(id);
    this.elements.delete(id);
    return entry && { onServer: entry.onServer };
  }

  /** Remembers an erase of a stroke the server may still hold, to send once joined. */
  queueDelete(id: string): void {
    this.deletes.add(id);
  }

  /** Whether a job still has to be sent (it may have been erased or cleared meanwhile). */
  isActive(job: Job): boolean {
    return job.kind === 'delete' ? this.deletes.has(job.id) : this.elements.has(job.id);
  }

  /** The job's last message went out: the item is no longer pending. */
  resolve(job: Job): void {
    if (job.kind === 'delete') this.deletes.delete(job.id);
    else this.elements.delete(job.id);
  }

  clear(): void {
    this.elements.clear();
    this.deletes.clear();
  }

  /**
   * Merges pending work with the server's authoritative elements (a `room:state`). Nothing is
   * duplicated, because ids are stable: an element the server already has in full counts as
   * synced, a truncated stroke copy is replaced, and anything missing is replayed on top.
   */
  reconcile(serverElements: BoardElement[]): Reconciled {
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
    const replayed: BoardElement[] = [];
    const replaced = new Set<string>();
    let dropped = 0;

    for (const [id, { element }] of [...this.elements]) {
      const copy = serverById.get(id);
      // Only a stroke can be partial on the server; anything else it holds is whole.
      const complete =
        copy !== undefined &&
        (element.type !== 'stroke' ||
          (copy.type === 'stroke' && copy.points.length >= element.points.length));
      if (complete) {
        this.elements.delete(id); // the server already has all of it
        continue;
      }
      if (!copy && count >= LIMITS.maxElementsPerBoard) {
        this.elements.delete(id);
        dropped++;
        continue;
      }
      if (element.type === 'stroke') {
        const limited = limitStroke(element);
        jobs.push(strokeJob(limited, copy !== undefined));
        replayed.push(limited);
        if (copy) replaced.add(id);
      } else {
        jobs.push(shapeJob(element));
        replayed.push(element);
      }
      if (!copy) count++;
    }

    const elements = serverElements
      .filter((element) => !this.deletes.has(element.id) && !replaced.has(element.id))
      .concat(replayed);
    return { elements, jobs, dropped };
  }
}
