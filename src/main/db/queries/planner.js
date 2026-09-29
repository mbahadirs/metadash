import { q } from '../index.js';
import { msg } from '../../i18n.js';
import {
  checkTransition, applyContentEdit, contentHash, TERMINAL_TARGET_STATES, IN_FLIGHT_TARGET_STATES,
} from '../../planner/status.js';

/**
 * Planner persistence: posts, targets, assets, audit, uploads, approval packs, quota cache (migration 009).
 * Times are UTC ms. Every write that changes a post writes an audit row.
 */
const LIST_LIMIT = 2000;
const LEASE_STALE_MS = 600_000;
const PREVIEW_CHARS = 140;
/** Targets that must never be deleted/reset by an edit (remote state exists or a call may be in flight). */
const LOCKED_TARGET_STATES = new Set([...IN_FLIGHT_TARGET_STATES, 'handed_off', 'published']);
/** App-mode targets whose container was built from the old content; they go back to `queued` (next_attempt_at kept). */
const PREPARED_STATES = new Set(['queued', 'ready']);

export function plannerError(key, code, vars) {
  return Object.assign(new Error(msg(key, vars)), { code });
}

const parseJson = (s, fallback) => { if (s == null || s === '') return fallback; try { return JSON.parse(s); } catch { return fallback; } };
const toJson = (v) => (v == null ? null : JSON.stringify(v));
const refFor = (id) => `P-${String(id).padStart(4, '0')}`;
const placeholders = (arr) => arr.map(() => '?').join(',');

// ---- mappers --------------------------------------------------------------------------------------------------
function mapPost(r) {
  return {
    id: r.id, ref: r.ref, title: r.title, caption: r.caption, firstComment: r.first_comment, status: r.status,
    scheduledAt: r.scheduled_at, timezone: r.timezone, clientName: r.client_name, labels: parseJson(r.labels, []), notes: r.notes,
    version: r.version, approvedVersion: r.approved_version, approvedBy: r.approved_by, approvedAt: r.approved_at,
    source: r.source, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
  };
}

export function mapTarget(r) {
  return {
    id: r.id, postId: r.post_id, accountId: r.account_id, platform: r.platform, format: r.format,
    captionOverride: r.caption_override, firstCommentOverride: r.first_comment_override, options: parseJson(r.options, {}),
    mode: r.mode, state: r.state, attempts: r.attempts, nextAttemptAt: r.next_attempt_at, lockedAt: r.locked_at, lockOwner: r.lock_owner,
    containerId: r.container_id, remoteId: r.remote_id, mediaKey: r.media_key, permalink: r.permalink, firstCommentId: r.first_comment_id,
    lastErrorCode: r.last_error_code, lastError: r.last_error, fbtraceId: r.fbtrace_id, publishedAt: r.published_at,
  };
}

const FORMAT_OF_MIME = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

export function mapAsset(r) {
  if (!r) return null;
  return {
    id: r.id, sha256: r.sha256, fileName: r.file_name, storedPath: r.stored_path, mime: r.mime, format: FORMAT_OF_MIME[r.mime] ?? null, kind: r.kind,
    bytes: r.bytes, width: r.width, height: r.height, rotation: r.rotation ?? 0, durationMs: r.duration_ms, videoCodec: r.video_codec,
    audioCodec: r.audio_codec, fps: r.fps, thumbPath: r.thumb_path, createdAt: r.created_at,
  };
}

function mapAudit(r) {
  return { id: r.id, at: r.at, postId: r.post_id, targetId: r.target_id, actor: r.actor, action: r.action, detail: parseJson(r.detail, null), ref: r.ref ?? null };
}

// ---- audit ----------------------------------------------------------------------------------------------------
export function addAudit({ postId = null, targetId = null, actor = 'user', action, detail = null, at = Date.now() }) {
  return Number(q.run('INSERT INTO planner_audit (at, post_id, target_id, actor, action, detail) VALUES (?, ?, ?, ?, ?, ?)', at, postId, targetId, actor, action, toJson(detail)).lastInsertRowid);
}

