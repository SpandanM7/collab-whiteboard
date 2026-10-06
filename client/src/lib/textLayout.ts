import type { TextAlign, TextElement, TextFont } from '@whiteboard/shared';

/** Line height as a multiple of the font size. The text editor uses the same value. */
export const LINE_HEIGHT = 1.25;

/** System font stacks only: no web font to load, so text shows up instantly everywhere. */
export const FONT_STACKS: Record<TextFont, string> = {
  sans: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
  hand: '"Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Sans MS", cursive',
};

export function fontOf(text: Pick<TextElement, 'font'>): TextFont {
  return text.font ?? 'sans';
}

export function alignOf(text: Pick<TextElement, 'align'>): TextAlign {
  return text.align ?? 'left';
}

/** The CSS / canvas font shorthand for a text at `fontSize` (board units, or pixels on screen). */
export function cssFont(font: TextFont, fontSize: number): string {
  return `${fontSize}px ${FONT_STACKS[font]}`;
}

export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

export type TextLayout = {
  lines: string[];
  /** Width of each line, in board units. */
  widths: number[];
  /** The block: as wide as the longest line, one line height per line. */
  width: number;
  height: number;
  lineHeight: number;
};

type Measure = (line: string, font: string) => number;

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Measures with a canvas when there is a DOM; tests (and SSR) fall back to an estimate. */
const defaultMeasure: Measure = (line, font) => {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!measureCtx) {
    const size = Number.parseFloat(font) || 16;
    return line.length * size * 0.6;
  }
  measureCtx.font = font;
  return measureCtx.measureText(line).width;
};

const layoutCache = new WeakMap<TextElement, TextLayout>();

/**
 * Where the lines of a text go. Measured on this device, so other people's screens may differ
 * by a pixel or two; only hit testing and selection use it, never the synced data.
 */
export function layoutText(text: TextElement, measure: Measure = defaultMeasure): TextLayout {
  const cached = measure === defaultMeasure ? layoutCache.get(text) : undefined;
  if (cached) return cached;
  const font = cssFont(fontOf(text), text.fontSize);
  const lines = splitLines(text.text);
  const widths = lines.map((line) => measure(line, font));
  const lineHeight = text.fontSize * LINE_HEIGHT;
  const layout: TextLayout = {
    lines,
    widths,
    width: Math.max(text.fontSize * 0.5, ...widths),
    height: lines.length * lineHeight,
    lineHeight,
  };
  if (measure === defaultMeasure) layoutCache.set(text, layout);
  return layout;
}

/** Font sizes offered in the style panel, in board units. */
export const FONT_SIZES = [
  { value: 16, label: 'S', name: 'Small' },
  { value: 24, label: 'M', name: 'Medium' },
  { value: 36, label: 'L', name: 'Large' },
  { value: 56, label: 'XL', name: 'Extra large' },
] as const;
