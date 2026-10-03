import { useState } from 'react';
import { CursorLayer } from '../components/CursorLayer.tsx';
import { ParticipantList } from '../components/ParticipantList.tsx';
import { ConnectionStatus } from '../components/ConnectionStatus.tsx';
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

  return (
    <>
      <Whiteboard
        strokes={sync.strokes}
        liveStrokes={sync.liveStrokes}
        tool={tool}
        color={color}
        width={width}
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
      />
      <ParticipantList
        self={identity}
        others={sync.participants}
        onRename={(name) => {
          const next = { ...identity, name };
          saveIdentity(next);
          setIdentity(next);
        }}
      />
      <ConnectionStatus status={sync.status} error={sync.error} />
    </>
  );
}
