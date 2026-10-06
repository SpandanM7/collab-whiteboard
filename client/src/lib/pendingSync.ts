import { CLIENT_EVENTS, LIMITS, pointCountOf, toElementInput } from '@whiteboard/shared';
import type {
  BoardElement,
  ElementAddPayload,
  ElementDeletePayload,
  ElementsAddPayload,
  ElementsDeletePayload,
  ElementsReorderPayload,
  ElementsUpdatePayload,
  ReorderTarget,
  Stroke,
  StrokeEndPayload,
  StrokePointsPayload,
  StrokeStartPayload,
} from '@whiteboard/shared';

/**
 * Work the server has not confirmed yet, kept so it can be (re)sent once the server is reachable.
 * Pure state and rules, no sockets: the hook paces and sends what this produces, and the replay
 * uses only the existing event contract.
 *
 * Kinds of pending work:
 * - elements the server does not fully have (drawn, pasted or restored while offline, or a stroke
 *   cut off by a disconnect): replayed as new elements;
 * - newer versions of elements the server has (moved, resized, restyled, edited): replayed as
 *   updates, unless someone deleted the element meanwhile;
 * - erases of elements the server may still hold, and stacking-order changes.
 * Clearing the board is never queued: replaying it later could wipe other people's new work.
 */

/** One socket emit, as data so it can be paced by the hook and inspected by tests. */
export type Outgoing =
  | { event: typeof CLIENT_EVENTS.elementAdd; payload: ElementAddPayload }
  | { event: typeof CLIENT_EVENTS.elementDelete; payload: ElementDeletePayload }
  | { event: typeof CLIENT_EVENTS.elementsAdd; payload: ElementsAddPayload }
  | { event: typeof CLIENT_EVENTS.elementsUpdate; payload: ElementsUpdatePayload }
  | { event: typeof CLIENT_EVENTS.elementsDelete; payload: ElementsDeletePayload }
  | { event: typeof CLIENT_EVENTS.elementsReorder; payload: ElementsReorderPayload }
  | { event: typeof CLIENT_EVENTS.strokeStart; payload: StrokeStartPayload }
  | { event: typeof CLIENT_EVENTS.strokePoints; payload: StrokePointsPayload }
  | { event: typeof CLIENT_EVENTS.strokeEnd; payload: StrokeEndPayload };

/** The messages that bring one pending item up to date on the server, in order. */
export type Job = {
  kind: 'stroke' | 'add' | 'update' | 'delete' | 'reorder';
  id: string;
  messages: Outgoing[];
};

