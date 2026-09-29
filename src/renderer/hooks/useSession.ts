import type { Session } from '@/lib/types';

/**
 * Current session (role, client scope, read-only workspace) — STUB (v2.0 chunk B). Chunk F1 owns this file: it will
 * load session:get, follow the session:changed event and keep a store slice. Until then the own install is admin.
 */
export const DEFAULT_SESSION: Session = { role: 'admin', clientScope: null, readOnly: false, workspace: 'local' };

export function useSession(): Session {
  return DEFAULT_SESSION;
}

/**
 * Nav/route visibility for a session (Layout.tsx filters its items with it). Keys are route paths ('/inbox',
 * '/settings', …). Contract (plan §5): the client role hides Settings, Setup, Ask, Inbox, Planner, SQL, Competitors.
 * The stub shows everything.
 */
export function canSeeRoute(session: Session, route: string): boolean {
  void session; void route;
  return true;
}
