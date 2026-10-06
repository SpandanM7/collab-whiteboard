import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import {
  EXPORT_PADDING,
  MAX_EXPORT_AREA,
  MAX_EXPORT_SIDE,
  exportFileName,
  exportFrame,
} from './exportImage.ts';

const rect = (w: number, h: number): Shape => ({
  id: 'r',
  type: 'rect',
  authorId: 'a',
  color: '#000000',
  width: 2,
  start: { x: 0, y: 0 },
  end: { x: w, y: h },
  createdAt: 0,
});

describe('exportFrame', () => {
  it('frames the drawing with padding at the requested scale', () => {
    const frame = exportFrame([rect(100, 50)], 2)!;
    expect(frame.bounds.left).toBe(Math.floor(-1 - EXPORT_PADDING));
    expect(frame.scale).toBe(2);
    expect(frame.width).toBe((frame.bounds.right - frame.bounds.left) * 2);
  });

  it('is null for an empty board', () => {
    expect(exportFrame([], 2)).toBeNull();
  });

  it('lowers the scale for a huge drawing so browsers can still make the image', () => {
    const frame = exportFrame([rect(50_000, 20_000)], 3)!;
    expect(frame.scale).toBeLessThan(3);
    expect(frame.width).toBeLessThanOrEqual(MAX_EXPORT_SIDE);
    expect(frame.width * frame.height).toBeLessThanOrEqual(MAX_EXPORT_AREA);
  });
});

describe('exportFileName', () => {
  it('names the file after the board and the local time', () => {
    expect(exportFileName('abc123xy', new Date(2026, 9, 6, 9, 5))).toBe(
      'whiteboard-abc123xy-2026-10-06-0905.png',
    );
  });
});
