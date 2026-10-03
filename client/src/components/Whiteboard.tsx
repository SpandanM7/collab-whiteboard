import { nanoid } from 'nanoid';
import { useLayoutEffect, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { Point, Stroke } from '@whiteboard/shared';
import { drawStroke } from '../lib/drawing.ts';
import { strokeHit } from '../lib/geometry.ts';
import type { Tool } from '../types.ts';

const ERASER_RADIUS = 6;
const LOCAL_AUTHOR_ID = 'local';

type Props = {
  strokes: Stroke[];
  tool: Tool;
  color: string;
  width: number;
  onStrokeAdd: (stroke: Stroke) => void;
  onStrokesErase: (ids: string[]) => void;
};

/** Maps a pointer event to board space. Identity offset for now; pan/zoom will go here. */
function toBoard(e: { clientX: number; clientY: number }): Point {
  return { x: e.clientX, y: e.clientY };
}

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
    if (activeRef.current) {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStroke(ctx, activeRef.current);
    }
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

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = cache.width = Math.round(window.innerWidth * dpr);
      canvas.height = cache.height = Math.round(window.innerHeight * dpr);
      rebuildCache();
      paint();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
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

  const erase = (points: Point[]) => {
    const { strokes, onStrokesErase } = propsRef.current;
    const ids = strokes
      .filter((s) => points.some((p) => strokeHit(s, p, ERASER_RADIUS)))
      .map((s) => s.id);
    if (ids.length > 0) onStrokesErase(ids);
  };

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== null || e.button !== 0) return;
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);

    const point = toBoard(e);
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
    schedulePaint();
  };

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerId !== pointerIdRef.current) return;
    // Coalesced events recover samples the browser merged between frames.
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const points = (samples.length > 0 ? samples : [e.nativeEvent]).map(toBoard);

    if (propsRef.current.tool === 'eraser') {
      erase(points);
    } else if (activeRef.current) {
      activeRef.current.points.push(...points);
      schedulePaint();
    }
  };

  const finish = (e: PointerEvent<HTMLCanvasElement>, commit: boolean) => {
    if (e.pointerId !== pointerIdRef.current) return;
    pointerIdRef.current = null;
    const stroke = activeRef.current;
    activeRef.current = null;
    if (stroke && commit) propsRef.current.onStrokeAdd(stroke);
    else paint(); // cancelled: drop the in-progress stroke from the screen
  };

  return (
    <canvas
      ref={canvasRef}
      className={`whiteboard ${props.tool}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
    />
  );
}
