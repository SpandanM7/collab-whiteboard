import {
  ARROWHEADS,
  FILL_STYLES,
  LINE_ROUTES,
  STROKE_STYLES,
  colorSchema,
  isClosedShape,
} from '@whiteboard/shared';
import type {
  Arrowhead,
  FillStyle,
  LineRoute,
  Point,
  Shape,
  ShapeType,
  StrokeStyle,
} from '@whiteboard/shared';

export const MIN_WIDTH = 1;
export const MAX_WIDTH = 40;

/** What new strokes and shapes look like. Remembered between visits, never synced. */
export type ToolStyle = {
  color: string;
  width: number;
  strokeStyle: StrokeStyle;
  /** 0.1 to 1. */
  opacity: number;
  /** Whether closed shapes are filled; the color is kept while it is off. */
  fillOn: boolean;
  fillColor: string;
  fillStyle: FillStyle;
  rounded: boolean;
  /** Heads for the arrow tool; the line tool never has heads. */
  startHead: Arrowhead;
  endHead: Arrowhead;
  route: LineRoute;
};

const isColor = (v: unknown) => colorSchema.safeParse(v).success;
const isOneOf = (values: readonly string[]) => (v: unknown) =>
  typeof v === 'string' && values.includes(v);
const isBoolean = (v: unknown) => typeof v === 'boolean';

/** Which stored values are acceptable for each field. */
const VALID: { [K in keyof ToolStyle]: (v: unknown) => boolean } = {
  color: isColor,
  width: (v) => Number.isInteger(v) && (v as number) >= MIN_WIDTH && (v as number) <= MAX_WIDTH,
  strokeStyle: isOneOf(STROKE_STYLES),
  opacity: (v) => typeof v === 'number' && v >= 0.1 && v <= 1,
  fillOn: isBoolean,
  fillColor: isColor,
  fillStyle: isOneOf(FILL_STYLES),
  rounded: isBoolean,
  startHead: isOneOf(ARROWHEADS),
  endHead: isOneOf(ARROWHEADS),
  route: isOneOf(LINE_ROUTES),
};

export const DEFAULT_STYLE: ToolStyle = {
  color: '#1a1a1a',
  width: 4,
  strokeStyle: 'solid',
  opacity: 1,
  fillOn: false,
  fillColor: '#ffd43b',
  fillStyle: 'solid',
  rounded: false,
  startHead: 'none',
  endHead: 'arrow',
  route: 'straight',
};

/** Quick picks for outlines and fills; the color inputs still allow any color. */
export const STROKE_SWATCHES = ['#1a1a1a', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#9c36b5'];
export const FILL_SWATCHES = ['#ffd43b', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#e9ecef', '#d0bfff'];

/** Shapes whose corners can be rounded. */
const CORNERED: readonly ShapeType[] = ['rect', 'diamond', 'triangle', 'hexagon', 'star'];

export function hasCorners(type: ShapeType): boolean {
  return CORNERED.includes(type);
}

const STORAGE_KEY = 'whiteboard:style';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** localStorage can be missing or throw (private mode, blocked site data); never rely on it. */
function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The remembered style; fields that are missing or invalid fall back to the defaults. */
export function loadStyle(storage: StorageLike | null = defaultStorage()): ToolStyle {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STYLE;
    const stored: unknown = JSON.parse(raw);
    if (typeof stored !== 'object' || stored === null) return DEFAULT_STYLE;
    const style: Record<string, unknown> = { ...DEFAULT_STYLE };
    for (const [key, valid] of Object.entries(VALID)) {
      const value = (stored as Record<string, unknown>)[key];
      if (valid(value)) style[key] = value;
    }
    return style as ToolStyle;
  } catch {
    return DEFAULT_STYLE;
  }
}

export function saveStyle(style: ToolStyle, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(style));
  } catch {
    // Quota or blocked storage: the style just will not survive a reload.
  }
}

/**
 * A shape of `type` between two points, in the current style. Fields at their default are left
 * out, so a plain shape is sent exactly as before styles existed.
 */
export function createShape(
  type: ShapeType,
  base: { id: string; authorId: string; createdAt: number; start: Point; end: Point },
  style: ToolStyle,
): Shape {
  const common = {
    ...base,
    color: style.color,
    width: style.width,
    ...(style.strokeStyle !== 'solid' ? { strokeStyle: style.strokeStyle } : {}),
    ...(style.opacity < 1 ? { opacity: style.opacity } : {}),
  };
  const shape = { ...common, type } as Shape;
  if (isClosedShape(shape)) {
    return {
      ...shape,
      ...(style.fillOn ? { fill: style.fillColor } : {}),
      ...(style.fillOn && style.fillStyle !== 'solid' ? { fillStyle: style.fillStyle } : {}),
      ...(style.rounded && hasCorners(type) ? { rounded: true } : {}),
    };
  }
  return {
    ...shape,
    ...(style.route !== 'straight' ? { route: style.route } : {}),
    ...(type === 'arrow' && style.startHead !== 'none' ? { startHead: style.startHead } : {}),
    ...(type === 'arrow' && style.endHead !== 'arrow' ? { endHead: style.endHead } : {}),
  };
}
