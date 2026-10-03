import type { CSSProperties } from 'react';
import type { Participant, Point } from '@whiteboard/shared';
import { toScreen } from '../lib/coords.ts';
import type { CursorState } from '../hooks/presenceReducer.ts';
import type { View } from '../lib/view.ts';
import { uiInsets, viewportSize } from '../lib/viewport.ts';

type Props = {
  participants: Participant[];
  cursors: Record<string, CursorState>;
  view: View;
  /** A marker for someone off screen was clicked: bring them into view. */
  onJumpTo: (point: Point) => void;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Other people's cursors with a name label, in their color. Click-through. Someone whose cursor is
 * off screen gets a marker on the nearest edge, pointing their way; clicking it jumps to them.
 */
export function CursorLayer({ participants, cursors, view, onJumpTo }: Props) {
  const { width, height } = viewportSize();
  const insets = uiInsets();

  return (
    <div className="cursor-layer">
      {participants.map(({ clientId, name, color }) => {
        const cursor = cursors[clientId];
        if (!cursor) return null;
        const { x, y } = toScreen(cursor.point, view);
        const style = { '--cursor-color': color } as CSSProperties; // custom property is not in React's CSS typings

        if (x >= 0 && x <= width && y >= 0 && y <= height) {
          return (
            <div
              key={clientId}
              className="remote-cursor"
              aria-hidden="true"
              style={{ ...style, transform: `translate(${x}px, ${y}px)` }}
            >
              <svg width="16" height="20" viewBox="0 0 16 20">
                <path
                  d="M1 1 L1 16 L5 12.5 L8 19 L10.5 18 L7.7 11.5 L13 11.5 Z"
                  fill={color}
                  stroke="#fff"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="remote-cursor-label">{name}</span>
            </div>
          );
        }

        // Off screen: sit on the nearest edge of the free area and point toward them.
        const markerX = clamp(x, insets.left, width - insets.right);
        const markerY = clamp(y, insets.top, height - insets.bottom);
        const angle = Math.atan2(y - markerY, x - markerX);
        return (
          <button
            key={clientId}
            type="button"
            className="edge-marker"
            aria-label={`Go to ${name}`}
            title={`Go to ${name}`}
            style={{ ...style, transform: `translate(${markerX}px, ${markerY}px)` }}
            onClick={() => onJumpTo(cursor.point)}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: `rotate(${angle}rad)` }}
              aria-hidden="true"
            >
              <path d="M4 12h15" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
