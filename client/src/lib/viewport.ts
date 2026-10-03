import type { Insets, Size } from './view.ts';

/** Same breakpoint as the compact (bottom toolbar) layout in index.css. */
export function isCompactLayout(): boolean {
  return window.matchMedia('(max-width: 1099px)').matches;
}

export function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * Screen edges covered by floating UI, so framed content and edge markers stay clear of it. Keep
 * in step with the toolbar and top bar sizes in index.css.
 */
export function uiInsets(): Insets {
  return isCompactLayout()
    ? { top: 64, right: 72, bottom: 100, left: 16 }
    : { top: 84, right: 24, bottom: 72, left: 24 };
}
