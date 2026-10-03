import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  boardClearPayload,
  cursorMovePayload,
  cursorMovedPayload,
  participantJoinedPayload,
  participantLeftPayload,
  elementDeletePayload,
  roomJoinPayload,
  strokeEndPayload,
  strokePointsPayload,
  strokeStartPayload,
  strokeStartRelayPayload,
} from './index.ts';

const point = { x: 10, y: -20.5 };

describe('roomJoinPayload', () => {
  const valid = { boardId: 'abcdefgh12', name: 'Quiet Otter', color: '#1a1a1a' };

  it('accepts a valid join', () => {
    expect(roomJoinPayload.safeParse(valid).success).toBe(true);
  });

  it('trims the display name', () => {
    expect(roomJoinPayload.parse({ ...valid, name: '  Otter  ' }).name).toBe('Otter');
  });

  it.each([
    ['short board id', { boardId: 'abc' }],
    ['board id with unsafe characters', { boardId: 'abcdefgh/../x' }],
    ['overlong board id', { boardId: 'a'.repeat(65) }],
    ['blank name', { name: '   ' }],
    ['overlong name', { name: 'x'.repeat(LIMITS.maxNameLength + 1) }],
    ['non-hex color', { color: 'red' }],
    ['3-digit hex color', { color: '#fff' }],
  ])('rejects %s', (_label, override) => {
    expect(roomJoinPayload.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it.each([undefined, null, 'room', 42, []])('rejects non-object payload %j', (raw) => {
    expect(roomJoinPayload.safeParse(raw).success).toBe(false);
  });
});

describe('strokeStartPayload', () => {
  const valid = { id: 'stroke_1', color: '#ff0000', width: 4, point };

  it('accepts a valid start', () => {
    expect(strokeStartPayload.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['missing id', { id: undefined }],
    ['id with spaces', { id: 'a b' }],
    ['zero width', { width: 0 }],
    ['huge width', { width: LIMITS.maxStrokeWidth + 1 }],
    ['string width', { width: '4' }],
    ['NaN coordinate', { point: { x: NaN, y: 0 } }],
    ['out-of-range coordinate', { point: { x: LIMITS.maxCoordinate + 1, y: 0 } }],
    ['missing y', { point: { x: 1 } }],
  ])('rejects %s', (_label, override) => {
    expect(strokeStartPayload.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it('strips unknown fields instead of passing them through', () => {
    const parsed = strokeStartPayload.parse({ ...valid, authorId: 'spoofed' });
    expect(parsed).not.toHaveProperty('authorId');
  });
});

describe('strokePointsPayload', () => {
  it('accepts a full batch', () => {
    const points = Array.from({ length: LIMITS.maxPointsPerMessage }, () => point);
    expect(strokePointsPayload.safeParse({ id: 's1', points }).success).toBe(true);
  });

  it('rejects more than the per-message point limit', () => {
    const points = Array.from({ length: LIMITS.maxPointsPerMessage + 1 }, () => point);
    expect(strokePointsPayload.safeParse({ id: 's1', points }).success).toBe(false);
  });

  it('rejects an empty batch', () => {
    expect(strokePointsPayload.safeParse({ id: 's1', points: [] }).success).toBe(false);
  });

  it('rejects an invalid point inside a batch', () => {
    expect(
      strokePointsPayload.safeParse({ id: 's1', points: [point, { x: 'a', y: 1 }] }).success,
    ).toBe(false);
  });
});

describe('simple payloads', () => {
  it('validates ids for stroke:end and element:delete', () => {
    expect(strokeEndPayload.safeParse({ id: 's1' }).success).toBe(true);
    expect(strokeEndPayload.safeParse({}).success).toBe(false);
    expect(elementDeletePayload.safeParse({ id: 's1' }).success).toBe(true);
    expect(elementDeletePayload.safeParse({ id: 5 }).success).toBe(false);
  });

  it('requires an object for board:clear', () => {
    expect(boardClearPayload.safeParse({}).success).toBe(true);
    expect(boardClearPayload.safeParse(undefined).success).toBe(false);
  });
});

describe('relay payloads', () => {
  it('add an author id to the client payload', () => {
    const payload = { id: 's1', color: '#000000', width: 2, point, authorId: 'sock123' };
    expect(strokeStartRelayPayload.parse(payload).authorId).toBe('sock123');
    expect(strokeStartRelayPayload.safeParse({ ...payload, authorId: undefined }).success).toBe(
      false,
    );
  });
});

describe('presence payloads', () => {
  it('validates cursor:move points', () => {
    expect(cursorMovePayload.safeParse({ point }).success).toBe(true);
    expect(cursorMovePayload.safeParse({ point: { x: NaN, y: 0 } }).success).toBe(false);
    expect(
      cursorMovePayload.safeParse({ point: { x: LIMITS.maxCoordinate + 1, y: 0 } }).success,
    ).toBe(false);
    expect(cursorMovePayload.safeParse({}).success).toBe(false);
  });

  it('strips a spoofed clientId from cursor:move', () => {
    expect(cursorMovePayload.parse({ point, clientId: 'spoofed' })).not.toHaveProperty('clientId');
  });

  it('requires a client id on cursor:moved and participant:left', () => {
    expect(cursorMovedPayload.safeParse({ clientId: 'abc', point }).success).toBe(true);
    expect(cursorMovedPayload.safeParse({ point }).success).toBe(false);
    expect(participantLeftPayload.safeParse({ clientId: 'abc' }).success).toBe(true);
    expect(participantLeftPayload.safeParse({}).success).toBe(false);
  });

  it('accepts a participant with or without a cursor', () => {
    const p = { clientId: 'abc', name: 'Quiet Otter', color: '#e03131' };
    expect(participantJoinedPayload.safeParse(p).success).toBe(true);
    expect(participantJoinedPayload.safeParse({ ...p, cursor: point }).success).toBe(true);
    expect(participantJoinedPayload.safeParse({ ...p, name: ' ' }).success).toBe(false);
  });
});
