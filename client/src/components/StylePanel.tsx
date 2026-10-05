import type { ReactNode } from 'react';
import { ARROWHEADS, isClosedShapeType } from '@whiteboard/shared';
import type { Arrowhead, FillStyle, LineRoute, ShapeType, StrokeStyle } from '@whiteboard/shared';
import { FILL_SWATCHES, STROKE_SWATCHES, hasCorners } from '../lib/toolStyle.ts';
import type { ToolStyle } from '../lib/toolStyle.ts';
import { Icon } from './Icon.tsx';
import { headIcon } from './shapeIcons.tsx';

type Props = {
  /** The shape tool in use; the panel only shows options that apply to it. */
  tool: ShapeType;
  style: ToolStyle;
  onChange: (change: Partial<ToolStyle>) => void;
  /** Compact layout: the panel is a sheet that is shown only while open. */
  open: boolean;
  onClose: () => void;
};

type Option<T> = { value: T; label: string; icon: ReactNode };

/** A row of mutually exclusive icon buttons. */
function Segmented<T extends string | boolean>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === value ? 'active' : ''}
          aria-pressed={option.value === value}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
        >
          <Icon size={18}>{option.icon}</Icon>
        </button>
      ))}
    </div>
  );
}

function Swatches({
  label,
  colors,
  value,
  onChange,
  none,
}: {
  label: string;
  colors: string[];
  value: string | null;
  onChange: (color: string | null) => void;
  /** Offer a "no color" swatch first (for fills). */
  none?: boolean;
}) {
  return (
    <div className="swatches" role="group" aria-label={label}>
      {none && (
        <button
          type="button"
          className={`swatch none${value === null ? ' active' : ''}`}
          aria-pressed={value === null}
          aria-label="No fill"
          title="No fill"
          onClick={() => onChange(null)}
        />
      )}
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={`swatch${value === color ? ' active' : ''}`}
          style={{ background: color }}
          aria-pressed={value === color}
          aria-label={`${label} ${color}`}
          title={color}
          onClick={() => onChange(color)}
        />
      ))}
      <input
        type="color"
        className="swatch-custom"
        value={value ?? colors[0]}
        aria-label={`Custom ${label.toLowerCase()}`}
        title="Custom color"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const STROKE_STYLE_OPTIONS: Option<StrokeStyle>[] = [
  { value: 'solid', label: 'Solid outline', icon: <path d="M4 12h16" /> },
  { value: 'dashed', label: 'Dashed outline', icon: <path d="M4 12h4m4 0h4m4 0h0" /> },
  { value: 'dotted', label: 'Dotted outline', icon: <path d="M4 12h0m4 0h0m4 0h0m4 0h0m4 0h0" /> },
];

const FILL_STYLE_OPTIONS: Option<FillStyle>[] = [
  {
    value: 'solid',
    label: 'Solid fill',
    icon: <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" />,
  },
  {
    value: 'hatch',
    label: 'Hatched fill',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 12 12 4M4 20 20 4M12 20l8-8" />
      </>
    ),
  },
  {
    value: 'cross',
    label: 'Cross-hatched fill',
    icon: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 12 12 4M4 20 20 4M12 20l8-8M12 4l8 8M4 4l16 16M4 12l8 8" />
      </>
    ),
  },
];

const CORNER_OPTIONS: Option<boolean>[] = [
  { value: false, label: 'Sharp corners', icon: <path d="M5 19V5h14" /> },
  { value: true, label: 'Rounded corners', icon: <path d="M5 19v-8a6 6 0 0 1 6-6h8" /> },
];

const ROUTE_OPTIONS: Option<LineRoute>[] = [
  { value: 'straight', label: 'Straight', icon: <path d="M5 19 19 5" /> },
  { value: 'elbow', label: 'Elbow', icon: <path d="M5 19h7V5h7" /> },
];

const HEAD_NAMES: Record<Arrowhead, string> = {
  none: 'No head',
  arrow: 'Arrow',
  triangle: 'Triangle',
  dot: 'Dot',
  bar: 'Bar',
};

const headOptions = (end: 'start' | 'end'): Option<Arrowhead>[] =>
  ARROWHEADS.map((head) => ({
    value: head,
    label: `${HEAD_NAMES[head]} at the ${end}`,
    // The start head points left, so mirror the icon.
    icon:
      end === 'start' ? <g transform="matrix(-1 0 0 1 24 0)">{headIcon(head)}</g> : headIcon(head),
  }));

const START_HEADS = headOptions('start');
const END_HEADS = headOptions('end');

/** Options for new shapes. A side panel on desktop; a sheet above the toolbar on small screens. */
export function StylePanel({ tool, style, onChange, open, onClose }: Props) {
  const closed = isClosedShapeType(tool);
  return (
    <div className={`style-panel${open ? ' open' : ''}`} role="group" aria-label="Shape style">
      <div className="style-panel-header">
        <span>Style</span>
        <button
          type="button"
          className="style-panel-close"
          aria-label="Close style"
          onClick={onClose}
        >
          <Icon size={18}>
            <path d="M6 6l12 12M18 6 6 18" />
          </Icon>
        </button>
      </div>

      <section>
        <h3>Stroke</h3>
        <Swatches
          label="Stroke color"
          colors={STROKE_SWATCHES}
          value={style.color}
          onChange={(color) => color && onChange({ color })}
        />
      </section>

      {closed && (
        <section>
          <h3>Fill</h3>
          <Swatches
            label="Fill color"
            colors={FILL_SWATCHES}
            value={style.fillOn ? style.fillColor : null}
            none
            onChange={(color) =>
              onChange(color ? { fillOn: true, fillColor: color } : { fillOn: false })
            }
          />
          {style.fillOn && (
            <Segmented
              label="Fill style"
              options={FILL_STYLE_OPTIONS}
              value={style.fillStyle}
              onChange={(fillStyle) => onChange({ fillStyle })}
            />
          )}
        </section>
      )}

      <section>
        <h3>Outline</h3>
        <Segmented
          label="Outline style"
          options={STROKE_STYLE_OPTIONS}
          value={style.strokeStyle}
          onChange={(strokeStyle) => onChange({ strokeStyle })}
        />
      </section>

      {hasCorners(tool) && (
        <section>
          <h3>Corners</h3>
          <Segmented
            label="Corners"
            options={CORNER_OPTIONS}
            value={style.rounded}
            onChange={(rounded) => onChange({ rounded })}
          />
        </section>
      )}

      {!closed && (
        <section>
          <h3>Path</h3>
          <Segmented
            label="Path"
            options={ROUTE_OPTIONS}
            value={style.route}
            onChange={(route) => onChange({ route })}
          />
        </section>
      )}

      {tool === 'arrow' && (
        <section>
          <h3>Arrowheads</h3>
          <Segmented
            label="Start arrowhead"
            options={START_HEADS}
            value={style.startHead}
            onChange={(startHead) => onChange({ startHead })}
          />
          <Segmented
            label="End arrowhead"
            options={END_HEADS}
            value={style.endHead}
            onChange={(endHead) => onChange({ endHead })}
          />
        </section>
      )}

      <section>
        <h3>Opacity</h3>
        <label className="opacity">
          <input
            type="range"
            min={10}
            max={100}
            step={10}
            value={Math.round(style.opacity * 100)}
            aria-label="Opacity"
            onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
          />
          <span>{Math.round(style.opacity * 100)}%</span>
        </label>
      </section>
    </div>
  );
}