export function listAudit({ postId, limit = 100, before } = {}) {
  const where = [];
  const params = [];
  if (postId != null) { where.push('a.post_id = ?'); params.push(postId); }
  if (before != null) { where.push('a.id < ?'); params.push(before); }
  const sql = `SELECT a.*, p.ref FROM planner_audit a LEFT JOIN planner_posts p ON p.id = a.post_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT ?`;
  return q.all(sql, ...params, Math.min(Math.max(1, Number(limit) || 100), 1000)).map(mapAudit);
}

// ---- assets ---------------------------------------------------------------------------------------------------
export function getAsset(id) {
  return mapAsset(q.get('SELECT * FROM planner_assets WHERE id = ?', id));
}

export function getAssetBySha(sha256) {
  return mapAsset(q.get('SELECT * FROM planner_assets WHERE sha256 = ?', sha256));
}

/** Inserts an asset row, or returns the existing one with the same sha256 (content-addressed). */
export function insertAsset(a, { now = Date.now() } = {}) {
  const existing = getAssetBySha(a.sha256);
  if (existing) return existing;
  const res = q.run(
    `INSERT INTO planner_assets (sha256, file_name, stored_path, mime, kind, bytes, width, height, rotation, duration_ms, video_codec, audio_codec, fps, thumb_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    a.sha256, a.fileName ?? null, a.storedPath, a.mime ?? null, a.kind, a.bytes ?? null, a.width ?? null, a.height ?? null, a.rotation ?? 0,
    a.durationMs ?? null, a.videoCodec ?? null, a.audioCodec ?? null, a.fps ?? null, a.thumbPath ?? null, now,
  );
  return getAsset(Number(res.lastInsertRowid));
}

const ASSET_COLUMNS = { thumbPath: 'thumb_path', width: 'width', height: 'height', rotation: 'rotation', durationMs: 'duration_ms', videoCodec: 'video_codec', audioCodec: 'audio_codec', fps: 'fps', fileName: 'file_name' };

export function updateAsset(id, patch) {
  const sets = Object.entries(patch).filter(([k]) => ASSET_COLUMNS[k]);
  if (sets.length) q.run(`UPDATE planner_assets SET ${sets.map(([k]) => `${ASSET_COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v ?? null), id);
  return getAsset(id);
}

/** Number of live (not deleted) posts using the asset, and active remote uploads. */
export function assetUsage(id) {
  const posts = q.get('SELECT COUNT(DISTINCT pa.post_id) AS n FROM planner_post_assets pa JOIN planner_posts p ON p.id = pa.post_id WHERE pa.asset_id = ? AND p.deleted_at IS NULL', id).n;
  const uploads = q.get('SELECT COUNT(*) AS n FROM planner_uploads WHERE asset_id = ? AND deleted_at IS NULL', id).n;
  return { posts, uploads };
}

/** Deletes the asset row (and references from soft-deleted posts). Throws planner_asset_in_use when still used. */
export function deleteAsset(id) {
  const usage = assetUsage(id);
  if (usage.posts || usage.uploads) throw plannerError('planner_asset_in_use', 'ASSET_IN_USE', { n: usage.posts });
  q.tx(() => {
    q.run('DELETE FROM planner_post_assets WHERE asset_id = ?', id);
    q.run('DELETE FROM planner_uploads WHERE asset_id = ?', id);
    q.run('DELETE FROM planner_assets WHERE id = ?', id);
  })();
}

export function postAssets(postId) {
  return q.all('SELECT pa.*, a.* , pa.position AS pa_position FROM planner_post_assets pa JOIN planner_assets a ON a.id = pa.asset_id WHERE pa.post_id = ? ORDER BY pa.role DESC, pa.position', postId)
    .map((r) => ({ assetId: r.asset_id, role: r.role, position: r.pa_position, altText: r.alt_text, asset: mapAsset(r) }));
}

// ---- posts ----------------------------------------------------------------------------------------------------
export function postTargets(postId) {
  return q.all('SELECT * FROM planner_targets WHERE post_id = ? ORDER BY id', postId).map(mapTarget);
}

export function getPost(id, { includeDeleted = false } = {}) {
  const row = q.get(`SELECT * FROM planner_posts WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`, id);
  if (!row) return null;
  return { ...mapPost(row), targets: postTargets(id), assets: postAssets(id) };
}

export function requirePost(id, opts) {
  const post = getPost(id, opts);
  if (!post) throw plannerError('planner_post_not_found', 'NOT_FOUND');
  return post;
}

function insertTargets(postId, targets) {
  const stmt = 'INSERT INTO planner_targets (post_id, account_id, platform, format, caption_override, first_comment_override, options, mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  for (const t of targets) q.run(stmt, postId, t.accountId, t.platform, t.format, t.captionOverride ?? null, t.firstCommentOverride ?? null, toJson(t.options ?? null), t.mode ?? 'app');
}

function replaceAssets(postId, items) {
  q.run('DELETE FROM planner_post_assets WHERE post_id = ?', postId);
  const counters = {};
  for (const it of items) {
    const role = it.role ?? 'media';
    const position = counters[role] ?? 0;
    counters[role] = position + 1;
    q.run('INSERT INTO planner_post_assets (post_id, asset_id, position, role, alt_text) VALUES (?, ?, ?, ?, ?)', postId, it.assetId, position, role, it.altText ?? null);
  }
}

/**
 * Creates a post with targets and assets. `input.status` is for seed/system use only (handlers never pass it).
 * @returns {number} post id
 */
export function createPost(input, { now = Date.now(), actor = 'user' } = {}) {
  return q.tx(() => {
    const res = q.run(
      `INSERT INTO planner_posts (title, caption, first_comment, status, scheduled_at, timezone, client_name, labels, notes, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.title ?? null, input.caption ?? '', input.firstComment ?? null, input.status ?? 'draft', input.scheduledAt ?? null, input.timezone ?? null,
      input.clientName ?? null, toJson(input.labels?.length ? input.labels : null), input.notes ?? null, input.source ?? 'manual', now, now,
    );
    const id = Number(res.lastInsertRowid);
    q.run('UPDATE planner_posts SET ref = ? WHERE id = ?', refFor(id), id);
    insertTargets(id, input.targets ?? []);
    replaceAssets(id, input.assets ?? []);
    addAudit({ postId: id, actor, action: 'created', detail: { source: input.source ?? 'manual' }, at: now });
    return id;
  })();
}

const hashOf = (post) => contentHash({
  caption: post.caption, firstComment: post.firstComment, targets: post.targets,
  assets: post.assets.map((a) => ({ assetId: a.assetId, role: a.role, position: a.position, altText: a.altText })),
});

const META_FIELDS = { title: 'title', timezone: 'timezone', clientName: 'client_name', notes: 'notes' };

/** Reconciles targets by accountId: updates kept ones, inserts new ones, deletes removed ones (unless locked). */
function syncTargets(postId, current, next) {
  const byAccount = new Map(current.map((t) => [t.accountId, t]));
  const wanted = new Set(next.map((t) => t.accountId));
  for (const t of current) {
    if (wanted.has(t.accountId)) continue;
    if (LOCKED_TARGET_STATES.has(t.state)) throw plannerError('planner_target_locked', 'TARGET_LOCKED');
    q.run('DELETE FROM planner_targets WHERE id = ?', t.id);
  }
  const fresh = [];
  for (const t of next) {
    const old = byAccount.get(t.accountId);
    if (!old) { fresh.push(t); continue; }
    q.run('UPDATE planner_targets SET format = ?, caption_override = ?, first_comment_override = ?, options = ?, mode = ? WHERE id = ?',
      t.format, t.captionOverride ?? null, t.firstCommentOverride ?? null, toJson(t.options ?? null), t.mode ?? old.mode, old.id);
  }
  insertTargets(postId, fresh);
}

/**
 * Updates a post. Content changes (caption, first comment, targets, assets) bump `version`; with requireApproval an
 * approved/scheduled post goes back to in_review. Prepared app-mode targets are reset so the worker rebuilds containers.
 * @param {object} patch { title?, caption?, firstComment?, timezone?, clientName?, labels?, notes?, targets?, assets? }
 * @returns {{ post: object, contentChanged: boolean, invalidated: boolean, remoteCancelTargetIds: number[] }}
 *   remoteCancelTargetIds = FB native (`handed_off`) targets whose remote scheduled post must be canceled/recreated (chunk B).
 */
export function updatePost(id, patch, { expectedVersion, now = Date.now(), actor = 'user', requireApproval = false } = {}) {
  return q.tx(() => {
    const cur = requirePost(id);
    if (expectedVersion != null && expectedVersion !== cur.version) throw plannerError('planner_version_conflict', 'VERSION_CONFLICT');
    if (cur.status === 'publishing') throw plannerError('planner_post_locked', 'POST_LOCKED');
    const fields = Object.keys(patch).filter((k) => patch[k] !== undefined);
    for (const [k, col] of Object.entries(META_FIELDS)) if (patch[k] !== undefined) q.run(`UPDATE planner_posts SET ${col} = ? WHERE id = ?`, patch[k], id);
    if (patch.labels !== undefined) q.run('UPDATE planner_posts SET labels = ? WHERE id = ?', toJson(patch.labels?.length ? patch.labels : null), id);
    if (patch.caption !== undefined) q.run('UPDATE planner_posts SET caption = ? WHERE id = ?', patch.caption ?? '', id);
    if (patch.firstComment !== undefined) q.run('UPDATE planner_posts SET first_comment = ? WHERE id = ?', patch.firstComment, id);
    if (patch.targets !== undefined) syncTargets(id, cur.targets, patch.targets);
    if (patch.assets !== undefined) replaceAssets(id, patch.assets);
    const next = requirePost(id);
    const contentChanged = hashOf(next) !== hashOf(cur);
    if (contentChanged && cur.status === 'published') throw plannerError('planner_post_locked', 'POST_LOCKED');
    let invalidated = false;
    let remoteCancelTargetIds = [];
    if (contentChanged) {
      const edit = applyContentEdit({ status: cur.status, requireApproval });
      invalidated = edit.invalidated;
      q.run('UPDATE planner_posts SET version = version + 1, status = ? WHERE id = ?', edit.status, id);
      for (const t of next.targets) {
        if (t.mode === 'native' && t.state === 'handed_off') remoteCancelTargetIds = [...remoteCancelTargetIds, t.id];
        else if (t.mode === 'app' && invalidated && !LOCKED_TARGET_STATES.has(t.state)) q.run("UPDATE planner_targets SET state = 'idle', container_id = NULL, next_attempt_at = NULL WHERE id = ?", t.id);
        else if (t.mode === 'app' && PREPARED_STATES.has(t.state)) q.run("UPDATE planner_targets SET state = 'queued', container_id = NULL WHERE id = ?", t.id);
      }
      if (invalidated) addAudit({ postId: id, actor, action: 'approval_invalidated', detail: { from: cur.status, version: cur.version + 1 }, at: now });
    }
    q.run('UPDATE planner_posts SET updated_at = ? WHERE id = ?', now, id);
    addAudit({ postId: id, actor, action: 'edited', detail: { fields, version: contentChanged ? cur.version + 1 : cur.version, contentChanged }, at: now });
    return { post: requirePost(id), contentChanged, invalidated, remoteCancelTargetIds };
  })();
}

/** Time-only change (drag and drop). Never invalidates approval. Recomputing next_attempt_at is the worker's job (chunk B). */
export function reschedulePost(id, scheduledAt, { now = Date.now(), actor = 'user', timezone } = {}) {
  return q.tx(() => {
    const cur = requirePost(id);
    if (['publishing', 'published'].includes(cur.status)) throw plannerError('planner_post_locked', 'POST_LOCKED');
    q.run('UPDATE planner_posts SET scheduled_at = ?, timezone = COALESCE(?, timezone), updated_at = ? WHERE id = ?', scheduledAt ?? null, timezone ?? null, now, id);
    addAudit({ postId: id, actor, action: cur.scheduledAt == null ? 'scheduled' : 'rescheduled', detail: { from: cur.scheduledAt, to: scheduledAt ?? null }, at: now });
    return requirePost(id);
  })();
}

/** Copies content, targets (fresh state) and media into a new draft. @returns {number} new post id */
export function duplicatePost(id, { scheduledAt = null, now = Date.now(), actor = 'user' } = {}) {
  const src = requirePost(id);
  const newId = createPost({
    title: src.title, caption: src.caption, firstComment: src.firstComment, scheduledAt, timezone: src.timezone, clientName: src.clientName,
    labels: src.labels, notes: src.notes, source: 'duplicate',
    targets: src.targets.map((t) => ({ accountId: t.accountId, platform: t.platform, format: t.format, captionOverride: t.captionOverride, firstCommentOverride: t.firstCommentOverride, options: t.options, mode: t.mode })),
    assets: src.assets.map((a) => ({ assetId: a.assetId, role: a.role, altText: a.altText })),
  }, { now, actor });
  addAudit({ postId: newId, actor, action: 'created', detail: { duplicateOf: src.ref }, at: now });
  return newId;
}

/**
 * Soft delete. Refuses while a target is in flight. Pending targets become `canceled`; FB native (`handed_off`) targets
 * are returned so chunk B can cancel them remotely.
 * @returns {{ handedOffTargetIds: number[] }}
 */
export function softDeletePost(id, { now = Date.now(), actor = 'user' } = {}) {
  return q.tx(() => {
    const cur = requirePost(id);
    if (cur.status === 'publishing' || cur.targets.some((t) => IN_FLIGHT_TARGET_STATES.includes(t.state))) throw plannerError('planner_post_locked', 'POST_LOCKED');
    const handedOffTargetIds = cur.targets.filter((t) => t.state === 'handed_off').map((t) => t.id);
    q.run(`UPDATE planner_targets SET state = 'canceled', next_attempt_at = NULL WHERE post_id = ? AND state NOT IN (${placeholders([...TERMINAL_TARGET_STATES, 'handed_off'])})`, id, ...TERMINAL_TARGET_STATES, 'handed_off');
    q.run('UPDATE planner_posts SET deleted_at = ?, updated_at = ? WHERE id = ?', now, now, id);
    addAudit({ postId: id, actor, action: 'deleted', detail: { handedOff: handedOffTargetIds.length }, at: now });
    return { handedOffTargetIds };
  })();
}

const STATUS_AUDIT = { approved: 'approved', changes_requested: 'changes_requested' };

/**
 * Status transition through the state machine. Approval stores approved_version/by/at.
 * @returns {{ ok: true, post } | { ok: false, reason }}
 */
export function setPostStatus(id, to, { actor = 'user', requireApproval = false, note, approver, now = Date.now() } = {}) {
  return q.tx(() => {
    const cur = getPost(id);
    if (!cur) return { ok: false, reason: 'not_found' };
    const check = checkTransition(cur.status, to, { requireApproval, actor });
    if (!check.ok) return check;
    q.run('UPDATE planner_posts SET status = ?, updated_at = ? WHERE id = ?', to, now, id);
    if (to === 'approved') q.run('UPDATE planner_posts SET approved_version = version, approved_by = ?, approved_at = ? WHERE id = ?', approver ?? null, now, id);
    addAudit({ postId: id, actor, action: STATUS_AUDIT[to] ?? 'status', detail: { from: cur.status, to, note: note ?? null, approver: approver ?? null, version: cur.version }, at: now });
    return { ok: true, post: requirePost(id) };
  })();
}

function listWhere({ from, to, accountIds, platforms, statuses, includeUnscheduled, search }) {
  const where = ['p.deleted_at IS NULL'];
  const params = [];
  const ranged = from != null || to != null;
  if (ranged) {
    const range = ['p.scheduled_at IS NOT NULL'];
    if (from != null) { range.push('p.scheduled_at >= ?'); params.push(from); }
    if (to != null) { range.push('p.scheduled_at < ?'); params.push(to); }
    where.push(includeUnscheduled ? `((${range.join(' AND ')}) OR p.scheduled_at IS NULL)` : `(${range.join(' AND ')})`);
  } else if (includeUnscheduled === false) where.push('p.scheduled_at IS NOT NULL');
  if (statuses?.length) { where.push(`p.status IN (${placeholders(statuses)})`); params.push(...statuses); } else where.push("p.status <> 'archived'");
  if (accountIds?.length) { where.push(`EXISTS (SELECT 1 FROM planner_targets t WHERE t.post_id = p.id AND t.account_id IN (${placeholders(accountIds)}))`); params.push(...accountIds.map(String)); }
  if (platforms?.length) { where.push(`EXISTS (SELECT 1 FROM planner_targets t WHERE t.post_id = p.id AND t.platform IN (${placeholders(platforms)}))`); params.push(...platforms); }
  if (search?.trim()) {
    const like = `%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.caption LIKE ? ESCAPE '\\' OR p.ref LIKE ? ESCAPE '\\')");
    params.push(like, like, like);
  }
  return { sql: where.join(' AND '), params };
}

/**
 * Calendar/list summaries. Without from/to every post is returned (unless includeUnscheduled === false); with a range,
 * unscheduled drafts are added only when includeUnscheduled is true. Archived posts only when statuses asks for them.
 * `issuesCount` is 0 here; the IPC handler fills it from validation.
 */
export function listPosts(filters = {}) {
  const { sql, params } = listWhere(filters);
  const rows = q.all(`SELECT p.* FROM planner_posts p WHERE ${sql} ORDER BY p.scheduled_at IS NULL, p.scheduled_at, p.id LIMIT ${LIST_LIMIT}`, ...params);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const targets = new Map();
  for (const t of q.all(`SELECT * FROM planner_targets WHERE post_id IN (${placeholders(ids)}) ORDER BY id`, ...ids)) {
    targets.set(t.post_id, [...(targets.get(t.post_id) ?? []), { id: t.id, accountId: t.account_id, platform: t.platform, format: t.format, state: t.state, mode: t.mode, permalink: t.permalink }]);
  }
  const thumbs = new Map(q.all(
    `SELECT pa.post_id, pa.asset_id, a.kind FROM planner_post_assets pa JOIN planner_assets a ON a.id = pa.asset_id
     WHERE pa.post_id IN (${placeholders(ids)}) AND pa.role = 'media' AND pa.position = 0`, ...ids,
  ).map((r) => [r.post_id, { assetId: r.asset_id, kind: r.kind }]));
  return rows.map((r) => {
    const p = mapPost(r);
    return {
      id: p.id, ref: p.ref, title: p.title, captionPreview: p.caption.slice(0, PREVIEW_CHARS), status: p.status, scheduledAt: p.scheduledAt,
      version: p.version, targets: targets.get(p.id) ?? [], thumb: thumbs.get(p.id) ?? null, issuesCount: 0, source: p.source,
      labels: p.labels, clientName: p.clientName, updatedAt: p.updatedAt,
    };
  });
}

/** Scheduled items per account in [from, to) (for min-gap checks and slot suggestions). */
export function scheduledForAccounts({ accountIds, from, to } = {}) {
  const where = ["p.deleted_at IS NULL", 'p.scheduled_at IS NOT NULL', "p.status NOT IN ('archived', 'failed')"];
  const params = [];
  if (accountIds?.length) { where.push(`t.account_id IN (${placeholders(accountIds)})`); params.push(...accountIds.map(String)); }
  if (from != null) { where.push('p.scheduled_at >= ?'); params.push(from); }
  if (to != null) { where.push('p.scheduled_at < ?'); params.push(to); }
  return q.all(`SELECT p.id AS postId, p.ref, t.account_id AS accountId, p.scheduled_at AS scheduledAt, p.status FROM planner_posts p JOIN planner_targets t ON t.post_id = p.id WHERE ${where.join(' AND ')} ORDER BY p.scheduled_at`, ...params);
}

// ---- targets (worker API, chunk B) -----------------------------------------------------------------------------
export function getTarget(id) {
  const r = q.get('SELECT * FROM planner_targets WHERE id = ?', id);
  return r ? mapTarget(r) : null;
}

const TARGET_COLUMNS = {
  state: 'state', attempts: 'attempts', nextAttemptAt: 'next_attempt_at', containerId: 'container_id', remoteId: 'remote_id', mediaKey: 'media_key',
  permalink: 'permalink', firstCommentId: 'first_comment_id', lastErrorCode: 'last_error_code', lastError: 'last_error', fbtraceId: 'fbtrace_id',
  publishedAt: 'published_at', mode: 'mode', lockedAt: 'locked_at', lockOwner: 'lock_owner',
};

/** Updates whitelisted worker columns (camelCase keys). */
export function updateTarget(id, patch) {
  const sets = Object.entries(patch).filter(([k, v]) => TARGET_COLUMNS[k] && v !== undefined);
  if (sets.length) q.run(`UPDATE planner_targets SET ${sets.map(([k]) => `${TARGET_COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`, ...sets.map(([, v]) => v), id);
  return getTarget(id);
}

/** Targets of live posts, optionally filtered by state and due time (next_attempt_at <= dueBefore). */
export function listTargets({ postId, states, dueBefore, accountId } = {}) {
  const where = ['p.deleted_at IS NULL'];
  const params = [];
  if (postId != null) { where.push('t.post_id = ?'); params.push(postId); }
  if (accountId != null) { where.push('t.account_id = ?'); params.push(String(accountId)); }
  if (states?.length) { where.push(`t.state IN (${placeholders(states)})`); params.push(...states); }
  if (dueBefore != null) { where.push('t.next_attempt_at IS NOT NULL AND t.next_attempt_at <= ?'); params.push(dueBefore); }
  return q.all(`SELECT t.*, p.ref AS post_ref, p.title AS post_title, p.scheduled_at AS post_scheduled_at FROM planner_targets t JOIN planner_posts p ON p.id = t.post_id WHERE ${where.join(' AND ')} ORDER BY t.next_attempt_at, t.id`, ...params)
    .map((r) => ({ ...mapTarget(r), postRef: r.post_ref, postTitle: r.post_title, scheduledAt: r.post_scheduled_at }));
}

/** Atomic lease: true when this owner now holds the target (free or lease older than 10 min). */
export function leaseTarget(id, owner, now = Date.now(), staleMs = LEASE_STALE_MS) {
  return q.run('UPDATE planner_targets SET locked_at = ?, lock_owner = ? WHERE id = ? AND (locked_at IS NULL OR locked_at < ? OR lock_owner = ?)', now, owner, id, now - staleMs, owner).changes === 1;
}

export function releaseTarget(id, owner) {
  q.run('UPDATE planner_targets SET locked_at = NULL, lock_owner = NULL WHERE id = ? AND lock_owner = ?', id, owner);
}

// ---- uploads, approval packs, quota ----------------------------------------------------------------------------
export function insertUpload({ assetId, host, objectKey = null, publicUrl, expiresAt = null }, { now = Date.now() } = {}) {
  return Number(q.run('INSERT INTO planner_uploads (asset_id, host, object_key, public_url, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)', assetId, host, objectKey, publicUrl, expiresAt, now).lastInsertRowid);
}

export function listUploads({ assetId, activeOnly = true } = {}) {
  const where = [];
  const params = [];
  if (assetId != null) { where.push('asset_id = ?'); params.push(assetId); }
  if (activeOnly) where.push('deleted_at IS NULL');
  return q.all(`SELECT * FROM planner_uploads ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`, ...params)
    .map((r) => ({ id: r.id, assetId: r.asset_id, host: r.host, objectKey: r.object_key, publicUrl: r.public_url, expiresAt: r.expires_at, createdAt: r.created_at, deletedAt: r.deleted_at }));
}

export function markUploadDeleted(id, now = Date.now()) {
  q.run('UPDATE planner_uploads SET deleted_at = ? WHERE id = ?', now, id);
}

export function insertPack({ id, title = null, clientName = null, lang = null, items, secret, filePath = null }, { now = Date.now() } = {}) {
  q.run('INSERT INTO planner_approval_packs (id, created_at, title, client_name, lang, items, secret, file_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, now, title, clientName, lang, toJson(items), secret, filePath);
  return getPack(id);
}

export function getPack(id) {
  const r = q.get('SELECT * FROM planner_approval_packs WHERE id = ?', id);
  return r ? { id: r.id, createdAt: r.created_at, title: r.title, clientName: r.client_name, lang: r.lang, items: parseJson(r.items, []), secret: r.secret, filePath: r.file_path } : null;
}

export function getQuota(accountId) {
  const r = q.get('SELECT * FROM planner_quota WHERE account_id = ?', String(accountId));
  return r ? { accountId: r.account_id, used: r.used, total: r.total, windowSec: r.window_sec, checkedAt: r.checked_at } : null;
}

export function setQuota(accountId, { used, total, windowSec, checkedAt = Date.now() }) {
  q.run(`INSERT INTO planner_quota (account_id, used, total, window_sec, checked_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET used = excluded.used, total = excluded.total, window_sec = excluded.window_sec, checked_at = excluded.checked_at`,
  String(accountId), used ?? null, total ?? null, windowSec ?? null, checkedAt);
  return getQuota(accountId);
}

/** All planner tables, children first (used by seed clearAll). */
export const PLANNER_TABLES = Object.freeze(['planner_post_assets', 'planner_targets', 'planner_audit', 'planner_uploads', 'planner_approval_packs', 'planner_quota', 'planner_posts', 'planner_assets']);
