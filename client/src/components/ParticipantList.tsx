import { useRef, useState } from 'react';
import type { Participant } from '@whiteboard/shared';
import { LIMITS } from '@whiteboard/shared';
import { sanitizeName } from '../lib/identity.ts';
import type { Identity } from '../lib/identity.ts';

type Props = {
  self: Identity;
  others: Participant[];
  onRename: (name: string) => void;
};

/** Top-right presence: you (name editable) followed by everyone else, as colored dots. */
export function ParticipantList({ self, others, onRename }: Props) {
  // null = not editing; the field shows the saved name until the user types.
  const [draft, setDraft] = useState<string | null>(null);

  // Compact layout only: the list collapses into a chip that opens it as a popover.
  const [open, setOpen] = useState(false);

  // Set by Escape so the blur it triggers discards the draft instead of saving it.
  const cancelRef = useRef(false);

  const commit = () => {
    const name = draft === null || cancelRef.current ? null : sanitizeName(draft);
    cancelRef.current = false;
    if (name && name !== self.name) onRename(name);
    setDraft(null);
  };

  const everyone = [self, ...others];

  return (
    <div className={`participants-wrap${open ? ' open' : ''}`}>
      <button
        type="button"
        className="participants-chip"
        aria-expanded={open}
        aria-label={`Participants, ${everyone.length}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chip-dots" aria-hidden="true">
          {everyone.slice(0, 3).map((p, i) => (
            <span key={i} className="participant-dot" style={{ background: p.color }} />
          ))}
        </span>
        {everyone.length}
      </button>
      <ul className="participants" aria-label="Participants">
        <li className="participant self">
          <span className="participant-dot" style={{ background: self.color }} aria-hidden="true" />
          <input
            className="participant-name"
            aria-label="Your display name"
            value={draft ?? self.name}
            maxLength={LIMITS.maxNameLength}
            size={Math.max(6, (draft ?? self.name).length)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                cancelRef.current = true;
                e.currentTarget.blur();
              }
            }}
          />
          <span className="participant-you">you</span>
        </li>
        {others.map((p) => (
          <li key={p.clientId} className="participant">
            <span className="participant-dot" style={{ background: p.color }} aria-hidden="true" />
            <span className="participant-name">{p.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
