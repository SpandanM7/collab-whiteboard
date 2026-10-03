import { useState } from 'react';
import type { BoardElement, Point } from '@whiteboard/shared';
import { rectContains } from '../lib/geometry.ts';
import { HOME_VIEW, centerOn, contentBounds, fitView, visibleRect, zoomAt } from '../lib/view.ts';
import type { View } from '../lib/view.ts';
import { uiInsets, viewportSize } from '../lib/viewport.ts';

const ZOOM_STEP = 1.25;

/**
 * This person's pan and zoom over the board. Local only: it never goes over the socket, so a
 * phone and a desktop can look at different parts of the same board.
 */
export function useBoardView(elements: BoardElement[]) {
  const [view, setView] = useState<View>(HOME_VIEW);
  // A board opens at 100% unless what is on it lies off screen (say, drawn on a bigger screen).
  // Then it is framed once, as long as the person has not moved the view or drawn yet.
  const [pristine, setPristine] = useState(true);

  if (pristine && elements.length > 0) {
    setPristine(false);
    const bounds = contentBounds(elements);
    const size = viewportSize();
    if (bounds && !rectContains(visibleRect(view, size), bounds)) {
      setView(fitView(bounds, size, uiInsets()));
    }
  }

  /** The person changed the view: use it, and never auto-frame over their choice. */
  const changeView = (next: View) => {
    setPristine(false);
    setView(next);
  };

  const screenCenter = (): Point => {
    const { width, height } = viewportSize();
    return { x: width / 2, y: height / 2 };
  };

  return {
    view,
    changeView,
    /** Drawing counts as having settled in: do not move the view afterwards. */
    markInteracted: () => setPristine(false),
    zoomIn: () => changeView(zoomAt(view, screenCenter(), view.scale * ZOOM_STEP)),
    zoomOut: () => changeView(zoomAt(view, screenCenter(), view.scale / ZOOM_STEP)),
    resetZoom: () => changeView(zoomAt(view, screenCenter(), 1)),
    fitAll: () => {
      const bounds = contentBounds(elements);
      changeView(bounds ? fitView(bounds, viewportSize(), uiInsets()) : HOME_VIEW);
    },
    jumpTo: (board: Point) => changeView(centerOn(view, board, viewportSize())),
  };
}
