import type { ConnectionStatus as Status } from '../hooks/useBoardSync.ts';

const LABELS: Record<Status, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
};

type Props = { status: Status; blocked: string | null };

/**
 * The status pill, plus what the user needs to know while they cannot draw: a cold-starting
 * server (first connection), a dropped connection, or a board that cannot be joined.
 */
export function ConnectionStatus({ status, blocked }: Props) {
  return (
    <>
      <div className="connection" role="status" aria-live="polite">
        <span className={`connection-pill ${status}`}>
          <span className="connection-dot" aria-hidden="true" />
          {LABELS[status]}
        </span>
      </div>
      {blocked ? (
        <div className="overlay" role="alert">
          <div className="overlay-card">
            <h2>Can’t open this board</h2>
            <p>{blocked}</p>
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
        <div className="overlay delayed">
          <div className="overlay-card">
            <span className="spinner" aria-hidden="true" />
            <p>Connecting to server (this can take up to a minute on the free tier)…</p>
          </div>
        </div>
      ) : status === 'reconnecting' ? (
        <div className="offline-banner" role="alert">
          Connection lost. Drawing is paused until we reconnect.
        </div>
      ) : null}
    </>
  );
}
