import { useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { ConnectionStatus } from '../components/ConnectionStatus.tsx';
import { CursorLayer } from '../components/CursorLayer.tsx';
import { ParticipantList } from '../components/ParticipantList.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { Toast } from '../components/Toast.tsx';
import { Toolbar } from '../components/Toolbar.tsx';
import { Whiteboard } from '../components/Whiteboard.tsx';
import { ZoomControls } from '../components/ZoomControls.tsx';
import { useBoardSync } from '../hooks/useBoardSync.ts';
import { useBoardView } from '../hooks/useBoardView.ts';
import { loadIdentity, saveIdentity } from '../lib/identity.ts';
import type { Tool } from '../types.ts';

export function BoardPage({ boardId }: { boardId: string }) {
  const [identity, setIdentity] = useState(() => loadIdentity());
  const sync = useBoardSync(boardId, identity);
  const board = useBoardView(sync.elements);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#1a1a1a');
  const [width, setWidth] = useState(4);
  const [fillOn, setFillOn] = useState(false);
  const [fillColor, setFillColor] = useState('#ffd43b');
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Drawing and erasing work offline (they sync later). Clearing is online-only: replaying it
  // after a reconnect could wipe what others drew in the meantime.
  const online = sync.status === 'connected' && !sync.blocked;

  return (
    <>
      <Whiteboard
        elements={sync.elements}
        liveStrokes={sync.liveStrokes}
        tool={tool}
        color={color}
        width={width}
        fill={fillOn ? fillColor : null}
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
        color={color}
        width={width}
        fillOn={fillOn}
        fillColor={fillColor}
        onToolChange={setTool}
        onFillOnChange={setFillOn}
        onFillColorChange={setFillColor}
        onColorChange={setColor}
        onWidthChange={setWidth}
        onClear={() => setConfirmingClear(true)}
        clearDisabled={!online}
      />
      <ZoomControls
        scale={board.view.scale}
        onZoomIn={board.zoomIn}
        onZoomOut={board.zoomOut}
        onReset={board.resetZoom}
        onFit={board.fitAll}
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
