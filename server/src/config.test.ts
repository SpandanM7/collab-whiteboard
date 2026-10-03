import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('reads PORT and CLIENT_URL', () => {
    expect(loadConfig({ PORT: '3001', CLIENT_URL: 'http://localhost:5173' })).toEqual({
      port: 3001,
      clientUrl: 'http://localhost:5173',
    });
  });

  it('normalises CLIENT_URL to an origin (no trailing slash or path)', () => {
    expect(loadConfig({ PORT: '3001', CLIENT_URL: 'https://app.example.com/' }).clientUrl).toBe(
      'https://app.example.com',
    );
  });

  it('fails with a readable message when variables are missing', () => {
    expect(() => loadConfig({})).toThrow(/PORT.*\n- CLIENT_URL/s);
  });

  it.each(['abc', '-1', '70000', '30.5'])('rejects PORT=%s', (PORT) => {
    expect(() => loadConfig({ PORT, CLIENT_URL: 'http://localhost:5173' })).toThrow(/PORT/);
  });

  it('rejects a CLIENT_URL that is not a URL', () => {
    expect(() => loadConfig({ PORT: '3001', CLIENT_URL: 'localhost' })).toThrow(/CLIENT_URL/);
  });
});
