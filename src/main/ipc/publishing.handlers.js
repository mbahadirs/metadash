import { notImplemented } from './notImplemented.js';

/**
 * Publishing channels — STUBS (v1.4 chunk A). Chunk B replaces this file; keep the export names
 * `registerPublishingHandlers(handle)` and `PUBLISHING_CHANNELS`. Contract (types in renderer lib/types.ts):
 *  publishing:schedule        ({ id }) → { queued: number, handedOff: number, warnings: Issue[] }   enforces status machine + validation errors
 *  publishing:unschedule      ({ id }) → null
 *  publishing:publishNow      ({ id, targetIds? }) → null
 *  publishing:queue           ({ states? }?) → QueueItem[]
 *  publishing:retry           ({ targetId }) → null
 *  publishing:cancel          ({ targetId }) → null
 *  publishing:missed          () → QueueItem[]
 *  publishing:resolveMissed   ({ targetIds, action: 'publish'|'reschedule'|'skip', scheduledAt? }) → null
 *  publishing:quota           ({ accountId, refresh? }) → { used, total, windowSec, checkedAt }
 *  publishing:readiness       () → PublishingReadiness
 *  publishing:status          () → { paused, running, nextAt, inFlight }
 *  publishing:setPaused       (boolean) → null
 *  publishing:mediaHost:get   () → MediaHostSettings (no secrets; keySet: { last4 } | null)
 *  publishing:mediaHost:set   ({ type, s3?, accessKeyId?, secretAccessKey? }) → null
 *  publishing:mediaHost:test  () → { ok, url, status, ms, error? }
 * Events emitted by B on progressBus: 'publish:progress' { targetId, postId, state, pct? }, 'publish:missed' { count },
 * and 'planner:changed' { postIds, reason } after target/post state changes.
 */
export const PUBLISHING_CHANNELS = [
  'publishing:schedule', 'publishing:unschedule', 'publishing:publishNow', 'publishing:queue', 'publishing:retry', 'publishing:cancel',
  'publishing:missed', 'publishing:resolveMissed', 'publishing:quota', 'publishing:readiness', 'publishing:status', 'publishing:setPaused',
  'publishing:mediaHost:get', 'publishing:mediaHost:set', 'publishing:mediaHost:test',
];

export function registerPublishingHandlers(handle) {
  for (const channel of PUBLISHING_CHANNELS) handle(channel, () => { throw notImplemented(); });
}
