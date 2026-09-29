import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, call, ApiCallError } from '@/lib/api';
import { fmtNum } from '@/lib/format';
import type {
  AbCreateInput, BrandVoice, BrandVoiceProfile, CaptionGenerateInput, CaptionGenerateResult, CaptionVariant, HashtagSuggestResult, IdeasGenerateInput,
  IdeasGenerateResult, ContentIdea, InboxItem, RepurposeInput, ReplySuggestResult, SendPreview, StudioCapabilities, StudioChangedEvent, StudioCost,
  StudioProgressEvent, StudioSettings, StudioSettingsPatch, UsageSummary, AiUsage,
} from '@/lib/types';

/**
 * AI studio data layer (v1.5 chunk A): typed wrappers for every studio:* channel plus query hooks.
 * Feature channels owned by chunks B/C/D answer NOT_IMPLEMENTED until they land — check isNotImplemented(err).
 */
export const STUDIO_KEY = 'studio';

export const isNotImplemented = (e: unknown) => e instanceof ApiCallError && e.code === 'NOT_IMPLEMENTED';
export const newRequestId = () => `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Typed calls (all unwrap the IPC envelope and throw ApiCallError). */
export const studio = {
  capabilities: () => call<StudioCapabilities>(api.studio.capabilities()),
  preview: (feature: string, params: Record<string, unknown>) => call<SendPreview>(api.studio.preview({ feature, params })),
  cancel: (requestId: string) => call<{ cancelled: boolean }>(api.studio.cancel(requestId)),
  usage: (p?: { from?: number; to?: number }) => call<UsageSummary>(api.studio.usage(p)),
  settings: {
    get: () => call<StudioSettings>(api.studio.settings.get()),
    set: (patch: StudioSettingsPatch) => call<StudioSettings>(api.studio.settings.set(patch)),
  },
  voice: {
    get: (accountId: string) => call<BrandVoice | null>(api.studio.voice.get(accountId)),
    derive: (p: { accountId: string; n?: number; lang?: string; requestId?: string }) => call<StudioCost & { proposal: { brief: string; profile: BrandVoiceProfile } }>(api.studio.voice.derive(p)),
    save: (p: { accountId: string; brief: string; profile?: BrandVoiceProfile | null; aiDisabled?: boolean }) => call<null>(api.studio.voice.save(p)),
  },
  captions: {
    generate: (p: CaptionGenerateInput) => call<CaptionGenerateResult>(api.studio.captions.generate(p)),
    save: (p: { postId: number; variants: CaptionVariant[]; chosenLabel?: string }) => call<null>(api.studio.captions.save(p)),
  },
  hashtags: {
    suggest: (p: { accountId: string; caption?: string; notes?: string; platform: string; count?: number; useAi?: boolean }) => call<HashtagSuggestResult>(api.studio.hashtags.suggest(p)),
  },
  ideas: {
    generate: (p: IdeasGenerateInput) => call<IdeasGenerateResult>(api.studio.ideas.generate(p)),
    toDrafts: (p: { accountId: string; ideas: ContentIdea[]; schedule: 'suggested' | 'none' }) => call<{ postIds: number[] }>(api.studio.ideas.toDrafts(p)),
  },
  repurpose: {
    run: (p: RepurposeInput) => call<StudioCost & { draft: Record<string, unknown> }>(api.studio.repurpose.run(p)),
    toDraft: (p: { source: RepurposeInput['source']; to: RepurposeInput['to']; draft: Record<string, unknown>; accountIds: string[] }) => call<{ postId: number }>(api.studio.repurpose.toDraft(p)),
  },
  replies: {
    inbox: (p?: { accountIds?: string[]; onlyUnanswered?: boolean; limit?: number; before?: number }) => call<InboxItem[]>(api.studio.replies.inbox(p)),
    refresh: (p: { accountIds: string[] }) => call<{ fetched: number; errors: number }>(api.studio.replies.refresh(p)),
    suggest: (p: { requestId?: string; commentId: string; lang?: string }) => call<ReplySuggestResult>(api.studio.replies.suggest(p)),
    send: (p: { commentId: string; text: string }) => call<{ replyId: string }>(api.studio.replies.send(p)),
    dismiss: (commentId: string) => call<null>(api.studio.replies.dismiss(commentId)),
  },
  ab: {
    list: <T = unknown>() => call<T[]>(api.studio.ab.list()),
    get: <T = unknown>(id: number) => call<T>(api.studio.ab.get(id)),
    create: (p: AbCreateInput) => call<unknown>(api.studio.ab.create(p)),
    tag: (p: { testId: number; arm: string; targetId?: number; mediaKey?: string }) => call<unknown>(api.studio.ab.tag(p)),
    conclude: (p: { id: number; conclusion?: string; summarizeWithAi?: boolean }) => call<unknown>(api.studio.ab.conclude(p)),
  },
  /** Escape hatch for chunk-specific channels not listed above: studio.call('voice:diff', payload) → studio:voice:diff. */
  call: <T = unknown>(sub: string, payload?: unknown) => call<T>(api.studio.call(sub, payload)),
};

export function useStudioCapabilities(enabled = true) {
  return useQuery<StudioCapabilities>({ queryKey: [STUDIO_KEY, 'capabilities'], queryFn: studio.capabilities, enabled, staleTime: 30_000 });
}

export function useStudioUsage(range?: { from?: number; to?: number }) {
  return useQuery<UsageSummary>({ queryKey: [STUDIO_KEY, 'usage', range ?? null], queryFn: () => studio.usage(range) });
}

export function useStudioSettings() {
  return useQuery<StudioSettings>({ queryKey: [STUDIO_KEY, 'settings'], queryFn: studio.settings.get });
}

/** Saves a settings patch and refreshes settings + capabilities (cost display, vision). */
export function useSaveStudioSettings() {
  const qc = useQueryClient();
  return useCallback(async (patch: StudioSettingsPatch) => {
    const next = await studio.settings.set(patch);
    qc.setQueryData([STUDIO_KEY, 'settings'], next);
    qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'capabilities'] });
    qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'usage'] });
    return next;
  }, [qc]);
}

/** "What will be sent" preview for a generate button (fetched on demand: pass enabled when the panel opens). */
export function useSendPreview(feature: string, params: Record<string, unknown>, enabled: boolean) {
  return useQuery<SendPreview>({ queryKey: [STUDIO_KEY, 'preview', feature, params], queryFn: () => studio.preview(feature, params), enabled, retry: false });
}

/**
 * Runs one cancellable studio request: run(fn) gives fn a fresh requestId; cancel() aborts it in main.
 * Usage and capabilities queries are refreshed afterwards so month-to-date spend stays current.
 */
export function useStudioRequest<T>() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<StudioProgressEvent['phase'] | null>(null);
  const current = useRef<string | null>(null);
  useEffect(() => api.on('studio:progress', (e: StudioProgressEvent) => { if (e.requestId === current.current) setPhase(e.phase); }), []);
  const run = useCallback(async (fn: (requestId: string) => Promise<T>) => {
    const id = newRequestId();
    current.current = id;
    setBusy(true);
    try {
      return await fn(id);
    } finally {
      if (current.current === id) { current.current = null; setBusy(false); setPhase(null); }
      qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'usage'] });
      qc.invalidateQueries({ queryKey: [STUDIO_KEY, 'capabilities'] });
    }
  }, [qc]);
  const cancel = useCallback(() => { if (current.current) void studio.cancel(current.current).catch(() => {}); }, []);
  return { run, cancel, busy, phase };
}

/** Subscribes to studio:changed (optionally filtered by kind). */
export function useStudioChanged(cb: (e: StudioChangedEvent) => void, kind?: string) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => api.on('studio:changed', (e: StudioChangedEvent) => { if (!kind || e.kind === kind) ref.current(e); }), [kind]);
}

/** "≈ 1,234 in / 567 out tokens" */
export function fmtTokens(u: AiUsage | null | undefined): string {
  if (!u) return '—';
  return `≈ ${fmtNum(u.inputTokens)} / ${fmtNum(u.outputTokens)}`;
}

/** USD estimate: "$0.0123", "<$0.0001", "—" when unknown. */
export function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  if (v < 0.0001) return '<$0.0001';
  return `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`;
}
