import type { CSSProperties } from 'react';
import type { Participant } from '@whiteboard/shared';
import { toScreen } from '../lib/coords.ts';
import type { CursorState } from '../hooks/presenceReducer.ts';

type Props = {
  participants: Participant[];
  cursors: Record<string, CursorState>;
};

/** Other people's cursors with a name label, in their color. Click-through. */
export function CursorLayer({ participants, cursors }: Props) {
  return (
    <div className="cursor-layer" aria-hidden="true">
      {participants.map(({ clientId, name, color }) => {
        const cursor = cursors[clientId];
        if (!cursor) return null;
        const { x, y } = toScreen(cursor.point);
        return (
          <div
            key={clientId}
            className="remote-cursor"
            style={
              {
                transform: `translate(${x}px, ${y}px)`,
                '--cursor-color': color,
              } as CSSProperties // custom property is not in React's CSS typings
            }
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
      })}
    </div>
  );
}
