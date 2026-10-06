import { z } from 'zod';
import { LIMITS } from './limits.ts';

/** URL-safe identifier, as produced by nanoid (also matches Socket.IO socket ids). */
export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Board ids are at least 8 URL-safe characters (SPEC.md FR-1). */
export const boardIdSchema = idSchema.min(8);

/** Hex color, e.g. "#1a1a1a". */
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const coordinateSchema = z.number().min(-LIMITS.maxCoordinate).max(LIMITS.maxCoordinate);

/** A position in board space (not screen pixels). */
export const pointSchema = z.object({ x: coordinateSchema, y: coordinateSchema });

export const strokeSchema = z.object({
  id: idSchema,
  type: z.literal('stroke'),
  authorId: idSchema,
  color: colorSchema,
  /** Line width in board units. */
  width: z.number().min(1).max(LIMITS.maxStrokeWidth),
  points: z.array(pointSchema).max(LIMITS.maxPointsPerStroke),
  createdAt: z.number(),
});

/** Shapes with an inside: they can be filled. */
export const CLOSED_SHAPE_TYPES = [
  'rect',
  'ellipse',
  'diamond',
  'triangle',
  'hexagon',
  'star',
  'cylinder',
] as const;
/** Shapes that run from a tail (`start`) to a head (`end`). */
export const LINE_SHAPE_TYPES = ['line', 'arrow'] as const;
export const SHAPE_TYPES = [...CLOSED_SHAPE_TYPES, ...LINE_SHAPE_TYPES] as const;

export const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export const FILL_STYLES = ['solid', 'hatch', 'cross'] as const;
export const ARROWHEADS = ['none', 'arrow', 'triangle', 'dot', 'bar'] as const;
/** `elbow` runs in right angles: along one axis, across, then along it again. */
export const LINE_ROUTES = ['straight', 'elbow'] as const;

const shapeFields = {
  id: idSchema,
  authorId: idSchema,
  color: colorSchema,
  /** Outline width in board units. */
  width: z.number().min(1).max(LIMITS.maxStrokeWidth),
  /**
   * The two corners the user dragged between. For closed shapes they span the bounding box (in
   * any order); for line and arrow they are the tail and the head.
   */
  start: pointSchema,
  end: pointSchema,
  createdAt: z.number(),
  /** Absent means solid. */
  strokeStyle: z.enum(STROKE_STYLES).optional(),
  /** Absent means fully opaque. */
  opacity: z.number().min(0.1).max(1).optional(),
};

export const closedShapeSchema = z.object({
  ...shapeFields,
  type: z.enum(CLOSED_SHAPE_TYPES),
  /** Fill color; absent means outline only. */
  fill: colorSchema.optional(),
  /** How the fill is painted; absent means solid. */
  fillStyle: z.enum(FILL_STYLES).optional(),
  /** Rounded corners (shapes with corners only). */
  rounded: z.boolean().optional(),
});

export const lineShapeSchema = z.object({
  ...shapeFields,
  type: z.enum(LINE_SHAPE_TYPES),
  /** Absent means no head at the tail. */
  startHead: z.enum(ARROWHEADS).optional(),
  /** Absent means an open arrow head on an arrow, and no head on a line. */
  endHead: z.enum(ARROWHEADS).optional(),
  /** Absent means straight. */
  route: z.enum(LINE_ROUTES).optional(),
});

export const shapeSchema = z.discriminatedUnion('type', [closedShapeSchema, lineShapeSchema]);

export const TEXT_FONTS = ['sans', 'serif', 'mono', 'hand'] as const;
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;

/**
 * A block of text. `start` is the top-left corner of the block; lines are split on "\n" and
 * aligned inside the block, which is as wide as its longest line. Never empty.
 */
export const textSchema = z.object({
  id: idSchema,
  type: z.literal('text'),
  authorId: idSchema,
  color: colorSchema,
  start: pointSchema,
  text: z
    .string()
    .max(LIMITS.maxTextLength)
    .refine((t) => t.trim().length > 0, 'Text cannot be empty.'),
  /** Board units; line height is 1.25 times this. */
  fontSize: z.number().min(LIMITS.minFontSize).max(LIMITS.maxFontSize),
  createdAt: z.number(),
  /** Absent means sans. */
  font: z.enum(TEXT_FONTS).optional(),
  /** Absent means left. */
  align: z.enum(TEXT_ALIGNS).optional(),
  /** Absent means fully opaque. */
  opacity: z.number().min(0.1).max(1).optional(),
});

export const boardElementSchema = z.discriminatedUnion('type', [
  strokeSchema,
  closedShapeSchema,
  lineShapeSchema,
  textSchema,
]);

/**
 * A finished element as a client sends it: everything but `authorId` and `createdAt`, which the
 * server sets. Strokes sent this way (pasted, duplicated, restored by undo) are complete.
 */
const inputOmit = { authorId: true, createdAt: true } as const;
export const elementInputSchema = z.discriminatedUnion('type', [
  strokeSchema.omit(inputOmit).extend({
    points: z.array(pointSchema).min(1).max(LIMITS.maxPointsPerStroke),
  }),
  closedShapeSchema.omit(inputOmit),
  lineShapeSchema.omit(inputOmit),
  textSchema.omit(inputOmit),
]);

export const boardSchema = z.object({
  id: boardIdSchema,
  /** Ordered; later = on top. */
  elements: z.array(boardElementSchema),
  createdAt: z.number(),
  lastActiveAt: z.number(),
});

export const participantSchema = z.object({
  clientId: idSchema,
  name: z.string().trim().min(1).max(LIMITS.maxNameLength),
  color: colorSchema,
  cursor: pointSchema.optional(),
});

export type Point = z.infer<typeof pointSchema>;
export type Stroke = z.infer<typeof strokeSchema>;
export type ClosedShape = z.infer<typeof closedShapeSchema>;
export type LineShape = z.infer<typeof lineShapeSchema>;
export type Shape = z.infer<typeof shapeSchema>;
export type ShapeType = Shape['type'];
export type ClosedShapeType = ClosedShape['type'];
export type StrokeStyle = (typeof STROKE_STYLES)[number];
export type FillStyle = (typeof FILL_STYLES)[number];
export type Arrowhead = (typeof ARROWHEADS)[number];
export type LineRoute = (typeof LINE_ROUTES)[number];
export type TextElement = z.infer<typeof textSchema>;
export type TextFont = (typeof TEXT_FONTS)[number];
export type TextAlign = (typeof TEXT_ALIGNS)[number];
export type BoardElement = z.infer<typeof boardElementSchema>;
export type ElementType = BoardElement['type'];
export type ElementInput = z.infer<typeof elementInputSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Participant = z.infer<typeof participantSchema>;

export function isClosedShapeType(type: string): type is ClosedShapeType {
  return (CLOSED_SHAPE_TYPES as readonly string[]).includes(type);
}

export function isClosedShape(shape: Shape): shape is ClosedShape {
  return isClosedShapeType(shape.type);
}

export function isShape(element: BoardElement): element is Shape {
  return element.type !== 'stroke' && element.type !== 'text';
}

/** Stroke points an element carries (what counts toward the board's point budget). */
export function pointCountOf(element: { type: string; points?: unknown[] }): number {
  return element.type === 'stroke' ? (element.points?.length ?? 0) : 0;
}

/** The element as it goes over the wire: the server sets the author and the time. */
export function toElementInput(element: BoardElement): ElementInput {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped from the payload
  const { authorId, createdAt, ...input } = element;
  return input;
}
