import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import type { Session, TeamState } from '@/lib/types';

/**
 * Current session (role, client scope, read-only workspace). Loaded from session:get, kept current by the
 * session:changed event; a small module store so every caller (Layout, RoleGate, banners) shares one copy.
 * Also: a subscriber pulls the shared folder when the window gains focus, and any session change or new team
 * snapshot invalidates every query (the data under the UI changed). Roles are UI guardrails, not security.
 */
export const DEFAULT_SESSION: Session = { role: 'admin', clientScope: null, readOnly: false, workspace: 'local' };

const FOCUS_PULL_MIN_MS = 30_000;
let current: Session = DEFAULT_SESSION;
let dataVersion = 0;
let started = false;
let loaded = false; // true once session:get answered (until then `current` is the admin default)
let lastSnapshotAt: number | null | undefined;
let lastFocusPull = 0;
const listeners = new Set<() => void>();

const emit = () => { for (const l of listeners) l(); };
const sameSession = (a: Session, b: Session) =>
  a.role === b.role && a.readOnly === b.readOnly && a.workspace === b.workspace && (a.clientScope ?? []).join('\n') === (b.clientScope ?? []).join('\n');

function setSession(next: Session | null | undefined) {
  if (!next || sameSession(next, current)) return;
  current = next;
  dataVersion += 1;
  emit();
}

function checkSnapshot() {
  call<TeamState>(api.team.getState()).then((s) => {
    if (lastSnapshotAt !== undefined && s.snapshotAt !== lastSnapshotAt) { dataVersion += 1; emit(); }
    lastSnapshotAt = s.snapshotAt;
  }).catch(() => {});
}

function start() {
  if (started || typeof window === 'undefined' || !window.api) return;
  started = true;
  call<Session>(api.session.get()).then(setSession).catch(() => {}).finally(() => { loaded = true; emit(); });
  checkSnapshot();
  api.on('session:changed', (s: Session) => setSession(s));
  api.on('team:status', () => checkSnapshot());
  window.addEventListener('focus', () => {
    if (!current.readOnly || Date.now() - lastFocusPull < FOCUS_PULL_MIN_MS) return;
    lastFocusPull = Date.now();
    call(api.team.pullNow()).catch(() => {});
  });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Re-reads the session (after a call that changed it, in case the event was missed). */
export function refreshSession(): Promise<void> {
  return call<Session>(api.session.get()).then(setSession).catch(() => {});
}

let invalidatedVersion = 0;

export function useSession(): Session {
  start();
  const session = useSyncExternalStore(subscribe, () => current, () => current);
  const version = useSyncExternalStore(subscribe, () => dataVersion, () => dataVersion);
  const qc = useQueryClient();
  useEffect(() => {
    if (version > invalidatedVersion) {
      invalidatedVersion = version;
      if (version > 1) void qc.invalidateQueries();
    }
  }, [version, qc]);
  return session;
}

/**
 * True once the real session is known and it is not the client view. Gate queries of channels the client view may
 * not call (inbox counts, mentions, AI status, export history) on it, so the admin default used before session:get
 * answers never fires denied calls.
 */
export function useStaffSession(): boolean {
  const session = useSession();
  const ready = useSyncExternalStore(subscribe, () => loaded, () => loaded);
  return ready && session.role !== 'client';
}

/** Routes the client view hides (plan §5; Studio and Ads also need data outside the client allowlist). */
export const CLIENT_HIDDEN_ROUTES = ['/settings', '/setup', '/ask', '/inbox', '/planner', '/sql', '/competitors', '/studio', '/ads'];
/** Routes a read-only (subscriber) workspace hides: there are no tokens to set up. */
export const READ_ONLY_HIDDEN_ROUTES = ['/setup'];

const matches = (route: string, list: string[]) => list.some((r) => route === r || route.startsWith(`${r}/`));

/** Nav/route visibility for a session (Layout.tsx filters its items with it). Keys are route paths. */
export function canSeeRoute(session: Session, route: string): boolean {
  if (session.role === 'client') return !matches(route, CLIENT_HIDDEN_ROUTES);
  if (session.readOnly) return !matches(route, READ_ONLY_HIDDEN_ROUTES);
  return true;
}
