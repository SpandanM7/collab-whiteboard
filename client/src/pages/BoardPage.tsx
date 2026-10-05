import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { ConnectionStatus } from '../components/ConnectionStatus.tsx';
import { CursorLayer } from '../components/CursorLayer.tsx';
import { ParticipantList } from '../components/ParticipantList.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { StylePanel } from '../components/StylePanel.tsx';
import { Toast } from '../components/Toast.tsx';
import { Toolbar } from '../components/Toolbar.tsx';
import { Whiteboard } from '../components/Whiteboard.tsx';
import { ZoomControls } from '../components/ZoomControls.tsx';
import { useBoardSync } from '../hooks/useBoardSync.ts';
import { useBoardView } from '../hooks/useBoardView.ts';
import { loadIdentity, saveIdentity } from '../lib/identity.ts';
import { isTypingTarget, shortcutFor } from '../lib/shortcuts.ts';
import { loadStyle, saveStyle } from '../lib/toolStyle.ts';
import type { ToolStyle } from '../lib/toolStyle.ts';
import { isShapeTool } from '../types.ts';
import type { Tool } from '../types.ts';

export function BoardPage({ boardId }: { boardId: string }) {
  const [identity, setIdentity] = useState(() => loadIdentity());
  const sync = useBoardSync(boardId, identity);
  const board = useBoardView(sync.elements);
  const [tool, setTool] = useState<Tool>('pen');
  const [style, setStyle] = useState(() => loadStyle());
  const [grid, setGrid] = useState(false);
  // Compact layout only; on desktop the style panel shows whenever a shape tool is in use.
  const [styleOpen, setStyleOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Drawing and erasing work offline (they sync later). Clearing is online-only: replaying it
  // after a reconnect could wipe what others drew in the meantime.
  const online = sync.status === 'connected' && !sync.blocked;

  const changeStyle = (change: Partial<ToolStyle>) => {
    const next = { ...style, ...change };
    setStyle(next);
    saveStyle(next);
  };

  // Tool keys (P, E, H, R, O, D, L, A) and Ctrl + ' for the grid.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isTypingTarget(e.target)) return;
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      if (action.type === 'tool') setTool(action.tool);
      else setGrid((on) => !on);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
        onStrokeStart={(stroke) => {
          board.markInteracted();
          sync.startStroke(stroke);
        }}
        onStrokePoints={sync.addPoints}
        onStrokeAdd={sync.finishStroke}
        onShapeAdd={(shape) => {
          board.markInteracted();
          sync.addShape(shape);
        }}
        onStrokeCancel={sync.cancelStroke}
        onStrokesErase={sync.deleteElements}
        onCursorMove={sync.moveCursor}
      />
      <CursorLayer
        participants={sync.participants}
        cursors={sync.cursors}
        view={board.view}
        onJumpTo={board.jumpTo}
      />
      <Toolbar
        tool={tool}
        color={style.color}
        width={style.width}
        onToolChange={setTool}
        onColorChange={(color) => changeStyle({ color })}
        onWidthChange={(width) => changeStyle({ width })}
        styleOpen={styleOpen}
        onStyleToggle={() => setStyleOpen((open) => !open)}
        onClear={() => setConfirmingClear(true)}
        clearDisabled={!online}
      />
      {isShapeTool(tool) && (
        <StylePanel
          tool={tool}
          style={style}
          onChange={changeStyle}
          open={styleOpen}
          onClose={() => setStyleOpen(false)}
        />
      )}
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
      <ConfirmDialog
        // Also closes if the connection drops while the dialog is open.
        open={confirmingClear && online}
        title="Clear the board?"
        message="This removes every drawing for everyone on this board. It can't be undone."
        confirmLabel="Clear board"
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => {
          setConfirmingClear(false);
          sync.clearBoard();
        }}
      />
    </>
  );
}
