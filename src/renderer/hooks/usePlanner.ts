import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call, ApiCallError } from '@/lib/api';
import { useSettings } from './queries';
import type {
  ApprovalExportInput, ApprovalExportResult, ApprovalImportResult, AuditEntry, Issue, MissedAction, PlannerAsset, PlannerCreateInput, PlannerDraft,
  PlannerListParams, PlannerPost, PlannerPostSummary, PlannerRescheduled, PlannerSetStatusInput, PlannerSetStatusResult, PlannerUpdateInput,
  PublishMissedEvent, PublishingReadiness, PublishingStatus, QueueItem, QuotaInfo, ScheduleResult, Slot, TargetState,
} from '@/lib/types';

/**
 * Planner data layer (v1.4 chunk D). Planner channels are implemented in main (chunk A); publishing channels (chunk B)
 * and suggestions/approval packs (chunk C) may still answer NOT_IMPLEMENTED — callers check isNotImplemented().
 */
export const PLANNER_KEY = 'planner';
export const PUBLISHING_KEY = 'publishing';

const EVENT_DEBOUNCE_MS = 400;

export function usePlannerPosts(params: PlannerListParams, enabled = true) {
  return useQuery<PlannerPostSummary[]>({ queryKey: [PLANNER_KEY, 'list', params], queryFn: () => call(api.planner.posts.list(params)), enabled, staleTime: 10_000 });
}

export function usePlannerPost(id: number | null) {
  return useQuery<PlannerPost>({ queryKey: [PLANNER_KEY, 'post', id], queryFn: () => call(api.planner.posts.get(id)), enabled: id != null, staleTime: 0 });
}

export function usePlannerAudit(params: { postId?: number; limit?: number; before?: number }, enabled = true) {
  return useQuery<AuditEntry[]>({ queryKey: [PLANNER_KEY, 'audit', params], queryFn: () => call(api.planner.audit(params)), enabled });
}

export function usePublishingQueue(states?: TargetState[]) {
  return useQuery<QueueItem[]>({ queryKey: [PUBLISHING_KEY, 'queue', states ?? null], queryFn: () => call(api.publishing.queue(states ? { states } : {})), retry: false });
}

export function useMissed() {
  return useQuery<QueueItem[]>({ queryKey: [PUBLISHING_KEY, 'missed'], queryFn: () => call(api.publishing.missed()), retry: false });
}

export function usePublishingStatus() {
  return useQuery<PublishingStatus>({ queryKey: [PUBLISHING_KEY, 'status'], queryFn: () => call(api.publishing.status()), retry: false, refetchInterval: 30_000 });
}

export function usePublishingReadiness() {
  return useQuery<PublishingReadiness>({ queryKey: [PUBLISHING_KEY, 'readiness'], queryFn: () => call(api.publishing.readiness()), retry: false, staleTime: 60_000 });
}

export function useQuota(accountId: string | null) {
  return useQuery<QuotaInfo>({ queryKey: [PUBLISHING_KEY, 'quota', accountId], queryFn: () => call(api.publishing.quota({ accountId })), enabled: !!accountId, retry: false, staleTime: 60_000 });
}

export function useSuggestSlots(accountIds: string[], enabled = true) {
  return useQuery<Slot[]>({
    queryKey: [PLANNER_KEY, 'slots', accountIds],
    queryFn: () => call(api.planner.suggestSlots({ accountIds, days: 7, count: 5 })),
    enabled: enabled && accountIds.length > 0, retry: false, staleTime: 5 * 60_000,
  });
}

/** Planner settings from config (read-only here; Settings sections own the toggles). */
export function usePlannerSettings() {
  const s = useSettings();
  const d = s.data ?? {};
  const week = Number(d['planner.weekStartsOn']);
  return {
    requireApproval: d['planner.requireApproval'] === true,
    weekStartsOn: week === 0 || week === 6 ? week : 1,
    minGapHours: Number(d['planner.minGapHours'] ?? 3) || 0,
    mediaHostType: (d['planner.mediaHost'] as { type?: string } | undefined)?.type ?? 'none',
  };
}

