import type { Tool } from '../types.ts';

type Props = {
  tool: Tool;
  color: string;
  width: number;
  onToolChange: (tool: Tool) => void;
  onColorChange: (color: string) => void;
  onWidthChange: (width: number) => void;
};

export const MIN_WIDTH = 1;
export const MAX_WIDTH = 40;

export function Toolbar({ tool, color, width, onToolChange, onColorChange, onWidthChange }: Props) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools">
      <button
        type="button"
        className={tool === 'pen' ? 'active' : ''}
        aria-pressed={tool === 'pen'}
        onClick={() => onToolChange('pen')}
      >
        Pen
      </button>
      <button
        type="button"
        className={tool === 'eraser' ? 'active' : ''}
        aria-pressed={tool === 'eraser'}
        onClick={() => onToolChange('eraser')}
      >
        Eraser
      </button>
      <input
        type="color"
        value={color}
        aria-label="Color"
        onChange={(e) => onColorChange(e.target.value)}
      />
      <label className="width">
        <input
          type="range"
          min={MIN_WIDTH}
          max={MAX_WIDTH}
          value={width}
          aria-label="Stroke width"
          onChange={(e) => onWidthChange(Number(e.target.value))}
        />
        <span>{width}px</span>
      </label>
    </div>
  );
}
