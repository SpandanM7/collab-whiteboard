import { describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, LIMITS } from '@whiteboard/shared';
import type { BoardElement, Shape, Stroke } from '@whiteboard/shared';
import {
  PendingSync,
  addJob,
  batchMessages,
  messageCost,
  reorderList,
  strokeJob,
  takeFromOutbox,
  updateJob,
} from './pendingSync.ts';
import type { OutboxItem, Outgoing } from './pendingSync.ts';

const stroke = (id: string, pointCount = 3, authorId = 'someone'): Stroke => ({
  id,
  type: 'stroke',
  authorId,
  color: '#112233',
  width: 4,
  points: Array.from({ length: pointCount }, (_, i) => ({ x: i, y: 0 })),
  createdAt: 0,
});

const shape = (id: string, type: Shape['type'] = 'rect'): Shape => {
  const common = {
    id,
    authorId: 'someone',
    color: '#112233',
    width: 2,
    start: { x: 0, y: 0 },
    end: { x: 10, y: 5 },
    createdAt: 0,
  };
  return type === 'rect' || type === 'ellipse'
    ? { ...common, type, fill: '#ffeecc' }
    : { ...common, type };
};

const pointsOf = (element?: BoardElement) => (element?.type === 'stroke' ? element.points : []);

const events = (messages: { event: string }[]) => messages.map((m) => m.event);

describe('strokeJob', () => {
  it('sends start, one points message and end for a short stroke', () => {
    const job = strokeJob(stroke('a', 3), false);
    expect(events(job.messages)).toEqual([
      CLIENT_EVENTS.strokeStart,
      CLIENT_EVENTS.strokePoints,
      CLIENT_EVENTS.strokeEnd,
    ]);
  });

  it('sends a single-point stroke without a points message', () => {
    expect(events(strokeJob(stroke('a', 1), false).messages)).toEqual([
      CLIENT_EVENTS.strokeStart,
      CLIENT_EVENTS.strokeEnd,
    ]);
  });

  it('splits long strokes into messages the server accepts', () => {
    const total = LIMITS.maxPointsPerMessage * 2 + 50 + 1;
    const job = strokeJob(stroke('a', total), false);
    const sizes = job.messages.flatMap((m) =>
      m.event === CLIENT_EVENTS.strokePoints ? [m.payload.points.length] : [],
    );
    expect(sizes).toEqual([LIMITS.maxPointsPerMessage, LIMITS.maxPointsPerMessage, 50]);
  });

  it('deletes the server copy first when asked to replace it', () => {
    const job = strokeJob(stroke('a', 2), true);
    expect(job.messages[0]).toEqual({ event: CLIENT_EVENTS.elementDelete, payload: { id: 'a' } });
    expect(job.messages).toHaveLength(4);
  });
});

