import { useLayoutEffect, useRef } from 'react';
import { LIMITS } from '@whiteboard/shared';
import type { TextElement } from '@whiteboard/shared';
import { LINE_HEIGHT, alignOf, cssFont, fontOf, layoutText } from '../lib/textLayout.ts';
import { toScreenPoint } from '../lib/view.ts';
import type { View } from '../lib/view.ts';

type Props = {
  /** The text being edited (or made), in its current style; `text` is the live value. */
  element: TextElement;
  view: View;
  onChange: (text: string) => void;
  /** Done: Escape, Ctrl/Cmd + Enter, or a press anywhere else (blur). */
  onCommit: () => void;
};

/**
 * Edits a text in place: a borderless textarea laid exactly over where the canvas draws the text,
 * in the same font, size and line height, scaled with the zoom. It grows as you type.
 */
export function TextEditor({ element, view, onChange, onCommit }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);

  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.focus({ preventScroll: true });
    const end = area.value.length;
    area.setSelectionRange(end, end);
  }, []);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit();
  };

  // The box the text will take: measured like the canvas measures it, plus room for the caret.
  const layout = layoutText({ ...element, text: element.text || ' ' });
  const s = view.scale;
  const at = toScreenPoint(element.start, view);
  const fontSize = element.fontSize * s;

  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={element.text}
      maxLength={LIMITS.maxTextLength}
      placeholder="Type here"
      aria-label="Text"
      spellCheck
      autoCapitalize="sentences"
      rows={1}
      wrap="off"
      style={{
        left: at.x,
        top: at.y,
        // Content as wide as the canvas's block, so alignment matches; the padding is caret room.
        boxSizing: 'content-box',
        width: Math.max(layout.width * s, fontSize / 2),
        paddingRight: fontSize,
        height: layout.height * s,
        font: cssFont(fontOf(element), fontSize),
        lineHeight: LINE_HEIGHT,
        color: element.color,
        textAlign: alignOf(element),
        opacity: element.opacity ?? 1,
      }}
      onChange={(e) => onChange(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          e.stopPropagation();
          ref.current?.blur();
        }
      }}
    />
  );
}
