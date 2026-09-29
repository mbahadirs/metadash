export interface ApiError { code: string | number; message: string; hint: string | null }
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface Account {
  igId: string; profileId: number; pageId: string | null; username: string; name: string | null; profilePicUrl: string | null;
  biography: string | null; website: string | null; isTracked: boolean; clientName: string | null; color: string | null;
  firstSeenAt: number | null; lastSyncedAt: number | null; followers: number | null; follows: number | null; mediaCount: number | null; tagIds: number[];
}
export interface Tag { id: number; name: string; color: string; count?: number }
export interface Kpi { value: number | null; prev?: number | null; changePct: number | null; currency?: string; byCurrency?: Record<string, { value: number; prev: number }> }
export interface Media {
  mediaId: string; igId: string; username: string; clientName: string | null; accountColor: string | null; profilePicUrl: string | null;
  mediaType: string; mediaProductType: string; caption: string | null; permalink: string | null; thumbnailPath: string | null;
  postedAt: number; postedHour: number; postedWeekday: number; captionLength: number; hashtagCount: number; mentionCount: number; emojiCount: number;
  reach: number | null; views: number | null; likes: number | null; comments: number | null; saved: number | null; shares: number | null;
  totalInteractions: number | null; engagementRate: number | null; saveRate: number | null;
  spend: number | null; paidReach: number | null; paidImpressions: number | null; paidClicks: number | null; paidResults: number | null; adCount: number; paidCurrency: string | null;
  paidPostEngagement: number | null; paidPageEngagement: number | null; paidResultType: string | null; totalReach: number; totalImpressions: number; paidReachShare: number | null; paidImpressionShare: number | null; costPerResult: number | null;
  paidFrequency: number | null; paidCpc: number | null; paidCtr: number | null; paidCpm: number | null; costPerPostEngagement: number | null; costPerPageEngagement: number | null;
}
export type TypeKey = 'image' | 'carousel' | 'video' | 'reels' | 'story';
export interface PaidAd { adId: string; adName: string | null; actId: string; accountName: string; currency: string; spend: number; impressions: number; reach: number; clicks: number; results: number; resultType: string | null; firstDate: string | null; lastDate: string | null; ctr: number | null; cpc: number | null; cpm: number | null; costPerResult: number | null }
export interface MediaDetail {
  media: Media & { typeKey: TypeKey; ageHours: number };
  benchmark: { posts: number; days: number; reach: number; views: number; likes: number; comments: number; saved: number; shares: number; engagementRate: number; saveRate: number } | null;
  deltas: Record<'reach' | 'views' | 'likes' | 'comments' | 'saved' | 'shares' | 'engagementRate' | 'saveRate', number | null>;
  rank: { rank: number | null; total: number; from: string; to: string };
  slot: { weekday: number; hour: number; count: number; value: number | null; qualified: boolean; bestValue: number | null } | null;
  derived: { viewsPerReach: number | null; interactionsPerThousandReach: number | null; commentRate: number | null; shareRate: number | null; paidShare: number | null };
  lifecycle: { series: Record<string, { ageHours: number; value: number; capturedAt: number }[]>; hoursTo80: number | null };
  paid: { currency: string; totals: PaidAd; series: { date: string; spend: number; reach: number; impressions: number; clicks: number; results: number }[]; ads: PaidAd[] } | null;
  comments: { comment_id: string; username: string; text: string; created_at: number; is_from_owner: number; parent_id: string | null; like_count: number }[];
}
export interface TypeSummary { typeKey: TypeKey; posts: number; avgReach: number | null; avgViews: number | null; avgLikes: number | null; avgComments: number | null; avgSaved: number | null; avgShares: number | null; avgEr: number | null; avgSaveRate: number | null; spend: number; paidPosts: number; totalReach: number }
export interface RecentPost extends Media { typeKey: TypeKey; vsReach: number | null; vsEr: number | null; vsSaved: number | null; benchPosts: number }
export interface ContentAnalysis {
  period: { from: string; to: string; recentDays: number; recentFrom: string };
  summary: { posts: number; reach: number; avgReach: number | null; avgEr: number | null; avgSaveRate: number | null; totalSpend: number; paidPosts: number; paidReach: number; currency: string | null; spendByCurrency: Record<string, number>; accounts: number };
  types: TypeSummary[]; recent: RecentPost[]; hashtags: { tag: string; posts: number; avgReach: number | null; avgEr: number | null; avgSaved: number | null }[]; top: Media[]; topSaved: Media[];
}
export interface Anomaly { igId: string; username: string; kind: 'reach' | 'post_er'; date: string; value: number; mean: number; sigma: number; z: number; direction: 'up' | 'down'; mediaId?: string }
export interface PaidAccountFields { paidCurrency: string | null; monthlyBudget: number | null; spend: number; paidImpressions: number; paidReach: number; paidClicks: number; paidResults: number; paidResultType: string | null; costPerResult: number | null; paidFrequency: number | null; paidCpc: number | null; paidCtr: number | null; paidCpm: number | null; paidPostEngagement: number; costPerPostEngagement: number | null; paidPageEngagement: number; costPerPageEngagement: number | null }
export interface PortfolioRow extends Account, PaidAccountFields {
  spendCurrency: string | null; totalReach: number; paidShare: number | null;
  followersChange: number | null; followersChangePct: number | null; reach: number; reachChangePct: number | null; posts: number; postsPrev: number;
  er: number | null; erChangePct: number | null; saveRate: number | null; health: number | null; sparkline: number[]; lastPostAt: number | null;
  daysSincePost: number | null; anomalies: Anomaly[]; syncError: { code: number; message: string } | null;
}
export interface Portfolio {
  period: { from: string; to: string; prevFrom: string; prevTo: string; days: number };
  kpis: { totalFollowers: Kpi; netFollowers: Kpi; totalReach: Kpi; avgEr: Kpi; totalSpend: Kpi; totalPosts: Kpi };
  rows: PortfolioRow[];
  attention: { anomalies: Anomaly[]; silent: { igId: string; username: string; daysSincePost: number | null }[]; errors: { igId: string; username: string; code: number; message: string }[] };
}
export interface SeriesPoint { date: string; [k: string]: number | string | null }
export interface HealthScore { igId: string; username: string; score: number; components: Record<'growth' | 'engagement' | 'consistency' | 'response', { raw: number | null; pct: number }> }
export interface AccountAnalytics {
  account: Account; period: Portfolio['period'];
  kpis: { reach: Kpi; views: Kpi; profileViews: Kpi; er: Kpi; newFollowers: Kpi; posts: Kpi; saveRate: Kpi };
  series: SeriesPoint[]; prevSeries: SeriesPoint[]; followerSeries: { date: string; followers: number }[]; posts: Media[];
  byType: { productType: string; mediaType: string; posts: number; avgReach: number; avgLikes: number; avgComments: number; avgSaved: number; avgEr: number | null }[];
  comments: { total: number; answered: number; incoming: number; avgLatency: number | null } | null; health: HealthScore | null;
  paid: (PaidAccountFields & { prev: PaidAccountFields; actId: string; name: string }) | null;
}
export interface HeatCell { weekday: number; hour: number; count: number; value: number | null; avgReach: number | null; qualified: boolean }
export interface BestTime { matrix: HeatCell[][]; best: HeatCell[]; totalPosts: number; minPosts: number }
export interface Lifecycle { curve: { ageHours: number; ratio: number | null; samples: number }[]; hoursTo80: number | null; mediaCount: number }
export interface SyncStatus { running: boolean; runId: number | null; scope: string | null; phase: string | null; currentAccount: string | null; done: number; total: number; apiCalls: number; startedAt: number | null; errors: number; lastSuccessAt: number | null; rateLimit: { usagePct: number; multiplier: number }; tokenInvalid: boolean }
export interface SyncProgress { runId: number; phase: string; currentAccount: string | null; done: number; total: number; apiCalls: number }
export interface AdAccount { actId: string; name: string; currency: string; status: string; linkedIgId: string | null; linkedUsername: string | null; isTracked: boolean; lastDate: string | null; monthlyBudget: number | null; budgetNote: string | null }
export interface AdRow { objectId?: string; objectName?: string; resultType?: string | null; bucket?: string; date?: string; spend: number; impressions: number; reach: number; clicks: number; results: number; ctr: number | null; cpc: number | null; cpm: number | null; frequency: number | null; costPerResult: number | null; postEngagement: number; pageEngagement: number; costPerPostEngagement: number | null; costPerPageEngagement: number | null }
export interface AdAccountRow extends AdAccount, AdRow { spendChangePct: number | null; resultsChangePct: number | null; reachChangePct: number | null }
export interface BudgetPacing { actId: string; name: string; currency: string; linkedIgId: string | null; linkedUsername: string | null; status: string; month: { from: string; to: string; daysInMonth: number; elapsed: number; remainingDays: number }; budget: number | null; note: string | null; spentMtd: number; expectedMtd: number | null; pacePct: number | null; remaining: number | null; dailyTarget: number | null; dailyNeeded: number | null; projected: number | null; projectedPct: number | null; weeklyTarget: number | null; spentToday: number; spentYesterday: number; last7: number; prev7: number; todayVsTarget: number | null; weekVsTarget: number | null; paceStatus: 'under' | 'on' | 'over' | 'no_budget' }
export interface AdInsights { currency: string; mixedCurrency: boolean; kpis: Record<string, Kpi>; accounts: AdAccountRow[]; series: AdRow[]; objects: AdRow[]; breakdown: AdRow[] | null; breakdowns: Record<string, AdRow[]> | null }
export interface Blended { adAccount: { actId: string; currency: string; name: string } | null; series: { date: string; organicReach: number; paidReach: number; spend: number; impressions: number }[]; totals: { organicReach: number; paidReach: number; spend: number; impressions: number; clicks: number; results: number; cpm: number | null; costPerResult: number | null; spendChangePct: number | null; paidReachChangePct: number | null; paidShare: number | null }; campaigns: AdRow[] }
export interface CompareResult { metric: string; series: { igId: string; username: string; color: string; points: (number | null)[] }[]; merged: Record<string, string | number | null>[]; table: ({ igId: string; username: string; clientName: string | null; color: string; followers: number | null; growth: number | null; growthPct: number | null; reach: number; reachChangePct: number | null; er: number | null; erChangePct: number | null; saveRate: number | null; posts: number; postsPerWeek: number; health: number | null; totalReach: number } & PaidAccountFields)[] }
export interface Competitor { id: number; username: string; linkedIgId: string; label: string | null; ownerUsername: string; followers: number | null; lastDate: string | null }
export interface CompetitorRow { id: number | null; username: string; isOwn: boolean; color: string; followers: number | null; growth: number | null; growthPct: number | null; postsPerWeek: number | null; avgLikes: number | null; avgComments: number | null; series: { date: string; followers: number }[]; lastDate?: string | null }
export interface SetupState { step: number; complete: boolean; demo: boolean; hasApp: boolean; appId: string | null; hasToken: boolean; trackedCount: number; adAccountCount: number; requiredScopes: string[]; optionalScopes: string[] }
export interface TokenHealth { valid: boolean; demo?: boolean; reason?: string; error?: string; expiresAt: number | null; daysLeft: number | null; scopes: string[]; missingScopes: string[]; optionalScopes: { scope: string; granted: boolean }[] }
export interface Digest { from: string; to: string; text: string; sentences: string[]; kpis: Portfolio['kpis']; topPosts: Media[]; silent: Portfolio['attention']['silent'] }
export interface Note { id: number; entity_type: string; entity_id: string; body: string; created_at: number }
export interface SyncRun { id: number; startedAt: number; finishedAt: number | null; scope: string; status: string; accountsDone: number; accountsTotal: number; apiCalls: number; errorSummary: string | null; errorCount: number }
export interface PostCompare { items: MediaDetail[]; lifecycle: Record<string, number | null>[]; best: Record<string, string | null> }
export interface BudgetNode { level: 'campaign' | 'adset' | 'ad'; objectId: string; name: string; parentId: string | null; depth: number; budget: number | null; mode: 'auto' | 'manual'; spentMtd: number; expectedMtd: number | null; pacePct: number | null; remaining: number | null; dailyTarget: number | null; dailyNeeded: number | null; projected: number | null; projectedPct: number | null; weeklyTarget: number | null; spentToday: number; spentYesterday: number; last7: number; todayVsTarget: number | null; weekVsTarget: number | null; paceStatus: 'under' | 'on' | 'over' | 'no_budget'; children: BudgetNode[]; childManualSum: number; firstDate: string; lastDate: string }
export interface BudgetTree { account: { actId: string; name: string; currency: string; linkedUsername: string | null; budget: number | null; spentMtd: number; pacePct: number | null; paceStatus: string; manualChildSum: number }; month: { from: string; to: string; daysInMonth: number; elapsed: number }; campaigns: BudgetNode[]; warnings: { level: string; parentId: string; manualSum: number; parentBudget: number | null }[] }
export interface TransferInfo { filePath: string; meta: { exportedAt: number; appVersion: string; host: string; secrets: boolean } | null; needsPassphrase: boolean; secretCount: number; schemaVersion: number | null; accounts: number; media: number; snapshots: number; insights: number; adAccounts: number; adRows: number; stories: number; competitors: number; notes: number; tags: number; size: number }
export type UpdateState = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
export interface UpdateStatus { state: UpdateState; version?: string; url?: string; manual?: boolean; percent?: number; error?: string; dev?: boolean }
