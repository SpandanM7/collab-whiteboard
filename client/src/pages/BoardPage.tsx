import { nanoid } from 'nanoid';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  BoardElement,
  ElementInput,
  ElementType,
  Point,
  TextElement,
} from '@whiteboard/shared';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { ConnectionStatus } from '../components/ConnectionStatus.tsx';
import { CursorLayer } from '../components/CursorLayer.tsx';
import { ExportDialog } from '../components/ExportDialog.tsx';
import { HistoryControls } from '../components/HistoryControls.tsx';
import { LaserLayer } from '../components/LaserLayer.tsx';
import { ParticipantList } from '../components/ParticipantList.tsx';
import { SelectionActions } from '../components/SelectionActions.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { ShortcutsDialog } from '../components/ShortcutsDialog.tsx';
import { StylePanel } from '../components/StylePanel.tsx';
import { TextEditor } from '../components/TextEditor.tsx';
import { Toast } from '../components/Toast.tsx';
import { Toolbar } from '../components/Toolbar.tsx';
import { Whiteboard } from '../components/Whiteboard.tsx';
import { ZoomControls } from '../components/ZoomControls.tsx';
import { useBoardActions } from '../hooks/useBoardActions.ts';
import { useBoardSync } from '../hooks/useBoardSync.ts';
import { useCompactLayout } from '../hooks/useCompactLayout.ts';
import { useBoardView } from '../hooks/useBoardView.ts';
import { MAX_BOARD_FILE_BYTES, parseBoardFile, serializeBoardFile } from '../lib/boardFile.ts';
import { cloneElements, parseElements, serializeElements } from '../lib/elementClipboard.ts';
import { downloadBlob, exportFileName } from '../lib/exportImage.ts';
import { loadIdentity, saveIdentity } from '../lib/identity.ts';
import { selectionBounds } from '../lib/selection.ts';
import { contentBounds } from '../lib/view.ts';
import { GRID_SIZE } from '../lib/shapeDrag.ts';
import { isTypingTarget, shortcutFor } from '../lib/shortcuts.ts';
import type { ShortcutAction } from '../lib/shortcuts.ts';
import { restyle, styleOfElement } from '../lib/stylePatch.ts';
import { LINE_HEIGHT } from '../lib/textLayout.ts';
import { createText, loadStyle, saveStyle } from '../lib/toolStyle.ts';
import type { ToolStyle } from '../lib/toolStyle.ts';
import { roundCoord, roundElement, transformElement, translation } from '../lib/transform.ts';
import { toBoardPoint } from '../lib/view.ts';
import { viewportSize } from '../lib/viewport.ts';
import { isShapeTool } from '../types.ts';
import type { Tool } from '../types.ts';

const LOCAL_AUTHOR_ID = 'local';
/** How far a duplicate lands from its original (board units), when the grid is off. */
const DUPLICATE_OFFSET = 16;
/** Style changes this close together (a slider drag, the color picker) are one undo step. */
const STYLE_WINDOW_MS = 1500;

/** A text being made or edited in place; `draft` holds the live text and style. */
type Editor = { draft: TextElement; isNew: boolean };

/** Is a modal dialog open? Board shortcuts are off while one is. */
const dialogOpen = () => document.querySelector('dialog[open]') !== null;

