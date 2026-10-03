import type { ConnectionStatus } from '../hooks/useBoardSync.ts';

/** What the status pill says. `unsynced` counts changes the server has not confirmed yet. */
export function statusLabel(status: ConnectionStatus, unsynced: number): string {
  if (status === 'connected') return unsynced > 0 ? `Syncing ${unsynced}…` : 'Connected';
  const base = status === 'connecting' ? 'Connecting…' : 'Reconnecting…';
  return unsynced > 0 ? `${base} · ${unsynced} unsynced` : base;
}

/** The pill's colour state: still catching up counts as "working on it", not as healthy. */
export function pillState(status: ConnectionStatus, unsynced: number): ConnectionStatus {
  return status === 'connected' && unsynced > 0 ? 'connecting' : status;
}
