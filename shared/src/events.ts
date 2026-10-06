import { z } from 'zod';
import {
  boardElementSchema,
  boardIdSchema,
  boardSchema,
  colorSchema,
  elementInputSchema,
  idSchema,
  participantSchema,
  pointCountOf,
  pointSchema,
} from './board.ts';
import { LIMITS } from './limits.ts';

/**
 * Socket event contract (SPEC.md section 8). Event names and payloads are defined here once;
 * client and server import them instead of using string literals.
 */

export const CLIENT_EVENTS = {
  roomJoin: 'room:join',
  strokeStart: 'stroke:start',
  strokePoints: 'stroke:points',
  strokeEnd: 'stroke:end',
  elementAdd: 'element:add',
  elementDelete: 'element:delete',
  elementsAdd: 'elements:add',
  elementsUpdate: 'elements:update',
  elementsDelete: 'elements:delete',
  elementsReorder: 'elements:reorder',
  boardClear: 'board:clear',
  cursorMove: 'cursor:move',
} as const;

export const SERVER_EVENTS = {
  roomState: 'room:state',
  strokeStart: 'stroke:start',
  strokePoints: 'stroke:points',
  strokeEnd: 'stroke:end',
  elementAdded: 'element:added',
  elementDeleted: 'element:deleted',
  elementsAdded: 'elements:added',
  elementsUpdated: 'elements:updated',
  elementsDeleted: 'elements:deleted',
  elementsReordered: 'elements:reordered',
  boardCleared: 'board:cleared',
  participantJoined: 'participant:joined',
  participantLeft: 'participant:left',
  cursorMoved: 'cursor:moved',
  error: 'error',
} as const;

// ---- Client -> server payloads ----

export const roomJoinPayload = z.object({
  boardId: boardIdSchema,
  name: z.string().trim().min(1).max(LIMITS.maxNameLength),
  color: colorSchema,
});

export const strokeStartPayload = z.object({
  id: idSchema,
  color: colorSchema,
  width: z.number().min(1).max(LIMITS.maxStrokeWidth),
  point: pointSchema,
});

export const strokePointsPayload = z.object({
  id: idSchema,
  points: z.array(pointSchema).min(1).max(LIMITS.maxPointsPerMessage),
});

export const strokeEndPayload = z.object({ id: idSchema });

/**
 * A finished element, sent in one message: a shape (only shown to others on release), a text, or a
 * complete stroke. The server sets `authorId` and `createdAt`, so the client does not send them.
 */
export const elementAddPayload = elementInputSchema;

export const elementDeletePayload = z.object({ id: idSchema });

/** Elements in one batch message: ids unique, and at most one full stroke's worth of points. */
const elementBatch = z
  .array(elementInputSchema)
  .min(1)
  .max(LIMITS.maxElementsPerMessage)
  .refine((elements) => new Set(elements.map((e) => e.id)).size === elements.length, {
    message: 'Element ids in one message must be unique.',
  })
  .refine(
    (elements) => elements.reduce((sum, e) => sum + pointCountOf(e), 0) <= LIMITS.maxPointsPerBatch,
    { message: `One message carries at most ${LIMITS.maxPointsPerBatch} points.` },
  );

const idBatch = z.array(idSchema).min(1).max(LIMITS.maxIdsPerMessage);

/** New finished elements (paste, duplicate, undo of a delete). Ids the board has are skipped. */
export const elementsAddPayload = z.object({ elements: elementBatch });

/**
 * New versions of existing elements (move, resize, restyle, edit text, undo). Each replaces the
 * element with its id, keeping its place in the stacking order. Ids not on the board are skipped,
 * so an element someone else deleted meanwhile stays deleted.
 */
export const elementsUpdatePayload = z.object({ elements: elementBatch });

export const elementsDeletePayload = z.object({ ids: idBatch });

export const REORDER_TARGETS = ['front', 'back'] as const;

/** Moves elements to the top (`front`) or bottom (`back`) of the stack, keeping their order. */
export const elementsReorderPayload = z.object({ ids: idBatch, to: z.enum(REORDER_TARGETS) });

export const boardClearPayload = z.object({});

export const cursorMovePayload = z.object({ point: pointSchema });

// ---- Server -> client payloads ----

export const roomStatePayload = z.object({
  board: boardSchema,
  participants: z.array(participantSchema),
});

/** Relays add the id of the participant who drew the stroke. */
export const strokeStartRelayPayload = strokeStartPayload.extend({ authorId: idSchema });
export const strokePointsRelayPayload = strokePointsPayload.extend({ authorId: idSchema });
export const strokeEndRelayPayload = strokeEndPayload.extend({ authorId: idSchema });

/** The element as stored on the board, including the server-assigned author. */
export const elementAddedPayload = boardElementSchema;

export const elementDeletedPayload = z.object({ id: idSchema });

/** The stored elements that were added or replaced (authors and times as on the board). */
export const elementsAddedPayload = z.object({ elements: z.array(boardElementSchema) });
export const elementsUpdatedPayload = z.object({ elements: z.array(boardElementSchema) });
/** The ids that were actually removed or moved. */
export const elementsDeletedPayload = z.object({ ids: z.array(idSchema) });
export const elementsReorderedPayload = elementsReorderPayload;

export const boardClearedPayload = z.object({});

/** Also sent when a present participant changes their name, so receivers treat it as an upsert. */
export const participantJoinedPayload = participantSchema;

export const participantLeftPayload = z.object({ clientId: idSchema });

