import { LIMITS, elementInputSchema, toElementInput } from '@whiteboard/shared';
import type { BoardElement, ElementInput, Point } from '@whiteboard/shared';
import { selectionBounds } from './selection.ts';
import { transformElement, translation } from './transform.ts';

/** Marks clipboard text as elements copied from a board (any board, in any tab). */
const CLIPBOARD_KIND = 'collab-whiteboard/elements';

/** Text for the system clipboard: plain JSON, so it survives being pasted into another tab. */
export function serializeElements(elements: readonly BoardElement[]): string {
  return JSON.stringify({ kind: CLIPBOARD_KIND, elements: elements.map(toElementInput) });
}

/**
 * The elements in clipboard text copied from a board, or null if it is anything else (including
 * text that merely looks similar). Every element is validated like the server would.
 */
export function parseElements(text: string): ElementInput[] | null {
  if (!text.includes(CLIPBOARD_KIND)) return null;
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null) return null;
    const { kind, elements } = data as { kind?: unknown; elements?: unknown };
    if (kind !== CLIPBOARD_KIND || !Array.isArray(elements)) return null;
    const valid = elements
      .slice(0, LIMITS.maxElementsPerBoard)
      .map((e) => elementInputSchema.safeParse(e))
      .flatMap((r) => (r.success ? [r.data] : []));
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

export type Placement = { offset: Point } | { center: Point };

/**
 * Fresh copies of `elements` with new ids, either shifted by an offset (duplicate) or centered
 * on a point (paste at the pointer). Their stacking order is kept.
 */
export function cloneElements(
  elements: readonly (ElementInput | BoardElement)[],
  placement: Placement,
  newId: () => string,
  authorId: string,
  now: number,
): BoardElement[] {
  const stored = elements.map(
    (e) => ({ ...e, id: newId(), authorId, createdAt: now }) as BoardElement,
  );
  const bounds = selectionBounds(stored);
  if (!bounds) return stored;
  const shift =
    'offset' in placement
      ? placement.offset
      : {
          x: placement.center.x - (bounds.left + bounds.right) / 2,
          y: placement.center.y - (bounds.top + bounds.bottom) / 2,
        };
  const t = translation(shift.x, shift.y);
  return stored.map((e) => transformElement(e, t));
}
