import { publishError } from '../errors.js';
import { isChildrenRef } from './shared.js';

/**
 * Simulated publisher for demo mode: no network. Containers finish 2–4 s after creation, publishing returns fake ids
 * and the permalink of the account's latest synced post (ctx.latestMedia), FB native posts "go live" at their time.
 * METADASH_DEMO_FAIL_RATE (0–1, dev only) makes that share of publishes fail.
 */
const DEMO_QUOTA = { used: 3, total: 100, windowSec: 86_400 };

const delayFor = (targetId) => 2000 + ((Number(targetId) * 7919) % 2001);
const createdAt = (containerId) => Number(String(containerId).split('_').pop()) || 0;

function failRate() {
  if (process.env.NODE_ENV === 'production') return 0;
  const r = Number(process.env.METADASH_DEMO_FAIL_RATE ?? 0);
  return Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
}

function latest(ctx, job) {
  const m = ctx.latestMedia?.(job.target.accountId) ?? null;
  return { permalink: m?.permalink ?? null };
}

export function createDemoPublisher(platform) {
  const now = (ctx) => (ctx.now ? ctx.now() : Date.now());
  return {
    platform,
    demo: true,
    nativeSchedule: platform === 'facebook',
    direct: false,
    firstPollDelayMs: 2000,
    imageVariant: () => null,
    hostedItems: () => [],
    optionalHosted: () => [],
    needsPrepare: (target) => !target.containerId || isChildrenRef(target.containerId),

    async prepare(ctx, job) {
      if (job.target.containerId && !isChildrenRef(job.target.containerId)) return { containerId: job.target.containerId };
      return { containerId: `demo_c${job.target.id}_${now(ctx)}` };
    },

    async status(ctx, job) {
      const done = now(ctx) - createdAt(job.target.containerId) >= delayFor(job.target.id);
      return { status: done ? 'FINISHED' : 'IN_PROGRESS', message: null };
    },

    async publish(ctx, job) {
      if (Math.random() < failRate()) throw publishError('pub_demo_fail', {}, { kind: 'media', code: 'demo_fail' });
      return { remoteId: `demo_${job.target.id}_${now(ctx)}`, permalink: latest(ctx, job).permalink, mediaKey: null };
    },

    async scheduleNative(ctx, job) {
      return { containerId: `demo_fb_${job.target.id}` };
    },

    async reconcile(ctx, job) {
      const published = job.post.scheduledAt != null && now(ctx) >= job.post.scheduledAt;
      return { published, remoteId: job.target.containerId, permalink: published ? latest(ctx, job).permalink : null, mediaKey: null };
    },

    async reschedule() {},
    async cancelNative() {},
    async recover() { return { notPublished: true }; },
    async firstComment(ctx, job) { return { id: `demo_comment_${job.target.id}` }; },
    async quota() { return { ...DEMO_QUOTA }; },
  };
}