export const cursorMovedPayload = z.object({ clientId: idSchema, point: pointSchema });

export const ERROR_CODES = [
  'invalid_payload',
  'not_in_room',
  'room_full',
  'server_full',
  'board_full',
  'duplicate_id',
  'unknown_stroke',
  'stroke_too_large',
  'rate_limited',
  'internal',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export const errorPayload = z.object({ code: errorCodeSchema, message: z.string() });

// ---- Inferred types ----

export type RoomJoinPayload = z.infer<typeof roomJoinPayload>;
export type StrokeStartPayload = z.infer<typeof strokeStartPayload>;
export type StrokePointsPayload = z.infer<typeof strokePointsPayload>;
export type StrokeEndPayload = z.infer<typeof strokeEndPayload>;
export type ElementAddPayload = z.infer<typeof elementAddPayload>;
export type ElementDeletePayload = z.infer<typeof elementDeletePayload>;
export type ElementsAddPayload = z.infer<typeof elementsAddPayload>;
export type ElementsUpdatePayload = z.infer<typeof elementsUpdatePayload>;
export type ElementsDeletePayload = z.infer<typeof elementsDeletePayload>;
export type ElementsReorderPayload = z.infer<typeof elementsReorderPayload>;
export type ReorderTarget = (typeof REORDER_TARGETS)[number];
export type BoardClearPayload = z.infer<typeof boardClearPayload>;
export type CursorMovePayload = z.infer<typeof cursorMovePayload>;

export type RoomStatePayload = z.infer<typeof roomStatePayload>;
export type StrokeStartRelayPayload = z.infer<typeof strokeStartRelayPayload>;
export type StrokePointsRelayPayload = z.infer<typeof strokePointsRelayPayload>;
export type StrokeEndRelayPayload = z.infer<typeof strokeEndRelayPayload>;
export type ElementAddedPayload = z.infer<typeof elementAddedPayload>;
export type ElementDeletedPayload = z.infer<typeof elementDeletedPayload>;
export type ElementsAddedPayload = z.infer<typeof elementsAddedPayload>;
export type ElementsUpdatedPayload = z.infer<typeof elementsUpdatedPayload>;
export type ElementsDeletedPayload = z.infer<typeof elementsDeletedPayload>;
export type ElementsReorderedPayload = z.infer<typeof elementsReorderedPayload>;
export type BoardClearedPayload = z.infer<typeof boardClearedPayload>;
export type ParticipantJoinedPayload = z.infer<typeof participantJoinedPayload>;
export type ParticipantLeftPayload = z.infer<typeof participantLeftPayload>;
export type CursorMovedPayload = z.infer<typeof cursorMovedPayload>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorPayload = z.infer<typeof errorPayload>;

// ---- Typed Socket.IO event maps ----

export interface ClientToServerEvents {
  [CLIENT_EVENTS.roomJoin]: (payload: RoomJoinPayload) => void;
  [CLIENT_EVENTS.strokeStart]: (payload: StrokeStartPayload) => void;
  [CLIENT_EVENTS.strokePoints]: (payload: StrokePointsPayload) => void;
  [CLIENT_EVENTS.strokeEnd]: (payload: StrokeEndPayload) => void;
  [CLIENT_EVENTS.elementAdd]: (payload: ElementAddPayload) => void;
  [CLIENT_EVENTS.elementDelete]: (payload: ElementDeletePayload) => void;
  [CLIENT_EVENTS.elementsAdd]: (payload: ElementsAddPayload) => void;
  [CLIENT_EVENTS.elementsUpdate]: (payload: ElementsUpdatePayload) => void;
  [CLIENT_EVENTS.elementsDelete]: (payload: ElementsDeletePayload) => void;
  [CLIENT_EVENTS.elementsReorder]: (payload: ElementsReorderPayload) => void;
  [CLIENT_EVENTS.boardClear]: (payload: BoardClearPayload) => void;
  [CLIENT_EVENTS.cursorMove]: (payload: CursorMovePayload) => void;
}

export interface ServerToClientEvents {
  [SERVER_EVENTS.roomState]: (payload: RoomStatePayload) => void;
  [SERVER_EVENTS.strokeStart]: (payload: StrokeStartRelayPayload) => void;
  [SERVER_EVENTS.strokePoints]: (payload: StrokePointsRelayPayload) => void;
  [SERVER_EVENTS.strokeEnd]: (payload: StrokeEndRelayPayload) => void;
  [SERVER_EVENTS.elementAdded]: (payload: ElementAddedPayload) => void;
  [SERVER_EVENTS.elementDeleted]: (payload: ElementDeletedPayload) => void;
  [SERVER_EVENTS.elementsAdded]: (payload: ElementsAddedPayload) => void;
  [SERVER_EVENTS.elementsUpdated]: (payload: ElementsUpdatedPayload) => void;
  [SERVER_EVENTS.elementsDeleted]: (payload: ElementsDeletedPayload) => void;
  [SERVER_EVENTS.elementsReordered]: (payload: ElementsReorderedPayload) => void;
  [SERVER_EVENTS.boardCleared]: (payload: BoardClearedPayload) => void;
  [SERVER_EVENTS.participantJoined]: (payload: ParticipantJoinedPayload) => void;
  [SERVER_EVENTS.participantLeft]: (payload: ParticipantLeftPayload) => void;
  [SERVER_EVENTS.cursorMoved]: (payload: CursorMovedPayload) => void;
  [SERVER_EVENTS.error]: (payload: ErrorPayload) => void;
}
