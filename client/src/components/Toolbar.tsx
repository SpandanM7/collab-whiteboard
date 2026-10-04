import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ShapeType } from '@whiteboard/shared';
import { isShapeTool } from '../types.ts';
import type { Tool } from '../types.ts';

type Props = {
  tool: Tool;
  color: string;
  width: number;
  /** Whether new rectangles and ellipses are filled, and with which color. */
  fillOn: boolean;
  fillColor: string;
  onToolChange: (tool: Tool) => void;
  onFillOnChange: (on: boolean) => void;
  onFillColorChange: (color: string) => void;
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

const SHAPE_TOOLS: { tool: ShapeType; label: string; icon: ReactNode }[] = [
  { tool: 'rect', label: 'Rectangle', icon: <rect x="4" y="5" width="16" height="14" rx="1" /> },
  { tool: 'ellipse', label: 'Ellipse', icon: <ellipse cx="12" cy="12" rx="9" ry="7" /> },
  { tool: 'line', label: 'Line', icon: <path d="M5 19 19 5" /> },
  {
    tool: 'arrow',
    label: 'Arrow',
    icon: (
      <>
        <path d="M5 19 19 5" />
        <path d="M9 5h10v10" />
      </>
    ),
  },
];

export function Toolbar({
  tool,
  color,
  width,
  fillOn,
  fillColor,
  onToolChange,
  onFillOnChange,
  onFillColorChange,
  onColorChange,
  onWidthChange,
  onClear,
  clearDisabled,
}: Props) {
  // Compact layout only: the width slider lives in a popover above the bar.
  const [widthOpen, setWidthOpen] = useState(false);
  // The four shapes and the fill option share one toolbar button, so the bar stays the same width.
  const [shapesOpen, setShapesOpen] = useState(false);
  const [lastShape, setLastShape] = useState<ShapeType>('rect');
  const shapeActive = isShapeTool(tool);
  if (isShapeTool(tool) && tool !== lastShape) setLastShape(tool);

  // Anything outside the popover (the canvas, another tool) or Escape closes it.
  useEffect(() => {
    if (!shapesOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (!target?.closest('.shapes-popover, .shapes-toggle')) setShapesOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShapesOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [shapesOpen]);

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
      <button
        type="button"
        className={tool === 'hand' ? 'active' : ''}
        aria-pressed={tool === 'hand'}
        onClick={() => onToolChange('hand')}
      >
        <Icon>
          <path d="M18 11V6a2 2 0 0 0-4 0" />
          <path d="M14 10V4a2 2 0 0 0-4 0v2" />
          <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15" />
        </Icon>
        <span className="label">Hand</span>
      </button>
      <button
        type="button"
        className={`shapes-toggle${shapeActive ? ' active' : ''}`}
        aria-pressed={shapeActive}
        aria-expanded={shapesOpen}
        aria-haspopup="true"
        onClick={() => {
          if (!shapeActive) onToolChange(lastShape);
          setShapesOpen(!shapeActive || !shapesOpen);
        }}
      >
        <Icon>{SHAPE_TOOLS.find((shape) => shape.tool === lastShape)?.icon}</Icon>
        <span className="label">Shapes</span>
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
      {shapesOpen && (
        <div className="shapes-popover" role="group" aria-label="Shapes">
          {SHAPE_TOOLS.map((shape) => (
            <button
              key={shape.tool}
              type="button"
              className={tool === shape.tool ? 'active' : ''}
              aria-pressed={tool === shape.tool}
              onClick={() => {
                onToolChange(shape.tool);
                setShapesOpen(false);
              }}
            >
              <Icon>{shape.icon}</Icon>
              <span className="label">{shape.label}</span>
            </button>
          ))}
          <div className="fill-options">
            <button
              type="button"
              className={fillOn ? 'active' : ''}
              aria-pressed={fillOn}
              aria-label="Fill rectangles and ellipses"
              title="Fill rectangles and ellipses"
              onClick={() => onFillOnChange(!fillOn)}
            >
              <Icon>
                <rect
                  x="4"
                  y="4"
                  width="16"
                  height="16"
                  rx="2"
                  fill={fillOn ? fillColor : 'none'}
                />
              </Icon>
              <span className="label">Fill</span>
            </button>
            <input
              type="color"
              value={fillColor}
              aria-label="Fill color"
              onChange={(e) => {
                onFillColorChange(e.target.value);
                onFillOnChange(true);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
