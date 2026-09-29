export interface ApiError { code: string | number; message: string; hint: string | null }
export type Envelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export type Platform = 'instagram' | 'facebook' | 'threads' | 'youtube' | 'tiktok';
export type AuthPlatform = 'meta' | 'threads' | 'google' | 'tiktok';
/** Platforms the v1.4 planner publishes to (v2.0 YouTube/TikTok are analytics-only). */
export type PublishPlatform = 'instagram' | 'facebook' | 'threads';
/** Mirrors main/providers/capabilities.js CAPABILITY_SCHEMA; the v2.0 keys are optional for older payloads. */
export interface PlatformCapabilities {
  reach: boolean; saveRate: boolean; stories: boolean; demographics: boolean; competitors: boolean; comments: boolean; ads: boolean;
  inbox?: boolean; inboxReply?: boolean | 'scope'; watchTime?: boolean; dailySeries?: 'native' | 'derived' | 'none'; experimental?: boolean;
}
/**
 * platforms:list row. `enabled` = provider implemented in this build; `connected` = auth profile exists.
 * v2.0 stub providers are omitted until enabled. `profiles` = active profiles of the auth (YouTube channels, …).
 */
export interface PlatformInfo {
  platform: Platform; label: string; enabled: boolean; auth: AuthPlatform; connected: boolean; trackedCount: number; capabilities: PlatformCapabilities; primaryMetric: 'reach' | 'views';
  keyPrefix?: string; experimental?: boolean; multiProfile?: boolean; profiles?: number;
}

/**
 * `igId` is the *account key* (column ig_id), not necessarily an Instagram id: raw IG id, 'fb-<pageId>' or 'th-<userId>'.
 * `externalId` is the raw API id; `linkedAccountId` links a Facebook Page to its Instagram account key.
 */
export interface Account {
  igId: string; platform: Platform; externalId: string; linkedAccountId: string | null; profileId: number; pageId: string | null; username: string; name: string | null; profilePicUrl: string | null;
  biography: string | null; website: string | null; isTracked: boolean; clientName: string | null; color: string | null;
  firstSeenAt: number | null; lastSyncedAt: number | null; followers: number | null; follows: number | null; mediaCount: number | null; tagIds: number[];
}
export interface Tag { id: number; name: string; color: string; count?: number }
export interface Kpi { value: number | null; prev?: number | null; changePct: number | null; currency?: string; byCurrency?: Record<string, { value: number; prev: number }> }
export interface Media {
  mediaId: string; igId: string; platform: Platform; externalId: string; username: string; clientName: string | null; accountColor: string | null; profilePicUrl: string | null;
  mediaType: string; mediaProductType: string; caption: string | null; permalink: string | null; thumbnailPath: string | null;
  postedAt: number; postedHour: number; postedWeekday: number; captionLength: number; hashtagCount: number; mentionCount: number; emojiCount: number;
  reach: number | null; views: number | null; likes: number | null; comments: number | null; saved: number | null; shares: number | null;
  reposts: number | null; quotes: number | null; clicks: number | null;
  /** v2.0 watch metrics (YouTube); null elsewhere. */
  watchTimeMin?: number | null; avgViewDurationS?: number | null; avgViewPct?: number | null; durationS?: number | null;
  totalInteractions: number | null; engagementRate: number | null; saveRate: number | null;
  spend: number | null; paidReach: number | null; paidImpressions: number | null; paidClicks: number | null; paidResults: number | null; adCount: number; paidCurrency: string | null;
  paidPostEngagement: number | null; paidPageEngagement: number | null; paidResultType: string | null; totalReach: number; totalImpressions: number; paidReachShare: number | null; paidImpressionShare: number | null; costPerResult: number | null;
  paidFrequency: number | null; paidCpc: number | null; paidCtr: number | null; paidCpm: number | null; costPerPostEngagement: number | null; costPerPageEngagement: number | null;
}
export type TypeKey = 'image' | 'carousel' | 'video' | 'reels' | 'story' | 'text' | 'short' | 'live'; // 'text' = TEXT_POST/TEXT/LINK/STATUS (Facebook, Threads); short/live = YouTube
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
export interface SyncStatus { running: boolean; runId: number | null; scope: string | null; phase: string | null; currentAccount: string | null; done: number; total: number; apiCalls: number; startedAt: number | null; errors: number; lastSuccessAt: number | null; rateLimit: { usagePct: number; multiplier: number }; tokenInvalid: boolean; invalidAuth?: string[]; lockedBy?: { kind: string; since: number } | null }
/** invalidAuth: auth platforms ('meta', 'threads') or '<auth>:<profileId>' for multi-profile auths (v2.0). */
export interface SyncDone { runId: number; status: string; errors: number; apiCalls: number; tokenInvalid: boolean; invalidAuth: string[]; demo?: boolean }
export interface TokenWarning { platform: AuthPlatform; code: number | string; message: string; accountId?: string | null; profileId?: number | null }
export interface DisabledMetric { metric: string; scope: string; reason: string | null; disabledAt: number | null; platform: Platform }
export interface FacebookPageCandidate { accountId: string; pageId: string; name: string; pictureUrl: string | null; followers: number | null; linkedIgId: string | null; canAnalyze: boolean; tracked: boolean; known: boolean }
export interface FacebookDiscovery { items: FacebookPageCandidate[]; missingScopes: string[] }
export interface ThreadsSetupState { hasApp: boolean; appId: string | null; hasToken: boolean; expiresAt: number | null; username: string | null; tracked: boolean }
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

