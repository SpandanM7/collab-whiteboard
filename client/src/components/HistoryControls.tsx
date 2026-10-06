import { modKey } from '../lib/shortcuts.ts';
import { Icon } from './Icon.tsx';
import { RedoIcon, UndoIcon } from './icons.tsx';

type Props = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
};

/** Undo and redo: bottom left on desktop, under the status pill on small screens. */
export function HistoryControls({ canUndo, canRedo, onUndo, onRedo }: Props) {
  const mod = modKey();
  return (
    <div className="history" role="group" aria-label="History">
      <button
        type="button"
        aria-label="Undo"
        title={`Undo (${mod}+Z)`}
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Icon size={20}>{UndoIcon}</Icon>
      </button>
      <button
        type="button"
        aria-label="Redo"
        title={`Redo (${mod}+Shift+Z)`}
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Icon size={20}>{RedoIcon}</Icon>
      </button>
    </div>
  );
}
