import type { ReactNode } from 'react';
import { MAX_SCALE, MIN_SCALE } from '../lib/view.ts';

type Props = {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Back to 100%, keeping the middle of the screen where it is. */
  onReset: () => void;
  /** Frame everything on the board. */
  onFit: () => void;
  /** The dot grid (shapes snap to it while it is shown). */
  grid: boolean;
  onGridToggle: () => void;
};

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Zoom out / level / zoom in / fit. A row on desktop, a column at the screen edge on phones. */
export function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
  onFit,
  grid,
  onGridToggle,
}: Props) {
  const percent = Math.round(scale * 100);
  return (
    <div className="zoom" role="group" aria-label="Zoom">
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={scale <= MIN_SCALE + 1e-6}
        onClick={onZoomOut}
      >
        <Glyph>
          <path d="M5 12h14" />
        </Glyph>
      </button>
      <button
        type="button"
        className="zoom-level"
        aria-label={`Zoom ${percent}%. Reset to 100%`}
        title="Reset to 100%"
        onClick={onReset}
      >
        {percent}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={scale >= MAX_SCALE - 1e-6}
        onClick={onZoomIn}
      >
        <Glyph>
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </Glyph>
      </button>
      <button type="button" aria-label="Fit all content" title="Fit all content" onClick={onFit}>
        <Glyph>
          <path d="M3 8V5a2 2 0 0 1 2-2h3" />
          <path d="M16 3h3a2 2 0 0 1 2 2v3" />
          <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
          <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
        </Glyph>
      </button>
      <button
        type="button"
        className={grid ? 'active' : ''}
        aria-pressed={grid}
        aria-label="Grid and snapping"
        title="Grid and snapping (Ctrl+')"
        onClick={onGridToggle}
      >
        <Glyph>
          <circle cx="6" cy="6" r="1" />
          <circle cx="12" cy="6" r="1" />
          <circle cx="18" cy="6" r="1" />
          <circle cx="6" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="18" cy="12" r="1" />
          <circle cx="6" cy="18" r="1" />
          <circle cx="12" cy="18" r="1" />
          <circle cx="18" cy="18" r="1" />
        </Glyph>
      </button>
    </div>
  );
}
