import { describe, expect, it } from 'vitest';
import { CLIENT_EVENTS, LIMITS } from '@whiteboard/shared';
import type { Stroke } from '@whiteboard/shared';
import { PendingSync, strokeJob } from './pendingSync.ts';

const stroke = (id: string, pointCount = 3, authorId = 'someone'): Stroke => ({
  id,
  type: 'stroke',
  authorId,
  color: '#112233',
  width: 4,
  points: Array.from({ length: pointCount }, (_, i) => ({ x: i, y: 0 })),
  createdAt: 0,
});

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
    expect(result.elements[1]?.points).toHaveLength(10);
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
    expect(result.elements[0]?.points).toHaveLength(LIMITS.maxPointsPerStroke);
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
    expect(pending.removeStroke('offline')).toEqual({ onServer: false });
    expect(pending.removeStroke('cut-off')).toEqual({ onServer: true });
    expect(pending.removeStroke('never-pending')).toBeUndefined();
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
