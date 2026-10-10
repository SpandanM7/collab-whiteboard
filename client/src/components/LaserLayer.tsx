import { useLayoutEffect, useRef } from 'react';
import type { Participant } from '@whiteboard/shared';
import { SELF, fade } from '../lib/laser.ts';
import type { LaserTrails, Trail } from '../lib/laser.ts';
import { toScreenPoint } from '../lib/view.ts';
import type { View } from '../lib/view.ts';

type Props = {
  trails: LaserTrails;
  /** Everyone else, for the color of their trail. */
  participants: Participant[];
  /** The local person's color. */
  selfColor: string;
  view: View;
};

/** Used for a trail whose owner is not (or no longer) in the participant list. */
const FALLBACK_COLOR = '#e03131';

/**
 * Laser pointer trails over the board, in the color of whoever is pointing. A separate canvas,
 * click-through, that only animates while some trail is still fading. Never exported.
 */
export function LaserLayer({ trails, participants, selfColor, view }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef(view);
  const colorsRef = useRef(new Map<string, string>());
  const frameRef = useRef(0);
  // Whether the last frame drew anything, so an emptied layer is cleared exactly once.
  const drawnRef = useRef(false);

  useLayoutEffect(() => {
    viewRef.current = view;
    colorsRef.current = new Map([
      [SELF, selfColor],
      ...participants.map((p) => [p.clientId, p.color] as const),
    ]);
  });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      frameRef.current = 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const now = performance.now();
      const alive = trails.prune(now);
      if (!alive && !drawnRef.current) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const trail of trails.all()) {
        drawTrail(ctx, trail, colorsRef.current.get(trail.owner) ?? FALLBACK_COLOR, now);
      }
      drawnRef.current = alive;
      if (alive) frameRef.current = requestAnimationFrame(draw);
    };
    const schedule = () => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      drawnRef.current = true; // resizing wiped the canvas; redraw whatever is left
      schedule();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('resize', resize);
    const unsubscribe = trails.subscribe(schedule);
    return () => {
      unsubscribe();
      observer.disconnect();
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };

    function drawTrail(ctx: CanvasRenderingContext2D, trail: Trail, color: string, now: number) {
      const points = trail.points.map((p) => ({
        ...toScreenPoint(p, viewRef.current),
        life: fade(now - p.t),
      }));
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      if (points.length === 1) {
        const [p] = points;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 + 2 * p.life, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      // A soft glow, then the colored core, then a thin bright center; each narrows as it fades.
      const passes = [
        { width: (life: number) => 4 + 10 * life, alpha: 0.25, color },
        { width: (life: number) => 1.5 + 3.5 * life, alpha: 1, color },
        { width: (life: number) => 1.2 * life, alpha: 0.9, color: '#ffffff' },
      ];
      for (const pass of passes) {
        ctx.strokeStyle = pass.color;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1];
          const b = points[i];
          if (b.life <= 0) continue;
          ctx.globalAlpha = pass.alpha * b.life;
          ctx.lineWidth = pass.width(b.life);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    // Panning or zooming needs nothing extra: while a trail is alive every frame reads the latest
    // view, and once none is, there is nothing to move.
  }, [trails]);

  return <canvas ref={canvasRef} className="laser-layer" aria-hidden="true" />;
}
