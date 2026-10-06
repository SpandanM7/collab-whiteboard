import { describe, expect, it } from 'vitest';
import type { BoardElement, Shape, Stroke } from '@whiteboard/shared';
import { cloneElements, parseElements, serializeElements } from './elementClipboard.ts';

const rect: Shape = {
  id: 'r',
  type: 'rect',
  authorId: 'someone',
  color: '#000000',
  width: 2,
  start: { x: 0, y: 0 },
  end: { x: 20, y: 10 },
  createdAt: 5,
};
const stroke: Stroke = {
  id: 's',
  type: 'stroke',
  authorId: 'someone',
  color: '#000000',
  width: 2,
  points: [
    { x: 40, y: 40 },
    { x: 60, y: 50 },
  ],
  createdAt: 5,
};

let n = 0;
const newId = () => `new${++n}`;

describe('clipboard text', () => {
  it('round-trips elements without their author or time', () => {
    const parsed = parseElements(serializeElements([rect, stroke]));
    expect(parsed).toHaveLength(2);
    expect(parsed![0]).not.toHaveProperty('authorId');
    expect(parsed![1]).toMatchObject({ type: 'stroke', points: stroke.points });
  });

  it('is not fooled by other text', () => {
    expect(parseElements('hello')).toBeNull();
    expect(parseElements('{"kind":"something-else","elements":[]}')).toBeNull();
    expect(parseElements('collab-whiteboard/elements {not json')).toBeNull();
  });

  it('drops invalid elements and keeps the valid ones', () => {
    const text = JSON.stringify({
      kind: 'collab-whiteboard/elements',
      elements: [
        { id: 'x', type: 'rect', color: 'red' },
        { ...rect, authorId: undefined },
      ],
    });
    expect(parseElements(text)).toHaveLength(1);
  });
});

describe('cloneElements', () => {
  it('gives copies new ids and the local author, offset for a duplicate', () => {
    const [copy] = cloneElements([rect], { offset: { x: 16, y: 16 } }, newId, 'local', 99);
    expect(copy.id).not.toBe('r');
    expect(copy).toMatchObject({
      authorId: 'local',
      createdAt: 99,
      start: { x: 16, y: 16 },
      end: { x: 36, y: 26 },
    });
  });

  it('centers a paste on a point, keeping the elements’ layout and order', () => {
    const copies = cloneElements([rect, stroke], { center: { x: 0, y: 0 } }, newId, 'local', 1);
    // Together they span (0,0) to (60,50); the middle moves to the origin.
    expect((copies[0] as Shape).start).toEqual({ x: -30, y: -25 });
    expect((copies[1] as Stroke).points[0]).toEqual({ x: 10, y: 15 });
    expect(copies.map((c: BoardElement) => c.type)).toEqual(['rect', 'stroke']);
  });
});
