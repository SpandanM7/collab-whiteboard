import { useSyncExternalStore } from 'react';
import { COMPACT_QUERY } from '../lib/viewport.ts';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(COMPACT_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

const snapshot = () => window.matchMedia(COMPACT_QUERY).matches;

/** Whether the compact layout (bottom toolbar, sheets) is in use; follows resizes and rotation. */
export function useCompactLayout(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
