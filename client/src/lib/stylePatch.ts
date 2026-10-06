import { isClosedShape } from '@whiteboard/shared';
import type { BoardElement, ElementType } from '@whiteboard/shared';
import { lineHeads } from './geometry.ts';
import { alignOf, fontOf } from './textLayout.ts';
import { DEFAULT_STYLE, createShape, createText, hasCorners } from './toolStyle.ts';
import type { ToolStyle } from './toolStyle.ts';

/**
 * The element's look as a full `ToolStyle`: its own options, with `fallback` for anything it does
 * not have (a stroke has no fill, say). The style panel shows a selection through this.
 */
export function styleOfElement(element: BoardElement, fallback: ToolStyle): ToolStyle {
  switch (element.type) {
    case 'stroke':
      return { ...fallback, color: element.color, width: element.width };
    case 'text':
      return {
        ...fallback,
        color: element.color,
        opacity: element.opacity ?? 1,
        font: fontOf(element),
        fontSize: element.fontSize,
        align: alignOf(element),
      };
  }
  const common = {
    ...fallback,
    color: element.color,
    width: element.width,
    strokeStyle: element.strokeStyle ?? 'solid',
    opacity: element.opacity ?? 1,
  };
  if (isClosedShape(element)) {
    return {
      ...common,
      fillOn: element.fill !== undefined,
      fillColor: element.fill ?? fallback.fillColor,
      fillStyle: element.fillStyle ?? 'solid',
      rounded: element.rounded ?? false,
    };
  }
  const heads = lineHeads(element);
  return {
    ...common,
    route: element.route ?? 'straight',
    startHead: heads.start,
    endHead: element.type === 'arrow' ? heads.end : fallback.endHead,
  };
}

/**
 * The element with `change` applied to whatever options it has; the rest of `change` is ignored
 * (a fill means nothing to a line). Options at their default are left out, as on new elements.
 */
export function restyle<T extends BoardElement>(element: T, change: Partial<ToolStyle>): T {
  switch (element.type) {
    case 'stroke':
      return {
        ...element,
        ...(change.color !== undefined ? { color: change.color } : {}),
        ...(change.width !== undefined ? { width: change.width } : {}),
      };
    case 'text': {
      const style = { ...styleOfElement(element, DEFAULT_STYLE), ...change };
      const { id, authorId, createdAt, start, text } = element;
      return createText({ id, authorId, createdAt, start, text }, style) as T;
    }
    default: {
      const style = { ...styleOfElement(element, DEFAULT_STYLE), ...change };
      const { id, authorId, createdAt, start, end } = element;
      return createShape(element.type, { id, authorId, createdAt, start, end }, style) as T;
    }
  }
}

/** Which groups of options apply to a set of element types (or to the tool about to make one). */
export type StyleSections = {
  stroke: boolean;
  /** Line width (everything but text). */
  width: boolean;
  fill: boolean;
  outline: boolean;
  corners: boolean;
  path: boolean;
  heads: boolean;
  text: boolean;
  opacity: boolean;
};

export function styleSections(types: Iterable<ElementType>): StyleSections {
  const sections: StyleSections = {
    stroke: false,
    width: false,
    fill: false,
    outline: false,
    corners: false,
    path: false,
    heads: false,
    text: false,
    opacity: false,
  };
  for (const type of types) {
    sections.stroke = true;
    if (type !== 'text') sections.width = true;
    if (type === 'stroke') continue;
    sections.opacity = true;
    if (type === 'text') {
      sections.text = true;
      continue;
    }
    sections.outline = true;
    if (type === 'line' || type === 'arrow') {
      sections.path = true;
      if (type === 'arrow') sections.heads = true;
    } else {
      sections.fill = true;
      if (hasCorners(type)) sections.corners = true;
    }
  }
  return sections;
}
