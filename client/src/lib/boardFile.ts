import { LIMITS, elementInputSchema, toElementInput } from '@whiteboard/shared';
import type { BoardElement, ElementInput } from '@whiteboard/shared';

/** Marks a file as a saved board, so any other JSON is turned away. */
export const BOARD_FILE_KIND = 'collab-whiteboard/board';
/** Bumped when the format changes in a way older versions cannot read. */
export const BOARD_FILE_VERSION = 1;
/** Bigger files are refused before reading: a full board is a few MB. */
export const MAX_BOARD_FILE_BYTES = 25 * 1024 * 1024;

/**
 * A board as a file: the elements as they go over the wire (no author or time), in stacking
 * order. Plain JSON, so it can be kept as a backup and opened on any board, in any browser.
 */
export function serializeBoardFile(elements: readonly BoardElement[], savedAt: Date): string {
  return JSON.stringify({
    kind: BOARD_FILE_KIND,
    version: BOARD_FILE_VERSION,
    savedAt: savedAt.toISOString(),
    elements: elements.map(toElementInput),
  });
}

export type BoardFileResult =
  | { ok: true; elements: ElementInput[]; skipped: number }
  | { ok: false; reason: 'not-a-board' | 'too-new' | 'empty' };

/**
 * The elements in a saved board file. Each one is validated as the server would; invalid ones are
 * skipped and counted, and at most a full board's worth is read.
 */
export function parseBoardFile(text: string): BoardFileResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not-a-board' };
  }
  if (typeof data !== 'object' || data === null) return { ok: false, reason: 'not-a-board' };
  const { kind, version, elements } = data as Record<string, unknown>;
  if (kind !== BOARD_FILE_KIND || !Array.isArray(elements)) {
    return { ok: false, reason: 'not-a-board' };
  }
  if (typeof version !== 'number' || version > BOARD_FILE_VERSION) {
    return { ok: false, reason: 'too-new' };
  }
  const candidates = elements.slice(0, LIMITS.maxElementsPerBoard);
  const valid = candidates
    .map((e) => elementInputSchema.safeParse(e))
    .flatMap((r) => (r.success ? [r.data] : []));
  if (valid.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, elements: valid, skipped: elements.length - valid.length };
}
