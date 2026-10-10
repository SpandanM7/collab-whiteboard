import type { BoardElement } from '@whiteboard/shared';
import { drawElement } from './drawing.ts';
import type { DrawContext } from './drawing.ts';
import type { ExportBackground } from './exportImage.ts';
import { exportBounds } from './exportImage.ts';

/** Numbers in the markup: two decimals at most (board units), no trailing zeros, no "-0". */
function num(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type Attrs = Record<string, string | number | undefined>;

function attrs(values: Attrs): string {
  return Object.entries(values)
    .flatMap(([k, v]) =>
      v === undefined ? [] : [` ${k}="${escapeXml(typeof v === 'number' ? num(v) : v)}"`],
    )
    .join('');
}

type State = {
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  dash: number[];
  /** The clip in force (a clipPath id), if any. */
  clip: string | undefined;
};

const TEXT_ANCHOR: Record<CanvasTextAlign, string> = {
  left: 'start',
  start: 'start',
  center: 'middle',
  right: 'end',
  end: 'end',
};

const BASELINE: Record<CanvasTextBaseline, string | undefined> = {
  alphabetic: undefined,
  middle: 'central',
  top: 'text-before-edge',
  hanging: 'hanging',
  bottom: 'text-after-edge',
  ideographic: 'ideographic',
};

/**
 * Records canvas drawing calls as SVG markup. It implements just the part of the canvas API the
 * board's drawing code uses (`DrawContext`), with the canvas's rules for paths, arcs and state,
 * so the SVG export draws exactly what the canvas and the PNG export draw.
 */
export class SvgContext implements DrawContext {
  private state: State = {
    strokeStyle: '#000000',
    fillStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    dash: [],
    clip: undefined,
  };
  private readonly stack: State[] = [];
  private path = '';
  /** The current point and where the current subpath began; null before any moveTo. */
  private current: { x: number; y: number } | null = null;
  private subpathStart: { x: number; y: number } | null = null;
  private readonly defs: string[] = [];
  private readonly body: string[] = [];
  private clipCount = 0;

  // ---- State ----

  get strokeStyle(): string {
    return this.state.strokeStyle;
  }
  set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
    if (typeof value === 'string') this.state.strokeStyle = value;
  }
  get fillStyle(): string {
    return this.state.fillStyle;
  }
  set fillStyle(value: string | CanvasGradient | CanvasPattern) {
    if (typeof value === 'string') this.state.fillStyle = value;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(value: number) {
    if (Number.isFinite(value) && value > 0) this.state.lineWidth = value;
  }
  get lineCap(): CanvasLineCap {
    return this.state.lineCap;
  }
  set lineCap(value: CanvasLineCap) {
    this.state.lineCap = value;
  }
  get lineJoin(): CanvasLineJoin {
    return this.state.lineJoin;
  }
  set lineJoin(value: CanvasLineJoin) {
    this.state.lineJoin = value;
  }
  get globalAlpha(): number {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: number) {
    if (Number.isFinite(value) && value >= 0 && value <= 1) this.state.globalAlpha = value;
  }
  get font(): string {
    return this.state.font;
  }
  set font(value: string) {
    this.state.font = value;
  }
  get textAlign(): CanvasTextAlign {
    return this.state.textAlign;
  }
  set textAlign(value: CanvasTextAlign) {
    this.state.textAlign = value;
  }
  get textBaseline(): CanvasTextBaseline {
    return this.state.textBaseline;
  }
  set textBaseline(value: CanvasTextBaseline) {
    this.state.textBaseline = value;
  }

  setLineDash(segments: Iterable<number>): void {
    const list = [...segments];
    if (list.some((n) => !Number.isFinite(n) || n < 0)) return;
    // Like the canvas: an odd list is repeated to make it even.
    this.state.dash = list.length % 2 === 1 ? [...list, ...list] : list;
  }

  save(): void {
    this.stack.push({ ...this.state, dash: [...this.state.dash] });
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous) this.state = previous;
  }

  // ---- Paths ----

  beginPath(): void {
    this.path = '';
    this.current = null;
    this.subpathStart = null;
  }

  moveTo(x: number, y: number): void {
    this.path += `M${num(x)} ${num(y)}`;
    this.current = { x, y };
    this.subpathStart = { x, y };
  }

  lineTo(x: number, y: number): void {
    if (!this.current) {
      this.moveTo(x, y);
      return;
    }
    this.path += `L${num(x)} ${num(y)}`;
    this.current = { x, y };
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.current) this.moveTo(cpx, cpy);
    this.path += `Q${num(cpx)} ${num(cpy)} ${num(x)} ${num(y)}`;
    this.current = { x, y };
  }

  closePath(): void {
    if (!this.current) return;
    this.path += 'Z';
    this.current = this.subpathStart;
  }

  arc(x: number, y: number, radius: number, start: number, end: number, ccw = false): void {
    this.ellipse(x, y, radius, radius, 0, start, end, ccw);
  }

  /** As on the canvas: a line joins the current point to the arc's start, if there is one. */
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw = false,
  ): void {
    const TAU = Math.PI * 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const at = (t: number) => {
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      return { x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos };
    };
    const raw = ccw ? start - end : end - start;
    const sweep = raw >= TAU ? TAU : ((raw % TAU) + TAU) % TAU;
    const first = at(start);
    if (this.current) this.lineTo(first.x, first.y);
    else this.moveTo(first.x, first.y);
    if (sweep === 0) return;
    // Pieces of at most half a turn each, so the large-arc flag is never needed.
    const pieces = Math.ceil(sweep / Math.PI - 1e-9);
    const step = (ccw ? -sweep : sweep) / pieces;
    const degrees = (rotation * 180) / Math.PI;
    for (let i = 1; i <= pieces; i++) {
      const p = at(start + step * i);
      this.path += `A${num(rx)} ${num(ry)} ${num(degrees)} 0 ${ccw ? 0 : 1} ${num(p.x)} ${num(p.y)}`;
      this.current = p;
    }
  }

  // ---- Painting ----

  private common(): Attrs {
    const { globalAlpha, clip } = this.state;
    return {
      opacity: globalAlpha < 1 ? globalAlpha : undefined,
      'clip-path': clip ? `url(#${clip})` : undefined,
    };
  }

  fill(): void {
    if (!this.path) return;
    this.body.push(
      `<path${attrs({ d: this.path, fill: this.state.fillStyle, ...this.common() })}/>`,
    );
  }

  stroke(): void {
    if (!this.path) return;
    const { strokeStyle, lineWidth, lineCap, lineJoin, dash } = this.state;
    this.body.push(
      `<path${attrs({
        d: this.path,
        fill: 'none',
        stroke: strokeStyle,
        'stroke-width': lineWidth,
        'stroke-linecap': lineCap === 'butt' ? undefined : lineCap,
        'stroke-linejoin': lineJoin === 'miter' ? undefined : lineJoin,
        // The canvas's default miter limit; SVG's is 4.
        'stroke-miterlimit': lineJoin === 'miter' ? 10 : undefined,
        'stroke-dasharray': dash.length > 0 ? dash.map(num).join(' ') : undefined,
        ...this.common(),
      })}/>`,
    );
  }

  /** Later drawing (until `restore`) only shows inside the current path, and any earlier clip. */
  clip(): void {
    const id = `clip${++this.clipCount}`;
    const outer = this.state.clip ? ` clip-path="url(#${this.state.clip})"` : '';
    this.defs.push(`<clipPath id="${id}"${outer}><path d="${this.path}"/></clipPath>`);
    this.state.clip = id;
  }

  fillText(text: string, x: number, y: number): void {
    const { fillStyle, font, textAlign, textBaseline } = this.state;
    const anchor = TEXT_ANCHOR[textAlign];
    this.body.push(
      `<text${attrs({
        x,
        y,
        fill: fillStyle,
        style: `font: ${font}; white-space: pre`,
        'text-anchor': anchor === 'start' ? undefined : anchor,
        'dominant-baseline': BASELINE[textBaseline],
        ...this.common(),
      })}>${escapeXml(text)}</text>`,
    );
  }

  /** The recorded drawing: clip paths first, then everything drawn, in order. */
  markup(): string {
    const defs = this.defs.length > 0 ? `<defs>${this.defs.join('')}</defs>` : '';
    return defs + this.body.join('');
  }
}

/**
 * The board (or a selection) as an SVG document, framed like the PNG export: the same padding,
 * one SVG unit per board unit, no grid or cursors. Null when there is nothing to export.
 */
export function renderSvg(
  elements: readonly BoardElement[],
  { background }: { background: ExportBackground },
): string | null {
  const bounds = exportBounds(elements);
  if (!bounds) return null;
  const ctx = new SvgContext();
  for (const element of elements) drawElement(ctx, element);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const backdrop =
    background === 'white'
      ? `<rect${attrs({ x: bounds.left, y: bounds.top, width, height, fill: '#ffffff' })}/>`
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${attrs({
      width,
      height,
      viewBox: [bounds.left, bounds.top, width, height].map(num).join(' '),
    })}>` +
    backdrop +
    ctx.markup() +
    '</svg>'
  );
}
