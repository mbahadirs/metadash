import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, call } from '@/lib/api';
import { useAppStore } from '@/store/app';
import { usePlatformScope } from './usePlatforms';
import type { Platform, BudgetTree, BudgetPacing, PostCompare, MediaDetail, ContentAnalysis, TypeKey, Account, Tag, Portfolio, AccountAnalytics, BestTime, Lifecycle, CompareResult, Media, AdAccount, AdInsights, Blended, Competitor, CompetitorRow, SetupState, TokenHealth, Digest, HealthScore, Note, SyncRun, SyncStatus } from '@/lib/types';

export function usePeriod() {
  return useAppStore((s) => s.period);
}

export const useAccounts = (params?: { tagIds?: number[]; search?: string; onlyTracked?: boolean }) =>
  useQuery<Account[]>({ queryKey: ['accounts', params], queryFn: () => call(api.accounts.list(params ?? {})) });

export const useAccount = (igId: string | undefined) =>
  useQuery<Account | null>({ queryKey: ['account', igId], queryFn: () => call(api.accounts.get(igId)), enabled: !!igId });

export const useTags = () => useQuery<Tag[]>({ queryKey: ['tags'], queryFn: () => call(api.tags.list()) });

/** Portfolio for the top-bar period, tag filter and effective platform filter (platforms omitted = all). */
export function usePortfolio() {
  const { from, to } = usePeriod();
  const tagIds = useAppStore((s) => s.tagFilter);
  const platforms = usePlatformScope();
  return useQuery<Portfolio>({ queryKey: ['portfolio', from, to, tagIds, platforms], queryFn: () => call(api.analytics.portfolio({ from, to, tagIds, ...(platforms.length ? { platforms } : {}) })) });
}

export function useAccountAnalytics(igId: string | undefined) {
  const { from, to } = usePeriod();
  return useQuery<AccountAnalytics | null>({ queryKey: ['accountAnalytics', igId, from, to], queryFn: () => call(api.analytics.account({ igId, from, to })), enabled: !!igId });
}

export function useBestTime(igId: string | undefined, range?: { from: string; to: string }) {
  const period = usePeriod();
  const { from, to } = range ?? period;
  return useQuery<BestTime>({ queryKey: ['bestTime', igId, from, to], queryFn: () => call(api.analytics.bestTime({ igId, from, to })), enabled: !!igId });
}

export function useLifecycle(igId: string | undefined, range?: { from: string; to: string }) {
  const period = usePeriod();
  const { from, to } = range ?? period;
  return useQuery<Lifecycle>({ queryKey: ['lifecycle', igId, from, to], queryFn: () => call(api.analytics.lifecycle({ igId, from, to })), enabled: !!igId });
}

export const useMediaDetail = (mediaId: string | null) =>
  useQuery<MediaDetail | null>({ queryKey: ['media', mediaId], queryFn: () => call(api.analytics.media(mediaId)), enabled: !!mediaId });

export const useComparePosts = (mediaIds: string[]) =>
  useQuery<PostCompare>({ queryKey: ['comparePosts', mediaIds], queryFn: () => call(api.analytics.comparePosts({ mediaIds })), enabled: mediaIds.length >= 2 });

export function useContentAnalysis(params: { igIds?: string[]; typeKeys?: TypeKey[]; recentDays?: number; platforms?: Platform[] }, enabled = true) {
  const { from, to } = usePeriod();
  return useQuery<ContentAnalysis>({ queryKey: ['contentAnalysis', from, to, params], queryFn: () => call(api.analytics.contentAnalysis({ from, to, ...params })), enabled });
}

export function useDemographics(igId: string | undefined) {
  return useQuery<{ capturedAt: number | null; city: { bucket: string; value: number }[]; genderAge: { bucket: string; value: number }[]; country: { bucket: string; value: number }[] }>({
    queryKey: ['demographics', igId], queryFn: () => call(api.analytics.demographics({ igId })), enabled: !!igId,
  });
}

export function useStories(igId: string | undefined) {
  const { from, to } = usePeriod();
  return useQuery<{ stories: { storyId: string; postedAt: number; mediaType: string; reach: number; views: number; replies: number; navForward: number; navBack: number; navExit: number; navNextStory: number; completionRate: number | null }[]; summary: { count: number; avgReach: number; avgViews: number; avgCompletion: number | null; avgExitRate: number | null; replies: number } }>({
    queryKey: ['stories', igId, from, to], queryFn: () => call(api.analytics.stories({ igId, from, to })), enabled: !!igId,
  });
}

