import { z } from 'zod';
import {
  boardIdSchema,
  boardSchema,
  colorSchema,
  idSchema,
  participantSchema,
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
  elementDelete: 'element:delete',
  boardClear: 'board:clear',
  cursorMove: 'cursor:move',
} as const;

export const SERVER_EVENTS = {
  roomState: 'room:state',
  strokeStart: 'stroke:start',
  strokePoints: 'stroke:points',
  strokeEnd: 'stroke:end',
  elementDeleted: 'element:deleted',
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

export const elementDeletePayload = z.object({ id: idSchema });

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

export const elementDeletedPayload = z.object({ id: idSchema });

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
  'internal',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);

export const errorPayload = z.object({ code: errorCodeSchema, message: z.string() });

// ---- Inferred types ----

export type RoomJoinPayload = z.infer<typeof roomJoinPayload>;
export type StrokeStartPayload = z.infer<typeof strokeStartPayload>;
export type StrokePointsPayload = z.infer<typeof strokePointsPayload>;
export type StrokeEndPayload = z.infer<typeof strokeEndPayload>;
export type ElementDeletePayload = z.infer<typeof elementDeletePayload>;
export type BoardClearPayload = z.infer<typeof boardClearPayload>;
export type CursorMovePayload = z.infer<typeof cursorMovePayload>;

export type RoomStatePayload = z.infer<typeof roomStatePayload>;
export type StrokeStartRelayPayload = z.infer<typeof strokeStartRelayPayload>;
export type StrokePointsRelayPayload = z.infer<typeof strokePointsRelayPayload>;
export type StrokeEndRelayPayload = z.infer<typeof strokeEndRelayPayload>;
export type ElementDeletedPayload = z.infer<typeof elementDeletedPayload>;
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
  [CLIENT_EVENTS.elementDelete]: (payload: ElementDeletePayload) => void;
  [CLIENT_EVENTS.boardClear]: (payload: BoardClearPayload) => void;
  [CLIENT_EVENTS.cursorMove]: (payload: CursorMovePayload) => void;
}

export interface ServerToClientEvents {
  [SERVER_EVENTS.roomState]: (payload: RoomStatePayload) => void;
  [SERVER_EVENTS.strokeStart]: (payload: StrokeStartRelayPayload) => void;
  [SERVER_EVENTS.strokePoints]: (payload: StrokePointsRelayPayload) => void;
  [SERVER_EVENTS.strokeEnd]: (payload: StrokeEndRelayPayload) => void;
  [SERVER_EVENTS.elementDeleted]: (payload: ElementDeletedPayload) => void;
  [SERVER_EVENTS.boardCleared]: (payload: BoardClearedPayload) => void;
  [SERVER_EVENTS.participantJoined]: (payload: ParticipantJoinedPayload) => void;
  [SERVER_EVENTS.participantLeft]: (payload: ParticipantLeftPayload) => void;
  [SERVER_EVENTS.cursorMoved]: (payload: CursorMovedPayload) => void;
  [SERVER_EVENTS.error]: (payload: ErrorPayload) => void;
}
