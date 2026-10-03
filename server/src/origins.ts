/**
 * Browser origins allowed to talk to the server (the `CLIENT_URL` setting).
 *
 * An entry is an origin such as `https://app.example.com`. A `*` inside the hostname matches
 * within one DNS label only (letters, digits and hyphens, never a dot), so
 * `https://whiteboard-*-myteam.vercel.app` covers a host's preview URLs without opening the
 * server to every site on that host.
 */

/** Normalises one `CLIENT_URL` entry, or returns null when it is not a usable origin. */
export function normalizeOrigin(entry: string): string | null {
  const text = entry.trim();
  const match = /^(https?):\/\/([^/?#\s]+)/i.exec(text);
  if (!match) return null;
  const scheme = (match[1] ?? '').toLowerCase();
  const host = (match[2] ?? '').toLowerCase();

  if (!host.includes('*')) {
    try {
      return new URL(text).origin; // also drops default ports, paths and trailing slashes
    } catch {
      return null;
    }
  }

  try {
    new URL(`${scheme}://${host.replaceAll('*', 'x')}`);
  } catch {
    return null;
  }
  // Keep at least the registrable part (e.g. `vercel.app`) free of wildcards.
  const labels = (host.split(':')[0] ?? '').split('.');
  if (labels.length < 3 || labels.slice(-2).some((label) => label.includes('*'))) return null;
  return `${scheme}://${host}`;
}

/** Splits a comma-separated list. Returns the normalised origins and any unusable entries. */
export function parseOrigins(list: string | undefined): { origins: string[]; invalid: string[] } {
  const origins: string[] = [];
  const invalid: string[] = [];
  for (const entry of (list ?? '').split(',')) {
    if (entry.trim() === '') continue;
    const origin = normalizeOrigin(entry);
    if (origin) origins.push(origin);
    else invalid.push(entry.trim());
  }
  return { origins, invalid };
}

const escapeRegExp = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Builds a fast check for a list of normalised origins (exact entries and `*` patterns). */
export function originMatcher(allowed: readonly string[]): (origin: string) => boolean {
  const exact = new Set(allowed.filter((entry) => !entry.includes('*')));
  const patterns = allowed
    .filter((entry) => entry.includes('*'))
    .map((entry) => new RegExp(`^${entry.split('*').map(escapeRegExp).join('[a-z0-9-]*')}$`, 'i'));
  return (origin) => exact.has(origin.toLowerCase()) || patterns.some((re) => re.test(origin));
}
