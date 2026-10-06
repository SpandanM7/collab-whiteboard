import { useEffect, useRef, useState } from 'react';
import type { BoardElement } from '@whiteboard/shared';
import {
  canvasToBlob,
  downloadBlob,
  exportFileName,
  exportFrame,
  renderElements,
} from '../lib/exportImage.ts';
import type { ExportBackground } from '../lib/exportImage.ts';

type Props = {
  open: boolean;
  onClose: () => void;
  boardId: string;
  elements: BoardElement[];
  /** The current selection; when there is one, exporting just it is offered (and the default). */
  selected: BoardElement[];
  /** Reports how it went ("Image copied", or an error). */
  onNotify: (message: string, kind: 'info' | 'error') => void;
};

/** Export the board (or the selection) as a PNG: download, copy, or share (on phones). */
export function ExportDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const { open, onClose } = props;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog export-dialog"
      aria-labelledby="export-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Mounted only while open, so every opening starts from fresh options. */}
      {open && <ExportBody {...props} />}
    </dialog>
  );
}

const SCALES = [1, 2, 3] as const;

type Rendered = { blob: Blob; url: string };

function canShareFiles(): boolean {
  try {
    const probe = new File([''], 'probe.png', { type: 'image/png' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

function canCopyImages(): boolean {
  return typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
}

function ExportBody({ onClose, boardId, elements, selected, onNotify }: Props) {
  const [scope, setScope] = useState<'all' | 'selection'>(
    selected.length > 0 ? 'selection' : 'all',
  );
  const [background, setBackground] = useState<ExportBackground>('white');
  const [scale, setScale] = useState<(typeof SCALES)[number]>(2);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [busy, setBusy] = useState(false);
  const [share] = useState(canShareFiles);
  const [copy] = useState(canCopyImages);

  const source = scope === 'selection' && selected.length > 0 ? selected : elements;
  const frame = exportFrame(source, scale);

  // Re-render the image whenever an option changes; the preview is the real export.
  useEffect(() => {
    const canvas = renderElements(source, { scale, background });
    if (!canvas) return;
    let cancelled = false;
    let url = '';
    canvasToBlob(canvas)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setRendered({ blob, url });
      })
      .catch(() => {
        if (!cancelled) onNotify("The image couldn't be created.", 'error');
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, scale, background, onNotify]);

  const fileName = exportFileName(boardId, new Date());
  const ready = rendered !== null && frame !== null;

  const run = async (action: (blob: Blob) => Promise<void> | void) => {
    if (!rendered) return;
    setBusy(true);
    try {
      await action(rendered.blob);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="dialog-header">
        <h2 id="export-title">Export image</h2>
        <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className={`export-preview${background === 'transparent' ? ' checker' : ''}`}>
        {!frame ? (
          <p>Nothing to export yet. Draw something first.</p>
        ) : rendered ? (
          <img src={rendered.url} alt="Preview of the exported image" />
        ) : (
          <div className="spinner" aria-label="Rendering" />
        )}
      </div>

      <div className="export-options">
        {selected.length > 0 && (
          <fieldset>
            <legend>Export</legend>
            <div className="segmented">
              <button
                type="button"
                className={scope === 'selection' ? 'active' : ''}
                aria-pressed={scope === 'selection'}
                onClick={() => setScope('selection')}
              >
                Selection
              </button>
              <button
                type="button"
                className={scope === 'all' ? 'active' : ''}
                aria-pressed={scope === 'all'}
                onClick={() => setScope('all')}
              >
                Whole board
              </button>
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend>Background</legend>
          <div className="segmented">
            <button
              type="button"
              className={background === 'white' ? 'active' : ''}
              aria-pressed={background === 'white'}
              onClick={() => setBackground('white')}
            >
              White
            </button>
            <button
              type="button"
              className={background === 'transparent' ? 'active' : ''}
              aria-pressed={background === 'transparent'}
              onClick={() => setBackground('transparent')}
            >
              Transparent
            </button>
          </div>
        </fieldset>
        <fieldset>
          <legend>Scale</legend>
          <div className="segmented">
            {SCALES.map((s) => (
              <button
                key={s}
                type="button"
                className={scale === s ? 'active' : ''}
                aria-pressed={scale === s}
                aria-label={`Scale ${s}x`}
                onClick={() => setScale(s)}
              >
                {s}×
              </button>
            ))}
          </div>
        </fieldset>
        {frame && (
          <p className="export-size">
            {frame.width.toLocaleString('en-US')} × {frame.height.toLocaleString('en-US')} px
            {frame.scale < scale - 1e-6 ? ' (reduced to fit)' : ''}
          </p>
        )}
      </div>

      <div className="dialog-actions">
        {share && (
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() =>
              run(async (blob) => {
                const file = new File([blob], fileName, { type: 'image/png' });
                try {
                  await navigator.share({ files: [file], title: 'Whiteboard' });
                  onClose();
                } catch (err) {
                  // The person closing the share sheet is not an error.
                  if ((err as Error).name !== 'AbortError') {
                    onNotify("The image couldn't be shared.", 'error');
                  }
                }
              })
            }
          >
            Share
          </button>
        )}
        {copy && (
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() =>
              run(async (blob) => {
                try {
                  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                  onNotify('Image copied to the clipboard.', 'info');
                  onClose();
                } catch {
                  onNotify("The image couldn't be copied. Try Download instead.", 'error');
                }
              })
            }
          >
            Copy
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={!ready || busy}
          onClick={() =>
            run((blob) => {
              downloadBlob(blob, fileName);
              onClose();
            })
          }
        >
          Download PNG
        </button>
      </div>
    </>
  );
}
