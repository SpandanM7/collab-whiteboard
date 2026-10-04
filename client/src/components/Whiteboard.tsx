import { nanoid } from 'nanoid';
import { useLayoutEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { BoardElement, Point, Shape, Stroke } from '@whiteboard/shared';
import { toBoard } from '../lib/coords.ts';
import { drawElement, drawShape, drawStroke } from '../lib/drawing.ts';
import { elementBounds, elementHit, rectsIntersect } from '../lib/geometry.ts';
import { clampScale, panBy, toBoardPoint, visibleRect, zoomAt } from '../lib/view.ts';
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
  color: string;
  width: number;
  /** Fill color for new rectangles and ellipses; null draws them as outlines. */
  fill: string | null;
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

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]') !== null
  );
}

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
    if (shapeRef.current) drawShape(ctx, shapeRef.current);
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
      if (e.code !== 'Space' || isTypingTarget(e.target) || !hoveringRef.current) return;
      e.preventDefault();
      if (e.repeat) return;
      spaceRef.current = true;
      if (!panRef.current) setPanState('ready');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (hoveringRef.current && !isTypingTarget(e.target)) e.preventDefault();
      releaseSpace();
    };
    const releaseSpace = () => {
      spaceRef.current = false;
      if (!panRef.current) setPanState('');
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

  // Redraw from element data. Layout effect so the frame never shows an element missing.
  useLayoutEffect(() => {
    rebuildCache();
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.elements]);

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
    const { disabled, tool, color, width, fill } = propsRef.current;
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
      const base = {
        id: nanoid(),
        authorId: LOCAL_AUTHOR_ID,
        color,
        width,
        start: point,
        end: point,
        createdAt: Date.now(),
      };
      shapeRef.current =
        tool === 'rect' || tool === 'ellipse'
          ? { ...base, type: tool, ...(fill ? { fill } : {}) }
          : { ...base, type: tool };
      schedulePaint();
      return;
    }
    activeRef.current = {
      id: nanoid(),
      type: 'stroke',
      authorId: LOCAL_AUTHOR_ID,
      color,
      width,
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
    } else if (shapeRef.current) {
      shapeRef.current.end = points[points.length - 1];
      schedulePaint();
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
