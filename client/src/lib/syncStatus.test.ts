import { describe, expect, it } from 'vitest';
import { pillState, statusLabel } from './syncStatus.ts';

describe('statusLabel', () => {
  it('is plain when nothing is waiting to sync', () => {
    expect(statusLabel('connecting', 0)).toBe('Connecting…');
    expect(statusLabel('connected', 0)).toBe('Connected');
    expect(statusLabel('reconnecting', 0)).toBe('Reconnecting…');
  });

  it('shows how much drawing is still unsynced while offline', () => {
    expect(statusLabel('connecting', 2)).toBe('Connecting… · 2 unsynced');
    expect(statusLabel('reconnecting', 1)).toBe('Reconnecting… · 1 unsynced');
  });

  it('says syncing while connected but still uploading', () => {
    expect(statusLabel('connected', 3)).toBe('Syncing 3…');
  });
});

describe('pillState', () => {
  it('only shows the healthy colour once everything is synced', () => {
    expect(pillState('connected', 0)).toBe('connected');
    expect(pillState('connected', 1)).toBe('connecting');
    expect(pillState('reconnecting', 1)).toBe('reconnecting');
  });
});