export function useCompare(igIds: string[], metric: string) {
  const { from, to } = usePeriod();
  return useQuery<CompareResult>({ queryKey: ['compare', igIds, metric, from, to], queryFn: () => call(api.analytics.compare({ igIds, from, to, metric })), enabled: igIds.length >= 1 });
}

export function useContent(params: { igIds?: string[]; filters: Record<string, unknown> }) {
  const { from, to } = usePeriod();
  return useQuery<Media[]>({ queryKey: ['content', from, to, params], queryFn: () => call(api.analytics.content({ from, to, ...params })) });
}

export function useHealth() {
  const { from, to } = usePeriod();
  return useQuery<HealthScore[]>({ queryKey: ['health', from, to], queryFn: () => call(api.analytics.health({ from, to })) });
}

export const useDigest = (weekOf?: string) => {
  const lang = useAppStore((s) => s.lang);
  return useQuery<Digest>({ queryKey: ['digest', weekOf, lang], queryFn: () => call(api.analytics.weeklyDigest({ weekOf, lang })) });
};

export const useAdAccounts = () => useQuery<AdAccount[]>({ queryKey: ['adAccounts'], queryFn: () => call(api.ads.accounts()) });

export function useAdInsights(params: { actIds: string[]; level: string; breakdown?: string; breakdowns?: string[] }, enabled = true) {
  const { from, to } = usePeriod();
  return useQuery<AdInsights>({ queryKey: ['adInsights', from, to, params], queryFn: () => call(api.ads.insights({ from, to, ...params })), enabled });
}

export const useBudgetTree = (actId: string | null) => useQuery<BudgetTree>({ queryKey: ['budgetTree', actId], queryFn: () => call(api.ads.budgetTree({ actId })), enabled: !!actId });
export const useBudget = () => useQuery<BudgetPacing[]>({ queryKey: ['budget'], queryFn: () => call(api.ads.budget({})) });
export const useBoostCandidates = (actId: string | null) => useQuery<{ account: AdAccount | null; candidates: Media[]; window?: { from: string; to: string } }>({ queryKey: ['boost', actId], queryFn: () => call(api.ads.boostCandidates({ actId })), enabled: !!actId });

export function useBlended(igId: string | undefined) {
  const { from, to } = usePeriod();
  return useQuery<Blended>({ queryKey: ['blended', igId, from, to], queryFn: () => call(api.ads.blended({ igId, from, to })), enabled: !!igId });
}

export const useCompetitors = (igId?: string) => useQuery<Competitor[]>({ queryKey: ['competitors', igId ?? 'all'], queryFn: () => call(api.competitors.list(igId ?? null)) });

export function useCompetitorCompare(igId: string | undefined) {
  const { from, to } = usePeriod();
  return useQuery<{ rows: CompetitorRow[]; note: string }>({ queryKey: ['competitorCompare', igId, from, to], queryFn: () => call(api.competitors.compare({ igId, from, to })), enabled: !!igId });
}

export const useSetupState = () => useQuery<SetupState>({ queryKey: ['setupState'], queryFn: () => call(api.setup.getState()) });
export const useTokenHealth = () => useQuery<TokenHealth>({ queryKey: ['tokenHealth'], queryFn: () => call(api.setup.getTokenHealth()), staleTime: 60_000 });
export const useSyncHistory = () => useQuery<SyncRun[]>({ queryKey: ['syncHistory'], queryFn: () => call(api.sync.history({ limit: 30 })) });
export const useSyncStatus = () => useQuery<SyncStatus>({ queryKey: ['syncStatus'], queryFn: () => call(api.sync.status()), refetchInterval: 5000 });
export const useNotes = (entityType: string, entityId: string) => useQuery<Note[]>({ queryKey: ['notes', entityType, entityId], queryFn: () => call(api.notes.list({ entityType, entityId })) });
export const useSettings = () => useQuery<Record<string, unknown>>({ queryKey: ['settings'], queryFn: () => call(api.settings.all()) });

export function useInvalidate() {
  const qc = useQueryClient();
  return (keys?: string[]) => {
    if (!keys) return qc.invalidateQueries();
    return Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
  };
}

export function useApiMutation<TArgs, TRes = unknown>(fn: (args: TArgs) => Promise<unknown>, invalidate: string[] = []) {
  const qc = useQueryClient();
  return useMutation<TRes, Error, TArgs>({
    mutationFn: (args) => call(fn(args) as never) as Promise<TRes>,
    onSuccess: () => { for (const k of invalidate) qc.invalidateQueries({ queryKey: [k] }); },
  });
}
