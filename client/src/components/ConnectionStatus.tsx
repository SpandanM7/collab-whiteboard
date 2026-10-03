import type { ConnectionStatus as Status } from '../hooks/useBoardSync.ts';
import { pillState, statusLabel } from '../lib/syncStatus.ts';

type Props = { status: Status; blocked: string | null; unsynced: number };

/**
 * The status pill, plus what the user needs to know while the server is out of reach: a
 * cold-starting server (first connection), a dropped connection, or a board that cannot be
 * joined. Only the last one blocks the canvas; otherwise people keep drawing and it syncs later.
 */
export function ConnectionStatus({ status, blocked, unsynced }: Props) {
  return (
    <>
      <div className="connection" role="status" aria-live="polite">
        <span className={`connection-pill ${pillState(status, unsynced)}`}>
          <span className="connection-dot" aria-hidden="true" />
          {statusLabel(status, unsynced)}
        </span>
      </div>
      {blocked ? (
        <div className="overlay" role="alert">
          <div className="overlay-card">
            <h2>Can’t open this board</h2>
            <p>{blocked}</p>
            {unsynced > 0 && <p>Your unsynced drawing can’t be saved to this board.</p>}
            <div className="overlay-actions">
              <button type="button" onClick={() => window.location.reload()}>
                Try again
              </button>
              <a className="button primary" href="/">
                Back to home
              </a>
            </div>
          </div>
        </div>
      ) : status === 'connecting' ? (
        // Fades in after a short delay (CSS) so a fast connection never flashes it.
        <div className="offline-banner delayed" role="status">
          <span className="spinner small" aria-hidden="true" />
          <span>
            Connecting to the server (this can take up to a minute on the free tier). You can start
            drawing; it will sync once we’re connected.
          </span>
        </div>
      ) : status === 'reconnecting' ? (
        <div className="offline-banner" role="status">
          <span className="spinner small" aria-hidden="true" />
          <span>Connection lost. Keep drawing: your changes will sync when we reconnect.</span>
        </div>
      ) : null}
    </>
  );
}
