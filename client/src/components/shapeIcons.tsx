import type { ReactNode } from 'react';
import type { Arrowhead, ShapeType } from '@whiteboard/shared';

/** The shape tools in menu order, with their keyboard shortcut (if any). */
export const SHAPE_TOOLS: { tool: ShapeType; label: string; key?: string; icon: ReactNode }[] = [
  {
    tool: 'rect',
    label: 'Rectangle',
    key: 'R',
    icon: <rect x="4" y="5" width="16" height="14" rx="1" />,
  },
  { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: <ellipse cx="12" cy="12" rx="9" ry="7" /> },
  { tool: 'diamond', label: 'Diamond', key: 'D', icon: <path d="M12 3 21 12 12 21 3 12Z" /> },
  { tool: 'triangle', label: 'Triangle', icon: <path d="M12 4 21 20H3Z" /> },
  { tool: 'hexagon', label: 'Hexagon', icon: <path d="M7.5 4h9L21 12l-4.5 8h-9L3 12Z" /> },
  {
    tool: 'cylinder',
    label: 'Cylinder',
    icon: (
      <>
        <ellipse cx="12" cy="6" rx="8" ry="3" />
        <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      </>
    ),
  },
  {
    tool: 'star',
    label: 'Star',
    icon: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />,
  },
  { tool: 'line', label: 'Line', key: 'L', icon: <path d="M5 19 19 5" /> },
  {
    tool: 'arrow',
    label: 'Arrow',
    key: 'A',
    icon: (
      <>
        <path d="M5 19 19 5" />
        <path d="M9 5h10v10" />
      </>
    ),
  },
];

/** A head on the right-hand end of a short line, for the arrowhead pickers. */
export function headIcon(head: Arrowhead): ReactNode {
  const tip = { x: 20, y: 12 };
  return (
    <>
      <path d={`M4 12H${head === 'none' || head === 'bar' ? tip.x : 15}`} />
      {head === 'arrow' && <path d="M14 7l6 5-6 5" />}
      {head === 'triangle' && <path d="M14 7l6 5-6 5Z" fill="currentColor" />}
      {head === 'dot' && <circle cx="17" cy="12" r="3" fill="currentColor" />}
      {head === 'bar' && <path d="M20 6v12" />}
    </>
  );
}
