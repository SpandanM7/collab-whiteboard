import type { Point } from '@whiteboard/shared';

/** How long a point of a laser trail stays visible, fading out over that time (ms). */
export const LASER_LIFETIME_MS = 1000;
/** A trail keeps at most this many points; a long press drops its oldest ones first. */
export const MAX_TRAIL_POINTS = 400;

/** Who drew a trail: a participant's client id, or this constant for the local person. */
export const SELF = 'self';

export type TrailPoint = Point & { t: number };

export type Trail = { owner: string; id: string; points: TrailPoint[] };

/** How visible a point of age `age` is: 1 when new, falling to 0 at the end of its life. */
export function fade(age: number): number {
  return Math.max(0, Math.min(1, 1 - age / LASER_LIFETIME_MS));
}

/**
 * Laser pointer trails, local and remote. Never part of the board: points fade out after
 * `LASER_LIFETIME_MS` and are then dropped. Kept outside React state because points arrive many
 * times a second; whoever draws them subscribes and animates while any are left.
 */
export class LaserTrails {
  private readonly trails = new Map<string, Trail>();
  private readonly listeners = new Set<() => void>();

  get isEmpty(): boolean {
    return this.trails.size === 0;
  }

  /**
   * Appends points to `owner`'s trail `id` at time `now`. A remote batch covers the interval it
   * was collected over, so `spreadMs` spaces its points across that time instead of giving them
   * one timestamp (which would fade in steps).
   */
  add(owner: string, id: string, points: readonly Point[], now: number, spreadMs = 0): void {
    if (points.length === 0) return;
    const key = `${owner}\u0000${id}`;
    let trail = this.trails.get(key);
    if (!trail) {
      trail = { owner, id, points: [] };
      this.trails.set(key, trail);
    }
    const n = points.length;
    points.forEach((p, i) => {
      trail.points.push({ x: p.x, y: p.y, t: now - spreadMs * (1 - (i + 1) / n) });
    });
    if (trail.points.length > MAX_TRAIL_POINTS) {
      trail.points.splice(0, trail.points.length - MAX_TRAIL_POINTS);
    }
    for (const listener of this.listeners) listener();
  }

  /** Drops points that have faded out, and trails left empty. Returns whether any remain. */
  prune(now: number): boolean {
    for (const [key, trail] of this.trails) {
      const firstAlive = trail.points.findIndex((p) => now - p.t < LASER_LIFETIME_MS);
      if (firstAlive === -1) this.trails.delete(key);
      else if (firstAlive > 0) trail.points.splice(0, firstAlive);
    }
    return this.trails.size > 0;
  }

  all(): Iterable<Trail> {
    return this.trails.values();
  }

  clear(): void {
    this.trails.clear();
    for (const listener of this.listeners) listener();
  }

  /** Called whenever trails are added or cleared. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