// ---- v1.4 Planner / publishing (contract: main ipc/planner.handlers.js, publishing.handlers.js, app.handlers.js) ----
export type PostStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed' | 'archived';
export type TargetState = 'idle' | 'queued' | 'hosting' | 'container' | 'ready' | 'handed_off' | 'publishing' | 'commenting' | 'published' | 'failed' | 'canceled' | 'missed' | 'paused';
export type InstagramFormat = 'image' | 'carousel' | 'reel' | 'story';
export type FacebookFormat = 'text' | 'link' | 'photo' | 'album' | 'video' | 'reel';
export type ThreadsFormat = 'text' | 'image' | 'video' | 'carousel';
export type PlannerFormat = InstagramFormat | FacebookFormat | ThreadsFormat;
export type TargetMode = 'app' | 'native';
export type PostSource = 'manual' | 'duplicate' | 'ai_idea' | 'repurpose';
export type MediaHostType = 'none' | 's3' | 'fbpage' | 'url';

/** planner_targets.options (JSON). */
export interface TargetOptions { shareToFeed?: boolean; coverAssetId?: number; thumbOffsetMs?: number; link?: string; topicTag?: string; locationId?: string; collaborators?: string[]; altText?: Record<string, string>; children?: string[] }
export interface PlannerTarget {
  id: number; postId: number; accountId: string; platform: Platform; format: PlannerFormat; captionOverride: string | null; firstCommentOverride: string | null;
  options: TargetOptions; mode: TargetMode; state: TargetState; attempts: number; nextAttemptAt: number | null; lockedAt: number | null; lockOwner: string | null;
  containerId: string | null; remoteId: string | null; mediaKey: string | null; permalink: string | null; firstCommentId: string | null;
  lastErrorCode: string | null; lastError: string | null; fbtraceId: string | null; publishedAt: number | null;
}
/** Library file. Preview URLs: mediaUrl(id) / mediaUrl(id, 'thumb') → mdmedia://asset/<id>[/thumb]. */
export interface PlannerAsset {
  id: number; sha256: string; fileName: string | null; storedPath: string; mime: string | null; format: 'jpeg' | 'png' | 'webp' | 'gif' | 'mp4' | 'mov' | null; kind: 'image' | 'video';
  bytes: number | null; width: number | null; height: number | null; rotation: number; durationMs: number | null; videoCodec: string | null; audioCodec: string | null; fps: number | null;
  thumbPath: string | null; createdAt: number;
}
export interface PlannerPostAsset { assetId: number; role: 'media' | 'cover'; position: number; altText: string | null; asset: PlannerAsset }
export type IssueLevel = 'error' | 'warn' | 'info';
/** Validation issue; `code` is an i18n key in locales/<lang>/planner.json, `params` fill its {placeholders}. */
export interface Issue { level: IssueLevel; code: string; platform: Platform | null; targetId: number | null; accountId: string | null; assetId: number | null; field: string; params: Record<string, string | number | null> }
export type AuditActor = 'user' | 'worker' | 'system' | 'client';
export interface AuditEntry { id: number; at: number; postId: number | null; targetId: number | null; actor: AuditActor; action: string; detail: Record<string, unknown> | null; ref: string | null }
export interface PlannerPost {
  id: number; ref: string; title: string | null; caption: string; firstComment: string | null; status: PostStatus; scheduledAt: number | null; timezone: string | null;
  clientName: string | null; labels: string[]; notes: string | null; version: number; approvedVersion: number | null; approvedBy: string | null; approvedAt: number | null;
  source: PostSource; createdAt: number; updatedAt: number; deletedAt: number | null;
  targets: PlannerTarget[]; assets: PlannerPostAsset[]; validation: Issue[]; audit: AuditEntry[];
}
export interface PlannerTargetSummary { id: number; accountId: string; platform: Platform; format: PlannerFormat; state: TargetState; mode: TargetMode; permalink: string | null }
export interface PlannerPostSummary {
  id: number; ref: string; title: string | null; captionPreview: string; status: PostStatus; scheduledAt: number | null; version: number;
  targets: PlannerTargetSummary[]; thumb: { assetId: number; kind: 'image' | 'video' } | null; issuesCount: number; source: PostSource; labels: string[]; clientName: string | null; updatedAt: number;
}
export interface PlannerListParams { from?: number; to?: number; accountIds?: string[]; platforms?: Platform[]; statuses?: PostStatus[]; includeUnscheduled?: boolean; search?: string }
export interface PlannerTargetInput { accountId: string; format?: PlannerFormat; captionOverride?: string | null; firstCommentOverride?: string | null; options?: TargetOptions | null; mode?: TargetMode }
export interface PlannerAssetInput { assetId: number; role?: 'media' | 'cover'; altText?: string | null }
export interface PlannerCreateInput {
  title?: string | null; caption?: string; firstComment?: string | null; scheduledAt?: number | null; timezone?: string | null; targets: PlannerTargetInput[];
  assetIds?: number[]; assets?: PlannerAssetInput[]; labels?: string[]; clientName?: string | null; notes?: string | null; source?: PostSource;
}
/** planner:posts:update patch. Time changes go through reschedule; targets/assets replace the whole list. */
export type PlannerPatch = Partial<Omit<PlannerCreateInput, 'scheduledAt' | 'assetIds' | 'source' | 'targets'>> & { targets?: PlannerTargetInput[] };
export interface PlannerUpdateInput { id: number; patch: PlannerPatch; expectedVersion?: number }
export type PlannerDraft = PlannerCreateInput & { id?: number };
export interface PlannerSetStatusInput { ids: number[]; status: PostStatus; note?: string; approver?: string }
export interface PlannerSetStatusResult { updated: number[]; rejected: { id: number; reason: 'not_found' | 'use_publishing' | 'transition_not_allowed' | 'approval_required' | 'worker_only' | 'same_status' | 'unknown_status' }[] }
export type PlannerRescheduled = PlannerPost & { warnings: Issue[] };
export interface Slot { at: number; weekday: number; hour: number; score: number; avgEr: number | null; posts: number; qualified: boolean; source: 'account' | 'portfolio' | 'default'; conflicts: { postId: number; ref: string; accountId: string; scheduledAt: number }[] }
export interface ApprovalExportInput { postIds?: number[]; from?: number; to?: number; accountIds?: string[]; format: 'html' | 'pdf'; title?: string; clientName?: string; lang?: string; includeNotes?: boolean }
export interface ApprovalExportResult { filePath: string; packId: string; count: number }
export interface ApprovalImportResult { applied: { ref: string; decision: 'approved' | 'changes_requested'; note: string | null }[]; stale: { ref: string; packVersion: number; currentVersion: number }[]; unknown: string[] }

