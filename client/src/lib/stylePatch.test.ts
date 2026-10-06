import { describe, expect, it } from 'vitest';
import type { LineShape, Shape, Stroke, TextElement } from '@whiteboard/shared';
import { restyle, styleOfElement, styleSections } from './stylePatch.ts';
import { DEFAULT_STYLE } from './toolStyle.ts';

const base = { id: 'x', authorId: 'a', createdAt: 0, color: '#000000' };
const rect: Shape = { ...base, type: 'rect', width: 2, start: { x: 0, y: 0 }, end: { x: 9, y: 9 } };
const arrow: LineShape = {
  ...base,
  type: 'arrow',
  width: 2,
  start: { x: 0, y: 0 },
  end: { x: 9, y: 9 },
};
const stroke: Stroke = { ...base, type: 'stroke', width: 3, points: [{ x: 0, y: 0 }] };
const text: TextElement = {
  ...base,
  type: 'text',
  start: { x: 0, y: 0 },
  text: 'hi',
  fontSize: 24,
};

describe('styleOfElement', () => {
  it('reads a shape’s options, with defaults for what it leaves out', () => {
    const style = styleOfElement(
      { ...rect, fill: '#ffeecc', strokeStyle: 'dashed' },
      DEFAULT_STYLE,
    );
    expect(style).toMatchObject({
      fillOn: true,
      fillColor: '#ffeecc',
      fillStyle: 'solid',
      strokeStyle: 'dashed',
      opacity: 1,
    });
  });

  it('reads an arrow’s default head', () => {
    expect(styleOfElement(arrow, DEFAULT_STYLE)).toMatchObject({ endHead: 'arrow' });
  });

  it('reads a text’s font options', () => {
    expect(styleOfElement({ ...text, font: 'mono', align: 'right' }, DEFAULT_STYLE)).toMatchObject({
      font: 'mono',
      align: 'right',
      fontSize: 24,
    });
  });
});

describe('restyle', () => {
  it('changes the options a shape has and keeps its geometry and identity', () => {
    const next = restyle(rect, { color: '#ff0000', fillOn: true, fillColor: '#00ff00' });
    expect(next).toMatchObject({
      id: 'x',
      color: '#ff0000',
      fill: '#00ff00',
      start: rect.start,
      end: rect.end,
    });
  });

  it('leaves out options set back to their default', () => {
    const dashed = restyle(rect, { strokeStyle: 'dashed', opacity: 0.5 });
    const plain = restyle(dashed, { strokeStyle: 'solid', opacity: 1 });
    expect(plain).toEqual(rect);
  });

  it('ignores options that do not apply', () => {
    expect(restyle(stroke, { fillOn: true, font: 'serif' })).toEqual(stroke);
    expect(restyle(text, { width: 10, rounded: true })).toEqual(text);
    expect(restyle(arrow, { fillOn: true })).not.toHaveProperty('fill');
  });

  it('restyles a stroke’s color and width', () => {
    expect(restyle(stroke, { color: '#123456', width: 8 })).toMatchObject({
      color: '#123456',
      width: 8,
    });
  });

  it('restyles text and keeps its content', () => {
    const next = restyle(text, { font: 'hand', fontSize: 56, align: 'center' });
    expect(next).toMatchObject({ text: 'hi', font: 'hand', fontSize: 56, align: 'center' });
  });

  it('changes an arrow’s heads', () => {
    expect(restyle(arrow, { startHead: 'dot', endHead: 'none' })).toMatchObject({
      startHead: 'dot',
      endHead: 'none',
    });
  });
});

describe('styleSections', () => {
  it('offers only what applies to the kinds present', () => {
    expect(styleSections(['stroke'])).toMatchObject({ stroke: true, opacity: false, fill: false });
    expect(styleSections(['text'])).toMatchObject({ text: true, opacity: true, outline: false });
    expect(styleSections(['rect'])).toMatchObject({ fill: true, corners: true, path: false });
    expect(styleSections(['ellipse'])).toMatchObject({ fill: true, corners: false });
    expect(styleSections(['line'])).toMatchObject({ path: true, heads: false, fill: false });
    expect(styleSections(['arrow', 'text'])).toMatchObject({ heads: true, text: true });
  });
});
