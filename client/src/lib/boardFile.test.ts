import { describe, expect, it } from 'vitest';
import { LIMITS } from '@whiteboard/shared';
import type { BoardElement } from '@whiteboard/shared';
import {
  BOARD_FILE_KIND,
  BOARD_FILE_VERSION,
  parseBoardFile,
  serializeBoardFile,
} from './boardFile.ts';

const rect = (id: string): BoardElement => ({
  id,
  type: 'rect',
  authorId: 'someone',
  color: '#1a1a1a',
  width: 2,
  start: { x: 0, y: 0 },
  end: { x: 40, y: 20 },
  createdAt: 123,
  fill: '#ffd43b',
});

const stroke: BoardElement = {
  id: 's1',
  type: 'stroke',
  authorId: 'someone',
  color: '#e03131',
  width: 4,
  points: [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
  ],
  createdAt: 5,
};

const text: BoardElement = {
  id: 't1',
  type: 'text',
  authorId: 'someone',
  color: '#000000',
  start: { x: 10, y: 10 },
  text: 'Hello <world> & "friends"',
  fontSize: 24,
  createdAt: 6,
  font: 'hand',
};

const fileWith = (elements: unknown[], extra: object = {}) =>
  JSON.stringify({ kind: BOARD_FILE_KIND, version: BOARD_FILE_VERSION, elements, ...extra });

describe('board files', () => {
  it('round-trips every element, in order, without authors or times', () => {
    const saved = serializeBoardFile([rect('r1'), stroke, text], new Date(Date.UTC(2026, 9, 10)));
    expect(JSON.parse(saved)).toMatchObject({
      kind: BOARD_FILE_KIND,
      version: BOARD_FILE_VERSION,
      savedAt: '2026-10-10T00:00:00.000Z',
    });
    const result = parseBoardFile(saved);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBe(0);
    expect(result.elements.map((e) => e.id)).toEqual(['r1', 's1', 't1']);
    expect(result.elements[0]).not.toHaveProperty('authorId');
    expect(result.elements[0]).not.toHaveProperty('createdAt');
    expect(result.elements[2]).toMatchObject({ text: 'Hello <world> & "friends"', font: 'hand' });
  });

  it('turns away anything that is not a saved board', () => {
    for (const bad of [
      'not json',
      '42',
      'null',
      '[]',
      JSON.stringify({ kind: 'something-else', version: 1, elements: [] }),
      JSON.stringify({ kind: 'collab-whiteboard/elements', elements: [rect('r1')] }),
      JSON.stringify({ kind: BOARD_FILE_KIND, version: 1, elements: 'nope' }),
    ]) {
      expect(parseBoardFile(bad)).toEqual({ ok: false, reason: 'not-a-board' });
    }
  });

  it('refuses files from a newer version of the app', () => {
    expect(parseBoardFile(fileWith([rect('r1')], { version: BOARD_FILE_VERSION + 1 }))).toEqual({
      ok: false,
      reason: 'too-new',
    });
  });

  it('skips invalid elements and counts them', () => {
    const result = parseBoardFile(
      fileWith([rect('r1'), { ...rect('r2'), color: 'red' }, { type: 'mystery' }, stroke]),
    );
    expect(result).toMatchObject({ ok: true, skipped: 2 });
    if (result.ok) expect(result.elements.map((e) => e.id)).toEqual(['r1', 's1']);
  });

  it('says so when nothing in the file can be used', () => {
    expect(parseBoardFile(fileWith([]))).toEqual({ ok: false, reason: 'empty' });
    expect(parseBoardFile(fileWith([{ type: 'mystery' }]))).toEqual({ ok: false, reason: 'empty' });
  });

  it('reads at most a full board', () => {
    const many = Array.from({ length: LIMITS.maxElementsPerBoard + 5 }, (_, i) => rect(`r${i}`));
    const result = parseBoardFile(fileWith(many));
    expect(result).toMatchObject({ ok: true, skipped: 5 });
    if (result.ok) expect(result.elements).toHaveLength(LIMITS.maxElementsPerBoard);
  });
});
