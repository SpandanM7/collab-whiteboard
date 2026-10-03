import { LIMITS, participantSchema } from '@whiteboard/shared';

export type Identity = { name: string; color: string };

const STORAGE_KEY = 'whiteboard:identity';

const ADJECTIVES = [
  'Quiet',
  'Brave',
  'Swift',
  'Gentle',
  'Clever',
  'Sunny',
  'Mellow',
  'Bold',
  'Curious',
  'Nimble',
  'Cosmic',
  'Dapper',
  'Jolly',
  'Lucky',
  'Witty',
  'Zesty',
];
const ANIMALS = [
  'Otter',
  'Falcon',
  'Panda',
  'Heron',
  'Lynx',
  'Badger',
  'Gecko',
  'Walrus',
  'Marmot',
  'Narwhal',
  'Puffin',
  'Ibex',
  'Koala',
  'Raven',
  'Tapir',
  'Wombat',
];

/** Distinct, readable-on-white colors for cursors and avatars. */
export const IDENTITY_COLORS = [
  '#e03131',
  '#d6336c',
  '#9c36b5',
  '#6741d9',
  '#3b5bdb',
  '#1c7ed6',
  '#0c8599',
  '#2f9e44',
  '#e8590c',
  '#f08c00',
  '#5c940d',
  '#495057',
];

type Random = () => number;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const pick = <T>(items: readonly T[], random: Random): T =>
  items[Math.floor(random() * items.length)];

export function generateIdentity(random: Random = Math.random): Identity {
  return {
    name: `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`,
    color: pick(IDENTITY_COLORS, random),
  };
}

/** Trims and caps a user-entered name; null when nothing usable is left. */
export function sanitizeName(raw: string): string | null {
  const name = raw.trim().slice(0, LIMITS.maxNameLength).trim();
  return name || null;
}

/** localStorage can be missing or throw (private mode, blocked site data); never rely on it. */
function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The stored identity, or a freshly generated one (which is stored for next time). */
export function loadIdentity(
  storage: StorageLike | null = defaultStorage(),
  random: Random = Math.random,
): Identity {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = participantSchema.pick({ name: true, color: true }).safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Corrupt JSON or blocked storage: fall through and generate a new identity.
  }
  const identity = generateIdentity(random);
  saveIdentity(identity, storage);
  return identity;
}

export function saveIdentity(
  identity: Identity,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Quota or blocked storage: the identity just will not survive a reload.
  }
}
