import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ShapeType } from '@whiteboard/shared';
import { MAX_WIDTH, MIN_WIDTH } from '../lib/toolStyle.ts';
import { isShapeTool } from '../types.ts';
import type { Tool } from '../types.ts';
import { Icon } from './Icon.tsx';
import { SHAPE_TOOLS } from './shapeIcons.tsx';

type Props = {
  tool: Tool;
  color: string;
  width: number;
  onToolChange: (tool: Tool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  /** Compact layout only: whether the style panel is open, and the button that toggles it. */
  styleOpen: boolean;
  onStyleToggle: () => void;
  onClear: () => void;
  /** Clearing has to reach the server, so it is unavailable while offline. */
  clearDisabled?: boolean;
};

const withKey = (label: string, key?: string) => (key ? `${label} (${key})` : label);

export function Toolbar({
  tool,
  color,
  width,
  onToolChange,
  onColorChange,
  onWidthChange,
  styleOpen,
  onStyleToggle,
  onClear,
  clearDisabled,
}: Props) {
  // Compact layout only: the width slider lives in a popover above the bar.
  const [widthOpen, setWidthOpen] = useState(false);
  // All the shapes share one toolbar button, so the bar stays the same width.
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

  const toolButton = (value: Tool, label: string, key: string, icon: ReactNode) => (
    <button
      type="button"
      className={tool === value ? 'active' : ''}
      aria-pressed={tool === value}
      title={withKey(label, key)}
      onClick={() => onToolChange(value)}
    >
      <Icon>{icon}</Icon>
      <span className="label">{label}</span>
    </button>
  );

  return (
    <div
      className={`toolbar${widthOpen ? ' width-open' : ''}`}
      role="toolbar"
      aria-label="Drawing tools"
    >
      {toolButton(
        'pen',
        'Pen',
        'P',
        <>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </>,
      )}
      {toolButton(
        'eraser',
        'Eraser',
        'E',
        <>
          <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9.6-9.6a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 21" />
          <path d="M22 21H7" />
          <path d="m5 11 9 9" />
        </>,
      )}
      {toolButton(
        'hand',
        'Hand',
        'H',
        <>
          <path d="M18 11V6a2 2 0 0 0-4 0" />
          <path d="M14 10V4a2 2 0 0 0-4 0v2" />
          <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15" />
        </>,
      )}
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
      {shapeActive && (
        <button
          type="button"
          className={`style-toggle${styleOpen ? ' active' : ''}`}
          aria-expanded={styleOpen}
          onClick={onStyleToggle}
        >
          <Icon>
            <circle cx="13.5" cy="6.5" r="1.5" />
            <circle cx="17.5" cy="10.5" r="1.5" />
            <circle cx="8.5" cy="7.5" r="1.5" />
            <circle cx="6.5" cy="12.5" r="1.5" />
            <path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-.5a2 2 0 0 1 2-2h2a4 4 0 0 0 4-4C22 7 17.5 2 12 2Z" />
          </Icon>
          <span className="label">Style</span>
        </button>
      )}
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
              aria-label={shape.label}
              title={withKey(shape.label, shape.key)}
              onClick={() => {
                onToolChange(shape.tool);
                setShapesOpen(false);
              }}
            >
              <Icon>{shape.icon}</Icon>
              <span className="label">{shape.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
