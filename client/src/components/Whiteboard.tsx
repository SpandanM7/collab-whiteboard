import { nanoid } from 'nanoid';
import { useLayoutEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { BoardElement, Point, Shape, ShapeType, Stroke } from '@whiteboard/shared';
import { toBoard } from '../lib/coords.ts';
import { drawElement, drawShape, drawStroke } from '../lib/drawing.ts';
import { elementBounds, elementHit, rectsIntersect } from '../lib/geometry.ts';
import type { Rect } from '../lib/geometry.ts';
import { dragReadout, dragShape, gridStep } from '../lib/shapeDrag.ts';
import { isTypingTarget } from '../lib/shortcuts.ts';
import type { DragModifiers } from '../lib/shapeDrag.ts';
import { createShape } from '../lib/toolStyle.ts';
import type { ToolStyle } from '../lib/toolStyle.ts';
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
  onStrokeStart: (stroke: Stroke) => void;
  onStrokePoints: (id: string, points: Point[]) => void;
  onStrokeAdd: (stroke: Stroke) => void;
  /** A shape was finished (pointer released). Shapes are shown to others only at this point. */
  onShapeAdd: (shape: Shape) => void;
  onStrokeCancel: (id: string) => void;
  onStrokesErase: (ids: string[]) => void;
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
    for (const stroke of propsRef.current.liveStrokes) drawStroke(ctx, stroke);
    if (activeRef.current) drawStroke(ctx, activeRef.current);
    if (shapeRef.current) {
      drawShape(ctx, shapeRef.current);
      if (dragRef.current) drawReadout(ctx, shapeRef.current, dragRef.current, view);
    }
  };

  /** The size (or length and angle) of the shape being dragged, in a label by the pointer. */
  const drawReadout = (
    ctx: CanvasRenderingContext2D,
    shape: Shape,
    drag: ShapeDrag,
    view: View,
  ) => {
    const dpr = window.devicePixelRatio || 1;
    const text = dragReadout(shape.type, shape.start, shape.end);
    const at = toScreenPoint(drag.pointer, view);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = READOUT_FONT;
    const width = ctx.measureText(text).width + 12;
    const height = 20;
    const x = at.x + 14;
    const y = drag.touch ? at.y - 56 : at.y + 18;
    ctx.fillStyle = 'rgba(26, 26, 26, 0.85)';
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 6, y + height / 2);
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
    for (const element of propsRef.current.elements) {
      if (rectsIntersect(elementBounds(element), visible)) drawElement(ctx, element);
    }
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
    // Shift or Alt pressed or released mid-drag reshapes the shape without the pointer moving.
    const updateDragKeys = (e: KeyboardEvent): boolean => {
      const drag = dragRef.current;
      if (!drag || (e.key !== 'Shift' && e.key !== 'Alt')) return false;
      if (e.key === 'Alt') e.preventDefault(); // Windows would otherwise focus the browser menu
      drag.mods = { shift: e.shiftKey, alt: e.altKey };
      updateShapeDrag();
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
  }, [props.elements, props.grid]);

  // The view was changed from outside (zoom buttons, fit, jump to a person).
  useLayoutEffect(() => {
    viewRef.current = props.view;
    schedulePaint();
    // schedulePaint only touches refs, so it is safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.view]);

  // Remote strokes in progress change often; they only need a repaint, not a cache rebuild.
  useLayoutEffect(() => {
    schedulePaint();
    // schedulePaint only touches refs, so it is safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.liveStrokes]);

  // The board became unusable mid-stroke: drop it rather than leave a stroke that cannot be saved.
  useLayoutEffect(() => {
    if (!props.disabled) return;
    pointerIdRef.current = null;
    panRef.current = null;
    pinchRef.current = null;
    touchesRef.current.clear();
    ignoredRef.current.clear();
    if (activeRef.current || shapeRef.current) {
      activeRef.current = null;
      shapeRef.current = null;
      dragRef.current = null;
      paint();
    }
    // paint only touches refs, so it is safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.disabled]);

  const erase = (points: Point[]) => {
    const { elements, onStrokesErase } = propsRef.current;
    const radius = ERASER_RADIUS / viewRef.current.scale;
    const ids = elements
      .filter((e) => points.some((p) => elementHit(e, p, radius)))
      .map((e) => e.id);
    if (ids.length > 0) onStrokesErase(ids);
  };

  /** Two fingers are down: stop whatever one finger was doing and start moving the view. */
  const startPinch = (canvas: HTMLCanvasElement) => {
    const ids = [...touchesRef.current.keys()].slice(0, 2) as [number, number];
    const [a, b] = ids.map((id) => touchesRef.current.get(id)!);
    const stroke = activeRef.current;
    activeRef.current = null;
    shapeRef.current = null;
    dragRef.current = null;
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

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const { disabled, tool, style } = propsRef.current;
    if (disabled) return;
    const canvas = e.currentTarget;

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

    const point = toBoard(e, canvas.getBoundingClientRect(), viewRef.current);
    if (tool === 'eraser') {
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

    propsRef.current.onCursorMove(toBoard(e, rect, viewRef.current));
    const pan = panRef.current;
    if (pan && pan.id === e.pointerId) {
      commitView(panBy(pan.startView, e.clientX - pan.startX, e.clientY - pan.startY));
      return;
    }
    if (e.pointerId !== pointerIdRef.current) return;

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

  return (
    <canvas
      ref={canvasRef}
      className={`whiteboard ${props.tool}${props.disabled ? ' disabled' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
      onPointerEnter={() => (hoveringRef.current = true)}
      onPointerLeave={() => (hoveringRef.current = false)}
    />
  );
}
