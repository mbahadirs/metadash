/**
 * JSDoc contracts for the provider layer (no runtime code).
 *
 * @typedef {'instagram'|'facebook'|'threads'|'youtube'|'tiktok'} Platform
 * @typedef {'meta'|'threads'|'google'|'tiktok'} AuthPlatform
 *
 * @typedef {Object} ProviderMeta          static, pure (providers/<p>/meta.js); capabilities.js derives its tables from it
 * @prop {Platform} platform
 * @prop {string} label                    brand name, never translated
 * @prop {AuthPlatform} auth
 * @prop {string} keyPrefix                account-key prefix ('' | 'fb-' | 'th-' | 'yt-' | 'tt-'); unique
 * @prop {boolean} multiProfile            one profiles row per channel/account (external_id), token via ctx.tokenForAccount
 * @prop {boolean} experimental
 * @prop {'reach'|'views'} primaryMetric
 * @prop {Capabilities} capabilities
 * @prop {ProviderKpis} [kpis]             required for non-built-in platforms (built-ins live in analytics/platform.js)
 * @prop {Record<string, 'percent'|'count'>} [demographicsUnit]  unit of account_demographics.value per dimension
 *
 * @typedef {Object} Capabilities          schema: providers/capabilities.js CAPABILITY_SCHEMA
 * @prop {boolean} reach @prop {boolean} saveRate @prop {boolean} stories @prop {boolean} demographics
 * @prop {boolean} competitors @prop {boolean} comments @prop {boolean} ads
 * @prop {boolean} inbox @prop {boolean|'scope'} inboxReply @prop {boolean} watchTime
 * @prop {'native'|'derived'|'none'} dailySeries @prop {boolean} experimental
 *
 * @typedef {Object} ProviderKpis          Account page / report vocabulary for a platform (analytics/platform.js)
 * @prop {string[]} keys                   ordered KPI keys of accountAnalytics().kpis ('posts','er','newFollowers' are generic)
 * @prop {string[]} chart                  [primary, secondary] daily metrics drawn on the account chart
 * @prop {string[]} daily                  canonical daily metrics stored in account_insights_daily
 * @prop {Record<string,string>} dailyMetric  KPI key → daily metric summed for it
 *
 * @typedef {Object} SyncContext
 * @prop {(auth: AuthPlatform) => string} tokenFor      cached token per single-profile auth; throws MetaError 190 when missing
 * @prop {(account: object) => Promise<string>} tokenForAccount  token for an account's own profile (accounts.profile_id);
 *   multi-profile auths refresh through provider.refreshToken when < 5 min remain. Throws an auth error (MetaError 190,
 *   source = auth) when missing/revoked. Single-profile auths resolve to tokenFor(auth).
 * @prop {string} token                                 Meta user token (legacy; ads/stories/competitor jobs)
 * @prop {Map<string, string>} pageTokens               Facebook Page tokens cached per page id for this run
 * @prop {object} settings                              getAllConfig()
 * @prop {AbortSignal} signal
 * @prop {(phase: string) => void} report
 * @prop {(e: {igId?:string, endpoint?:string, code?:number, message:string, platform?:string}) => void} log
 *
 * @typedef {Object} DiscoveredAccount
 * @prop {string} accountId       account key (igId column)
 * @prop {string} externalId      raw API id
 * @prop {string} username
 * @prop {string} [name]
 * @prop {string} [profilePicUrl]
 * @prop {number} [followers]
 *
 * @typedef {Object} Profile
 * @prop {string} username
 * @prop {string} [name]
 * @prop {string} [profilePicUrl]
 * @prop {string} [biography]
 * @prop {string} [website]
 * @prop {number} [followers]
 * @prop {number} [follows]
 * @prop {number} [mediaCount]
 *
 * @typedef {Object} Post
 * @prop {string} mediaId         stored key (IG id; FB 'pageid_postid'; Threads 'th-<id>')
 * @prop {string} externalId      raw API id used for /insights
 * @prop {string} mediaType       IMAGE | VIDEO | CAROUSEL_ALBUM | TEXT_POST | TEXT | LINK | STATUS | ...
 * @prop {string} mediaProductType FEED | REELS | STORY | FB_POST | THREADS
 * @prop {string} caption
 * @prop {string} [permalink]
 * @prop {string} [thumbnailUrl]
 * @prop {string} timestamp       ISO date
 * @prop {{likes?:number, comments?:number, shares?:number}} [inline]  counts from the list call; insights values win
 *
 * @typedef {Object} Provider
 * @prop {Platform} platform
 * @prop {boolean} enabled                     false = stub; skipped by the registry
 * @prop {AuthPlatform} auth
 * @prop {number} concurrency                  IG 2, FB 2, Threads 1
 * @prop {object} capabilities                 see providers/capabilities.js
 * @prop {'reach'|'views'} primaryMetric
 * @prop {string} labelSuffix                  '' | ' (FB)' | ' (Threads)' — sync progress labels
 * @prop {(externalId: string) => string} accountKey
 * @prop {(ctx: SyncContext) => Promise<{items: DiscoveredAccount[], warnings: object[]}>} discover
 * @prop {(ctx: SyncContext, account: object) => Promise<object>} [prepare]            e.g. Facebook page token
 * @prop {(ctx: SyncContext, account: object) => Promise<Profile>} fetchProfile
 * @prop {(ctx: SyncContext, account: object, w: {sinceUnix:number, untilUnix:number, disabled?:string[], overrides?:object}) =>
 *   Promise<{series: Record<string, {date:string, value:number}[]>, dropped: {metric:string, message:string}[]}>} fetchDailyInsights
 * @prop {(ctx: SyncContext, account: object, o: {sinceUnix:number, max?:number}) => Promise<Post[]>} fetchPosts
 * @prop {(ctx: SyncContext, post: {mediaId:string, externalId:string, mediaType:string, mediaProductType:string},
 *   o: {account: object, disabled?:string[], overrides?:object}) =>
 *   Promise<{values: Record<string, number>, dropped: {metric:string, message:string}[]}>} fetchPostInsights
 * @prop {(post: {mediaType:string, mediaProductType:string}) => boolean} [skipInsights]   IG STORY; Threads REPOST_FACADE
 * @prop {(ctx: SyncContext, account: object, o?: {disabled?:string[], overrides?:object}) =>
 *   Promise<{dimensions: Record<string, {bucket:string, value:number}[]>, dropped: {metric:string, message:string}[]}>} [fetchDemographics]
 * @prop {(ctx: SyncContext, post: {mediaId:string, externalId:string}, o: {account: object}) => Promise<object[]>} [fetchComments]
 *   IG comment shape: {id, text, timestamp, like_count, username, replies:{data:[{id,timestamp,username,text}]}}
 * @prop {{windowDays:number, maxLookbackDays:number, initialDays?:number, minSinceUnix?:number}} dailyWindow
 * @prop {() => Promise<void>} [maintenance]   run by the scheduler before each tick (Threads token refresh)
 * @prop {object} client                       Graph client from createGraphClient
 *
 * v2.0 optional hooks (chunk B contract):
 * @prop {ProviderMeta} meta
 * @prop {boolean} [contract]                  stub providers: still checked by tests/providers.contract.test.js
 * @prop {(ctx: SyncContext, account: object, posts: {mediaId:string, externalId:string, mediaType:string, mediaProductType:string}[],
 *   o: {disabled?:string[], overrides?:object}) => Promise<{values: Record<string, Record<string, number>>, dropped: object[]}>} [fetchPostInsightsBatch]
 *   values keyed by mediaId; platformAccount.js uses it instead of per-post fetchPostInsights when present
 * @prop {(profile: object) => Promise<{token:string, expiresAt:number|null, refreshToken?:string}>} [refreshToken]
 *   multi-profile auths: refresh an access token from profile.refresh_ref; throw an auth error on invalid_grant
 * @prop {InboxAdapter|null} [inbox]           comments adapter for the unified inbox (capabilities.inbox)
 * @prop {ReportSection[]} [reportSections]    extra report sections (export/reportSections/index.js)
 * @prop {{seed: (o:{now:Date, rng:() => number}) => object, extendDay?: (key:string, r:() => number, date:string) => void}|null} [demo]
 *   demo data (seed/index.js provider registry); seed must create its own demo profile row (token_ref 'demo:<auth>:…')
 * @prop {string} [connectionCard]             renderer component key in routes/Settings/connections/index.ts
 * (dailyWindow may carry refetchTrailingDays: re-upsert the last N days each sync — revised data, e.g. YouTube Analytics)
 *
 * @typedef {Object} NormalizedComment
 * @prop {string} commentId        stored key: IG raw id | 'fbc-<id>' | 'th-<id>' | 'ytc-<id>'
 * @prop {string} externalId       raw API id (used for replies / hide)
 * @prop {string} mediaId          media.media_id
 * @prop {string} accountId        account key
 * @prop {Platform} platform
 * @prop {string|null} parentId    commentId of the top-level comment for replies
 * @prop {string|null} authorId
 * @prop {string} username
 * @prop {string} text
 * @prop {number} likeCount
 * @prop {number} createdAt        epoch ms
 * @prop {boolean} isFromOwner
 * @prop {string|null} permalink
 * @prop {boolean} isHidden
 *
 * @typedef {Object} InboxAdapter
 * @prop {(ctx: SyncContext, account: object, post: {mediaId:string, externalId:string}, o: {sinceUnix?:number}) => Promise<NormalizedComment[]>} fetch
 * @prop {(ctx: SyncContext, account: object, comment: NormalizedComment, text: string) => Promise<{remoteId:string, createdAt:number}>} [reply]
 * @prop {(ctx: SyncContext, account: object, comment: NormalizedComment, hidden: boolean) => Promise<void>} [hide]
 * @prop {{read: string[], reply: string[], hide: string[]}} scopes
 * @prop {number} maxReplyLength
 *
 * @typedef {Object} ReportSection
 * @prop {string} key                          unique section key (sections[key] === false disables it)
 * @prop {string[]} templates                  report templates it joins ('monthly', 'weekly_client', 'custom', …)
 * @prop {Platform[]} [platforms]              only for accounts of these platforms (omit = every platform)
 * @prop {keyof Capabilities} [capability]     only when the platform has this capability
 * @prop {(c: {L:Function, lang:string, analysis:object, igId:string, from:string, to:string}) => string} html
 * @prop {(c: {L:Function, lang:string, analysis:object, igId:string, from:string, to:string}) => object[]} [sheets]  xlsx sheets
 */
export {};
