import { useState } from 'react';
import { ConnectionStatus } from '../components/ConnectionStatus.tsx';
import { Toolbar } from '../components/Toolbar.tsx';
import { Whiteboard } from '../components/Whiteboard.tsx';
import { useBoardSync } from '../hooks/useBoardSync.ts';
import type { Tool } from '../types.ts';

export function BoardPage({ boardId }: { boardId: string }) {
  const sync = useBoardSync(boardId);
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
      />
      <Toolbar
        tool={tool}
        color={color}
        width={width}
        onToolChange={setTool}
        onColorChange={setColor}
        onWidthChange={setWidth}
      />
      <ConnectionStatus status={sync.status} error={sync.error} />
    </>
  );
}