/**
 * Keeps planner/publishing queries fresh from main-process events and counts `publish:missed`.
 * Mount once per screen that shows planner data.
 */
export function usePlannerEvents() {
  const qc = useQueryClient();
  const [missed, setMissed] = useState<number>(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const flush = () => {
      timer.current = null;
      qc.invalidateQueries({ queryKey: [PLANNER_KEY] });
      qc.invalidateQueries({ queryKey: [PUBLISHING_KEY] });
    };
    const schedule = () => { if (!timer.current) timer.current = setTimeout(flush, EVENT_DEBOUNCE_MS); };
    const offChanged = api.on('planner:changed', schedule);
    const offProgress = api.on('publish:progress', schedule);
    const offMissed = api.on('publish:missed', (p: PublishMissedEvent) => { setMissed(Number(p?.count) || 0); schedule(); });
    return () => { offChanged(); offProgress(); offMissed(); if (timer.current) clearTimeout(timer.current); };
  }, [qc]);
  return { missed, clearMissed: () => setMissed(0) };
}

/** Thin, typed wrappers around the preload surface (all unwrap the envelope and throw ApiCallError). */
export const plannerApi = {
  create: (p: PlannerCreateInput) => call<PlannerPost>(api.planner.posts.create(p)),
  update: (p: PlannerUpdateInput) => call<PlannerPost>(api.planner.posts.update(p)),
  reschedule: (id: number, scheduledAt: number | null) => call<PlannerRescheduled>(api.planner.posts.reschedule({ id, scheduledAt })),
  duplicate: (id: number, scheduledAt?: number | null) => call<PlannerPost>(api.planner.posts.duplicate({ id, scheduledAt: scheduledAt ?? null })),
  remove: (id: number) => call<true>(api.planner.posts.delete({ id, cancelRemote: true })),
  setStatus: (p: PlannerSetStatusInput) => call<PlannerSetStatusResult>(api.planner.posts.setStatus(p)),
  validate: (draft: PlannerDraft) => call<Issue[]>(api.planner.validate(draft)),
  importAssets: (paths?: string[]) => call<PlannerAsset[]>(api.planner.assets.import(paths)),
  importData: (name: string, dataUrl: string) => call<PlannerAsset>(api.planner.assets.importData({ name, dataUrl })),
  setThumb: (assetId: number, dataUrl: string) => call<PlannerAsset>(api.planner.assets.setThumb({ assetId, dataUrl })),
  pathForFile: (file: File): string => { try { return String(api.planner.pathForFile(file) ?? ''); } catch { return ''; } },
  exportPack: (p: ApprovalExportInput) => call<ApprovalExportResult>(api.planner.approval.export(p)),
  importPack: (code: string) => call<ApprovalImportResult>(api.planner.approval.import(code)),
};

export const publishingApi = {
  schedule: (id: number) => call<ScheduleResult>(api.publishing.schedule(id)),
  unschedule: (id: number) => call<unknown>(api.publishing.unschedule(id)),
  publishNow: (id: number, targetIds?: number[]) => call<unknown>(api.publishing.publishNow(targetIds ? { id, targetIds } : { id })),
  retry: (targetId: number) => call<unknown>(api.publishing.retry(targetId)),
  cancel: (targetId: number) => call<unknown>(api.publishing.cancel(targetId)),
  resolveMissed: (targetIds: number[], action: MissedAction, scheduledAt?: number) => call<unknown>(api.publishing.resolveMissed({ targetIds, action, ...(scheduledAt ? { scheduledAt } : {}) })),
  setPaused: (paused: boolean) => call<unknown>(api.publishing.setPaused(paused)),
};

export { ApiCallError };
