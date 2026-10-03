import { nanoid } from 'nanoid';
import { useLayoutEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { Point, Stroke } from '@whiteboard/shared';
import { toBoard } from '../lib/coords.ts';
import { drawStroke } from '../lib/drawing.ts';
import { strokeHit } from '../lib/geometry.ts';
import type { Tool } from '../types.ts';

const ERASER_RADIUS = 6;
const LOCAL_AUTHOR_ID = 'local';

type Props = {
  /** Finished strokes, drawn from the cached layer. */
  strokes: Stroke[];
  /** Strokes other people are still drawing; repainted every frame on top of the cache. */
  liveStrokes: Stroke[];
  tool: Tool;
  color: string;
  width: number;
  /** The board cannot be used at all (e.g. the room is full): ignore input. */
  disabled: boolean;
  onStrokeStart: (stroke: Stroke) => void;
  onStrokePoints: (id: string, points: Point[]) => void;
  onStrokeAdd: (stroke: Stroke) => void;
  onStrokeCancel: (id: string) => void;
  onStrokesErase: (ids: string[]) => void;
  /** The pointer moved over the board (hovering or drawing), in board space. */
  onCursorMove: (point: Point) => void;
};

export function Whiteboard(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Committed strokes are cached here so a frame only has to blit + draw the active stroke.
  const cacheRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef<Stroke | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const propsRef = useRef(props);

  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const paint = () => {
    const canvas = canvasRef.current;
    const cache = cacheRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !cache || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cache, 0, 0);
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const stroke of propsRef.current.liveStrokes) drawStroke(ctx, stroke);
    if (activeRef.current) drawStroke(ctx, activeRef.current);
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cache.width, cache.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const stroke of propsRef.current.strokes) drawStroke(ctx, stroke);
  };

  // Size the canvas (and cache) to the viewport, including on resize / DPR change.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cache = document.createElement('canvas');
    cacheRef.current = cache;

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
  }, []);

  // Redraw from stroke data. Layout effect so the frame never shows a stroke missing.
  useLayoutEffect(() => {
    rebuildCache();
    paint();
  }, [props.strokes]);

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
    if (activeRef.current) {
      activeRef.current = null;
      paint();
    }
    // paint only touches refs, so it is safe to omit.
  }, [props.disabled]);

  const erase = (points: Point[]) => {
    const { strokes, onStrokesErase } = propsRef.current;
    const ids = strokes
      .filter((s) => points.some((p) => strokeHit(s, p, ERASER_RADIUS)))
      .map((s) => s.id);
    if (ids.length > 0) onStrokesErase(ids);
  };

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (propsRef.current.disabled || pointerIdRef.current !== null || e.button !== 0) return;
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);

    const point = toBoard(e, e.currentTarget.getBoundingClientRect());
    const { tool, color, width } = propsRef.current;
    if (tool === 'eraser') {
      erase([point]);
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
    const origin = e.currentTarget.getBoundingClientRect();
    propsRef.current.onCursorMove(toBoard(e, origin));
    if (e.pointerId !== pointerIdRef.current) return;
    // Coalesced events recover samples the browser merged between frames.
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const points = (samples.length > 0 ? samples : [e.nativeEvent]).map((s) => toBoard(s, origin));

    if (propsRef.current.tool === 'eraser') {
      erase(points);
    } else if (activeRef.current) {
      activeRef.current.points.push(...points);
      propsRef.current.onStrokePoints(activeRef.current.id, points);
      schedulePaint();
    }
  };

  const finish = (e: PointerEvent<HTMLCanvasElement>, commit: boolean) => {
    if (e.pointerId !== pointerIdRef.current) return;
    pointerIdRef.current = null;
    const stroke = activeRef.current;
    activeRef.current = null;
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
    />
  );
}
