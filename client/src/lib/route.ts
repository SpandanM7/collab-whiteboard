import { useSyncExternalStore } from 'react';
import { boardIdSchema } from '@whiteboard/shared';

/** `invalidBoard`: the path looked like a board link, but its id is not valid. */
export type Route = { name: 'landing'; invalidBoard?: true } | { name: 'board'; boardId: string };

/**
 * `/board/:id` is a board when the id is valid. A malformed id shows the landing page with
 * `invalidBoard` set; every other path shows the landing page.
 */
export function parseRoute(pathname: string): Route {
  const match = /^\/board\/([^/]+)\/?$/.exec(pathname);
  if (!match) return { name: 'landing' };
  const id = boardIdSchema.safeParse(decodeURIComponentSafe(match[1]));
  return id.success ? { name: 'board', boardId: id.data } : { name: 'landing', invalidBoard: true };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value; // malformed escape: let the id schema reject it
  }
}

/** Accepts a bare board code or a pasted board URL; returns the board id, or null if invalid. */
export function parseJoinCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let pathname = `/board/${text}`;
  if (/^https?:\/\//i.test(text)) {
    try {
      pathname = new URL(text).pathname;
    } catch {
      return null;
    }
  } else if (text.includes('/')) {
    pathname = text.startsWith('/') ? text : `/${text}`;
  }
  const route = parseRoute(pathname);
  return route.name === 'board' ? route.boardId : null;
}

export const boardPath = (boardId: string) => `/board/${boardId}`;

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
};

/** Current route, re-rendering on navigation. Small enough that a router library isn't needed. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname);
  return parseRoute(pathname);
}