export function BoardPage({ boardId }: { boardId: string }) {
  const [identity, setIdentity] = useState(() => loadIdentity());
  const sync = useBoardSync(boardId, identity);
  const actions = useBoardActions(sync);
  const board = useBoardView(sync.elements);
  const [tool, setTool] = useState<Tool>('pen');
  const [style, setStyle] = useState(() => loadStyle());
  const [grid, setGrid] = useState(false);
  // Compact layout only; on desktop the style panel shows whenever there is something to style.
  const [styleOpen, setStyleOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // A move, resize or marquee is under way: the floating selection controls step aside.
  const [gesturing, setGesturing] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  // Small screens have no room for color and width in the toolbar: they live in the Style sheet.
  const compact = useCompactLayout();
  // The last place the pointer was over the board: where pasted things go.
  const cursorRef = useRef<Point | null>(null);
  // The hidden file picker behind "Open file…".
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Drawing and erasing work offline (they sync later). Clearing is online-only: replaying it
  // after a reconnect could wipe what others drew in the meantime.
  const online = sync.status === 'connected' && !sync.blocked;

  // The selection, in stacking order. Ids of elements someone else deleted simply drop out.
  const selection = useMemo(() => {
    if (selectedIds.length === 0) return [];
    const ids = new Set(selectedIds);
    return sync.elements.filter((e) => ids.has(e.id));
  }, [selectedIds, sync.elements]);

  const changeTool = (next: Tool) => {
    setTool(next);
    if (next !== 'select') setSelectedIds([]);
  };

  // ---- Style: for the next element, and for whatever is selected or being edited ----

  let styleTypes: ElementType[] | null = null;
  let styleTitle = 'Style';
  let shownStyle = style;
  if (editor) {
    styleTypes = ['text'];
    styleTitle = 'Text';
    shownStyle = styleOfElement(editor.draft, style);
  } else if (tool === 'select' && selection.length > 0) {
    styleTypes = [...new Set(selection.map((e) => e.type))];
    styleTitle = selection.length === 1 ? 'Selection' : `${selection.length} selected`;
    shownStyle = styleOfElement(selection[0], style);
  } else if (isShapeTool(tool)) {
    styleTypes = [tool];
  } else if (tool === 'text') {
    styleTypes = ['text'];
  } else if (tool === 'pen' && compact) {
    styleTypes = ['stroke'];
  }

  const changeStyle = (change: Partial<ToolStyle>) => {
    const next = { ...style, ...change };
    setStyle(next);
    saveStyle(next);
    if (editor) {
      setEditor({ ...editor, draft: restyle(editor.draft, change) });
    } else if (tool === 'select' && selection.length > 0) {
      actions.updateElements(
        selection.map((e) => restyle(e, change)),
        { group: `style:${Object.keys(change).sort().join(',')}`, window: STYLE_WINDOW_MS },
      );
    }
  };

  // ---- Text editing ----

  const openText = (request: { id: string } | { at: Point }) => {
    if ('id' in request) {
      const element = sync.elements.find((e) => e.id === request.id);
      if (element?.type !== 'text') return;
      setSelectedIds([]);
      setEditor({ draft: element, isNew: false });
      return;
    }
    // The click lands in the middle of the first line.
    const start = {
      x: roundCoord(request.at.x),
      y: roundCoord(request.at.y - (style.fontSize * LINE_HEIGHT) / 2),
    };
    const draft = createText(
      { id: nanoid(), authorId: LOCAL_AUTHOR_ID, createdAt: Date.now(), start, text: '' },
      style,
    );
    setSelectedIds([]);
    setEditor({ draft, isNew: true });
  };

  const commitText = () => {
    if (!editor) return;
    setEditor(null);
    const { draft, isNew } = editor;
    const text = draft.text.replace(/\s+$/, '');
    const empty = text.trim().length === 0;
    if (isNew) {
      if (empty) return;
      const element = roundElement({ ...draft, text });
      board.markInteracted();
      if (actions.addElements([element]) && tool === 'select') setSelectedIds([element.id]);
      return;
    }
    const current = sync.elements.find((e) => e.id === draft.id);
    if (!current) return; // deleted by someone else meanwhile
    if (empty) {
      actions.deleteElements([draft.id]);
      return;
    }
    actions.updateElements([{ ...draft, text }]);
    if (tool === 'select') setSelectedIds([draft.id]);
  };

  // ---- Selection actions ----

  const duplicate = () => {
    if (selection.length === 0) return;
    const step = grid ? GRID_SIZE : DUPLICATE_OFFSET;
    const clones = cloneElements(
      selection,
      { offset: { x: step, y: step } },
      nanoid,
      LOCAL_AUTHOR_ID,
      Date.now(),
    );
    if (actions.addElements(clones)) setSelectedIds(clones.map((e) => e.id));
  };

  const deleteSelection = () => {
    if (selection.length === 0) return;
    actions.deleteElements(selection.map((e) => e.id));
    setSelectedIds([]);
  };

  const nudge = (dx: number, dy: number) => {
    if (selection.length === 0) return;
    const t = translation(dx, dy);
    actions.updateElements(
      selection.map((e) => transformElement(e, t)),
      { group: 'nudge', window: actions.nudgeWindow },
    );
  };

  /** Where pasted things go: the pointer's last spot on the board, or the middle of the screen. */
  const pasteCenter = (): Point => {
    if (cursorRef.current) return cursorRef.current;
    const { width, height } = viewportSize();
    return toBoardPoint({ x: width / 2, y: height / 2 }, board.view);
  };

  const paste = (text: string) => {
    const parsed = parseElements(text);
    if (parsed) {
      const clones = cloneElements(
        parsed,
        { center: pasteCenter() },
        nanoid,
        LOCAL_AUTHOR_ID,
        Date.now(),
      );
      if (!actions.addElements(clones)) return;
      board.markInteracted();
      changeTool('select');
      setSelectedIds(clones.map((e) => e.id));
      return;
    }
    // Plain text from anywhere becomes a text element.
    const value = text.replace(/\s+$/, '').slice(0, 2000);
    if (value.trim().length === 0) return;
    const center = pasteCenter();
    const element = roundElement(
      createText(
        {
          id: nanoid(),
          authorId: LOCAL_AUTHOR_ID,
          createdAt: Date.now(),
          start: { x: center.x, y: center.y - (style.fontSize * LINE_HEIGHT) / 2 },
          text: value,
        },
        style,
      ),
    );
    if (!actions.addElements([element])) return;
    board.markInteracted();
    changeTool('select');
    setSelectedIds([element.id]);
  };

  // ---- Saving to and opening from a file ----

  const saveToFile = () => {
    if (sync.elements.length === 0) {
      sync.showToast('Nothing to save yet. Draw something first.', 'info');
      return;
    }
    const now = new Date();
    const blob = new Blob([serializeBoardFile(sync.elements, now)], { type: 'application/json' });
    downloadBlob(blob, exportFileName(boardId, now, 'json'));
  };

  const openFile = () => {
    if (sync.blocked) return;
    fileInputRef.current?.click();
  };

  /**
   * Adds a saved board's elements to this board, where they were when saved, as new elements
   * (so opening a file twice gives two copies, not clashing ids). Nothing on the board is
   * replaced: to start over, clear the board first. Opening is one undo step.
   */
  const importElements = (elements: ElementInput[], skipped: number) => {
    const clones = cloneElements(
      elements,
      { offset: { x: 0, y: 0 } },
      nanoid,
      LOCAL_AUTHOR_ID,
      Date.now(),
    );
    if (!actions.addElements(clones)) return;
    board.markInteracted();
    changeTool('select');
    setSelectedIds(clones.map((e) => e.id));
    const bounds = contentBounds(clones);
    if (bounds) board.show(bounds);
    const added = `Added ${clones.length} ${clones.length === 1 ? 'element' : 'elements'} from the file.`;
    sync.showToast(
      skipped > 0
        ? `${added} ${skipped} ${skipped === 1 ? 'was' : 'were'} damaged or too many and left out.`
        : added,
      skipped > 0 ? 'error' : 'info',
    );
  };

  const readFile = async (file: File) => {
    if (file.size > MAX_BOARD_FILE_BYTES) {
      sync.showToast('That file is too big to be a saved board.');
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      sync.showToast("The file couldn't be read.");
      return;
    }
    const result = parseBoardFile(text);
    if (!result.ok) {
      sync.showToast(
        result.reason === 'too-new'
          ? 'That file was saved by a newer version of the app. Reload the page and try again.'
          : result.reason === 'empty'
            ? 'That file has nothing on it to add.'
            : "That file isn't a saved board. Use a .json file from Save to file.",
      );
      return;
    }
    // Read through the ref: the board may have changed while the file was being read.
    latest.current.importElements(result.elements, result.skipped);
  };

  const undoOrRedo = (which: 'undo' | 'redo') => {
    const restored = which === 'undo' ? actions.undo() : actions.redo();
    setSelectedIds(tool === 'select' ? restored : []);
  };

  const runShortcut = (action: ShortcutAction): boolean => {
    const hasSelection = tool === 'select' && selection.length > 0;
    switch (action.type) {
      case 'tool':
        changeTool(action.tool);
        return true;
      case 'toggle-grid':
        setGrid((on) => !on);
        return true;
      case 'undo':
      case 'redo':
        undoOrRedo(action.type);
        return true;
      case 'select-all':
        setTool('select');
        setSelectedIds(sync.elements.map((e) => e.id));
        return true;
      case 'duplicate':
        if (!hasSelection) return false;
        duplicate();
        return true;
      case 'delete':
        if (!hasSelection) return false;
        deleteSelection();
        return true;
      case 'reorder':
        if (!hasSelection) return false;
        actions.reorderElements(
          selection.map((e) => e.id),
          action.to,
        );
        return true;
      case 'nudge': {
        if (!hasSelection) return false;
        const step = grid ? GRID_SIZE / Math.max(Math.abs(action.dx), Math.abs(action.dy)) : 1;
        nudge(action.dx * step, action.dy * step);
        return true;
      }
      case 'edit': {
        const only = selection.length === 1 ? selection[0] : null;
        if (!hasSelection || only?.type !== 'text') return false;
        openText({ id: only.id });
        return true;
      }
      case 'export':
        setExportOpen(true);
        return true;
      // Always handled, so the browser's own Save page and Open file never show up instead.
      case 'save':
        saveToFile();
        return true;
      case 'open':
        openFile();
        return true;
      case 'help':
        setShortcutsOpen(true);
        return true;
      case 'escape':
        if (selectedIds.length === 0) return false;
        setSelectedIds([]);
        return true;
    }
  };

  // Window listeners read the latest render's handlers through this ref.
  const latest = useRef({ runShortcut, paste, selection, deleteSelection, importElements });
  useLayoutEffect(() => {
    latest.current = { runShortcut, paste, selection, deleteSelection, importElements };
  });

  // Keyboard shortcuts, and copy / cut / paste through the browser's clipboard events (they need
  // no permission prompt, and work across tabs and boards).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || dialogOpen()) return;
      const action = shortcutFor(e);
      if (!action) return;
      const repeatable = ['nudge', 'undo', 'redo'].includes(action.type);
      if (e.repeat && !repeatable) return;
      if (latest.current.runShortcut(action)) e.preventDefault();
    };
    const copySelection = (e: ClipboardEvent): boolean => {
      const { selection } = latest.current;
      if (isTypingTarget(document.activeElement) || dialogOpen() || selection.length === 0) {
        return false;
      }
      e.clipboardData?.setData('text/plain', serializeElements(selection));
      e.preventDefault();
      return true;
    };
    const onCopy = (e: ClipboardEvent) => void copySelection(e);
    const onCut = (e: ClipboardEvent) => {
      if (copySelection(e)) latest.current.deleteSelection();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(document.activeElement) || dialogOpen()) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text) return;
      e.preventDefault();
      latest.current.paste(text);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  const bounds = selectionBounds(selection);
  const singleText = selection.length === 1 && selection[0].type === 'text' ? selection[0] : null;
  const showSelectionActions =
    tool === 'select' && bounds !== null && !gesturing && editor === null;

  return (
    <>
      <Whiteboard
        elements={sync.elements}
        liveStrokes={sync.liveStrokes}
        tool={tool}
        style={style}
        grid={grid}
        view={board.view}
        onViewChange={board.changeView}
        disabled={sync.blocked !== null}
        selectedIds={selectedIds}
        editingId={editor && !editor.isNew ? editor.draft.id : null}
        editing={editor !== null}
        onStrokeStart={(stroke) => {
          board.markInteracted();
          sync.startStroke(stroke);
        }}
        onStrokePoints={sync.addPoints}
        onStrokeAdd={actions.finishStroke}
        onShapeAdd={(shape) => {
          board.markInteracted();
          actions.addElements([shape]);
        }}
        onStrokeCancel={sync.cancelStroke}
        onErase={(ids, gesture) => actions.deleteElements(ids, `erase:${gesture}`)}
        onSelect={setSelectedIds}
        onElementsChange={(elements: BoardElement[]) => actions.updateElements(elements)}
        onTextRequest={openText}
        onGestureChange={setGesturing}
        onCursorMove={(point) => {
          cursorRef.current = point;
          sync.moveCursor(point);
        }}
        onLaser={sync.pointLaser}
      />
      {editor && (
        <TextEditor
          element={editor.draft}
          view={board.view}
          onChange={(text) => setEditor({ ...editor, draft: { ...editor.draft, text } })}
          onCommit={commitText}
        />
      )}
      <LaserLayer
        trails={sync.laser}
        participants={sync.participants}
        selfColor={identity.color}
        view={board.view}
      />
      <CursorLayer
        participants={sync.participants}
        cursors={sync.cursors}
        view={board.view}
        onJumpTo={board.jumpTo}
      />
      {showSelectionActions && (
        <SelectionActions
          bounds={bounds}
          view={board.view}
          count={selection.length}
          canEdit={singleText !== null}
          onEdit={() => singleText && openText({ id: singleText.id })}
          onDuplicate={duplicate}
          onFront={() =>
            actions.reorderElements(
              selection.map((e) => e.id),
              'front',
            )
          }
          onBack={() =>
            actions.reorderElements(
              selection.map((e) => e.id),
              'back',
            )
          }
          onDelete={deleteSelection}
        />
      )}
      <Toolbar
        tool={tool}
        color={shownStyle.color}
        width={shownStyle.width}
        onToolChange={changeTool}
        onColorChange={(color) => changeStyle({ color })}
        onWidthChange={(width) => changeStyle({ width })}
        hasStyle={styleTypes !== null}
        styleOpen={styleOpen}
        onStyleToggle={() => setStyleOpen((open) => !open)}
        showWidth={!(styleTypes?.every((t) => t === 'text') ?? false)}
        onExport={() => setExportOpen(true)}
        onSave={saveToFile}
        onOpen={openFile}
        saveDisabled={sync.elements.length === 0}
        openDisabled={sync.blocked !== null}
        onShortcuts={() => setShortcutsOpen(true)}
        onClear={() => setConfirmingClear(true)}
        clearDisabled={!online}
      />
      {styleTypes && (
        <StylePanel
          types={styleTypes}
          title={styleTitle}
          style={shownStyle}
          onChange={changeStyle}
          open={styleOpen}
          onClose={() => setStyleOpen(false)}
          withWidth={compact}
        />
      )}
      <HistoryControls
        canUndo={actions.canUndo}
        canRedo={actions.canRedo}
        onUndo={() => undoOrRedo('undo')}
        onRedo={() => undoOrRedo('redo')}
      />
      <ZoomControls
        scale={board.view.scale}
        onZoomIn={board.zoomIn}
        onZoomOut={board.zoomOut}
        onReset={board.resetZoom}
        onFit={board.fitAll}
        grid={grid}
        onGridToggle={() => setGrid((on) => !on)}
      />
      <div className="top-right">
        <ShareButton boardId={boardId} />
        <ParticipantList
          self={identity}
          others={sync.participants}
          onRename={(name) => {
            const next = { ...identity, name };
            saveIdentity(next);
            setIdentity(next);
          }}
        />
      </div>
      <ConnectionStatus status={sync.status} blocked={sync.blocked} unsynced={sync.unsynced} />
      <Toast toast={sync.toast} onDismiss={sync.dismissToast} />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        boardId={boardId}
        elements={sync.elements}
        selected={selection}
        onNotify={sync.showToast}
      />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Open a saved board"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared, so choosing the same file again still counts as a change.
          e.target.value = '';
          if (file) void readFile(file);
        }}
      />
      <ConfirmDialog
        // Also closes if the connection drops while the dialog is open.
        open={confirmingClear && online}
        title="Clear the board?"
        message="This removes every drawing for everyone on this board. It can't be undone."
        confirmLabel="Clear board"
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => {
          setConfirmingClear(false);
          setSelectedIds([]);
          sync.clearBoard();
        }}
      />
    </>
  );
}