export interface QueueItem extends PlannerTarget { postRef: string; postTitle: string | null; scheduledAt: number | null; thumb: { assetId: number; kind: 'image' | 'video' } | null }
export interface ScheduleResult { queued: number; handedOff: number; warnings: Issue[] }
export interface QuotaInfo { used: number | null; total: number | null; windowSec: number | null; checkedAt: number | null }
export interface PlatformReadiness { canPublish: boolean; missingScopes: string[]; firstComment: boolean }
export interface PublishingReadiness {
  instagram: PlatformReadiness; facebook: PlatformReadiness & { pages: { accountId: string; canPublish: boolean }[] }; threads: PlatformReadiness;
  mediaHost: { type: MediaHostType; configured: boolean; lastTestOk: boolean | null };
}
export interface PublishingStatus { paused: boolean; running: boolean; nextAt: number | null; inFlight: number }
export interface S3Settings { endpoint: string; region: string; bucket: string; prefix: string; pathStyle: boolean; publicBaseUrl: string; urlTtlSec: number; deleteAfterPublish: boolean }
export interface MediaHostSettings { type: MediaHostType; s3: S3Settings; keySet: { last4: string } | null }
export interface MediaHostInput { type: MediaHostType; s3?: Partial<S3Settings>; accessKeyId?: string; secretAccessKey?: string }
export interface MediaHostTest { ok: boolean; url: string | null; status: number | null; ms: number; error?: string }
export interface BackgroundSettings { trayMode: boolean; launchAtLogin: boolean; startHidden: boolean; keepAwakeForPosts: boolean; supported: { loginItem: boolean; tray: boolean } }
export type MissedAction = 'publish' | 'reschedule' | 'skip';

