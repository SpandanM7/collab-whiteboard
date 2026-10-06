import type { CSSProperties, ReactNode } from 'react';
import { ARROWHEADS, TEXT_FONTS } from '@whiteboard/shared';
import type {
  Arrowhead,
  ElementType,
  FillStyle,
  LineRoute,
  StrokeStyle,
  TextAlign,
  TextFont,
} from '@whiteboard/shared';
import { styleSections } from '../lib/stylePatch.ts';
import { FONT_SIZES, FONT_STACKS } from '../lib/textLayout.ts';
import { FILL_SWATCHES, MAX_WIDTH, MIN_WIDTH, STROKE_SWATCHES } from '../lib/toolStyle.ts';
import type { ToolStyle } from '../lib/toolStyle.ts';
import { Icon } from './Icon.tsx';
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, CloseIcon } from './icons.tsx';
import { headIcon } from './shapeIcons.tsx';

type Props = {
  /**
   * What is being styled: the kind of element the tool makes, or the kinds in the selection. The
   * panel only shows options that apply to at least one of them.
   */
  types: readonly ElementType[];
  /** "Style" for a tool; "Selection" or "3 selected" for a selection. */
  title: string;
  style: ToolStyle;
  onChange: (change: Partial<ToolStyle>) => void;
  /** Compact layout: the panel is a sheet that is shown only while open. */
  open: boolean;
  onClose: () => void;
  /** Show the line width here (the compact toolbar has no room for it). */
  withWidth: boolean;
};

/** An option shows an icon, or a short text sample (fonts, sizes). */
type Option<T> = {
  value: T;
  label: string;
  icon?: ReactNode;
  text?: string;
  style?: CSSProperties;
};

/** A row of mutually exclusive buttons. */
function Segmented<T extends string | boolean | number>({
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
          {option.text !== undefined ? (
            <span className="segmented-text" style={option.style}>
              {option.text}
            </span>
          ) : (
            <Icon size={18}>{option.icon}</Icon>
          )}
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

const FONT_NAMES: Record<TextFont, string> = {
  sans: 'Sans-serif',
  serif: 'Serif',
  mono: 'Monospace',
  hand: 'Handwritten',
};

const FONT_OPTIONS: Option<TextFont>[] = TEXT_FONTS.map((font) => ({
  value: font,
  label: FONT_NAMES[font],
  text: 'Aa',
  style: { fontFamily: FONT_STACKS[font] },
}));

const SIZE_OPTIONS: Option<number>[] = FONT_SIZES.map((size) => ({
  value: size.value,
  label: `${size.name} text`,
  text: size.label,
}));

const ALIGN_OPTIONS: Option<TextAlign>[] = [
  { value: 'left', label: 'Align left', icon: AlignLeftIcon },
  { value: 'center', label: 'Align center', icon: AlignCenterIcon },
  { value: 'right', label: 'Align right', icon: AlignRightIcon },
];

/**
 * Options for new shapes and text, or for the selected elements. A side panel on desktop; a sheet
 * above the toolbar on small screens.
 */
export function StylePanel({ types, title, style, onChange, open, onClose, withWidth }: Props) {
  const sections = styleSections(types);
  const textOnly = types.length > 0 && types.every((t) => t === 'text');
  return (
    <div className={`style-panel${open ? ' open' : ''}`} role="group" aria-label="Style">
      <div className="style-panel-header">
        <span>{title}</span>
        <button
          type="button"
          className="style-panel-close"
          aria-label="Close style"
          onClick={onClose}
        >
          <Icon size={18}>{CloseIcon}</Icon>
        </button>
      </div>

      <section>
        <h3>{textOnly ? 'Color' : 'Stroke'}</h3>
        <Swatches
          label={textOnly ? 'Text color' : 'Stroke color'}
          colors={STROKE_SWATCHES}
          value={style.color}
          onChange={(color) => color && onChange({ color })}
        />
      </section>

      {withWidth && sections.width && (
        <section>
          <h3>Width</h3>
          <label className="range-row">
            <input
              type="range"
              min={MIN_WIDTH}
              max={MAX_WIDTH}
              value={style.width}
              aria-label="Stroke width"
              onChange={(e) => onChange({ width: Number(e.target.value) })}
            />
            <span>{style.width}px</span>
          </label>
        </section>
      )}

      {sections.text && (
        <>
          <section>
            <h3>Font</h3>
            <Segmented
              label="Font"
              options={FONT_OPTIONS}
              value={style.font}
              onChange={(font) => onChange({ font })}
            />
          </section>
          <section>
            <h3>Text size</h3>
            <Segmented
              label="Text size"
              options={SIZE_OPTIONS}
              value={style.fontSize}
              onChange={(fontSize) => onChange({ fontSize })}
            />
          </section>
          <section>
            <h3>Alignment</h3>
            <Segmented
              label="Alignment"
              options={ALIGN_OPTIONS}
              value={style.align}
              onChange={(align) => onChange({ align })}
            />
          </section>
        </>
      )}

      {sections.fill && (
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

      {sections.outline && (
        <section>
          <h3>Outline</h3>
          <Segmented
            label="Outline style"
            options={STROKE_STYLE_OPTIONS}
            value={style.strokeStyle}
            onChange={(strokeStyle) => onChange({ strokeStyle })}
          />
        </section>
      )}

      {sections.corners && (
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

      {sections.path && (
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

      {sections.heads && (
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

      {sections.opacity && (
        <section>
          <h3>Opacity</h3>
          <label className="range-row">
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
      )}
    </div>
  );
}
