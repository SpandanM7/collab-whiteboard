import type { ReactNode } from 'react';
import type { Rect } from '../lib/geometry.ts';
import { modKey } from '../lib/shortcuts.ts';
import { toScreenPoint } from '../lib/view.ts';
import type { View } from '../lib/view.ts';
import { viewportSize } from '../lib/viewport.ts';
import { Icon } from './Icon.tsx';
import { BackIcon, DuplicateIcon, EditIcon, FrontIcon, TrashIcon } from './icons.tsx';

type Props = {
  /** The selection's frame, in board space. */
  bounds: Rect;
  view: View;
  count: number;
  /** A single text is selected: offer to edit it (touch has no double-click to discover). */
  canEdit: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onFront: () => void;
  onBack: () => void;
  onDelete: () => void;
};

/** Space between the frame and the bar (clear of the resize handles), and the bar's height. */
const GAP = 24;
const BAR_HEIGHT = 48;
/** Keeps clear of the top bar (connection status, share). */
const TOP_CLEARANCE = 64;
const EDGE = 8;
const HALF_WIDTH_ESTIMATE = 120;

/**
 * Actions for the selection, floating just above it (or below, near the top of the screen).
 * Everything here also has a keyboard shortcut; on touch screens this is the only way.
 */
export function SelectionActions({
  bounds,
  view,
  count,
  canEdit,
  onEdit,
  onDuplicate,
  onFront,
  onBack,
  onDelete,
}: Props) {
  const topLeft = toScreenPoint({ x: bounds.left, y: bounds.top }, view);
  const bottomRight = toScreenPoint({ x: bounds.right, y: bounds.bottom }, view);
  const { width, height } = viewportSize();
  const centerX = Math.min(
    width - EDGE - HALF_WIDTH_ESTIMATE,
    Math.max(EDGE + HALF_WIDTH_ESTIMATE, (topLeft.x + bottomRight.x) / 2),
  );
  const above = topLeft.y - GAP - BAR_HEIGHT;
  const top =
    above >= TOP_CLEARANCE ? above : Math.min(bottomRight.y + GAP, height - BAR_HEIGHT - EDGE - 80);
  const mod = modKey();

  const action = (label: string, shortcut: string, icon: ReactNode, onClick: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
    >
      <Icon size={20}>{icon}</Icon>
    </button>
  );

  return (
    <div
      className="selection-actions"
      role="toolbar"
      aria-label={`Selection, ${count} ${count === 1 ? 'element' : 'elements'}`}
      style={{ left: centerX, top: Math.max(TOP_CLEARANCE, top) }}
    >
      {canEdit && action('Edit text', 'Enter', EditIcon, onEdit)}
      {action('Duplicate', `${mod}+D`, DuplicateIcon, onDuplicate)}
      {action('Bring to front', `${mod}+Shift+]`, FrontIcon, onFront)}
      {action('Send to back', `${mod}+Shift+[`, BackIcon, onBack)}
      <span className="selection-actions-divider" aria-hidden="true" />
      {action('Delete', 'Delete', TrashIcon, onDelete)}
    </div>
  );
}