/** Renderer events (api.on). */
export interface PlannerChangedEvent { postIds: number[]; reason: 'created' | 'edited' | 'approval_invalidated' | 'rescheduled' | 'deleted' | 'status' | string; [extra: string]: unknown }
export interface PublishProgressEvent { targetId: number; postId: number; state: TargetState; pct?: number }
export interface PublishMissedEvent { count: number }

/** mdmedia:// URL for a planner asset (main: planner/mediaRequest.js). */
export const mediaUrl = (assetId: number, variant: 'file' | 'thumb' = 'file') => `mdmedia://asset/${assetId}${variant === 'thumb' ? '/thumb' : ''}`;

// ---------------------------------------------------------------- v1.5 AI studio (main: ai/studio/*, ipc/studio.handlers.js)
export type AiProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama';
export type Tri = boolean | 'unknown';
export type StudioFeature = 'voice' | 'caption' | 'hashtags' | 'ideas' | 'repurpose' | 'reply' | 'abtest' | 'commentary' | 'anomaly' | 'ask' | 'test';
export interface AiUsage { inputTokens: number; outputTokens: number }
export interface PriceInfo { inPerM: number; outPerM: number; source: 'override' | 'list' | 'estimate' | 'local' }
export interface StudioCapabilities {
  enabled: boolean; provider: AiProviderId; model: string;
  vision: Tri; visionDisabledByUser: boolean; tools: Tri; jsonMode: boolean; nativeSchema: boolean; structuredModes: ('schema' | 'tool' | 'json')[]; local: boolean;
  pricingKnown: boolean; price: PriceInfo | null; monthToDateUsd: number; budgetUsd: number | null; showCost: boolean; keepHistory: boolean;
}
/** Every generate result carries these (costUsd null = unknown price; 0 for Ollama). */
export interface StudioCost { usage: AiUsage; costUsd: number | null; generationId: number | null; provider?: AiProviderId; model?: string }
export interface SendPreviewItem { kind: 'text' | 'image' | 'table'; label: string; chars?: number; count?: number; thumb?: string; ids?: (string | number)[] }
export interface SendPreview { feature: string; items: SendPreviewItem[]; estInputTokens: number; estOutputTokens: number; estCostUsd: number | null; pricingKnown: boolean; local: boolean }
export interface UsageGroup { calls: number; inputTokens: number; outputTokens: number; images: number; usd: number | null; unknownCost: number; errors: number }
export interface UsageSummary {
  from: number; to: number; totalUsd: number; calls: number; inputTokens: number; outputTokens: number; images: number; unknownCostCalls: number; errors: number;
  byFeature: (UsageGroup & { feature: StudioFeature | string })[]; byModel: (UsageGroup & { provider: AiProviderId | null; model: string | null })[];
  budgetUsd: number | null; overBudget: boolean;
}
export interface PricingOverrides { [provider: string]: { [model: string]: { inPerM: number; outPerM: number } } }
export interface PriceRow { provider: AiProviderId; model: string; inPerM: number; outPerM: number; source: 'override' | 'list' | 'estimate' }
export interface StudioSettings {
  keepHistory: boolean; showCost: boolean; vision: boolean; pricing: PricingOverrides; monthlyBudgetUsd: number | null;
  anonymizeCommenters: boolean; captionLangs: ('tr' | 'en')[]; prices: PriceRow[];
}
export type StudioSettingsPatch = Partial<Omit<StudioSettings, 'prices'>>;
export interface BrandVoiceProfile {
  tone?: string[]; formality?: string; avgLength?: number; emojiRate?: number; emojiSet?: string[]; hashtagHabit?: { avgCount: number; placement: string };
  ctaPatterns?: string[]; hooks?: string[]; doList?: string[]; dontList?: string[]; languages?: string[]; pronoun?: 'sen' | 'siz'; sampleMediaIds?: string[];
  [extra: string]: unknown;
}
export interface BrandVoice {
  accountId: string; brief: string; profile: BrandVoiceProfile | null; source: 'manual' | 'ai' | 'ai_edited'; derivedFrom: number | null; derivedAt: number | null;
  provider: string | null; model: string | null; aiDisabled: boolean; updatedAt: number; stats?: Record<string, unknown>;
}
export interface CaptionVariant { label: string; lang: 'tr' | 'en'; angle: string; text: string; hashtags: string[]; charCounts: Partial<Record<'instagram' | 'facebook' | 'threads', number>>; issues: Issue[] }
export interface CaptionGenerateInput { requestId?: string; postId?: number; accountIds: string[]; assetIds?: number[]; notes?: string; langs: ('tr' | 'en')[]; variants?: number; platforms?: ('instagram' | 'facebook' | 'threads')[] }
export interface CaptionGenerateResult extends StudioCost { variants: CaptionVariant[]; visionUsed: boolean }
export interface HashtagStat { tag: string; posts: number; lift: number; avgReach: number | null; avgEr: number | null; lastUsedAt: number | null; score: number }
export interface HashtagSuggestResult { tested: HashtagStat[]; overused: HashtagStat[]; stale: HashtagStat[]; untested: { tag: string; reason: string }[]; usage?: AiUsage; costUsd?: number | null }
export interface ContentIdea { id: string; title: string; format: string; pillar: string; hook: string; captionDraft: string; suggestedDate: string | null; rationale: string; basedOn: string[] }
export interface IdeasGenerateInput { requestId?: string; accountId: string; month: string; count?: number; pillars?: string[]; langs: ('tr' | 'en')[]; includeSpecialDays?: boolean }
export interface IdeasGenerateResult extends StudioCost { ideas: ContentIdea[] }
export type RepurposeTarget = 'carousel' | 'threads' | 'facebook' | 'story';
export interface RepurposeInput { requestId?: string; source: { mediaId: string } | { postId: number }; to: RepurposeTarget; lang: 'tr' | 'en'; transcript?: string }
export interface InboxItem {
  commentId: string; mediaId: string; accountId: string; username: string; text: string; createdAt: number; likeCount: number;
  caption: string | null; permalink: string | null; thumb: string | null; reply: { status: string; suggestion: string | null } | null;
}
export interface ReplySuggestResult extends StudioCost { category: 'question' | 'praise' | 'complaint' | 'spam' | 'other'; suggestions: string[] }
export type AbVariable = 'caption_hook' | 'length' | 'emoji' | 'cta' | 'hashtags' | 'other';
export type AbMetric = 'reach_lift' | 'er' | 'save_rate' | 'views_lift';
export interface AbCreateInput { name: string; hypothesis?: string; variable: AbVariable; metric: AbMetric; arms: { arm: string; targetIds?: number[]; mediaKeys?: string[]; captionVariantIds?: number[] }[] }
export interface StudioProgressEvent { requestId: string; feature: string; phase: 'preparing' | 'sending' | 'validating' | 'done' }
export interface StudioChangedEvent { kind: 'voice' | 'inbox' | 'ab' | 'usage' | 'ideas' | string; accountIds?: string[]; postIds?: number[]; ids?: (string | number)[] }

