import { SHAPE_TYPES } from '@whiteboard/shared';
import type { ShapeType } from '@whiteboard/shared';

export type Tool = 'select' | 'pen' | 'eraser' | 'hand' | 'laser' | 'text' | ShapeType;

export function isShapeTool(tool: Tool): tool is ShapeType {
  return (SHAPE_TYPES as readonly string[]).includes(tool);
}
