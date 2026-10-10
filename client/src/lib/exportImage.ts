import type { BoardElement } from '@whiteboard/shared';
import { drawElement } from './drawing.ts';
import type { Rect } from './geometry.ts';
import { contentBounds } from './view.ts';

export type ExportBackground = 'white' | 'transparent';

export type ExportOptions = {
  /** Output pixels per board unit (2 is crisp on most screens). */
  scale: number;
  background: ExportBackground;
};

/** Board units of empty space around the drawing. */
export const EXPORT_PADDING = 32;
/**
 * Browsers refuse canvases past these (iOS Safari is the strictest, at about 16.7 million
 * pixels), so a huge board is exported at a lower scale rather than not at all.
 */
export const MAX_EXPORT_SIDE = 8192;
export const MAX_EXPORT_AREA = 16_000_000;

export type ExportFrame = {
  /** The board area exported, padding included. */
  bounds: Rect;
  width: number;
  height: number;
  /** The scale actually used, after the size caps. */
  scale: number;
};

/** The board area an export covers: the drawing plus padding, on whole units. */
export function exportBounds(elements: readonly BoardElement[]): Rect | null {
  const content = contentBounds([...elements]);
  if (!content) return null;
  return {
    left: Math.floor(content.left - EXPORT_PADDING),
    top: Math.floor(content.top - EXPORT_PADDING),
    right: Math.ceil(content.right + EXPORT_PADDING),
    bottom: Math.ceil(content.bottom + EXPORT_PADDING),
  };
}

/** What exporting `elements` at `scale` produces, or null when there is nothing to export. */
export function exportFrame(elements: readonly BoardElement[], scale: number): ExportFrame | null {
  const bounds = exportBounds(elements);
  if (!bounds) return null;
  const w = bounds.right - bounds.left;
  const h = bounds.bottom - bounds.top;
  const capped = Math.min(
    scale,
    MAX_EXPORT_SIDE / w,
    MAX_EXPORT_SIDE / h,
    Math.sqrt(MAX_EXPORT_AREA / (w * h)),
  );
  return {
    bounds,
    width: Math.max(1, Math.floor(w * capped)),
    height: Math.max(1, Math.floor(h * capped)),
    scale: capped,
  };
}

/** Draws `elements` onto a new canvas, framed by `exportFrame`. Null for an empty board. */
export function renderElements(
  elements: readonly BoardElement[],
  { scale, background }: ExportOptions,
): HTMLCanvasElement | null {
  const frame = exportFrame(elements, scale);
  if (!frame) return null;
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (background === 'white') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const s = frame.scale;
  ctx.setTransform(s, 0, 0, s, -frame.bounds.left * s, -frame.bounds.top * s);
  for (const element of elements) drawElement(ctx, element);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export failed'))),
      'image/png',
    ),
  );
}

/** "whiteboard-<board>-2026-10-06-1430.png" (or another extension), in local time. */
export function exportFileName(boardId: string, date: Date, extension = 'png'): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `whiteboard-${boardId}-${stamp}.${extension}`;
}

/** Saves a blob as a file through a temporary link. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers read the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
