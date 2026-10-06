import { useEffect, useRef } from 'react';
import { modKey } from '../lib/shortcuts.ts';

type Props = { open: boolean; onClose: () => void };

type Row = [string, string[]];

const sections = (mod: string): { title: string; rows: Row[] }[] => [
  {
    title: 'Tools',
    rows: [
      ['Select', ['V']],
      ['Pen', ['P']],
      ['Eraser', ['E']],
      ['Hand (pan)', ['H']],
      ['Text', ['T']],
      ['Rectangle, ellipse, diamond', ['R', 'O', 'D']],
      ['Line, arrow', ['L', 'A']],
    ],
  },
  {
    title: 'Edit',
    rows: [
      ['Undo', [`${mod}+Z`]],
      ['Redo', [`${mod}+Shift+Z`, `${mod}+Y`]],
      ['Select all', [`${mod}+A`]],
      ['Copy, cut, paste', [`${mod}+C`, `${mod}+X`, `${mod}+V`]],
      ['Duplicate', [`${mod}+D`]],
      ['Delete', ['Delete']],
      ['Nudge (10 with Shift)', ['←', '↑', '→', '↓']],
      ['Bring to front, send to back', [`${mod}+Shift+]`, `${mod}+Shift+[`]],
      ['Edit text', ['Enter', 'Double-click']],
      ['Deselect', ['Esc']],
    ],
  },
  {
    title: 'While dragging',
    rows: [
      ['Keep proportions, snap angles, lock axis', ['Shift']],
      ['From the center', ['Alt']],
    ],
  },
  {
    title: 'View',
    rows: [
      ['Pan', ['Space+drag', 'Wheel']],
      ['Zoom', [`${mod}+wheel`, 'Pinch']],
      ['Grid and snapping', [`${mod}+'`]],
      ['Export image', [`${mod}+Shift+E`]],
      ['This list', ['?']],
    ],
  },
];

/** Every keyboard shortcut, in one place. Opened with "?" or from the More menu. */
export function ShortcutsDialog({ open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog shortcuts-dialog"
      aria-labelledby="shortcuts-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="shortcuts-grid">
        {sections(modKey()).map((section) => (
          <section key={section.title}>
            <h3>{section.title}</h3>
            <dl>
              {section.rows.map(([label, keys]) => (
                <div key={label} className="shortcut-row">
                  <dt>{label}</dt>
                  <dd>
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