describe('PendingSync.reconcile', () => {
  it('returns the server elements untouched when nothing is pending', () => {
    const server = [stroke('s1'), stroke('s2')];
    const result = new PendingSync().reconcile(server);
    expect(result.elements).toEqual(server);
    expect(result.jobs).toEqual([]);
    expect(result.dropped).toBe(0);
  });

  it('keeps a stroke drawn offline on top of the server board and replays it', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('mine'), false);
    const result = pending.reconcile([stroke('theirs')]);
    expect(result.elements.map((e) => e.id)).toEqual(['theirs', 'mine']);
    expect(result.jobs.map((j) => j.id)).toEqual(['mine']);
    expect(pending.size).toBe(1); // stays pending until the job has been sent
  });

  it('merges two users who both drew before the server was reachable', () => {
    // Each client only knows its own stroke; ids differ, so both survive the merge.
    const a = new PendingSync();
    a.addStroke(stroke('from-a'), false);
    const afterA = a.reconcile([]);
    expect(afterA.elements.map((e) => e.id)).toEqual(['from-a']);

    const b = new PendingSync();
    b.addStroke(stroke('from-b'), false);
    // B joins after A's upload landed.
    const afterB = b.reconcile(afterA.elements);
    expect(afterB.elements.map((e) => e.id)).toEqual(['from-a', 'from-b']);
    expect(afterB.jobs.map((j) => j.id)).toEqual(['from-b']);
  });

  it('does not duplicate a stroke the server already has in full', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('mine', 5), false);
    const result = pending.reconcile([stroke('mine', 5, 'old-socket')]);
    expect(result.elements.map((e) => e.id)).toEqual(['mine']);
    expect(result.jobs).toEqual([]);
    expect(pending.size).toBe(0);
  });

  it('replaces a truncated server copy with the complete local stroke', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('mine', 10), true);
    const result = pending.reconcile([stroke('other'), stroke('mine', 4, 'old-socket')]);
    expect(result.elements.map((e) => e.id)).toEqual(['other', 'mine']);
    expect(pointsOf(result.elements[1])).toHaveLength(10);
    expect(result.jobs[0]?.messages[0]?.event).toBe(CLIENT_EVENTS.elementDelete);
  });

  it('gives up on strokes that no longer fit and reports them', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('mine'), false);
    const full = Array.from({ length: LIMITS.maxElementsPerBoard }, (_, i) => stroke(`s${i}`, 1));
    const result = pending.reconcile(full);
    expect(result.dropped).toBe(1);
    expect(result.jobs).toEqual([]);
    expect(result.elements).toHaveLength(LIMITS.maxElementsPerBoard);
    expect(pending.size).toBe(0);
  });

  it('still replaces a truncated copy on a full board (it takes no new slot)', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('mine', 6), true);
    const full = [
      ...Array.from({ length: LIMITS.maxElementsPerBoard - 1 }, (_, i) => stroke(`s${i}`, 1)),
      stroke('mine', 2),
    ];
    const result = pending.reconcile(full);
    expect(result.dropped).toBe(0);
    expect(result.jobs).toHaveLength(1);
  });

  it('cuts a stroke over the per-stroke limit instead of losing it', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('huge', LIMITS.maxPointsPerStroke + 10), false);
    const result = pending.reconcile([]);
    expect(pointsOf(result.elements[0])).toHaveLength(LIMITS.maxPointsPerStroke);
  });

  it('sends offline erases for strokes the server still has and hides them meanwhile', () => {
    const pending = new PendingSync();
    pending.queueDelete('gone');
    const result = pending.reconcile([stroke('gone'), stroke('kept')]);
    expect(result.elements.map((e) => e.id)).toEqual(['kept']);
    expect(result.jobs).toEqual([
      {
        kind: 'delete',
        id: 'gone',
        messages: [{ event: CLIENT_EVENTS.elementDelete, payload: { id: 'gone' } }],
      },
    ]);
  });

  it('forgets an erase of a stroke the server no longer has (e.g. after a restart)', () => {
    const pending = new PendingSync();
    pending.queueDelete('gone');
    const result = pending.reconcile([stroke('kept')]);
    expect(result.jobs).toEqual([]);
    expect(pending.size).toBe(0);
  });

  it('is repeatable: a second room:state before the jobs finish plans the same work', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('mine'), false);
    const first = pending.reconcile([]);
    const second = pending.reconcile([]);
    expect(second.jobs).toEqual(first.jobs);
    expect(second.elements).toEqual(first.elements);
  });
});

describe('PendingSync bookkeeping', () => {
  it('counts strokes and erases, and resolves them once sent', () => {
    const pending = new PendingSync();
    const job = pending.addStroke(stroke('a'), false);
    pending.queueDelete('b');
    expect(pending.size).toBe(2);
    expect(pending.isActive(job)).toBe(true);
    pending.resolve(job);
    expect(pending.isActive(job)).toBe(false);
    expect(pending.size).toBe(1);
  });

  it('removing a pending stroke deactivates its job and reports where it lived', () => {
    const pending = new PendingSync();
    const offline = pending.addStroke(stroke('offline'), false);
    pending.addStroke(stroke('cut-off'), true);
    expect(pending.removeElement('offline')).toEqual({ onServer: false });
    expect(pending.removeElement('cut-off')).toEqual({ onServer: true });
    expect(pending.removeElement('never-pending')).toBeUndefined();
    expect(pending.isActive(offline)).toBe(false);
    expect(pending.size).toBe(0);
  });

  it('clear drops everything', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('a'), false);
    pending.queueDelete('b');
    pending.clear();
    expect(pending.size).toBe(0);
  });
});

