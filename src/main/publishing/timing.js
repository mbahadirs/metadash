import { LIMITS } from './limits.js';

/**
 * Pure timing rules for the publishing worker (plan §6.7).
 *  lead:        IG/Threads video (reel, video story, carousel with video, Threads video) 30 min; IG/Threads images 5 min;
 *               text and Facebook app mode 0 (the publish call itself uploads).
 *  reconcile:   FB native posts are checked at T+5 min, T+30 min, then hourly until T+24 h.
 */
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const LEAD_VIDEO_MS = 30 * MIN;
export const LEAD_IMAGE_MS = 5 * MIN;
export const POLL_MS = 20_000;
export const CONTAINER_TIMEOUT_MS = 20 * MIN;
export const RECOVER_DELAY_MS = 2 * MIN;
export const UNCERTAIN_WAIT_MS = 5 * MIN;
export const RECONCILE_WINDOW_MS = 24 * HOUR;
export const MAX_TIMER_MS = 60_000;
export const QUOTA_CACHE_MS = 10 * MIN;

/**
 * @param {{ platform: string, format: string, mode?: string }} target
 * @param {{ kind: 'image'|'video' }[]} media
 */
export function leadFor(target, media = []) {
  if (target.platform === 'facebook') return 0;
  if (target.format === 'text' || target.format === 'link' || !media.length) return 0;
  return media.some((m) => m.kind === 'video') ? LEAD_VIDEO_MS : LEAD_IMAGE_MS;
}

/** When the worker should first pick a newly queued target up. FB native → now (immediate hand-off). */
export function firstAttemptAt({ target, scheduledAt, media, now }) {
  if (target.mode === 'native') return now;
  if (scheduledAt == null) return now;
  return scheduledAt - leadFor(target, media);
}

/** Next FB native reconcile time after `now`, or null once the 24 h window is over. */
export function nextReconcileAt(scheduledAt, now) {
  const offsets = [5 * MIN, 30 * MIN];
  for (let h = 1; h <= 24; h += 1) offsets.push(h * HOUR);
  for (const off of offsets) if (scheduledAt + off > now) return scheduledAt + off;
  return null;
}

/** FB native scheduling window (limits.js). */
export function nativeWindow(now) {
  return { min: now + LIMITS.facebook.nativeMinLeadMin * MIN, max: now + LIMITS.facebook.nativeMaxLeadDays * 24 * HOUR };
}

export const insideNativeWindow = (at, now) => {
  const w = nativeWindow(now);
  return at != null && at >= w.min && at <= w.max;
};
