import { useSyncExternalStore } from 'react';
import { boardIdSchema } from '@whiteboard/shared';

export type Route = { name: 'landing' } | { name: 'board'; boardId: string };

/** `/board/:id` is a board when the id is valid; every other path shows the landing page. */
export function parseRoute(pathname: string): Route {
  const match = /^\/board\/([^/]+)\/?$/.exec(pathname);
  const id = match ? boardIdSchema.safeParse(match[1]) : undefined;
  return id?.success ? { name: 'board', boardId: id.data } : { name: 'landing' };
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