// ───────────────────────────────────────────── v2.0 contracts (chunk B) ─────────────────────────────────────────────
// Owners fill the behaviour; changing a shape is a chunk-B follow-up (see v20 contract).

/** setup:youtube:getState (C1). */
export interface YouTubeChannel { accountId: string; profileId: number; title: string; handle: string | null; thumbnail: string | null; subscribers: number | null; tracked: boolean; tokenOk: boolean; canReply: boolean; expiresAt: number | null }
export interface YouTubeSetupState { hasClient: boolean; clientId: string | null; channels: YouTubeChannel[]; quota: { used: number; limit: number; resetsAt: number } | null }
/** setup:tiktok:getState (C2). */
export interface TikTokAccountState { accountId: string; profileId: number; username: string; displayName: string | null; avatar: string | null; followers: number | null; tracked: boolean; tokenOk: boolean; expiresAt: number | null; refreshExpiresAt: number | null }
export interface TikTokSetupState { hasClient: boolean; clientKey: string | null; sandbox: boolean; accounts: TikTokAccountState[]; redirectUri: string | null }

/** Unified inbox (D). commentId keys: IG raw id | 'fbc-<id>' | 'th-<id>' | 'ytc-<id>'. */
export type InboxStatus = 'open' | 'replied' | 'done' | 'ignored';
export type InboxSentiment = 'positive' | 'neutral' | 'negative' | 'question' | 'complaint' | 'spam';
export interface InboxListParams {
  status?: InboxStatus | 'unanswered' | 'overdue' | 'all'; platforms?: Platform[]; accountIds?: string[]; sentiment?: InboxSentiment[]; assignee?: string | null;
  question?: boolean; q?: string; from?: string; to?: string; sort?: 'newest' | 'oldest' | 'overdue'; cursor?: string | null; limit?: number;
}
export interface InboxRow {
  commentId: string; externalId: string; mediaId: string; accountId: string; platform: Platform; accountUsername: string;
  username: string; authorId: string | null; text: string; createdAt: number; likeCount: number; permalink: string | null; isHidden: boolean;
  post: { caption: string | null; permalink: string | null; thumb: string | null; mediaType: string | null; mediaProductType: string | null };
  status: InboxStatus; assignee: string | null; firstResponseAt: number | null; overdue: boolean; isQuestion: boolean;
  sentiment: InboxSentiment | null; replies: number; aiDisabled: boolean;
}
export interface InboxCounts { open: number; replied: number; done: number; overdue: number }
export interface InboxListResult { items: InboxRow[]; nextCursor: string | null; counts: InboxCounts }
export interface InboxOutboxRow { id: number; commentId: string; body: string; status: 'sending' | 'sent' | 'failed'; remoteId: string | null; errorCode: string | null; error: string | null; attempts: number; author: string | null; createdAt: number; sentAt: number | null }
export interface InboxThread { root: InboxRow; replies: (InboxRow & { isFromOwner: boolean })[]; outbox: InboxOutboxRow[]; notes?: NoteV2[] }
export interface InboxCapability { accountId: string; platform: Platform; read: boolean; reply: boolean; hide: boolean; maxReplyLength: number | null; missingScopes: string[] }
export interface InboxSlaRow { accountId: string; platform: Platform; incoming: number; answered: number; answeredPct: number | null; withinSlaPct: number | null; medianFrtMin: number | null; p90FrtMin: number | null; backlog: number }
export interface InboxSla { slaHours: number; totals: Omit<InboxSlaRow, 'accountId' | 'platform'>; rows: InboxSlaRow[] }
export interface InboxUpdatedEvent { commentIds?: string[]; accountIds?: string[]; reason: 'poll' | 'reply' | 'status' | 'assign' | 'hide' | 'classify' | string }