describe('shapes', () => {
  it('addJob is a single element:add without the author or timestamp', () => {
    const job = addJob(shape('r1', 'ellipse'));
    expect(job.kind).toBe('add');
    expect(job.messages).toEqual([
      {
        event: CLIENT_EVENTS.elementAdd,
        payload: {
          id: 'r1',
          type: 'ellipse',
          color: '#112233',
          width: 2,
          fill: '#ffeecc',
          start: { x: 0, y: 0 },
          end: { x: 10, y: 5 },
        },
      },
    ]);
  });

  it('addJob for a line carries no fill', () => {
    const [message] = addJob(shape('l1', 'line')).messages;
    expect(message?.payload).not.toHaveProperty('fill');
  });

  it('addJob carries the style options', () => {
    const arrow: Shape = {
      ...shape('a1', 'arrow'),
      type: 'arrow',
      strokeStyle: 'dashed',
      opacity: 0.4,
      startHead: 'dot',
      route: 'elbow',
    };
    const [message] = addJob(arrow).messages;
    expect(message?.payload).toMatchObject({
      strokeStyle: 'dashed',
      opacity: 0.4,
      startHead: 'dot',
      route: 'elbow',
    });
  });

  it('replays a shape the server does not have, on top of the server board', () => {
    const pending = new PendingSync();
    pending.addElement(shape('mine'));
    const result = pending.reconcile([stroke('other')]);
    expect(result.elements.map((e) => e.id)).toEqual(['other', 'mine']);
    expect(result.jobs.map((j) => j.kind)).toEqual(['add']);
  });

  it('does not replay a shape the server already has', () => {
    const pending = new PendingSync();
    pending.addElement(shape('mine'));
    const result = pending.reconcile([shape('mine')]);
    expect(result.jobs).toEqual([]);
    expect(result.elements.map((e) => e.id)).toEqual(['mine']);
    expect(pending.size).toBe(0);
  });

  it('keeps drawing order between offline strokes and shapes', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('s1'), false);
    pending.addElement(shape('r1'));
    pending.addStroke(stroke('s2'), false);
    expect(pending.reconcile([]).elements.map((e) => e.id)).toEqual(['s1', 'r1', 's2']);
  });

  it('gives up on a shape when the board is full', () => {
    const pending = new PendingSync();
    pending.addElement(shape('late'));
    const full = Array.from({ length: LIMITS.maxElementsPerBoard }, (_, i) => stroke(`s${i}`, 1));
    const result = pending.reconcile(full);
    expect(result.dropped).toBe(1);
    expect(result.jobs).toEqual([]);
  });

  it('erasing a pending shape deactivates its job; the server never heard of it', () => {
    const pending = new PendingSync();
    const job = pending.addElement(shape('r1'));
    expect(pending.removeElement('r1')).toEqual({ onServer: false });
    expect(pending.isActive(job)).toBe(false);
  });

  it('resolving a shape job clears it', () => {
    const pending = new PendingSync();
    const job = pending.addElement(shape('r1'));
    pending.resolve(job);
    expect(pending.size).toBe(0);
  });
});

describe('PendingSync updates', () => {
  it('replays a change to a server element as an update in place', () => {
    const pending = new PendingSync();
    const moved = { ...shape('r1'), start: { x: 50, y: 50 } };
    pending.update(moved);
    const result = pending.reconcile([shape('r1'), stroke('s1')]);
    expect(result.elements.map((e) => e.id)).toEqual(['r1', 's1']);
    expect(result.elements[0]).toBe(moved);
    expect(result.jobs.map((j) => j.kind)).toEqual(['update']);
    expect(events(result.jobs[0].messages)).toEqual([CLIENT_EVENTS.elementsUpdate]);
  });

  it('drops a change to an element someone else deleted meanwhile', () => {
    const pending = new PendingSync();
    pending.update(shape('r1'));
    const result = pending.reconcile([]);
    expect(result.elements).toEqual([]);
    expect(result.jobs).toEqual([]);
    expect(pending.size).toBe(0);
  });

  it('drops a change the server already has', () => {
    const pending = new PendingSync();
    pending.update(shape('r1'));
    expect(pending.reconcile([{ ...shape('r1'), authorId: 'x' }]).jobs).toEqual([]);
  });

  it('sends a still-pending element once, in its latest form', () => {
    const pending = new PendingSync();
    const first = pending.addElement(shape('r1'));
    const moved = { ...shape('r1'), start: { x: 7, y: 7 } };
    const second = pending.update(moved);
    expect(pending.isActive(first)).toBe(false);
    expect(pending.isActive(second)).toBe(true);
    expect(second.kind).toBe('add');
    expect(pending.size).toBe(1);
  });

  it('replaces any partial server copy when a pen stroke changes before it was sent', () => {
    const pending = new PendingSync();
    pending.addStroke(stroke('s1'), false);
    const job = pending.update({ ...stroke('s1'), color: '#ff0000' });
    expect(job.messages[0].event).toBe(CLIENT_EVENTS.elementDelete);
  });

  it('resolving a stale job leaves the newer one pending', () => {
    const pending = new PendingSync();
    const first = pending.addElement(shape('r1'));
    pending.update(shape('r1'));
    pending.resolve(first);
    expect(pending.size).toBe(1);
  });

  it('turns an erase that is brought back into an update', () => {
    const pending = new PendingSync();
    pending.queueDelete('r1');
    expect(pending.cancelDelete('r1')).toBe(true);
    expect(pending.cancelDelete('r1')).toBe(false);
    expect(pending.update(shape('r1')).kind).toBe('update');
  });
});

