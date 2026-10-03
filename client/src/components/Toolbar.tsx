import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Tool } from '../types.ts';

type Props = {
  tool: Tool;
  color: string;
  width: number;
  onToolChange: (tool: Tool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  onClear: () => void;
  /** Clearing has to reach the server, so it is unavailable while offline. */
  clearDisabled?: boolean;
};

export const MIN_WIDTH = 1;
export const MAX_WIDTH = 40;

// Icons only show in the compact (bottom bar) layout; desktop keeps the text buttons.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width="22"
      height="22"
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

export function Toolbar({
  tool,
  color,
  width,
  onToolChange,
  onColorChange,
  onWidthChange,
  onClear,
  clearDisabled,
}: Props) {
  // Compact layout only: the width slider lives in a popover above the bar.
  const [widthOpen, setWidthOpen] = useState(false);

  return (
    <div
      className={`toolbar${widthOpen ? ' width-open' : ''}`}
      role="toolbar"
      aria-label="Drawing tools"
    >
      <button
        type="button"
        className={tool === 'pen' ? 'active' : ''}
        aria-pressed={tool === 'pen'}
        onClick={() => onToolChange('pen')}
      >
        <Icon>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </Icon>
        <span className="label">Pen</span>
      </button>
      <button
        type="button"
        className={tool === 'eraser' ? 'active' : ''}
        aria-pressed={tool === 'eraser'}
        onClick={() => onToolChange('eraser')}
      >
        <Icon>
          <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21" />
          <path d="M22 21H7" />
          <path d="m5 11 9 9" />
        </Icon>
        <span className="label">Eraser</span>
      </button>
      <label className="color">
        <input
          type="color"
          value={color}
          aria-label="Color"
          onChange={(e) => onColorChange(e.target.value)}
        />
        <span className="label">Color</span>
      </label>
      <button
        type="button"
        className="width-toggle"
        aria-expanded={widthOpen}
        aria-label={`Stroke width, ${width}px`}
        onClick={() => setWidthOpen((open) => !open)}
      >
        <span className="width-dot-box" aria-hidden="true">
          <span
            className="width-dot"
            style={{ width: Math.max(4, width), height: Math.max(4, width) }}
          />
        </span>
        <span className="label">Size</span>
      </button>
      <label className="width">
        <input
          type="range"
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          value={width}
          aria-label="Stroke width"
          onChange={(e) => onWidthChange(Number(e.target.value))}
        />
        <span>{width}px</span>
      </label>
      <button type="button" className="clear" disabled={clearDisabled} onClick={onClear}>
        <Icon>
          <path d="M3 6h18" />
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </Icon>
        <span className="label">Clear</span>
      </button>
    </div>
  );
}
