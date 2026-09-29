import crypto from 'node:crypto';

/**
 * Planner post status machine (pure). See plan §3.
 *  draft → in_review | scheduled (scheduled only when approval is not required)
 *  in_review → approved | changes_requested | draft
 *  changes_requested → in_review | draft
 *  approved → scheduled | draft
 *  scheduled → draft (unschedule) | publishing (worker only)
 *  publishing → published | partial | failed (worker/system only; derived from targets)
 *  failed | partial → scheduled (retry)
 *  any state except publishing → archived; archived → draft (restore)
 */
export const POST_STATUSES = Object.freeze([
  'draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'archived',
]);

export const TARGET_STATES = Object.freeze([
  'idle', 'queued', 'hosting', 'container', 'ready', 'handed_off', 'publishing', 'commenting', 'published', 'failed', 'canceled', 'missed', 'paused',
]);

/** Target states the worker is done with. */
export const TERMINAL_TARGET_STATES = Object.freeze(['published', 'failed', 'canceled', 'missed']);
/** Target states in which a remote call may be in flight (never touch them from the UI). */
export const IN_FLIGHT_TARGET_STATES = Object.freeze(['hosting', 'container', 'publishing', 'commenting']);

const TRANSITIONS = Object.freeze({
  draft: ['in_review', 'scheduled'],
  in_review: ['approved', 'changes_requested', 'draft'],
  changes_requested: ['in_review', 'draft'],
  approved: ['scheduled', 'draft'],
  scheduled: ['draft', 'publishing'],
  publishing: ['published', 'partial', 'failed'],
  failed: ['scheduled'],
  partial: ['scheduled'],
  published: [],
  archived: ['draft'],
});

const WORKER_ONLY = new Set(['publishing', 'published', 'partial', 'failed']);
const MACHINE_ACTORS = new Set(['worker', 'system']);

/**
 * @param {string} from
 * @param {string} to
 * @param {{ requireApproval?: boolean, actor?: 'user'|'worker'|'system'|'client' }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: 'unknown_status'|'same_status'|'transition_not_allowed'|'worker_only'|'approval_required' }}
 */
export function checkTransition(from, to, { requireApproval = false, actor = 'user' } = {}) {
  if (!POST_STATUSES.includes(from) || !POST_STATUSES.includes(to)) return { ok: false, reason: 'unknown_status' };
  if (from === to) return { ok: false, reason: 'same_status' };
  const allowed = to === 'archived' ? from !== 'publishing' : TRANSITIONS[from].includes(to);
  if (!allowed) return { ok: false, reason: 'transition_not_allowed' };
  if (WORKER_ONLY.has(to) && !MACHINE_ACTORS.has(actor)) return { ok: false, reason: 'worker_only' };
  if (from === 'draft' && to === 'scheduled' && requireApproval) return { ok: false, reason: 'approval_required' };
  return { ok: true };
}

export function canTransition(from, to, opts) {
  return checkTransition(from, to, opts).ok;
}

/**
 * Status after a content change (caption, media, targets, first comment). Time-only changes never call this.
 * @returns {{ status: string, invalidated: boolean }} invalidated = approval was withdrawn (audit `approval_invalidated`)
 */
export function applyContentEdit({ status, requireApproval = false }) {
  if (requireApproval && (status === 'approved' || status === 'scheduled')) return { status: 'in_review', invalidated: true };
  return { status, invalidated: false };
}

export function isApprovalCurrent({ version, approvedVersion }) {
  return approvedVersion != null && approvedVersion === version;
}

/**
 * Outcome of a publishing run from its targets. Canceled targets are ignored.
 * @returns {'published'|'partial'|'failed'|null} null while any target is still pending (or there is nothing to judge)
 */
export function derivePostStatus(targets) {
  const active = (targets ?? []).filter((t) => t.state !== 'canceled');
  if (!active.length) return null;
  if (!active.every((t) => TERMINAL_TARGET_STATES.includes(t.state))) return null;
  const published = active.filter((t) => t.state === 'published').length;
  if (published === active.length) return 'published';
  return published > 0 ? 'partial' : 'failed';
}

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  return value ?? null;
};

/**
 * Hash of everything that counts as content: caption, first comment, targets (account, format, overrides, options) and
 * media (asset, role, position, alt text). Title, notes, labels, client and time are not content.
 * @param {{ caption?: string, firstComment?: string|null, targets?: object[], assets?: object[] }} post
 */
export function contentHash({ caption, firstComment, targets = [], assets = [] }) {
  const t = targets
    .map((x) => stable({ accountId: String(x.accountId), format: x.format ?? null, captionOverride: x.captionOverride ?? null, firstCommentOverride: x.firstCommentOverride ?? null, options: x.options ?? null }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
  const a = assets
    .map((x) => ({ assetId: Number(x.assetId), role: x.role ?? 'media', position: Number(x.position ?? 0), altText: x.altText ?? null }))
    .sort((p, q) => p.role.localeCompare(q.role) || p.position - q.position);
  const payload = JSON.stringify({ c: caption ?? '', f: firstComment ?? null, t, a });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
