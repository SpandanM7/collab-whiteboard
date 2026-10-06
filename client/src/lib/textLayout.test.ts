import { describe, expect, it } from 'vitest';
import type { Point, TextElement } from '@whiteboard/shared';
import { coreBounds, elementBounds, elementHit, textBox } from './geometry.ts';
import { LINE_HEIGHT, cssFont, layoutText, splitLines } from './textLayout.ts';

const text = (value: string, start: Point = { x: 0, y: 0 }): TextElement => ({
  id: 't',
  type: 'text',
  authorId: 'a',
  color: '#000000',
  start,
  text: value,
  fontSize: 20,
  createdAt: 0,
});

/** Every character 10 units wide, so the expectations are exact. */
const fixed = (line: string) => line.length * 10;

describe('layoutText', () => {
  it('splits lines and sizes the block by the longest line', () => {
    const layout = layoutText(text('ab\nabcd\n'), fixed);
    expect(layout.lines).toEqual(['ab', 'abcd', '']);
    expect(layout.width).toBe(40);
    expect(layout.height).toBe(3 * 20 * LINE_HEIGHT);
  });

  it('accepts any line ending', () => {
    expect(splitLines('a\r\nb\rc')).toEqual(['a', 'b', 'c']);
  });

  it('builds a CSS font from the family and size', () => {
    expect(cssFont('mono', 18)).toMatch(/^18px .*monospace$/);
  });
});

describe('text geometry', () => {
  // Without a DOM the measurement falls back to an estimate; only its shape matters here.
  const t = text('hello', { x: 100, y: 50 });

  it('places the block at its start point', () => {
    const box = textBox(t);
    expect(box.left).toBe(100);
    expect(box.top).toBe(50);
    expect(box.bottom).toBe(50 + 20 * LINE_HEIGHT);
    expect(box.right).toBeGreaterThan(100);
    expect(elementBounds(t)).toEqual(box);
    expect(coreBounds(t)).toEqual(box);
  });

  it('is hit anywhere inside its block', () => {
    expect(elementHit(t, { x: 101, y: 51 }, 0)).toBe(true);
    expect(elementHit(t, { x: 99, y: 51 }, 0)).toBe(false);
    expect(elementHit(t, { x: 99, y: 51 }, 2)).toBe(true);
  });
});
