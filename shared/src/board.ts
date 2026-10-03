/** A position in board space (not screen pixels). */
export type Point = { x: number; y: number };

export type Stroke = {
  id: string;
  type: 'stroke';
  authorId: string;
  /** Hex color, e.g. "#1a1a1a". */
  color: string;
  /** Line width in board units. */
  width: number;
  points: Point[];
  createdAt: number;
};
