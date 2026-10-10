import type { ReorderTarget } from '@whiteboard/shared';
import type { Tool } from '../types.ts';

/** Single-key tool shortcuts, as in most drawing tools. Shown in the buttons' tooltips. */
export const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  p: 'pen',
  e: 'eraser',
  h: 'hand',
  k: 'laser',
  t: 'text',
  r: 'rect',
  o: 'ellipse',
  d: 'diamond',
  l: 'line',
  a: 'arrow',
};

/** Arrow keys move the selection by this much, or by `NUDGE_FAR` with Shift (board units). */
export const NUDGE = 1;
export const NUDGE_FAR = 10;

export type ShortcutAction =
  | { type: 'tool'; tool: Tool }
  | { type: 'toggle-grid' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select-all' }
  | { type: 'duplicate' }
  | { type: 'delete' }
  | { type: 'reorder'; to: ReorderTarget }
  | { type: 'nudge'; dx: number; dy: number }
  | { type: 'export' }
  | { type: 'help' }
  | { type: 'edit' }
  | { type: 'escape' };

type KeyInfo = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> &
  Partial<Pick<KeyboardEvent, 'code'>>;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * What a key press does on the board, if anything. Ctrl stands for Cmd on a Mac too. Copy, cut and
 * paste are not here: they come from the browser's clipboard events.
 */
export function shortcutFor(e: KeyInfo): ShortcutAction | null {
  const command = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (command) {
    if (e.altKey) return null;
    if (key === "'") return { type: 'toggle-grid' };
    if (key === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
    if (key === 'y' && !e.shiftKey) return { type: 'redo' };
    if (e.shiftKey) {
      if (key === 'e') return { type: 'export' };
      if (e.code === 'BracketRight') return { type: 'reorder', to: 'front' };
      if (e.code === 'BracketLeft') return { type: 'reorder', to: 'back' };
      return null;
    }
    if (key === 'a') return { type: 'select-all' };
    if (key === 'd') return { type: 'duplicate' };
    return null;
  }
  if (e.altKey) return null;
  if (e.key === 'Delete' || e.key === 'Backspace') return { type: 'delete' };
  if (e.key === 'Escape') return { type: 'escape' };
  if (e.key === 'Enter' && !e.shiftKey) return { type: 'edit' };
  const arrow = ARROWS[e.key];
  if (arrow) {
    const step = e.shiftKey ? NUDGE_FAR : NUDGE;
    return { type: 'nudge', dx: arrow[0] * step, dy: arrow[1] * step };
  }
  if (e.key === '?') return { type: 'help' };
  if (e.shiftKey) return null;
  const tool = TOOL_KEYS[key];
  return tool ? { type: 'tool', tool } : null;
}

/** Keys typed into a field belong to the field, not the board. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]') !== null
  );
}

/** Shortcut keys as shown in tooltips and the shortcuts dialog: "Ctrl" or "⌘" as appropriate. */
export function modKey(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';
}
