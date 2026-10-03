import { describe, expect, it } from 'vitest';
import { LIMITS } from '@whiteboard/shared';
import { generateIdentity, loadIdentity, sanitizeName, saveIdentity } from './identity.ts';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  };
};

describe('identity', () => {
  it('generates a two-word name and a valid hex color', () => {
    const { name, color } = generateIdentity(() => 0);
    expect(name).toBe('Quiet Otter');
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(generateIdentity().name.length).toBeLessThanOrEqual(LIMITS.maxNameLength);
  });

  it('generates and stores an identity on first visit, then reuses it', () => {
    const storage = memoryStorage();
    const first = loadIdentity(storage);
    expect(Object.keys(storage.data)).toHaveLength(1);
    expect(loadIdentity(storage, () => 0.99)).toEqual(first);
  });

  it('returns what was last saved', () => {
    const storage = memoryStorage();
    saveIdentity({ name: 'Ada', color: '#123456' }, storage);
    expect(loadIdentity(storage)).toEqual({ name: 'Ada', color: '#123456' });
  });

  it.each(['not json', '{"name":"","color":"#123456"}', '{"name":"A","color":"red"}'])(
    'replaces unusable stored data (%s)',
    (raw) => {
      const identity = loadIdentity(memoryStorage({ 'whiteboard:identity': raw }), () => 0);
      expect(identity.name).toBe('Quiet Otter');
    },
  );

  it('still works when storage is unavailable or throws', () => {
    expect(loadIdentity(null).name).toBeTruthy();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadIdentity(throwing).name).toBeTruthy();
  });

  it('sanitizes edited names', () => {
    expect(sanitizeName('  Ada  ')).toBe('Ada');
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName('x'.repeat(100))).toHaveLength(LIMITS.maxNameLength);
  });
});
