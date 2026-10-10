import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import type { ShapeType } from '@whiteboard/shared';
import { useDismiss } from '../hooks/useDismiss.ts';
import { modKey } from '../lib/shortcuts.ts';
import { MAX_WIDTH, MIN_WIDTH } from '../lib/toolStyle.ts';
import { isShapeTool } from '../types.ts';
import type { Tool } from '../types.ts';
import { Icon } from './Icon.tsx';
import {
  ExportIcon,
  HandIcon,
  KeyboardIcon,
  LaserIcon,
  MoreIcon,
  SelectIcon,
  TextIcon,
  TrashIcon,
} from './icons.tsx';
import { SHAPE_TOOLS } from './shapeIcons.tsx';

type Props = {
  tool: Tool;
  color: string;
  width: number;
  onToolChange: (tool: Tool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
  /** Whether the style panel has anything to show (a shape or text tool, or a selection). */
  hasStyle: boolean;
  /** Compact layout only: whether the style panel is open, and the button that toggles it. */
  styleOpen: boolean;
  onStyleToggle: () => void;
  /** Whether the line width applies (it does not to text). Wide layout only. */
  showWidth: boolean;
  onExport: () => void;
  onShortcuts: () => void;
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
  hasStyle,
  styleOpen,
  onStyleToggle,
  showWidth,
  onExport,
  onShortcuts,
  onClear,
  clearDisabled,
}: Props) {
  // All the shapes share one toolbar button, so the bar stays the same width.
  const [shapesOpen, setShapesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [lastShape, setLastShape] = useState<ShapeType>('rect');
  const shapeActive = isShapeTool(tool);
  if (isShapeTool(tool) && tool !== lastShape) setLastShape(tool);

  // Anything outside a popover (the canvas, another tool) or Escape closes it.
  useDismiss(
    shapesOpen,
    '.shapes-popover, .shapes-toggle',
    useCallback(() => setShapesOpen(false), []),
  );
  useDismiss(
    moreOpen,
    '.more-menu, .more-toggle',
    useCallback(() => setMoreOpen(false), []),
  );

  const toolButton = (value: Tool, label: string, key: string, icon: ReactNode, className = '') => (
    <button
      type="button"
      className={`${className}${tool === value ? ' active' : ''}`.trim()}
      aria-pressed={tool === value}
      title={withKey(label, key)}
      onClick={() => onToolChange(value)}
    >
      <Icon>{icon}</Icon>
      <span className="label">{label}</span>
    </button>
  );

  const menuItem = (label: string, icon: ReactNode, onClick: () => void, extra = {}) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setMoreOpen(false);
        onClick();
      }}
      {...extra}
    >
      <Icon size={20}>{icon}</Icon>
      <span>{label}</span>
    </button>
  );

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      {toolButton('select', 'Select', 'V', SelectIcon)}
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
      {toolButton('hand', 'Hand', 'H', HandIcon, 'wide-only')}
      {toolButton('laser', 'Laser', 'K', LaserIcon, 'roomy-only')}
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
      {toolButton('text', 'Text', 'T', TextIcon)}
      <label className="color" title="Color">
        <input
          type="color"
          value={color}
          aria-label="Color"
          onChange={(e) => onColorChange(e.target.value)}
        />
        <span className="label">Color</span>
      </label>
      {/* Wide layout only; small screens set color and width in the Style sheet. */}
      {showWidth && (
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
      )}
      {hasStyle && (
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
      <button
        type="button"
        className={`more-toggle${moreOpen ? ' active' : ''}`}
        aria-expanded={moreOpen}
        aria-haspopup="menu"
        title="More"
        onClick={() => setMoreOpen((open) => !open)}
      >
        <Icon>{MoreIcon}</Icon>
        <span className="label">More</span>
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
      {moreOpen && (
        <div className="more-menu" role="menu" aria-label="More">
          <div className="compact-only">
            {menuItem('Hand (pan)', HandIcon, () => onToolChange('hand'), {
              'aria-current': tool === 'hand' ? 'true' : undefined,
            })}
          </div>
          <div className="unless-roomy">
            {menuItem('Laser pointer', LaserIcon, () => onToolChange('laser'), {
              'aria-current': tool === 'laser' ? 'true' : undefined,
            })}
          </div>
          {menuItem('Export image…', ExportIcon, onExport, {
            title: `Export image (${modKey()}+Shift+E)`,
          })}
          {menuItem('Keyboard shortcuts', KeyboardIcon, onShortcuts, { title: 'Shortcuts (?)' })}
          <hr />
          {menuItem('Clear board…', TrashIcon, onClear, {
            className: 'danger',
            disabled: clearDisabled,
            title: clearDisabled ? 'Clearing needs a connection' : undefined,
          })}
        </div>
      )}
    </div>
  );
}
