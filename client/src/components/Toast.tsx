import { useEffect } from 'react';
import type { Toast as ToastData } from '../hooks/useBoardSync.ts';

const TOAST_MS = 5000;

/** One message at a time; a new toast (new id) replaces the old one and restarts the timer. */
export function Toast({ toast, onDismiss }: { toast: ToastData | null; onDismiss: () => void }) {
  const id = toast?.id;
  useEffect(() => {
    if (id === undefined) return;
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className={`toast ${toast.kind}`} key={toast.id}>
          <span>{toast.message}</span>
          <button type="button" aria-label="Dismiss" onClick={onDismiss}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
