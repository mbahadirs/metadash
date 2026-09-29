import instagram from './instagram.js';
import facebook from './facebook.js';
import threads from './threads.js';
import { createDemoPublisher } from './demo.js';

/**
 * Publisher registry (separate from the analytics providers). Publisher interface (plan §6.2, as implemented):
 *   platform, nativeSchedule, direct (no container step), firstPollDelayMs
 *   imageVariant(item) → { variant, maxWidth, format } | null     conversion needed before hosting
 *   hostedItems(job) → MediaItem[]    items that must get a public URL;  optionalHosted(job) → items hosted if possible
 *   needsPrepare(target) → boolean     container missing or still waiting for children
 *   prepare(ctx, job) → { containerId, pending? }
 *   status(ctx, job) → { status: 'IN_PROGRESS'|'FINISHED'|'ERROR'|'EXPIRED'|'PUBLISHED', message }
 *   publish(ctx, job) → { remoteId, permalink, mediaKey }
 *   recover(ctx, job, { since }) → { found } | { notPublished } | null (inconclusive)
 *   scheduleNative / reconcile / reschedule / cancelNative (Facebook)
 *   firstComment(ctx, job, text) → { id };  quota(ctx, account) → { used, total, windowSec }
 */
const PUBLISHERS = { instagram, facebook, threads };
const demo = Object.fromEntries(Object.keys(PUBLISHERS).map((p) => [p, createDemoPublisher(p)]));

export function getPublisher(platform, { demo: isDemo = false } = {}) {
  return (isDemo ? demo[platform] : PUBLISHERS[platform]) ?? null;
}

export { instagram, facebook, threads, createDemoPublisher };
