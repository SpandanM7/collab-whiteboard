import { describe, expect, it } from 'vitest';
import type { BoardElement } from '@whiteboard/shared';
import { drawElement } from './drawing.ts';
import { EXPORT_PADDING, exportBounds } from './exportImage.ts';
import { SvgContext, renderSvg } from './exportSvg.ts';

const base = { authorId: 'a', createdAt: 0, color: '#1a1a1a', width: 2 };

const rect: BoardElement = {
  ...base,
  id: 'r',
  type: 'rect',
  start: { x: 0, y: 0 },
  end: { x: 100, y: 50 },
};

function draw(element: BoardElement): string {
  const ctx = new SvgContext();
  drawElement(ctx, element);
  return ctx.markup();
}

describe('renderSvg', () => {
  it('frames the drawing like the PNG export, one unit per board unit', () => {
    const svg = renderSvg([rect], { background: 'white' })!;
    const b = exportBounds([rect])!;
    expect(b.left).toBe(Math.floor(-1 - EXPORT_PADDING));
    const w = b.right - b.left;
    const h = b.bottom - b.top;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`width="${w}" height="${h}" viewBox="${b.left} ${b.top} ${w} ${h}"`);
    expect(svg).toContain('<rect x="-33" y="-33"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('leaves out the backdrop for a transparent export', () => {
    expect(renderSvg([rect], { background: 'transparent' })).not.toContain('<rect');
  });

  it('is null when there is nothing to export', () => {
    expect(renderSvg([], { background: 'white' })).toBeNull();
  });
});

describe('SvgContext drawing board elements', () => {
  it('outlines a rectangle with the shape color and width', () => {
    expect(draw(rect)).toBe(
      '<path d="M0 0L100 0L100 50L0 50Z" fill="none" stroke="#1a1a1a" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round"/>',
    );
  });

  it('fills before it outlines, and keeps the opacity', () => {
    const svg = draw({ ...rect, fill: '#ffd43b', opacity: 0.5 } as BoardElement);
    const fill = svg.indexOf('fill="#ffd43b"');
    const outline = svg.indexOf('stroke="#1a1a1a"');
    expect(fill).toBeGreaterThan(-1);
    expect(outline).toBeGreaterThan(fill);
    expect(svg.match(/opacity="0.5"/g)).toHaveLength(2);
  });

  it('clips hatching to the shape', () => {
    const svg = draw({ ...rect, fill: '#ffd43b', fillStyle: 'hatch' } as BoardElement);
    expect(svg).toMatch(/^<defs><clipPath id="clip1"><path d="M0 0L100 0L100 50L0 50Z"\/>/);
    expect(svg).toContain('clip-path="url(#clip1)"');
    // The outline after the hatching is not clipped.
    expect(svg).toMatch(/<path d="M0 0L100 0L100 50L0 50Z" fill="none"[^>]*\/>$/);
    expect(svg.slice(svg.lastIndexOf('<path'))).not.toContain('clip-path');
  });

  it('draws an ellipse as two half-turn arcs', () => {
    const svg = draw({ ...rect, type: 'ellipse' } as BoardElement);
    expect(svg).toContain('d="M100 25A50 25 0 0 1 0 25A50 25 0 0 1 100 25"');
  });

  it('dashes an outline with the canvas dash pattern', () => {
    const svg = draw({ ...rect, strokeStyle: 'dashed' } as BoardElement);
    expect(svg).toContain('stroke-dasharray="12 10"');
  });

  it('smooths a stroke with curves, and draws a single point as a dot', () => {
    const stroke: BoardElement = {
      ...base,
      id: 's',
      type: 'stroke',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 20, y: 0 },
      ],
    };
    expect(draw(stroke)).toContain('d="M0 0Q10 10 15 5L20 0"');
    const dot = draw({ ...stroke, points: [{ x: 5, y: 5 }] } as BoardElement);
    expect(dot).toContain('d="M6 5A1 1 0 0 1 4 5A1 1 0 0 1 6 5"');
    expect(dot).toContain('fill="#1a1a1a"');
  });

  it('draws an arrow with its head', () => {
    const arrow: BoardElement = {
      ...base,
      id: 'a',
      type: 'arrow',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
    };
    const svg = draw(arrow);
    expect(svg).toContain('d="M0 0L100 0"');
    expect(svg.match(/<path/g)).toHaveLength(2);
  });

  it('writes text line by line, escaped, in its font and alignment', () => {
    const text: BoardElement = {
      ...base,
      id: 't',
      type: 'text',
      start: { x: 10, y: 20 },
      text: 'a < b & "c"\n  indented',
      fontSize: 20,
      align: 'center',
    };
    const svg = draw(text);
    expect(svg.match(/<text/g)).toHaveLength(2);
    expect(svg).toContain('>a &lt; b &amp; &quot;c&quot;</text>');
    expect(svg).toContain('>  indented</text>');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('dominant-baseline="central"');
    expect(svg).toContain('style="font: 20px system-ui, &quot;Segoe UI&quot;');
    expect(svg).toContain('white-space: pre');
  });
});

describe('SvgContext path rules', () => {
  it('joins an arc to the current point with a line, as the canvas does', () => {
    const ctx = new SvgContext();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(10, 0, 5, Math.PI, Math.PI * 2);
    ctx.stroke();
    expect(ctx.markup()).toContain('d="M0 0L5 0A5 5 0 0 1 15 0"');
  });

  it('restores state saved before a change', () => {
    const ctx = new SvgContext();
    ctx.strokeStyle = '#ff0000';
    ctx.save();
    ctx.strokeStyle = '#00ff00';
    ctx.setLineDash([1, 2, 3]);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(1, 1);
    ctx.stroke();
    expect(ctx.markup()).toContain('stroke="#ff0000"');
    expect(ctx.markup()).not.toContain('dasharray');
  });

  it('ignores painting an empty path', () => {
    const ctx = new SvgContext();
    ctx.beginPath();
    ctx.stroke();
    ctx.fill();
    expect(ctx.markup()).toBe('');
  });
});
