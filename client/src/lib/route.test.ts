import { describe, expect, it } from 'vitest';
import { parseJoinCode, parseRoute } from './route.ts';

describe('parseRoute', () => {
  it('recognises a valid board path, with or without a trailing slash', () => {
    expect(parseRoute('/board/abcdefgh12')).toEqual({ name: 'board', boardId: 'abcdefgh12' });
    expect(parseRoute('/board/abcdefgh12/')).toEqual({ name: 'board', boardId: 'abcdefgh12' });
  });

  it('flags a malformed board id instead of silently showing the landing page', () => {
    expect(parseRoute('/board/short')).toEqual({ name: 'landing', invalidBoard: true });
    expect(parseRoute('/board/has%20space-1')).toEqual({ name: 'landing', invalidBoard: true });
    expect(parseRoute('/board/%E0%A4%A')).toEqual({ name: 'landing', invalidBoard: true });
  });

  it('shows the plain landing page for everything else', () => {
    expect(parseRoute('/')).toEqual({ name: 'landing' });
    expect(parseRoute('/nope')).toEqual({ name: 'landing' });
    expect(parseRoute('/board/a/b')).toEqual({ name: 'landing' });
  });
});

describe('parseJoinCode', () => {
  it('accepts a bare code, trimming whitespace', () => {
    expect(parseJoinCode('  abcdefgh12 ')).toBe('abcdefgh12');
  });

  it('extracts the id from a pasted board URL', () => {
    expect(parseJoinCode('https://example.com/board/abcdefgh12')).toBe('abcdefgh12');
    expect(parseJoinCode('http://localhost:5173/board/abcdefgh12?x=1#y')).toBe('abcdefgh12');
    expect(parseJoinCode('/board/abcdefgh12')).toBe('abcdefgh12');
  });

  it('rejects empty, too short, or malformed input', () => {
    for (const bad of ['', '   ', 'short', 'has space here', 'https://example.com/', 'a/b/c']) {
      expect(parseJoinCode(bad)).toBeNull();
    }
  });
});