describe('PendingSync reorders', () => {
  it('applies offline reorders after the merge and replays them', () => {
    const pending = new PendingSync();
    pending.queueReorder(['a'], 'front');
    const result = pending.reconcile([shape('a'), shape('b')]);
    expect(result.elements.map((e) => e.id)).toEqual(['b', 'a']);
    expect(result.jobs.map((j) => j.kind)).toEqual(['reorder']);
    expect(pending.size).toBe(1);
    pending.resolve(result.jobs[0]);
    expect(pending.size).toBe(0);
  });

  it('forgets a reorder of elements that are gone', () => {
    const pending = new PendingSync();
    pending.queueReorder(['gone'], 'back');
    expect(pending.reconcile([shape('a')]).jobs).toEqual([]);
    expect(pending.size).toBe(0);
  });

  it('reorderList keeps the moved elements in their order', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    expect(reorderList(list, ['c', 'a'], 'front').map((e) => e.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(reorderList(list, ['d', 'b'], 'back').map((e) => e.id)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('batching', () => {
  const add = (id: string): Outgoing => addJob(shape(id)).messages[0];
  const del = (id: string): Outgoing => ({ event: CLIENT_EVENTS.elementDelete, payload: { id } });

  it('merges runs of adds and of erases, keeping their order', () => {
    const batched = batchMessages([add('a'), add('b'), del('x'), del('y'), add('c')]);
    expect(events(batched)).toEqual([
      CLIENT_EVENTS.elementsAdd,
      CLIENT_EVENTS.elementsDelete,
      CLIENT_EVENTS.elementAdd,
    ]);
  });

  it('keeps each batch within the point limit', () => {
    const big = (id: string): Outgoing =>
      addJob(stroke(id, LIMITS.maxPointsPerBatch - 10)).messages[0];
    expect(batchMessages([big('a'), big('b')])).toHaveLength(2);
  });

  it('never puts two versions of one element in a batch', () => {
    const update = (x: number): Outgoing =>
      updateJob({ ...shape('a'), start: { x, y: 0 } }).messages[0];
    expect(batchMessages([update(1), update(2)])).toHaveLength(2);
  });

  it('charges points the way the server does', () => {
    expect(messageCost(add('a'))).toBe(1);
    const points = LIMITS.pointsPerToken * 2;
    expect(messageCost(addJob(stroke('s', points)).messages[0])).toBe(3);
  });

  it('drains the outbox in batches, skipping work that was cancelled', () => {
    const pending = new PendingSync();
    const jobs = ['a', 'b', 'c'].map((id) => pending.addElement(shape(id)));
    pending.removeElement('b');
    const outbox: OutboxItem[] = jobs.map((job) => ({ job, next: 0 }));
    const { messages, finished } = takeFromOutbox(outbox, (j) => pending.isActive(j), 5);
    expect(events(messages)).toEqual([CLIENT_EVENTS.elementsAdd]);
    const sent = messages[0].payload as { elements: { id: string }[] };
    expect(sent.elements.map((e) => e.id)).toEqual(['a', 'c']);
    expect(finished.map((j) => j.id)).toEqual(['a', 'c']);
    expect(outbox).toEqual([]);
  });

  it('sends stroke streams message by message within the budget', () => {
    const pending = new PendingSync();
    const job = pending.addStroke(stroke('s', LIMITS.maxPointsPerMessage * 3), false);
    const outbox: OutboxItem[] = [{ job, next: 0 }];
    const first = takeFromOutbox(outbox, (j) => pending.isActive(j), 2);
    expect(events(first.messages)).toEqual([CLIENT_EVENTS.strokeStart, CLIENT_EVENTS.strokePoints]);
    expect(first.finished).toEqual([]);
    const rest = takeFromOutbox(outbox, (j) => pending.isActive(j), 10);
    expect(rest.finished).toEqual([job]);
  });
});
