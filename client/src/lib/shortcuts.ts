import type { Tool } from '../types.ts';

/** Single-key tool shortcuts, as in most drawing tools. Shown in the buttons' tooltips. */
export const TOOL_KEYS: Record<string, Tool> = {
  p: 'pen',
  e: 'eraser',
  h: 'hand',
  r: 'rect',
  o: 'ellipse',
  d: 'diamond',
  l: 'line',
  a: 'arrow',
};

export type ShortcutAction = { type: 'tool'; tool: Tool } | { type: 'toggle-grid' };

type KeyInfo = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/** What a key press does on the board, if anything. Ctrl + ' toggles the grid (also Cmd on Mac). */
export function shortcutFor(e: KeyInfo): ShortcutAction | null {
  const command = e.ctrlKey || e.metaKey;
  if (command && !e.altKey && e.key === "'") return { type: 'toggle-grid' };
  if (command || e.altKey || e.shiftKey) return null;
  const tool = TOOL_KEYS[e.key.toLowerCase()];
  return tool ? { type: 'tool', tool } : null;
}

/** Keys typed into a field belong to the field, not the board. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]') !== null
  );
}
