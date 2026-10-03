import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/clipboard.ts';
import { boardPath } from '../lib/route.ts';

const COPIED_MS = 2000;

type State = 'idle' | 'copied' | 'manual';

/** Copies the board URL. If the clipboard is unavailable, shows the URL selected for Ctrl+C. */
export function ShareButton({ boardId }: { boardId: string }) {
  const [state, setState] = useState<State>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const url = `${window.location.origin}${boardPath(boardId)}`;

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (state === 'manual') inputRef.current?.select();
  }, [state]);

  const share = async () => {
    clearTimeout(timerRef.current);
    if (await copyText(url)) {
      setState('copied');
      timerRef.current = setTimeout(() => setState('idle'), COPIED_MS);
    } else {
      setState('manual');
    }
  };

  return (
    <div className="share">
      <button type="button" className="share-button" onClick={share}>
        {state === 'copied' ? 'Copied ✓' : 'Share'}
      </button>
      <span className="visually-hidden" role="status">
        {state === 'copied' ? 'Link copied to clipboard' : ''}
      </span>
      {state === 'manual' && (
        <div className="share-manual">
          <label>
            Copy this link (Ctrl+C / ⌘C):
            <input
              ref={inputRef}
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => setState('idle')}
            />
          </label>
        </div>
      )}
    </div>
  );
}
