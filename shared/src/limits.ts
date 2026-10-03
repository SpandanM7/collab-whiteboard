/** Size limits enforced by the server and respected by the client. */
export const LIMITS = {
  /** Max points in one `stroke:points` message. The client chunks batches to this size. */
  maxPointsPerMessage: 200,
  /** Max total points in a single stroke. */
  maxPointsPerStroke: 5_000,
  /** Max elements on one board (see SPEC.md section 5). */
  maxElementsPerBoard: 2_000,
  /** Max points across all strokes of one board: bounds a board's memory (about 40 B a point). */
  maxPointsPerBoard: 100_000,
  /** Max participants in one room (see SPEC.md section 5). */
  maxRoomSize: 10,
  /** Max boards held in server memory at once. */
  maxBoards: 30,
  /** A board nobody is in is dropped from memory after this long without activity. */
  boardIdleTtlMs: 6 * 60 * 60 * 1000,
  /** Coordinates must be within +/- this value in board space. */
  maxCoordinate: 1_000_000,
  maxStrokeWidth: 100,
  maxNameLength: 32,
  /** A cursor with no update for this long is considered gone (server drops it, client hides it). */
  cursorTtlMs: 10_000,
  /** Per-socket rate limit: a burst of this many events, refilled at `eventsPerSecond`. */
  eventBurst: 150,
  eventsPerSecond: 100,
} as const;
