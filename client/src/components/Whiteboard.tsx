import { nanoid } from 'nanoid';
import { useLayoutEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { BoardElement, LineShape, Point, Shape, ShapeType, Stroke } from '@whiteboard/shared';
import { isClosedShape, isShape } from '@whiteboard/shared';
import { toBoard } from '../lib/coords.ts';
import { drawElement, drawShape, drawStroke } from '../lib/drawing.ts';
import {
  coreBounds,
  elementBounds,
  elementHit,
  rectFromPoints,
  rectsIntersect,
} from '../lib/geometry.ts';
import type { Rect } from '../lib/geometry.ts';
import {
  elementsInRect,
  handleAt,
  handleCursor,
  handlePoint,
  lineEndAt,
  moveDelta,
  moveLineEnd,
  pickElement,
  resizeTransform,
  selectionBounds,
  visibleHandles,
} from '../lib/selection.ts';
import type { Handle, LineEnd } from '../lib/selection.ts';
import { dragReadout, dragShape, gridStep, snapAngle, snapToGrid } from '../lib/shapeDrag.ts';
import { isTypingTarget } from '../lib/shortcuts.ts';
import type { DragModifiers } from '../lib/shapeDrag.ts';
import { createShape } from '../lib/toolStyle.ts';
import type { ToolStyle } from '../lib/toolStyle.ts';
import {
  isIdentity,
  mapPoint,
  roundCoord,
  transformElement,
  translation,
} from '../lib/transform.ts';
import type { Transform } from '../lib/transform.ts';
import {
  clampScale,
  panBy,
  toBoardPoint,
  toScreenPoint,
  visibleRect,
  zoomAt,
} from '../lib/view.ts';
import type { View } from '../lib/view.ts';
import { isShapeTool } from '../types.ts';
import type { Tool } from '../types.ts';

/** In screen pixels, so the eraser feels the same at any zoom. */
const ERASER_RADIUS = 6;
const LOCAL_AUTHOR_ID = 'local';
/** A shape dragged out smaller than this (in screen pixels) was a click, not a shape. */
const MIN_SHAPE_SIZE = 4;
/** Ctrl + wheel (and trackpad pinch): zoom factor is e^(-delta * speed), delta capped per event. */
const WHEEL_ZOOM_SPEED = 0.01;
const WHEEL_ZOOM_MAX_DELTA = 50;
const WHEEL_LINE_PX = 16;
/** Screen pixels a press may wander and still count as a click (not a drag). */
const CLICK_SLOP = 4;
const CLICK_SLOP_TOUCH = 10;
/** Two taps this close in time and space make a double-tap (double-click on touch). */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;
/** How close (screen pixels) a pointer must be to pick an element or grab a handle. */
const PICK_RADIUS = 6;
const PICK_RADIUS_TOUCH = 14;
const HANDLE_REACH = 9;
const HANDLE_REACH_TOUCH = 22;
const HANDLE_SIZE = 8;
const HANDLE_SIZE_TOUCH = 12;
/** Space between an element and its selection frame, in screen pixels. */
const FRAME_PAD = 4;

const SELECTION_COLOR = '#1c7ed6';
const SELECTION_FILL = 'rgba(28, 126, 214, 0.08)';

type TextRequest = { id: string } | { at: Point };

type Props = {
  /** Finished strokes and shapes, drawn from the cached layer. */
  elements: BoardElement[];
  /** Strokes other people are still drawing; repainted every frame on top of the cache. */
  liveStrokes: Stroke[];
  tool: Tool;
  /** Color, width and shape options for new strokes and shapes. */
  style: ToolStyle;
  /** Show the dot grid, and snap shapes to it. */
  grid: boolean;
  /** Where this person is looking: pan and zoom. Local only, never synced. */
  view: View;
  /** The person moved or zoomed the view (drag, pinch, wheel). */
  onViewChange: (view: View) => void;
  /** The board cannot be used at all (e.g. the room is full): ignore input. */
  disabled: boolean;
  /** Ids of the selected elements (select tool). */
  selectedIds: readonly string[];
  /** A text being edited in place: the editor shows it, so the canvas leaves it out. */
  editingId: string | null;
  /** The text editor is open; the next press on the board only closes it. */
  editing: boolean;
  onStrokeStart: (stroke: Stroke) => void;
  onStrokePoints: (id: string, points: Point[]) => void;
  onStrokeAdd: (stroke: Stroke) => void;
  /** A shape was finished (pointer released). Shapes are shown to others only at this point. */
  onShapeAdd: (shape: Shape) => void;
  onStrokeCancel: (id: string) => void;
  /** The eraser touched these elements; `gesture` is the same for one whole drag. */
  onErase: (ids: string[], gesture: string) => void;
  onSelect: (ids: string[]) => void;
  /** Elements were moved or resized (sent once, on release). */
  onElementsChange: (elements: BoardElement[]) => void;
  /** Open the text editor: on an existing text, or for a new one at a board point. */
  onTextRequest: (request: TextRequest) => void;
  /** A move, resize or marquee started or ended (floating selection controls hide meanwhile). */
  onGestureChange: (active: boolean) => void;
  /** The pointer moved over the board (hovering or drawing), in board space. */
  onCursorMove: (point: Point) => void;
};

/** A one-pointer drag that moves the view (hand tool, Space + drag, or middle mouse button). */
type Pan = { id: number; startX: number; startY: number; startView: View };

/** Two fingers moving and zooming the view. `anchor` is the board point that stays under them. */
type Pinch = { ids: [number, number]; anchor: Point; startDistance: number; startScale: number };

/** A shape being dragged out: where it began, where the pointer is, and the modifier keys. */
type ShapeDrag = {
  type: ShapeType;
  origin: Point;
  pointer: Point;
  mods: DragModifiers;
  /** Touch puts the size readout above the finger instead of beside the pointer. */
  touch: boolean;
};

/** What a press with the select (or text) tool is doing. */
type SelectGesture = {
  /** Where the press started, on screen and on the board. */
  downScreen: Point;
  down: Point;
  pointer: Point;
  mods: DragModifiers;
  touch: boolean;
  /** Past the click slop: a real drag. */
  dragging: boolean;
} & (
  | { kind: 'move'; originals: BoardElement[]; bounds: Rect }
  | { kind: 'resize'; originals: BoardElement[]; bounds: Rect; handle: Handle; keepAspect: boolean }
  | { kind: 'line-end'; original: LineShape; end: LineEnd }
  | { kind: 'marquee'; additive: boolean; base: readonly string[] }
  /** A press that only becomes something on release (a click, or the text tool). */
  | { kind: 'click' }
);

const GRID_DOT_COLOR = '#c9c8cc';
const READOUT_FONT = '12px system-ui, "Segoe UI", Roboto, sans-serif';

export function Whiteboard(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Committed elements are cached here so a frame only has to blit + draw the active stroke.
  const cacheRef = useRef<HTMLCanvasElement | null>(null);
  // The view the cache was drawn with; the cache is rebuilt when the view moves on.
  const cacheViewRef = useRef<View | null>(null);
  // The latest view, updated the moment a gesture changes it (props follow after a render).
  const viewRef = useRef(props.view);
  const activeRef = useRef<Stroke | null>(null);
  // The shape being dragged out. Local only until release, so it needs no network handling.
  const shapeRef = useRef<Shape | null>(null);
  const dragRef = useRef<ShapeDrag | null>(null);
  const selectRef = useRef<SelectGesture | null>(null);
  // Elements left out of the cache while they are dragged (drawn live on top instead).
  const hiddenRef = useRef<ReadonlySet<string>>(new Set());
  const hoverRef = useRef<{ id: string | null; cursor: string }>({ id: null, cursor: '' });
  const lastTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const eraseGestureRef = useRef('');
  const pointerIdRef = useRef<number | null>(null);
  const panRef = useRef<Pan | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  // Touches in use for drawing or pinching, and ones to ignore until lifted (palm, third finger).
  const touchesRef = useRef(new Map<number, Point>());
  const ignoredRef = useRef(new Set<number>());
  const spaceRef = useRef(false);
  const hoveringRef = useRef(false);
  const frameRef = useRef(0);
  const propsRef = useRef(props);

  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const applyView = (ctx: CanvasRenderingContext2D, view: View) => {
    const dpr = window.devicePixelRatio || 1;
    const s = dpr * view.scale;
    ctx.setTransform(s, 0, 0, s, dpr * view.x, dpr * view.y);
  };

  const selectedElements = (): BoardElement[] => {
    const ids = new Set(propsRef.current.selectedIds);
    return ids.size === 0 ? [] : propsRef.current.elements.filter((e) => ids.has(e.id));
  };

  /** The elements a select gesture is showing in their new place (null if it moves nothing). */
  const previewOf = (g: SelectGesture): BoardElement[] | null => {
    if (g.kind === 'move' || g.kind === 'resize') {
      const t = gestureTransform(g);
      return g.originals.map((e) => transformElement(e, t));
    }
    if (g.kind === 'line-end') return [lineEndResult(g)];
    return null;
  };

  const draggedElements = (): BoardElement[] | null => {
    const g = selectRef.current;
    return g?.dragging ? previewOf(g) : null;
  };

  const paint = () => {
    const canvas = canvasRef.current;
    const cache = cacheRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !cache || !ctx) return;
    const view = viewRef.current;
    if (cacheViewRef.current !== view) rebuildCache();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cache, 0, 0);
    applyView(ctx, view);
    const dragged = draggedElements();
    if (dragged) for (const element of dragged) drawElement(ctx, element);
    for (const stroke of propsRef.current.liveStrokes) drawStroke(ctx, stroke);
    if (activeRef.current) drawStroke(ctx, activeRef.current);
    if (shapeRef.current) {
      drawShape(ctx, shapeRef.current);
      if (dragRef.current) drawReadout(ctx, shapeRef.current, dragRef.current, view);
    }
    drawSelectionOverlay(ctx, view, dragged);
  };

  /** The size (or length and angle) of the shape being dragged, in a label by the pointer. */
  const drawReadout = (
    ctx: CanvasRenderingContext2D,
    shape: Shape,
    drag: ShapeDrag,
    view: View,
  ) => {
    const text = dragReadout(shape.type, shape.start, shape.end);
    drawLabel(ctx, text, toScreenPoint(drag.pointer, view), drag.touch);
  };

  const drawLabel = (ctx: CanvasRenderingContext2D, text: string, at: Point, touch: boolean) => {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = READOUT_FONT;
    const width = ctx.measureText(text).width + 12;
    const height = 20;
    const x = at.x + 14;
    const y = touch ? at.y - 56 : at.y + 18;
    ctx.fillStyle = 'rgba(26, 26, 26, 0.85)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 6, y + height / 2);
  };

  /** A board rect as a screen rect, grown by `pad` pixels. */
  const screenRect = (r: Rect, view: View, pad = 0): Rect => {
    const a = toScreenPoint({ x: r.left, y: r.top }, view);
    const b = toScreenPoint({ x: r.right, y: r.bottom }, view);
    return { left: a.x - pad, top: a.y - pad, right: b.x + pad, bottom: b.y + pad };
  };

  const strokeRect = (ctx: CanvasRenderingContext2D, r: Rect) => {
    ctx.strokeRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
  };

  /** Selection frames, handles, the hover outline and the marquee, in screen space. */
  const drawSelectionOverlay = (
    ctx: CanvasRenderingContext2D,
    view: View,
    dragged: BoardElement[] | null,
  ) => {
    const { tool } = propsRef.current;
    const g = selectRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = SELECTION_COLOR;

    if (g?.kind === 'marquee' && g.dragging) {
      const r = screenRect(rectFromPoints(g.down, g.pointer), view);
      ctx.fillStyle = SELECTION_FILL;
      ctx.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
      strokeRect(ctx, r);
    }
    if (tool !== 'select') return;

    const selected =
      dragged ?? selectedElements().filter((e) => e.id !== propsRef.current.editingId);
    const hover = hoverRef.current.id;
    if (hover && !g && !propsRef.current.selectedIds.includes(hover)) {
      const element = propsRef.current.elements.find((e) => e.id === hover);
      if (element) {
        ctx.globalAlpha = 0.6;
        strokeRect(ctx, screenRect(coreBounds(element), view, FRAME_PAD));
        ctx.globalAlpha = 1;
      }
    }
    if (selected.length === 0) return;

    const touch = g?.touch ?? false;
    const size = touch ? HANDLE_SIZE_TOUCH : HANDLE_SIZE;
    const single = selected.length === 1 ? selected[0] : null;
    if (single && isShape(single) && !isClosedShape(single)) {
      // A line or arrow: a handle on each end instead of a frame.
      for (const p of [single.start, single.end]) {
        const at = toScreenPoint(p, view);
        ctx.beginPath();
        ctx.arc(at.x, at.y, size / 2 + 1, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.stroke();
      }
      return;
    }

    if (selected.length > 1) {
      ctx.globalAlpha = 0.5;
      for (const element of selected) strokeRect(ctx, screenRect(coreBounds(element), view, 2));
      ctx.globalAlpha = 1;
    }
    const bounds = selectionBounds(selected)!;
    const frame = screenRect(bounds, view, FRAME_PAD);
    ctx.lineWidth = 1.5;
    strokeRect(ctx, frame);
    if (g?.dragging && g.kind === 'move') return;

    const handles = visibleHandles(
      frame.right - frame.left,
      frame.bottom - frame.top,
      lockAspect(selected),
    );
    ctx.lineWidth = 1.5;
    for (const handle of handles) {
      const at = handlePoint(frame, handle);
      ctx.fillStyle = '#fff';
      ctx.fillRect(at.x - size / 2, at.y - size / 2, size, size);
      ctx.strokeRect(at.x - size / 2, at.y - size / 2, size, size);
    }
    if (g?.dragging && g.kind === 'resize') {
      const w = Math.round(bounds.right - bounds.left);
      const h = Math.round(bounds.bottom - bounds.top);
      drawLabel(ctx, `${w} × ${h}`, toScreenPoint(g.pointer, view), g.touch);
    }
  };

  /** A dot at every grid point on screen, spaced further apart when zoomed far out. */
  const drawGrid = (ctx: CanvasRenderingContext2D, view: View, visible: Rect) => {
    const step = gridStep(view.scale);
    const r = 1 / view.scale; // one screen pixel
    ctx.fillStyle = GRID_DOT_COLOR;
    for (let x = Math.ceil(visible.left / step) * step; x <= visible.right; x += step) {
      for (let y = Math.ceil(visible.top / step) * step; y <= visible.bottom; y += step) {
        ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    }
  };

  /** Recomputes the dragged shape's corners from the pointer, the keys held and the grid. */
  const updateShapeDrag = () => {
    const drag = dragRef.current;
    const shape = shapeRef.current;
    if (!drag || !shape) return;
    const { start, end } = dragShape(
      drag.type,
      drag.origin,
      drag.pointer,
      drag.mods,
      propsRef.current.grid,
    );
    shape.start = start;
    shape.end = end;
    schedulePaint();
  };

  const schedulePaint = () => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      paint();
    });
  };

  const rebuildCache = () => {
    const cache = cacheRef.current;
    const ctx = cache?.getContext('2d');
    if (!cache || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const view = viewRef.current;
    cacheViewRef.current = view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cache.width, cache.height);
    applyView(ctx, view);
    // Elements off screen cost nothing, so a big board stays smooth while panning.
    const visible = visibleRect(view, { width: cache.width / dpr, height: cache.height / dpr });
    if (propsRef.current.grid) drawGrid(ctx, view, visible);
    const hidden = hiddenRef.current;
    const editing = propsRef.current.editingId;
    for (const element of propsRef.current.elements) {
      if (hidden.has(element.id) || element.id === editing) continue;
      if (rectsIntersect(elementBounds(element), visible)) drawElement(ctx, element);
    }
  };

  /** Leaves `ids` out of the cache (they are being dragged), or brings everything back. */
  const setHidden = (ids: Iterable<string>) => {
    hiddenRef.current = new Set(ids);
    rebuildCache();
  };

  /** Drops the select gesture without applying it (pinch, disabled, cancelled pointer). */
  const cancelSelectGesture = () => {
    const g = selectRef.current;
    selectRef.current = null;
    if (!g) return;
    if (hiddenRef.current.size > 0) setHidden([]);
    if (g.dragging) propsRef.current.onGestureChange(false);
  };

  /** A gesture changed the view: take it now, tell the parent, repaint next frame. */
  const commitView = (next: View) => {
    viewRef.current = next;
    propsRef.current.onViewChange(next);
    schedulePaint();
  };

  /** What the cursor looks like while panning is possible ('ready') or under way ('active'). */
  const setPanState = (state: '' | 'ready' | 'active') => {
    if (canvasRef.current) canvasRef.current.dataset.pan = state;
  };

  /** The cursor over the board in the select tool (a resize arrow, or move), set inline. */
  const setCursor = (cursor: string) => {
    if (hoverRef.current.cursor === cursor) return;
    hoverRef.current.cursor = cursor;
    if (canvasRef.current) canvasRef.current.style.cursor = cursor;
  };

  // ---- Select tool geometry ----

  /** Text keeps its proportions, so a selection holding any resizes evenly. */
  const lockAspect = (elements: readonly BoardElement[]) => elements.some((e) => e.type === 'text');

  const gestureTransform = (g: SelectGesture): Transform => {
    if (g.kind === 'move') {
      const d = moveDelta(g.bounds, g.down, g.pointer, {
        axisLock: g.mods.shift,
        grid: propsRef.current.grid,
      });
      return translation(roundCoord(d.x), roundCoord(d.y));
    }
    if (g.kind === 'resize') {
      const at = grabbed(g, handlePoint(g.bounds, g.handle));
      const pointer = propsRef.current.grid ? snapToGrid(at) : at;
      return resizeTransform(g.bounds, g.handle, pointer, {
        keepAspect: g.keepAspect || g.mods.shift,
        fromCenter: g.mods.alt,
      });
    }
    return translation(0, 0);
  };

  /**
   * Where the grabbed point (a handle or a line end) is now. It follows the pointer's movement,
   * not the pointer itself, so grabbing a handle a few pixels off does not make the shape jump.
   */
  const grabbed = (g: SelectGesture, from: Point): Point => ({
    x: from.x + g.pointer.x - g.down.x,
    y: from.y + g.pointer.y - g.down.y,
  });

  const lineEndResult = (g: SelectGesture & { kind: 'line-end' }): LineShape => {
    const at = grabbed(g, g.end === 'start' ? g.original.start : g.original.end);
    let p = propsRef.current.grid ? snapToGrid(at) : at;
    const fixed = g.end === 'start' ? g.original.end : g.original.start;
    if (g.mods.shift) p = snapAngle(fixed, p);
    // Mapping through no transform rounds and clamps the point like every other edit.
    return moveLineEnd(g.original, g.end, mapPoint(p, translation(0, 0)));
  };

  /** Pixels a pointer counts as being "on" something, converted to board units. */
  const reach = (screenPx: number) => screenPx / viewRef.current.scale;

  /** What pressing at `p` would grab: a handle, a line end, or nothing. */
  const grabAt = (p: Point, touch: boolean) => {
    const selected = selectedElements();
    if (selected.length === 0) return null;
    const handleReach = reach(touch ? HANDLE_REACH_TOUCH : HANDLE_REACH);
    const single = selected.length === 1 ? selected[0] : null;
    if (single && isShape(single) && !isClosedShape(single)) {
      const end = lineEndAt(single, p, handleReach);
      return end ? ({ kind: 'line-end', shape: single, end } as const) : null;
    }
    const bounds = selectionBounds(selected)!;
    const pad = reach(FRAME_PAD);
    const framed = {
      left: bounds.left - pad,
      top: bounds.top - pad,
      right: bounds.right + pad,
      bottom: bounds.bottom + pad,
    };
    const scale = viewRef.current.scale;
    const handles = visibleHandles(
      (framed.right - framed.left) * scale,
      (framed.bottom - framed.top) * scale,
      lockAspect(selected),
    );
    const handle = handleAt(framed, p, handleReach, handles);
    return handle ? ({ kind: 'handle', handle, bounds, selected } as const) : null;
  };

  /** Whether `p` is inside the frame of a multi-selection (which drags it as a whole). */
  const insideSelection = (p: Point) => {
    const selected = selectedElements();
    if (selected.length < 2) return false;
    const b = selectionBounds(selected)!;
    return p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;
  };

  /** Hovering with the select tool: highlight what a click would pick, and set the cursor. */
  const updateHover = (p: Point) => {
    const { tool, elements, selectedIds } = propsRef.current;
    if (tool !== 'select' || selectRef.current) return;
    const grab = grabAt(p, false);
    let cursor = '';
    let id: string | null = null;
    if (grab) {
      cursor = grab.kind === 'handle' ? handleCursor(grab.handle) : 'pointer';
    } else {
      id = pickElement(elements, p, reach(PICK_RADIUS))?.id ?? null;
      if (id || insideSelection(p)) cursor = 'move';
    }
    setCursor(cursor);
    if (id !== hoverRef.current.id) {
      hoverRef.current.id = id && !selectedIds.includes(id) ? id : null;
      schedulePaint();
    }
  };

  const clearHover = () => {
    if (hoverRef.current.id) schedulePaint();
    hoverRef.current.id = null;
    setCursor('');
  };

  // Size the canvas (and cache) to its own box, including on resize / DPR change.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cache = document.createElement('canvas');
    cacheRef.current = cache;
    cacheViewRef.current = null;

    // Sized from the canvas's own box (not window.innerWidth), which is what pointer positions are
    // measured against. It also tracks the mobile URL bar showing/hiding and rotation.
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      // The cache is checked too: StrictMode re-runs this effect with a fresh, unsized cache.
      if (width === canvas.width && height === canvas.height && width === cache.width) return;
      canvas.width = cache.width = width;
      canvas.height = cache.height = height;
      rebuildCache();
      paint();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('resize', resize); // DPR changes (browser zoom) do not resize the box
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      cacheRef.current = null;
    };
    // paint/rebuildCache only touch refs, so they are safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wheel and keyboard. The wheel listener is native because React's is passive and could not stop
  // the browser from zooming the page on Ctrl + wheel.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? rect.height : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      const view = viewRef.current;
      if (e.ctrlKey) {
        const capped = Math.max(-WHEEL_ZOOM_MAX_DELTA, Math.min(WHEEL_ZOOM_MAX_DELTA, dy));
        const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        commitView(zoomAt(view, anchor, view.scale * Math.exp(-capped * WHEEL_ZOOM_SPEED)));
      } else if (e.shiftKey && dx === 0) {
        commitView(panBy(view, -dy, 0)); // Shift + wheel scrolls sideways
      } else {
        commitView(panBy(view, -dx, -dy));
      }
    };

    // Space + drag pans, like most drawing tools. Only while the pointer is over the board, so
    // Space still works on buttons and in text fields.
    const onKeyDown = (e: KeyboardEvent) => {
      if (updateDragKeys(e)) return;
      if (e.code !== 'Space' || isTypingTarget(e.target) || !hoveringRef.current) return;
      e.preventDefault();
      if (e.repeat) return;
      spaceRef.current = true;
      if (!panRef.current) setPanState('ready');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (updateDragKeys(e)) return;
      if (e.code !== 'Space') return;
      if (hoveringRef.current && !isTypingTarget(e.target)) e.preventDefault();
      releaseSpace();
    };
    const releaseSpace = () => {
      spaceRef.current = false;
      if (!panRef.current) setPanState('');
    };
    // Shift or Alt pressed or released mid-drag reshapes (or re-snaps) without the pointer moving.
    const updateDragKeys = (e: KeyboardEvent): boolean => {
      const drag = dragRef.current;
      const select = selectRef.current;
      if ((!drag && !select?.dragging) || (e.key !== 'Shift' && e.key !== 'Alt')) return false;
      if (e.key === 'Alt') e.preventDefault(); // Windows would otherwise focus the browser menu
      const mods = { shift: e.shiftKey, alt: e.altKey };
      if (drag) {
        drag.mods = mods;
        updateShapeDrag();
      } else if (select) {
        select.mods = mods;
        schedulePaint();
      }
      return true;
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseSpace);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseSpace);
    };
    // commitView only touches refs and props, so it is safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw from element data (or the grid). Layout effect so no frame shows an element missing.
  useLayoutEffect(() => {
    rebuildCache();
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.elements, props.grid, props.editingId]);

  // The view was changed from outside (zoom buttons, fit, jump to a person).
  useLayoutEffect(() => {
    viewRef.current = props.view;
    schedulePaint();
    // schedulePaint only touches refs, so it is safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.view]);

  // Remote strokes in progress change often; they only need a repaint, not a cache rebuild.
  // The selection overlay is drawn per frame too.
  useLayoutEffect(() => {
    schedulePaint();
    // schedulePaint only touches refs, so it is safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.liveStrokes, props.selectedIds, props.tool]);

  // Leaving the select tool drops its hover outline and cursor.
  useLayoutEffect(() => {
    if (props.tool !== 'select') clearHover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.tool]);

  // The board became unusable mid-stroke: drop it rather than leave a stroke that cannot be saved.
  useLayoutEffect(() => {
    if (!props.disabled) return;
    pointerIdRef.current = null;
    panRef.current = null;
    pinchRef.current = null;
    touchesRef.current.clear();
    ignoredRef.current.clear();
    if (activeRef.current || shapeRef.current || selectRef.current) {
      activeRef.current = null;
      shapeRef.current = null;
      dragRef.current = null;
      cancelSelectGesture();
      paint();
    }
    // paint only touches refs, so it is safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.disabled]);

  const erase = (points: Point[]) => {
    const { elements, onErase } = propsRef.current;
    const radius = ERASER_RADIUS / viewRef.current.scale;
    const ids = elements
      .filter((e) => points.some((p) => elementHit(e, p, radius)))
      .map((e) => e.id);
    if (ids.length > 0) onErase(ids, eraseGestureRef.current);
  };

  /** Two fingers are down: stop whatever one finger was doing and start moving the view. */
  const startPinch = (canvas: HTMLCanvasElement) => {
    const ids = [...touchesRef.current.keys()].slice(0, 2) as [number, number];
    const [a, b] = ids.map((id) => touchesRef.current.get(id)!);
    const stroke = activeRef.current;
    activeRef.current = null;
    shapeRef.current = null;
    dragRef.current = null;
    cancelSelectGesture();
    if (stroke) propsRef.current.onStrokeCancel(stroke.id);
    pointerIdRef.current = null;
    panRef.current = null;
    setPanState('');

    const rect = canvas.getBoundingClientRect();
    const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    pinchRef.current = {
      ids,
      anchor: toBoardPoint(mid, viewRef.current),
      startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startScale: viewRef.current.scale,
    };
    paint(); // the cancelled stroke or shape leaves the screen
  };

  const updatePinch = (pinch: Pinch, rect: DOMRect) => {
    const a = touchesRef.current.get(pinch.ids[0]);
    const b = touchesRef.current.get(pinch.ids[1]);
    if (!a || !b) return;
    const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    const scale = clampScale(
      (pinch.startScale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.startDistance,
    );
    commitView({ scale, x: mid.x - pinch.anchor.x * scale, y: mid.y - pinch.anchor.y * scale });
  };

  /** A press with the select tool: grab a handle, move, toggle, or start a marquee. */
  const startSelect = (e: PointerEvent<HTMLCanvasElement>, point: Point, screen: Point) => {
    const { elements, selectedIds, onSelect } = propsRef.current;
    const touch = e.pointerType === 'touch';
    const base = {
      downScreen: screen,
      down: point,
      pointer: point,
      mods: { shift: e.shiftKey, alt: e.altKey },
      touch,
      dragging: false,
    };

    const grab = grabAt(point, touch);
    if (grab?.kind === 'line-end') {
      selectRef.current = { ...base, kind: 'line-end', original: grab.shape, end: grab.end };
      return;
    }
    if (grab?.kind === 'handle') {
      selectRef.current = {
        ...base,
        kind: 'resize',
        handle: grab.handle,
        bounds: grab.bounds,
        originals: grab.selected,
        keepAspect: lockAspect(grab.selected),
      };
      return;
    }

    const hit = pickElement(elements, point, reach(touch ? PICK_RADIUS_TOUCH : PICK_RADIUS));
    if (e.shiftKey) {
      if (hit) {
        onSelect(
          selectedIds.includes(hit.id)
            ? selectedIds.filter((id) => id !== hit.id)
            : [...selectedIds, hit.id],
        );
        selectRef.current = { ...base, kind: 'click' };
      } else {
        selectRef.current = { ...base, kind: 'marquee', additive: true, base: selectedIds };
      }
      return;
    }

    let moving: BoardElement[];
    if (hit && selectedIds.includes(hit.id)) {
      moving = selectedElements();
    } else if (insideSelection(point)) {
      moving = selectedElements();
    } else if (hit) {
      onSelect([hit.id]);
      moving = [hit];
    } else {
      if (selectedIds.length > 0) onSelect([]);
      selectRef.current = { ...base, kind: 'marquee', additive: false, base: [] };
      return;
    }
    selectRef.current = {
      ...base,
      kind: 'move',
      originals: moving,
      bounds: selectionBounds(moving)!,
    };
  };

  /** The pointer moved with the select tool held down. */
  const moveSelect = (g: SelectGesture, point: Point, screen: Point, mods: DragModifiers) => {
    g.pointer = point;
    g.mods = mods;
    if (!g.dragging) {
      const slop = g.touch ? CLICK_SLOP_TOUCH : CLICK_SLOP;
      if (Math.hypot(screen.x - g.downScreen.x, screen.y - g.downScreen.y) < slop) return;
      if (g.kind === 'click') return;
      g.dragging = true;
      propsRef.current.onGestureChange(true);
      clearHover();
      if (g.kind === 'move' || g.kind === 'resize') setHidden(g.originals.map((el) => el.id));
      if (g.kind === 'line-end') setHidden([g.original.id]);
      if (g.kind === 'resize') setCursor(handleCursor(g.handle));
      if (g.kind === 'move') setCursor('move');
    }
    if (g.kind === 'marquee') {
      const inside = elementsInRect(propsRef.current.elements, rectFromPoints(g.down, point));
      const next = g.additive ? [...new Set([...g.base, ...inside])] : inside;
      const current = propsRef.current.selectedIds;
      if (next.length !== current.length || next.some((id, i) => id !== current[i])) {
        propsRef.current.onSelect(next);
      }
    }
    schedulePaint();
  };

  /** Released: apply a move or resize, or treat it as a click / double-click. */
  const finishSelect = (g: SelectGesture, commit: boolean) => {
    selectRef.current = null;
    const moved =
      g.kind !== 'move' && g.kind !== 'resize' ? true : !isIdentity(gestureTransform(g));
    const dragged = commit && g.dragging && moved ? previewOf(g) : null;
    if (hiddenRef.current.size > 0) hiddenRef.current = new Set();
    if (g.dragging) {
      propsRef.current.onGestureChange(false);
      setCursor('');
    }
    // Back into the cache. If the edit changes elements, the re-render rebuilds it again before
    // the next frame is painted, so the old positions never show.
    rebuildCache();
    schedulePaint();
    if (dragged) propsRef.current.onElementsChange(dragged);
    if (!commit || g.dragging) return;
    // A click (no drag). Two in a row on the same spot edit a text, or make a new one.
    const now = performance.now();
    const last = lastTapRef.current;
    const isDouble =
      last !== null &&
      now - last.at < DOUBLE_TAP_MS &&
      Math.hypot(g.downScreen.x - last.x, g.downScreen.y - last.y) < DOUBLE_TAP_PX;
    lastTapRef.current = isDouble ? null : { at: now, x: g.downScreen.x, y: g.downScreen.y };
    if (!isDouble) return;
    const hit = pickElement(
      propsRef.current.elements,
      g.down,
      reach(g.touch ? PICK_RADIUS_TOUCH : PICK_RADIUS),
    );
    if (hit?.type === 'text') propsRef.current.onTextRequest({ id: hit.id });
    else if (!hit) propsRef.current.onTextRequest({ at: g.down });
  };

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const { disabled, tool, style, editing } = propsRef.current;
    if (disabled) return;
    const canvas = e.currentTarget;
    if (editing) {
      // The press only closes the text editor (its blur saves the text).
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      return;
    }

    if (e.pointerType === 'touch') {
      // A pen or mouse already at work means this touch is a resting palm; a third finger is noise.
      const otherBusy =
        pointerIdRef.current !== null && !touchesRef.current.has(pointerIdRef.current);
      if (pinchRef.current || otherBusy) {
        ignoredRef.current.add(e.pointerId);
        return;
      }
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchesRef.current.size === 2) {
        startPinch(canvas);
        return;
      }
    } else if (pinchRef.current || pointerIdRef.current !== null) {
      return;
    }

    const wantsPan = e.button === 1 || tool === 'hand' || spaceRef.current;
    if (e.button !== 0 && !wantsPan) return;
    pointerIdRef.current = e.pointerId;
    canvas.setPointerCapture(e.pointerId);

    if (wantsPan) {
      e.preventDefault(); // middle button would otherwise start browser autoscroll
      panRef.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startView: viewRef.current,
      };
      setPanState('active');
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const point = toBoard(e, rect, viewRef.current);
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (tool === 'select') {
      startSelect(e, point, screen);
      schedulePaint();
      return;
    }
    if (tool === 'text') {
      selectRef.current = {
        downScreen: screen,
        down: point,
        pointer: point,
        mods: { shift: false, alt: false },
        touch: e.pointerType === 'touch',
        dragging: false,
        kind: 'click',
      };
      return;
    }
    if (tool === 'eraser') {
      eraseGestureRef.current = nanoid();
      erase([point]);
      return;
    }
    if (isShapeTool(tool)) {
      shapeRef.current = createShape(
        tool,
        {
          id: nanoid(),
          authorId: LOCAL_AUTHOR_ID,
          createdAt: Date.now(),
          start: point,
          end: point,
        },
        style,
      );
      dragRef.current = {
        type: tool,
        origin: point,
        pointer: point,
        mods: { shift: e.shiftKey, alt: e.altKey },
        touch: e.pointerType === 'touch',
      };
      updateShapeDrag();
      return;
    }
    activeRef.current = {
      id: nanoid(),
      type: 'stroke',
      authorId: LOCAL_AUTHOR_ID,
      color: style.color,
      width: style.width,
      points: [point],
      createdAt: Date.now(),
    };
    propsRef.current.onStrokeStart(activeRef.current);
    schedulePaint();
  };

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (touchesRef.current.has(e.pointerId)) {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const rect = e.currentTarget.getBoundingClientRect();
    if (pinchRef.current) {
      updatePinch(pinchRef.current, rect);
      return;
    }
    if (ignoredRef.current.has(e.pointerId)) return;

    const here = toBoard(e, rect, viewRef.current);
    propsRef.current.onCursorMove(here);
    const pan = panRef.current;
    if (pan && pan.id === e.pointerId) {
      commitView(panBy(pan.startView, e.clientX - pan.startX, e.clientY - pan.startY));
      return;
    }
    if (e.pointerId !== pointerIdRef.current) {
      // Just hovering (a mouse or pen with no button down).
      if (pointerIdRef.current === null && e.pointerType !== 'touch') updateHover(here);
      return;
    }

    const select = selectRef.current;
    if (select) {
      const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      moveSelect(select, here, screen, { shift: e.shiftKey, alt: e.altKey });
      return;
    }

    // Coalesced events recover samples the browser merged between frames.
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const view = viewRef.current;
    const points = (samples.length > 0 ? samples : [e.nativeEvent]).map((s) =>
      toBoard(s, rect, view),
    );

    if (propsRef.current.tool === 'eraser') {
      erase(points);
    } else if (dragRef.current) {
      dragRef.current.pointer = points[points.length - 1];
      dragRef.current.mods = { shift: e.shiftKey, alt: e.altKey };
      updateShapeDrag();
    } else if (activeRef.current) {
      activeRef.current.points.push(...points);
      propsRef.current.onStrokePoints(activeRef.current.id, points);
      schedulePaint();
    }
  };

  const finish = (e: PointerEvent<HTMLCanvasElement>, commit: boolean) => {
    const id = e.pointerId;
    touchesRef.current.delete(id);
    if (ignoredRef.current.delete(id)) return;

    const pinch = pinchRef.current;
    if (pinch?.ids.includes(id)) {
      pinchRef.current = null;
      // The finger left behind must not start drawing; it is ignored until it lifts too.
      for (const other of pinch.ids) {
        if (other !== id && touchesRef.current.delete(other)) ignoredRef.current.add(other);
      }
      return;
    }

    if (panRef.current?.id === id) {
      panRef.current = null;
      pointerIdRef.current = null;
      setPanState(spaceRef.current ? 'ready' : '');
      return;
    }

    if (id !== pointerIdRef.current) return;
    pointerIdRef.current = null;

    const select = selectRef.current;
    if (select) {
      if (propsRef.current.tool === 'text') {
        selectRef.current = null;
        if (commit && !select.dragging) textClick(select.down, select.touch);
        return;
      }
      finishSelect(select, commit);
      return;
    }

    const stroke = activeRef.current;
    const shape = shapeRef.current;
    activeRef.current = null;
    shapeRef.current = null;
    dragRef.current = null;
    if (shape) {
      const { start, end } = shape;
      const size = Math.hypot(end.x - start.x, end.y - start.y) * viewRef.current.scale;
      if (commit && size >= MIN_SHAPE_SIZE) {
        propsRef.current.onShapeAdd(shape); // the new element repaints the board
      } else {
        paint(); // too small or cancelled: drop the preview
      }
      return;
    }
    if (stroke && commit) {
      propsRef.current.onStrokeAdd(stroke);
    } else {
      if (stroke) propsRef.current.onStrokeCancel(stroke.id);
      paint(); // cancelled: drop the in-progress stroke from the screen
    }
  };

  /** A tap with the text tool: edit the text under it, or start a new one there. */
  const textClick = (p: Point, touch: boolean) => {
    const { elements, onTextRequest } = propsRef.current;
    const radius = reach(touch ? PICK_RADIUS_TOUCH : PICK_RADIUS);
    const hit = [...elements]
      .reverse()
      .find((el) => el.type === 'text' && elementHit(el, p, radius));
    onTextRequest(hit ? { id: hit.id } : { at: p });
  };

  return (
    <canvas
      ref={canvasRef}
      className={`whiteboard ${props.tool}${props.disabled ? ' disabled' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
      onPointerEnter={() => (hoveringRef.current = true)}
      onPointerLeave={() => {
        hoveringRef.current = false;
        if (pointerIdRef.current === null) clearHover();
      }}
    />
  );
}
