import { useCallback, useState } from 'react';
import type { Stroke } from '@whiteboard/shared';
import { Toolbar } from './components/Toolbar.tsx';
import { Whiteboard } from './components/Whiteboard.tsx';
import type { Tool } from './types.ts';

function App() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#1a1a1a');
  const [width, setWidth] = useState(4);

  const addStroke = useCallback((stroke: Stroke) => {
    setStrokes((prev) => [...prev, stroke]);
  }, []);

  const eraseStrokes = useCallback((ids: string[]) => {
    const removed = new Set(ids);
    setStrokes((prev) => {
      const next = prev.filter((s) => !removed.has(s.id));
      return next.length === prev.length ? prev : next;
    });
  }, []);

  return (
    <>
      <Whiteboard
        strokes={strokes}
        tool={tool}
        color={color}
        width={width}
        onStrokeAdd={addStroke}
        onStrokesErase={eraseStrokes}
      />
      <Toolbar
        tool={tool}
        color={color}
        width={width}
        onToolChange={setTool}
        onColorChange={setColor}
        onWidthChange={setWidth}
      />
    </>
  );
}

export default App;
