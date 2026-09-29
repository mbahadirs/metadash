import { getConfig } from '../config/store.js';
import { getQuota, scheduledForAccounts } from '../db/queries/planner.js';
import { validate } from '../publishing/validate.js';

/**
 * Builds the `context` for publishing/validate.js from config and the DB, and validates stored posts.
 * Chunk B plugs in publish readiness with extendValidationContext((ctx) => ({ missingScopes: { instagram: [...] } })).
 */
const HOUR = 3_600_000;
let extenders = [];

/** Registers a context extender; returns an unregister function. Extenders must be synchronous and cheap. */
export function extendValidationContext(fn) {
  extenders = [...extenders, fn];
  return () => { extenders = extenders.filter((f) => f !== fn); };
}

export function buildValidationContext({ accountIds = [], scheduledAt = null } = {}) {
  const mediaHost = getConfig('planner.mediaHost') ?? { type: 'none' };
  const minGapHours = Number(getConfig('planner.minGapHours')) || 0;
  const quota = Object.fromEntries(accountIds.map((id) => [id, getQuota(id)]).filter(([, v]) => v));
  const gap = minGapHours * HOUR;
  const existing = scheduledAt != null && gap > 0 && accountIds.length ? scheduledForAccounts({ accountIds, from: scheduledAt - gap, to: scheduledAt + gap + 1 }) : [];
  const base = { mediaHostType: mediaHost?.type ?? 'none', minGapHours, quota, existing };
  return extenders.reduce((ctx, fn) => {
    try { return { ...ctx, ...(fn(ctx) ?? {}) }; } catch (e) { console.error('[planner] validation context extender failed:', e); return ctx; }
  }, base);
}

/** Post assets ([{ assetId, role, altText, asset }]) → validate()'s asset shape. */
export function assetsForValidation(items) {
  return items.map((it) => ({ ...it.asset, id: it.assetId, role: it.role, altText: it.altText }));
}

/** Validates a post as stored (getPost shape) or a composer draft with the same shape. @returns {import('../publishing/validate.js').Issue[]} */
export function validatePostLike(post, { now = Date.now() } = {}) {
  const targets = post.targets ?? [];
  const context = buildValidationContext({ accountIds: [...new Set(targets.map((t) => t.accountId))], scheduledAt: post.scheduledAt ?? null });
  return validate({
    post: { id: post.id ?? null, caption: post.caption ?? '', firstComment: post.firstComment ?? null, scheduledAt: post.scheduledAt ?? null },
    targets,
    assets: assetsForValidation(post.assets ?? []),
    now,
    context,
  });
}
