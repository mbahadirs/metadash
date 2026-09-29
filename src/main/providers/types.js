/**
 * JSDoc contracts for the provider layer (no runtime code).
 *
 * @typedef {'instagram'|'facebook'|'threads'} Platform
 * @typedef {'meta'|'threads'} AuthPlatform
 *
 * @typedef {Object} SyncContext
 * @prop {(auth: AuthPlatform) => string} tokenFor      cached token per auth profile; throws MetaError 190 when missing
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
 */
export {};
