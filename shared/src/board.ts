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

const shapeFields = {
  id: idSchema,
  authorId: idSchema,
  color: colorSchema,
  /** Outline width in board units. */
  width: z.number().min(1).max(LIMITS.maxStrokeWidth),
  /**
   * The two corners the user dragged between. For rect and ellipse they span the bounding box
   * (in any order); for line and arrow they are the tail and the head.
   */
  start: pointSchema,
  end: pointSchema,
  createdAt: z.number(),
};

export const rectSchema = z.object({
  ...shapeFields,
  type: z.literal('rect'),
  /** Fill color; absent means outline only. */
  fill: colorSchema.optional(),
});
export const ellipseSchema = z.object({
  ...shapeFields,
  type: z.literal('ellipse'),
  fill: colorSchema.optional(),
});
export const lineSchema = z.object({ ...shapeFields, type: z.literal('line') });
export const arrowSchema = z.object({ ...shapeFields, type: z.literal('arrow') });

export const SHAPE_TYPES = ['rect', 'ellipse', 'line', 'arrow'] as const;

export const shapeSchema = z.discriminatedUnion('type', [
  rectSchema,
  ellipseSchema,
  lineSchema,
  arrowSchema,
]);

export const boardElementSchema = z.discriminatedUnion('type', [
  strokeSchema,
  rectSchema,
  ellipseSchema,
  lineSchema,
  arrowSchema,
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
export type Shape = z.infer<typeof shapeSchema>;
export type ShapeType = Shape['type'];
export type BoardElement = z.infer<typeof boardElementSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Participant = z.infer<typeof participantSchema>;