/** Self-hosted publish worker (E). Executor applies per planner target. */
export type WorkerExecutor = 'local' | 'worker';
export interface WorkerToken { tokenKey: string; platform: Platform; accountId: string; scopes: string[]; expiresAt: number | null; pushedAt: number | null; status: 'ok' | 'expiring' | 'invalid' | 'missing' | string }
export interface WorkerState {
  configured: boolean; enabled: boolean; url: string | null; defaultExecutor: WorkerExecutor; lastSyncAt: number | null; lastError: string | null;
  info: { version: string; time: number; tz: string; queue: { queued: number; publishing: number; failed: number }; publicMediaUrl: boolean } | null;
  tokens: WorkerToken[];
}
export interface WorkerPairing { secret: string; envSnippet: string; pairing: string }
export interface WorkerStatusEvent { configured: boolean; state: 'idle' | 'syncing' | 'error' | 'offline'; lastSyncAt: number | null; lastError: string | null; queue: { queued: number; publishing: number; failed: number } | null }

/** Team workspace, roles and session (F1). */
export type Role = 'admin' | 'analyst' | 'client';
export interface Session { role: Role; clientScope: string[] | null; readOnly: boolean; workspace: 'local' | string }
export interface TeamMember { id: string; name: string; handle: string; role: Role; isSelf: boolean; updatedAt: number | null }
export interface TeamState {
  mode: 'none' | 'publisher' | 'subscriber'; teamId: string | null; name: string | null; folder: string | null; encrypted: boolean;
  me: TeamMember | null; members: TeamMember[]; lastPublishAt: number | null; lastPullAt: number | null; snapshotAt: number | null; publisher: string | null; error: string | null;
}
export interface TeamStatusEvent { state: 'idle' | 'publishing' | 'pulling' | 'error'; lastPublishAt: number | null; lastPullAt: number | null; error: string | null }
export interface NoteV2 extends Note { uid: string; author_id: string | null; author_name: string | null; mentions: string[]; visibility: 'internal' | 'client'; updated_at: number | null; deleted_at: number | null }

/** Command-line tool (F2). */
export interface CliStatus { installed: boolean; shimPath: string | null; onPath: boolean; command: string; platform: string }