export type Reconciled = {
  /** What the board should show: the server's elements plus the pending work on top. */
  elements: BoardElement[];
  /** What to send so the server catches up with `elements`. */
  jobs: Job[];
  /** Pending new elements given up on because the board is full. */
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

/**
 * A finished element (shape, text, or complete stroke) goes out as one message, so unlike a
 * streamed stroke it is never left half-sent. The server sets the author and the time.
 */
export function addJob(element: BoardElement): Job {
  return {
    kind: 'add',
    id: element.id,
    messages: [{ event: CLIENT_EVENTS.elementAdd, payload: toElementInput(element) }],
  };
}

/** A newer version of an element the server has. */
export function updateJob(element: BoardElement): Job {
  return {
    kind: 'update',
    id: element.id,
    messages: [
      { event: CLIENT_EVENTS.elementsUpdate, payload: { elements: [toElementInput(element)] } },
    ],
  };
}

function deleteJob(id: string): Job {
  return {
    kind: 'delete',
    id,
    messages: [{ event: CLIENT_EVENTS.elementDelete, payload: { id } }],
  };
}

function reorderJob(key: string, ids: string[], to: ReorderTarget): Job {
  return {
    kind: 'reorder',
    id: key,
    messages: [{ event: CLIENT_EVENTS.elementsReorder, payload: { ids, to } }],
  };
}

/** Moves `ids` to the top or bottom of `elements`, keeping their relative order. */
export function reorderList<T extends { id: string }>(
  elements: readonly T[],
  ids: Iterable<string>,
  to: ReorderTarget,
): T[] {
  const wanted = new Set(ids);
  const moved = elements.filter((e) => wanted.has(e.id));
  if (moved.length === 0) return [...elements];
  const rest = elements.filter((e) => !wanted.has(e.id));
  return to === 'front' ? [...rest, ...moved] : [...moved, ...rest];
}

const sameContent = (a: BoardElement, b: BoardElement) =>
  JSON.stringify(toElementInput(a)) === JSON.stringify(toElementInput(b));

type Entry = {
  element: BoardElement;
  /** The server may hold a copy: a partial stroke (`add`), or an older version (`update`). */
  onServer: boolean;
  mode: 'add' | 'update';
  /** Drawn with the pen: replayed as a stream of stroke messages, like it was drawn. */
  stream: boolean;
  /** The job currently responsible for sending it; an older job is stale and skipped. */
  job: Job;
};

function jobFor(entry: Omit<Entry, 'job'>): Job {
  if (entry.mode === 'update') return updateJob(entry.element);
  if (entry.stream && entry.element.type === 'stroke') {
    return strokeJob(limitStroke(entry.element), entry.onServer);
  }
  return addJob(entry.element);
}

export class PendingSync {
  /** Insertion order is drawing order. */
  private readonly elements = new Map<string, Entry>();
  private readonly deletes = new Set<string>();
  private readonly reorders = new Map<string, { ids: string[]; to: ReorderTarget }>();
  private reorderSeq = 0;

  /** How many changes the server has not confirmed yet. */
  get size(): number {
    return this.elements.size + this.deletes.size + this.reorders.size;
  }

  /** Whether `id` has unsent work (it may then not be on the server yet). */
  has(id: string): boolean {
    return this.elements.has(id);
  }

  /**
   * Remembers a finished pen stroke the server does not fully have. `onServer` is true when it
   * was started on a connection that has since dropped, so the server may hold a partial copy.
   * Returns the job to send right away if the socket is currently joined.
   */
  addStroke(stroke: Stroke, onServer: boolean): Job {
    return this.put({ element: stroke, onServer, mode: 'add', stream: true });
  }

  /** Remembers a finished element the server does not have (shape, text, pasted stroke). */
  addElement(element: BoardElement): Job {
    return this.put({ element, onServer: false, mode: 'add', stream: false });
  }

  /**
   * Remembers a new version of an element. One that is itself still pending is simply replaced
   * (it goes out once, in its latest form); otherwise it becomes an update of the server's copy.
   */
  update(element: BoardElement): Job {
    const entry = this.elements.get(element.id);
    if (entry) {
      entry.element = element;
      // Its stroke messages may already be partly out: replace whatever copy the server has.
      if (entry.stream) entry.onServer = true;
      entry.job = jobFor(entry);
      return entry.job;
    }
    return this.put({ element, onServer: true, mode: 'update', stream: false });
  }

  /** The user erased `id`. Returns the pending entry, if the element was one. */
  removeElement(id: string): { onServer: boolean } | undefined {
    const entry = this.elements.get(id);
    this.elements.delete(id);
    return entry && { onServer: entry.onServer };
  }

  /** Remembers an erase of an element the server may still hold, to send once joined. */
  queueDelete(id: string): void {
    this.deletes.add(id);
  }

  /** Forgets a queued erase (the element was brought back). True if there was one. */
  cancelDelete(id: string): boolean {
    return this.deletes.delete(id);
  }

  /** Remembers a stacking-order change. Returns its job. */
  queueReorder(ids: string[], to: ReorderTarget): Job {
    const key = `reorder-${++this.reorderSeq}`;
    this.reorders.set(key, { ids, to });
    return reorderJob(key, ids, to);
  }

  /** Whether a job still has to be sent (it may have been erased, replaced or cleared). */
  isActive(job: Job): boolean {
    switch (job.kind) {
      case 'delete':
        return this.deletes.has(job.id);
      case 'reorder':
        return this.reorders.has(job.id);
      default:
        return this.elements.get(job.id)?.job === job;
    }
  }

  /** The job's last message went out: the item is no longer pending. */
  resolve(job: Job): void {
    switch (job.kind) {
      case 'delete':
        this.deletes.delete(job.id);
        break;
      case 'reorder':
        this.reorders.delete(job.id);
        break;
      default:
        if (this.elements.get(job.id)?.job === job) this.elements.delete(job.id);
    }
  }

  clear(): void {
    this.elements.clear();
    this.deletes.clear();
    this.reorders.clear();
  }

  /**
   * Merges pending work with the server's authoritative elements (a `room:state`). Nothing is
   * duplicated, because ids are stable: an element the server already has in full counts as
   * synced, a truncated stroke copy is replaced, an update replaces the server's version in
   * place, and anything missing is replayed on top. Stacking-order changes are applied last.
   */
  reconcile(serverElements: BoardElement[]): Reconciled {
    const serverById = new Map(serverElements.map((element) => [element.id, element]));
    const jobs: Job[] = [];

    // Erases made while offline. An id the server no longer has (e.g. after a restart or
    // someone else erased it first) needs nothing.
    for (const id of [...this.deletes]) {
      if (serverById.has(id)) jobs.push(deleteJob(id));
      else this.deletes.delete(id);
    }

    let count = serverElements.length - this.deletes.size;
    const replayed: BoardElement[] = [];
    const replaced = new Set<string>();
    const updated = new Map<string, BoardElement>();
    let dropped = 0;

    for (const [id, entry] of [...this.elements]) {
      const { element } = entry;
      const copy = serverById.get(id);

      if (entry.mode === 'update') {
        // Deleted by someone else meanwhile: it stays deleted. Already current: nothing to do.
        if (!copy || this.deletes.has(id) || sameContent(copy, element)) {
          this.elements.delete(id);
          continue;
        }
        entry.job = jobFor(entry);
        jobs.push(entry.job);
        updated.set(id, element);
        continue;
      }

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
      const shown = element.type === 'stroke' ? limitStroke(element) : element;
      entry.element = shown;
      entry.onServer = copy !== undefined;
      entry.job = jobFor(entry);
      jobs.push(entry.job);
      replayed.push(shown);
      if (copy) replaced.add(id);
      else count++;
    }

    let elements = serverElements
      .filter((element) => !this.deletes.has(element.id) && !replaced.has(element.id))
      .map((element) => updated.get(element.id) ?? element)
      .concat(replayed);

    for (const [key, { ids, to }] of [...this.reorders]) {
      const present = new Set(elements.map((e) => e.id));
      const kept = ids.filter((id) => present.has(id));
      if (kept.length === 0) {
        this.reorders.delete(key);
        continue;
      }
      elements = reorderList(elements, kept, to);
      jobs.push(reorderJob(key, kept, to));
    }
    return { elements, jobs, dropped };
  }

  private put(fields: Omit<Entry, 'job'>): Job {
    const entry: Entry = { ...fields, job: jobFor(fields) };
    // Re-inserting moves it to the end: it is replayed in the order it was (re)made.
    this.elements.delete(fields.element.id);
    this.elements.set(fields.element.id, entry);
    return entry.job;
  }
}

// ---- Sending: batching and pacing ----

/** Consecutive messages of these kinds are merged into one batch message when sent. */
type BatchKind = 'add' | 'update' | 'delete';

function batchKind(message: Outgoing): BatchKind | null {
  switch (message.event) {
    case CLIENT_EVENTS.elementAdd:
    case CLIENT_EVENTS.elementsAdd:
      return 'add';
    case CLIENT_EVENTS.elementsUpdate:
      return 'update';
    case CLIENT_EVENTS.elementDelete:
    case CLIENT_EVENTS.elementsDelete:
      return 'delete';
    default:
      return null;
  }
}

/**
 * Socket messages are capped by the server (256 KB); batches aim well below that, counting the
 * UTF-8 size of the JSON the client would send.
 */
export const MAX_BATCH_BYTES = 160 * 1024;

const encoder = new TextEncoder();
const byteSize = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

/** Rate-limit tokens a message costs on the server (see `LIMITS.pointsPerToken`). */
export function messageCost(message: Outgoing): number {
  let points = 0;
  if (message.event === CLIENT_EVENTS.elementAdd) points = pointCountOf(message.payload);
  if (
    message.event === CLIENT_EVENTS.elementsAdd ||
    message.event === CLIENT_EVENTS.elementsUpdate
  ) {
    points = message.payload.elements.reduce((sum, e) => sum + pointCountOf(e), 0);
  }
  return 1 + Math.floor(points / LIMITS.pointsPerToken);
}

/**
 * Merges messages of one batch kind into as few messages as the limits allow, keeping their order.
 * Other messages are returned unchanged.
 */
export function batchMessages(messages: Outgoing[]): Outgoing[] {
  const out: Outgoing[] = [];
  let kind: BatchKind | null = null;
  let elements: ElementsAddPayload['elements'] = [];
  let ids: string[] = [];
  let points = 0;
  let bytes = 0;

  const flush = () => {
    if (kind === 'add' && elements.length > 0) {
      out.push(
        elements.length === 1
          ? { event: CLIENT_EVENTS.elementAdd, payload: elements[0] }
          : { event: CLIENT_EVENTS.elementsAdd, payload: { elements } },
      );
    } else if (kind === 'update' && elements.length > 0) {
      out.push({ event: CLIENT_EVENTS.elementsUpdate, payload: { elements } });
    } else if (kind === 'delete' && ids.length > 0) {
      out.push(
        ids.length === 1
          ? { event: CLIENT_EVENTS.elementDelete, payload: { id: ids[0] } }
          : { event: CLIENT_EVENTS.elementsDelete, payload: { ids } },
      );
    }
    kind = null;
    elements = [];
    ids = [];
    points = 0;
    bytes = 0;
  };

  for (const message of messages) {
    const k = batchKind(message);
    if (k === null) {
      flush();
      out.push(message);
      continue;
    }
    if (k !== kind) flush();
    kind = k;
    if (k === 'delete') {
      const more =
        message.event === CLIENT_EVENTS.elementDelete
          ? [message.payload.id]
          : (message.payload as ElementsDeletePayload).ids;
      for (const id of more) {
        if (ids.length >= LIMITS.maxIdsPerMessage) {
          flush();
          kind = k;
        }
        if (!ids.includes(id)) ids.push(id);
      }
      continue;
    }
    const more =
      message.event === CLIENT_EVENTS.elementAdd
        ? [message.payload]
        : (message.payload as ElementsAddPayload).elements;
    for (const element of more) {
      const p = pointCountOf(element);
      const b = byteSize(element);
      const full =
        elements.length >= LIMITS.maxElementsPerMessage ||
        points + p > LIMITS.maxPointsPerBatch ||
        bytes + b > MAX_BATCH_BYTES ||
        // One id per batch: a second version of the same element starts a new message.
        elements.some((e) => e.id === element.id);
      if (full && elements.length > 0) {
        flush();
        kind = k;
      }
      elements.push(element);
      points += p;
      bytes += b;
    }
  }
  flush();
  return out;
}

/** A job being sent, and the index of its next message. */
export type OutboxItem = { job: Job; next: number };

/**
 * Takes the next messages to send off the front of `outbox`, spending about `budget` rate-limit
 * tokens. Runs of single-message jobs of the same kind (adds, updates, erases) are merged into
 * batch messages. Jobs that are no longer active are skipped; `finished` lists the jobs whose last
 * message is in `messages`, so the caller can resolve them once sent.
 */
export function takeFromOutbox(
  outbox: OutboxItem[],
  isActive: (job: Job) => boolean,
  budget: number,
): { messages: Outgoing[]; finished: Job[] } {
  const messages: Outgoing[] = [];
  const finished: Job[] = [];
  let spent = 0;

  while (spent < budget && outbox.length > 0) {
    const item = outbox[0];
    const message = item.job.messages[item.next];
    if (!isActive(item.job) || !message) {
      outbox.shift();
      if (isActive(item.job)) finished.push(item.job); // an empty job is done
      continue;
    }

    const kind = batchKind(message);
    if (kind === null || item.job.messages.length !== 1) {
      item.next++;
      messages.push(message);
      spent += messageCost(message);
      if (item.next >= item.job.messages.length) {
        finished.push(item.job);
        outbox.shift();
      }
      continue;
    }

    // A run of one-message jobs of the same kind goes out as batches.
    const group: Outgoing[] = [];
    let weight = 0;
    while (outbox.length > 0) {
      const next = outbox[0];
      if (!isActive(next.job)) {
        outbox.shift();
        continue;
      }
      const m = next.job.messages[next.next];
      if (next.job.messages.length !== 1 || !m || batchKind(m) !== kind) break;
      if (group.length > 0 && spent + weight >= budget) break;
      group.push(m);
      weight += messageCost(m) - 1 + 1 / LIMITS.maxElementsPerMessage;
      finished.push(next.job);
      outbox.shift();
    }
    for (const batched of batchMessages(group)) {
      messages.push(batched);
      spent += messageCost(batched);
    }
  }
  return { messages, finished };
}
