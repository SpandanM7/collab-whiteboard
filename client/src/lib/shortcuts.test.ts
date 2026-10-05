import { describe, expect, it } from 'vitest';
import { shortcutFor } from './shortcuts.ts';

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
    expect(shortcutFor(key('a', { meta: true }))).toBeNull();
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
    expect(shortcutFor(key('Enter'))).toBeNull();
  });
});
