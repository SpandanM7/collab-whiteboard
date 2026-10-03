import { describe, expect, it } from 'vitest';
import { normalizeOrigin, originMatcher, parseOrigins } from './origins.ts';

describe('normalizeOrigin', () => {
  it('reduces a URL to its origin', () => {
    expect(normalizeOrigin('https://app.example.com/')).toBe('https://app.example.com');
    expect(normalizeOrigin(' https://app.example.com/some/path?x=1 ')).toBe(
      'https://app.example.com',
    );
    expect(normalizeOrigin('http://localhost:5173')).toBe('http://localhost:5173');
  });

  it('rejects things that are not http(s) origins', () => {
    for (const bad of ['localhost', 'ftp://example.com', '', 'https://']) {
      expect(normalizeOrigin(bad)).toBeNull();
    }
  });

  it('keeps a wildcard hostname as a pattern', () => {
    expect(normalizeOrigin('https://Whiteboard-*-Team.vercel.app/')).toBe(
      'https://whiteboard-*-team.vercel.app',
    );
  });

  it('refuses wildcards that would match whole hosts or top-level domains', () => {
    for (const bad of ['https://*', 'https://*.com', 'https://app.*.app', 'https://*.*']) {
      expect(normalizeOrigin(bad)).toBeNull();
    }
  });
});

describe('parseOrigins', () => {
  it('reads a comma-separated list and reports unusable entries', () => {
    expect(parseOrigins('https://a.example.com, http://localhost:5173/ ,nope,,')).toEqual({
      origins: ['https://a.example.com', 'http://localhost:5173'],
      invalid: ['nope'],
    });
  });

  it('treats a missing value as an empty list', () => {
    expect(parseOrigins(undefined)).toEqual({ origins: [], invalid: [] });
  });
});

describe('originMatcher', () => {
  const allowed = originMatcher([
    'https://whiteboard.example.com',
    'https://whiteboard-*-team.vercel.app',
    'http://localhost:5173',
  ]);

  it('accepts exact origins', () => {
    expect(allowed('https://whiteboard.example.com')).toBe(true);
    expect(allowed('http://localhost:5173')).toBe(true);
  });

  it('accepts preview URLs that fit the pattern', () => {
    expect(allowed('https://whiteboard-git-feature-x-team.vercel.app')).toBe(true);
    expect(allowed('https://whiteboard-a1b2c3-team.vercel.app')).toBe(true);
  });

  it('rejects look-alikes', () => {
    for (const origin of [
      'https://whiteboard.example.com.evil.com',
      'http://whiteboard.example.com', // wrong scheme
      'https://evil-team.vercel.app',
      'https://whiteboard-x.evil-team.vercel.app', // wildcard never crosses a dot
      'https://whiteboard-x-team.vercel.app.evil.com',
      'http://localhost:5174',
      'null',
    ]) {
      expect(allowed(origin)).toBe(false);
    }
  });

  it('is case-insensitive about the host', () => {
    expect(allowed('https://Whiteboard.Example.com')).toBe(true);
  });
});
