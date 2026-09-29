import { toId } from '../planner/input.js';
import { plannerError } from '../db/queries/planner.js';
import {
  schedule, unschedule, publishNow, queue, retry, cancel, missed, resolveMissed, quota, setPaused,
} from '../publishing/actions.js';
import { getReadiness, registerReadinessValidation } from '../publishing/readiness.js';
import { getMediaHostSettings, setMediaHostSettings, createMediaHost, recordHostTest } from '../publishing/hosts/index.js';
import { publishingStatus, wake } from '../publishing/worker.js';

/**
 * Publishing channels (v1.4 chunk B). Types in renderer lib/types.ts.
 *  publishing:schedule        ({ id }) → { queued, handedOff, warnings: Issue[] }   status machine + validation errors
 *                             (error codes: NO_TIME, TIME_PAST, VALIDATION_FAILED, APPROVAL_REQUIRED, STATUS_NOT_ALLOWED, POST_LOCKED)
 *  publishing:unschedule      ({ id }) → null      (FB native posts are deleted on Facebook; POST_LOCKED while publishing)
 *  publishing:publishNow      ({ id, targetIds? }) → null   (post time → now, targets in app mode)
 *  publishing:queue           ({ states? }?) → QueueItem[]
 *  publishing:retry           ({ targetId }) → null
 *  publishing:cancel          ({ targetId }) → null
 *  publishing:missed          () → QueueItem[]
 *  publishing:resolveMissed   ({ targetIds, action: 'publish'|'reschedule'|'skip', scheduledAt? }) → null
 *  publishing:quota           ({ accountId, refresh? }) → { used, total, windowSec, checkedAt }
 *  publishing:readiness       () → PublishingReadiness   (Meta scopes cached 10 min; also feeds validation)
 *  publishing:status          () → { paused, running, nextAt, inFlight }
 *  publishing:setPaused       (boolean) → null
 *  publishing:mediaHost:get   () → MediaHostSettings (+ baseUrl, pageId; no secrets; keySet: { last4 } | null)
 *  publishing:mediaHost:set   ({ type, s3?, accessKeyId?, secretAccessKey?, baseUrl?, pageId? }) → MediaHostSettings
 *  publishing:mediaHost:test  () → { ok, url, status, ms, error? }
 * Events on progressBus: 'publish:progress' { targetId, postId, state }, 'publish:missed' { count },
 * 'planner:changed' { postIds, reason, source: 'worker' } after target/post state changes.
 */
export const PUBLISHING_CHANNELS = [
  'publishing:schedule', 'publishing:unschedule', 'publishing:publishNow', 'publishing:queue', 'publishing:retry', 'publishing:cancel',
  'publishing:missed', 'publishing:resolveMissed', 'publishing:quota', 'publishing:readiness', 'publishing:status', 'publishing:setPaused',
  'publishing:mediaHost:get', 'publishing:mediaHost:set', 'publishing:mediaHost:test',
];

const MAX_TARGET_IDS = 500;
const ACTIONS = new Set(['publish', 'reschedule', 'skip']);

const idOf = (p) => toId(typeof p === 'object' && p !== null ? p.id : p);
const targetIdOf = (p) => toId(typeof p === 'object' && p !== null ? p.targetId : p, 'targetId');

function targetIdList(list) {
  if (list == null) return undefined;
  if (!Array.isArray(list) || list.length > MAX_TARGET_IDS) throw plannerError('planner_invalid_payload', 'INVALID_PAYLOAD', { field: 'targetIds' });
  return list.map((x) => toId(x, 'targetIds'));
}

export function registerPublishingHandlers(handle) {
  registerReadinessValidation();

  handle('publishing:schedule', (p) => schedule(idOf(p)));
  handle('publishing:unschedule', (p) => unschedule(idOf(p)));
  handle('publishing:publishNow', (p = {}) => publishNow({ id: idOf(p), targetIds: targetIdList(p?.targetIds) }));
  handle('publishing:queue', (p) => queue({ states: Array.isArray(p?.states) ? p.states.slice(0, 20) : undefined }));
  handle('publishing:retry', (p) => retry(targetIdOf(p)));
  handle('publishing:cancel', (p) => cancel(targetIdOf(p)));
  handle('publishing:missed', () => missed());

  handle('publishing:resolveMissed', (p = {}) => {
    if (!ACTIONS.has(p?.action)) throw plannerError('planner_invalid_payload', 'INVALID_PAYLOAD', { field: 'action' });
    const scheduledAt = p.scheduledAt == null ? undefined : Number(p.scheduledAt);
    return resolveMissed({ targetIds: targetIdList(p.targetIds) ?? [], action: p.action, scheduledAt });
  });

  handle('publishing:quota', (p = {}) => {
    if (typeof p?.accountId !== 'string' || !p.accountId) throw plannerError('planner_invalid_payload', 'INVALID_PAYLOAD', { field: 'accountId' });
    return quota({ accountId: p.accountId, refresh: p.refresh === true });
  });

  handle('publishing:readiness', (p) => getReadiness({ force: p?.force === true }));
  handle('publishing:status', () => publishingStatus());

  handle('publishing:setPaused', (p) => setPaused(typeof p === 'object' && p !== null ? p.paused === true : p === true));

  handle('publishing:mediaHost:get', () => getMediaHostSettings());

  handle('publishing:mediaHost:set', (p) => {
    if (!p || typeof p !== 'object') throw plannerError('planner_invalid_payload', 'INVALID_PAYLOAD', { field: 'mediaHost' });
    const saved = setMediaHostSettings(p);
    wake();
    return saved;
  });

  handle('publishing:mediaHost:test', async () => {
    const started = Date.now();
    let res;
    try {
      const host = createMediaHost();
      res = host ? await host.test() : { ok: false, url: null, status: null, ms: 0, error: 'none' };
    } catch (e) {
      res = { ok: false, url: null, status: null, ms: Date.now() - started, error: e?.message ?? String(e) };
    }
    recordHostTest(res);
    return res;
  });
}
