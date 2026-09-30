import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import type {
  InboxCapability, InboxCounts, InboxListParams, InboxListResult, InboxOutboxRow, InboxSla, InboxStatus, InboxThread, InboxUpdatedEvent,
  ReplySuggestResult, SendPreview,
} from '@/lib/types';

/** Unified inbox data layer (v2.0 chunk D): typed wrappers for the inbox:* channels + query hooks. */
export const INBOX_KEY = 'inbox';

export interface ClassifyPreview extends SendPreview { total: number; batches: number }

export const inbox = {
  list: (p: InboxListParams) => call<InboxListResult>(api.inbox.list(p)),
  thread: (commentId: string) => call<InboxThread>(api.inbox.thread(commentId)),
  reply: (p: { commentId: string; body: string; confirmed: true }) => call<InboxOutboxRow>(api.inbox.reply(p)),
  retry: (outboxId: number) => call<InboxOutboxRow>(api.inbox.retry(outboxId)),
  setStatus: (p: { commentIds: string[]; status: InboxStatus }) => call<{ updated: number }>(api.inbox.setStatus(p)),
  assign: (p: { commentIds: string[]; assignee: string | null }) => call<{ updated: number }>(api.inbox.assign(p)),
  hide: (p: { commentId: string; hidden: boolean }) => call<true>(api.inbox.hide(p)),
  refresh: (p?: { accountIds?: string[] }) => call<{ fetched: number; errors: number; accounts?: number; demo?: boolean }>(api.inbox.refresh(p ?? {})),
  suggest: (p: { commentId: string; requestId?: string; lang?: string }) => call<ReplySuggestResult>(api.inbox.suggest(p)),
  classify: (p: { commentIds?: string[]; unclassified?: boolean }) => call<{ classified: number; batches: number }>(api.inbox.classify(p)),
  classifyPreview: (p: { commentIds?: string[]; unclassified?: boolean }) => call<ClassifyPreview>(api.inbox.classifyPreview(p)),
  sla: (p: { from?: string; to?: string; accountIds?: string[]; platforms?: string[] }) => call<InboxSla>(api.inbox.sla(p)),
  capabilities: () => call<InboxCapability[]>(api.inbox.capabilities()),
  counts: () => call<InboxCounts>(api.inbox.counts()),
};

type ListFilters = Omit<InboxListParams, 'cursor'>;

/** Keyset-paginated list; pages are flattened by the caller. */
export function useInboxList(filters: ListFilters) {
  return useInfiniteQuery<InboxListResult>({
    queryKey: [INBOX_KEY, 'list', filters],
    queryFn: ({ pageParam }) => inbox.list({ ...filters, cursor: (pageParam as string | null) ?? null }),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useInboxThread(commentId: string | null) {
  return useQuery<InboxThread>({ queryKey: [INBOX_KEY, 'thread', commentId], queryFn: () => inbox.thread(commentId!), enabled: !!commentId });
}

export function useInboxCapabilities() {
  return useQuery<InboxCapability[]>({ queryKey: [INBOX_KEY, 'capabilities'], queryFn: inbox.capabilities, staleTime: 5 * 60_000 });
}

export function useInboxSla(p: { from?: string; to?: string; accountIds?: string[]; platforms?: string[] }, enabled = true) {
  return useQuery<InboxSla>({ queryKey: [INBOX_KEY, 'sla', p], queryFn: () => inbox.sla(p), enabled });
}

export function useInboxCounts(enabled = true) {
  return useQuery<InboxCounts>({ queryKey: [INBOX_KEY, 'counts'], queryFn: inbox.counts, enabled, refetchInterval: 5 * 60_000 });
}

/** Runs fn on every inbox:updated event (poll, reply, status…). */
export function useInboxUpdated(fn: (e: InboxUpdatedEvent) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => api.on('inbox:updated', (e: InboxUpdatedEvent) => ref.current(e)), []);
}

/** Invalidates every inbox query when main reports a change. */
export function useInboxAutoRefresh() {
  const qc = useQueryClient();
  useInboxUpdated(() => { void qc.invalidateQueries({ queryKey: [INBOX_KEY] }); });
}

/** Error code of a policy denial (read-only team workspace / client view), see team/policy.js. */
export const isForbidden = (e: unknown) => !!e && typeof e === 'object' && 'code' in e && (e as { code: unknown }).code === 'FORBIDDEN';
