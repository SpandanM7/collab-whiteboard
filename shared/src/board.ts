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

/** v1.1 adds more element types; this becomes a discriminated union. */
export const boardElementSchema = strokeSchema;

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
export type BoardElement = z.infer<typeof boardElementSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Participant = z.infer<typeof participantSchema>;
