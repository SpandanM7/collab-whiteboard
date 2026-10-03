import type { ConnectionStatus as Status } from '../hooks/useBoardSync.ts';

const LABELS: Record<Status, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
};

type Props = { status: Status; error: string | null };

export function ConnectionStatus({ status, error }: Props) {
  return (
    <div className="connection" role="status" aria-live="polite">
      <span className={`connection-pill ${status}`}>
        <span className="connection-dot" aria-hidden="true" />
        {LABELS[status]}
      </span>
      {error && <span className="connection-error">{error}</span>}
    </div>
  );
}
