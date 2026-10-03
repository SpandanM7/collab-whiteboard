import { useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { ConnectionStatus } from '../components/ConnectionStatus.tsx';
import { CursorLayer } from '../components/CursorLayer.tsx';
import { ParticipantList } from '../components/ParticipantList.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { Toast } from '../components/Toast.tsx';
import { Toolbar } from '../components/Toolbar.tsx';
import { Whiteboard } from '../components/Whiteboard.tsx';
import { useBoardSync } from '../hooks/useBoardSync.ts';
import { loadIdentity, saveIdentity } from '../lib/identity.ts';
import type { Tool } from '../types.ts';

export function BoardPage({ boardId }: { boardId: string }) {
  const [identity, setIdentity] = useState(() => loadIdentity());
  const sync = useBoardSync(boardId, identity);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#1a1a1a');
  const [width, setWidth] = useState(4);
  const [confirmingClear, setConfirmingClear] = useState(false);
  // Drawing and clearing only make sense while the server is listening.
  const online = sync.status === 'connected' && !sync.blocked;

  return (
    <>
      <Whiteboard
        strokes={sync.strokes}
        liveStrokes={sync.liveStrokes}
        tool={tool}
        color={color}
        width={width}
        disabled={!online}
        onStrokeStart={sync.startStroke}
        onStrokePoints={sync.addPoints}
        onStrokeAdd={sync.finishStroke}
        onStrokeCancel={sync.cancelStroke}
        onStrokesErase={sync.deleteElements}
        onCursorMove={sync.moveCursor}
      />
      <CursorLayer participants={sync.participants} cursors={sync.cursors} />
      <Toolbar
        tool={tool}
        color={color}
        width={width}
        onToolChange={setTool}
        onColorChange={setColor}
        onWidthChange={setWidth}
        onClear={() => setConfirmingClear(true)}
        clearDisabled={!online}
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
      <ConnectionStatus status={sync.status} blocked={sync.blocked} />
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
