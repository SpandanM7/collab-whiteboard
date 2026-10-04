import { SHAPE_TYPES } from '@whiteboard/shared';
import type { ShapeType } from '@whiteboard/shared';

export type Tool = 'pen' | 'eraser' | 'hand' | ShapeType;

export function isShapeTool(tool: Tool): tool is ShapeType {
  return (SHAPE_TYPES as readonly string[]).includes(tool);
}
