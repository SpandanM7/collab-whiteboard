import { describe, expect, it } from 'vitest';
import { NUDGE, NUDGE_FAR, shortcutFor } from './shortcuts.ts';

const key = (
  k: string,
  mods: Partial<Record<'ctrl' | 'meta' | 'alt' | 'shift', boolean>> = {},
) => ({
  key: k,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

describe('shortcutFor', () => {
  it.each([
    ['p', 'pen'],
    ['e', 'eraser'],
    ['h', 'hand'],
    ['k', 'laser'],
    ['r', 'rect'],
    ['o', 'ellipse'],
    ['d', 'diamond'],
    ['l', 'line'],
    ['a', 'arrow'],
  ])('%s picks the %s tool', (k, tool) => {
    expect(shortcutFor(key(k))).toEqual({ type: 'tool', tool });
  });

  it('works with Caps Lock on', () => {
    expect(shortcutFor(key('R'))).toEqual({ type: 'tool', tool: 'rect' });
  });

  it('leaves browser shortcuts alone', () => {
    expect(shortcutFor(key('r', { ctrl: true }))).toBeNull(); // reload
    expect(shortcutFor(key('b', { meta: true }))).toBeNull();
    expect(shortcutFor(key('e', { alt: true }))).toBeNull();
    expect(shortcutFor(key('r', { shift: true }))).toBeNull();
  });

  it("toggles the grid with Ctrl + ' (Cmd on Mac)", () => {
    expect(shortcutFor(key("'", { ctrl: true }))).toEqual({ type: 'toggle-grid' });
    expect(shortcutFor(key("'", { meta: true }))).toEqual({ type: 'toggle-grid' });
    expect(shortcutFor(key("'"))).toBeNull();
  });

  it('ignores other keys', () => {
    expect(shortcutFor(key('z'))).toBeNull();
    expect(shortcutFor(key('Tab'))).toBeNull();
  });
});

describe('editing shortcuts', () => {
  const press = (k: string, mods: Parameters<typeof key>[1] = {}, code?: string) =>
    shortcutFor({ ...key(k, mods), code });

  it('picks the select and text tools', () => {
    expect(press('v')).toEqual({ type: 'tool', tool: 'select' });
    expect(press('t')).toEqual({ type: 'tool', tool: 'text' });
  });

  it('undoes and redoes', () => {
    expect(press('z', { ctrl: true })).toEqual({ type: 'undo' });
    expect(press('Z', { ctrl: true, shift: true })).toEqual({ type: 'redo' });
    expect(press('y', { meta: true })).toEqual({ type: 'redo' });
  });

  it('selects all, duplicates and deletes', () => {
    expect(press('a', { ctrl: true })).toEqual({ type: 'select-all' });
    expect(press('d', { meta: true })).toEqual({ type: 'duplicate' });
    expect(press('Delete')).toEqual({ type: 'delete' });
    expect(press('Backspace')).toEqual({ type: 'delete' });
  });

  it('reorders with Ctrl + Shift + brackets, whatever the layout prints', () => {
    expect(press('}', { ctrl: true, shift: true }, 'BracketRight')).toEqual({
      type: 'reorder',
      to: 'front',
    });
    expect(press('{', { ctrl: true, shift: true }, 'BracketLeft')).toEqual({
      type: 'reorder',
      to: 'back',
    });
  });

  it('nudges with the arrows, further with Shift', () => {
    expect(press('ArrowLeft')).toEqual({ type: 'nudge', dx: -NUDGE, dy: 0 });
    expect(press('ArrowDown', { shift: true })).toEqual({ type: 'nudge', dx: 0, dy: NUDGE_FAR });
  });

  it('opens export, help and text editing, and escapes', () => {
    expect(press('E', { ctrl: true, shift: true })).toEqual({ type: 'export' });
    expect(press('?', { shift: true })).toEqual({ type: 'help' });
    expect(press('Enter')).toEqual({ type: 'edit' });
    expect(press('Escape')).toEqual({ type: 'escape' });
  });
});
