import { app, dialog, BrowserWindow, nativeImage } from 'electron';
import fs from 'node:fs';
import { getConfig } from '../config/store.js';
import { q } from '../db/index.js';
import { msg } from '../i18n.js';
import { progressBus } from '../sync/progress.js';
import {
  createPost, getPost, requirePost, updatePost, reschedulePost, duplicatePost, softDeletePost, setPostStatus, listPosts, listAudit,
  getAsset, plannerError,
} from '../db/queries/planner.js';
import { importFile, importDataUrl, setThumbFromDataUrl, removeAsset } from '../planner/assets.js';
import { validatePostLike } from '../planner/validationContext.js';
import { toId, toIds, toTime, toTargets, toAssetItems, toPostFields, toListFilters, invalid } from '../planner/input.js';
import { LIMITS } from '../publishing/limits.js';
import { notImplemented } from './notImplemented.js';

/**
 * Planner channels (contract in the v1.4 plan §10; payload/return shapes in lib/types.ts):
 *  planner:posts:list       (PlannerListParams?) → PlannerPostSummary[]   (issuesCount = validation errors)
 *  planner:posts:get        (id) → PlannerPost                            (+ validation: Issue[], audit: AuditEntry[] (last 20))
 *  planner:posts:create     (PlannerCreateInput) → PlannerPost
 *  planner:posts:update     ({ id, patch, expectedVersion? }) → PlannerPost | error { code: 'VERSION_CONFLICT' }
 *  planner:posts:reschedule ({ id, scheduledAt }) → PlannerPost & { warnings: Issue[] }
 *  planner:posts:duplicate  ({ id, scheduledAt? }) → PlannerPost
 *  planner:posts:delete     ({ id, cancelRemote? }) → true
 *  planner:posts:setStatus  ({ ids, status, note?, approver? }) → { updated: number[], rejected: [{ id, reason }] }
 *  planner:posts:setAssets  ({ id, items: [{ assetId, role?, altText? }] }) → PlannerPost
 *  planner:validate         ({ draft }) → Issue[]
 *  planner:assets:import    ({ paths? }?) → PlannerAsset[]                (open dialog when paths is omitted)
 *  planner:assets:importData ({ name, dataUrl }) → PlannerAsset
 *  planner:assets:setThumb  ({ assetId, dataUrl }) → PlannerAsset
 *  planner:assets:remove    ({ assetId }) → true
 *  planner:audit            ({ postId?, limit?, before? }?) → AuditEntry[]
 *  planner:suggestSlots / planner:approval:export / planner:approval:import → chunk C (stubs below)
 * Every mutation emits `planner:changed` { postIds, reason, ... } on progressBus (forwarded to the renderer).
 */
export const PLANNER_CHANNELS = [
  'planner:posts:list', 'planner:posts:get', 'planner:posts:create', 'planner:posts:update', 'planner:posts:reschedule',
  'planner:posts:duplicate', 'planner:posts:delete', 'planner:posts:setStatus', 'planner:posts:setAssets', 'planner:validate',
  'planner:assets:import', 'planner:assets:importData', 'planner:assets:setThumb', 'planner:assets:remove', 'planner:audit',
  'planner:suggestSlots', 'planner:approval:export', 'planner:approval:import',
];

const AUDIT_TAIL = 20;
const THUMB_WIDTH = 480;
const THUMB_QUALITY = 80;
const MAX_IMPORT_PATHS = 50;
/** Statuses that only the publishing channels may set (they also queue/dequeue targets). */
const PUBLISHING_STATUSES = new Set(['scheduled', 'publishing', 'published', 'partial', 'failed']);
/** Statuses whose calendar summary gets a validation count. */
const VALIDATED_STATUSES = new Set(['draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'failed', 'partial']);
const MEDIA_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'mov', 'm4v'];

const emitChanged = (postIds, reason, extra = {}) => progressBus.emit('planner:changed', { postIds, reason, ...extra });
const requireApproval = () => getConfig('planner.requireApproval') === true;
const platformOf = (accountId) => q.get('SELECT platform FROM accounts WHERE ig_id = ?', accountId)?.platform ?? null;
const assetExists = (id) => !!getAsset(id);

/** Full post for the renderer: stored post + validation + audit tail. */
function fullPost(id) {
  const post = requirePost(id);
  return { ...post, validation: validatePostLike(post), audit: listAudit({ postId: id, limit: AUDIT_TAIL }) };
}

/** Media assets in order (for format inference). */
function mediaOf(items = []) {
  return items.filter((it) => it.role === 'media').map((it) => getAsset(it.assetId)).filter(Boolean);
}

/** Electron thumbnailer for planner/assets.js (images everywhere; videos on macOS/Windows only). */
async function electronThumb({ kind, filePath, outPath }) {
  let img;
  if (kind === 'image') img = nativeImage.createFromPath(filePath);
  else if (process.platform === 'darwin' || process.platform === 'win32') img = await nativeImage.createThumbnailFromPath(filePath, { width: THUMB_WIDTH, height: THUMB_WIDTH });
  if (!img || img.isEmpty()) return false;
  const sized = img.getSize().width > THUMB_WIDTH ? img.resize({ width: THUMB_WIDTH, quality: 'good' }) : img;
  await fs.promises.writeFile(outPath, sized.toJPEG(THUMB_QUALITY));
  return true;
}

async function pickMediaFiles(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, {
    defaultPath: app.getPath('pictures'),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: msg('planner_media_filter'), extensions: MEDIA_EXTENSIONS }],
  });
  return res.canceled ? [] : res.filePaths;
}

function createFromPayload(p) {
  const fields = toPostFields(p);
  delete fields.source;
  const assets = toAssetItems(p.assetIds !== undefined ? (p.assetIds ?? []).map((assetId) => ({ assetId })) : p.assets, assetExists) ?? [];
  const targets = toTargets(p.targets ?? [], { platformOf, media: mediaOf(assets) });
  const source = ['manual', 'ai_idea', 'repurpose'].includes(p.source) ? p.source : 'manual';
  return { ...fields, source, targets, assets };
}

function updatePatch(id, patch) {
  if (!patch || typeof patch !== 'object') throw invalid('patch');
  const fields = toPostFields(patch);
  delete fields.source;
  delete fields.scheduledAt; // time changes go through planner:posts:reschedule
  const assets = toAssetItems(patch.assets, assetExists);
  const media = mediaOf(assets ?? requirePost(id).assets);
  const targets = toTargets(patch.targets, { platformOf, media });
  return { ...fields, ...(assets !== undefined ? { assets } : {}), ...(targets !== undefined ? { targets } : {}) };
}

function setStatusMany({ ids, status, note, approver }) {
  const updated = [];
  const rejected = [];
  const cleanNote = typeof note === 'string' ? note.slice(0, 2000) : null;
  const cleanApprover = typeof approver === 'string' ? approver.trim().slice(0, 200) || null : null;
  for (const id of toIds(ids)) {
    const cur = getPost(id);
    if (!cur) { rejected.push({ id, reason: 'not_found' }); continue; }
    if (PUBLISHING_STATUSES.has(status) || cur.status === 'scheduled' || cur.status === 'publishing') { rejected.push({ id, reason: 'use_publishing' }); continue; }
    const res = setPostStatus(id, status, { actor: 'user', requireApproval: requireApproval(), note: cleanNote, approver: cleanApprover });
    if (res.ok) updated.push(id);
    else rejected.push({ id, reason: res.reason });
  }
  if (updated.length) emitChanged(updated, 'status', { status });
  return { updated, rejected };
}

export function registerPlannerHandlers(handle) {
  handle('planner:posts:list', (p) => {
    const summaries = listPosts(toListFilters(p ?? {}));
    return summaries.map((s) => {
      if (!VALIDATED_STATUSES.has(s.status)) return s;
      const post = getPost(s.id);
      return { ...s, issuesCount: post ? validatePostLike(post).filter((i) => i.level === 'error').length : 0 };
    });
  });

  handle('planner:posts:get', (id) => fullPost(toId(id)));

  handle('planner:posts:create', (p) => {
    const input = createFromPayload(p ?? {});
    const id = createPost(input);
    emitChanged([id], 'created');
    return fullPost(id);
  });

  handle('planner:posts:update', ({ id, patch, expectedVersion } = {}) => {
    const postId = toId(id);
    const res = updatePost(postId, updatePatch(postId, patch), {
      expectedVersion: expectedVersion == null ? undefined : toId(expectedVersion, 'expectedVersion'),
      requireApproval: requireApproval(),
    });
    emitChanged([postId], res.invalidated ? 'approval_invalidated' : 'edited', { contentChanged: res.contentChanged, remoteCancelTargetIds: res.remoteCancelTargetIds });
    return fullPost(postId);
  });

  handle('planner:posts:reschedule', ({ id, scheduledAt } = {}) => {
    const postId = toId(id);
    const at = toTime(scheduledAt);
    if (at != null && at < Date.now() - LIMITS.common.pastGraceMs) throw plannerError('planner_time_past', 'TIME_PAST');
    reschedulePost(postId, at ?? null);
    emitChanged([postId], 'rescheduled', { scheduledAt: at ?? null });
    const post = fullPost(postId);
    return { ...post, warnings: post.validation.filter((i) => i.level === 'warn') };
  });

  handle('planner:posts:duplicate', ({ id, scheduledAt } = {}) => {
    const newId = duplicatePost(toId(id), { scheduledAt: toTime(scheduledAt) ?? null });
    emitChanged([newId], 'created', { duplicateOf: toId(id) });
    return fullPost(newId);
  });

  handle('planner:posts:delete', ({ id, cancelRemote } = {}) => {
    const postId = toId(id);
    const { handedOffTargetIds } = softDeletePost(postId);
    emitChanged([postId], 'deleted', { handedOffTargetIds, cancelRemote: cancelRemote !== false });
    return true;
  });

  handle('planner:posts:setStatus', (p = {}) => {
    if (typeof p.status !== 'string') throw invalid('status');
    return setStatusMany(p);
  });

  handle('planner:posts:setAssets', ({ id, items } = {}) => {
    const postId = toId(id);
    const res = updatePost(postId, { assets: toAssetItems(items ?? [], assetExists) }, { requireApproval: requireApproval() });
    emitChanged([postId], res.invalidated ? 'approval_invalidated' : 'edited', { contentChanged: res.contentChanged, remoteCancelTargetIds: res.remoteCancelTargetIds });
    return fullPost(postId);
  });

  handle('planner:validate', ({ draft } = {}) => {
    if (!draft || typeof draft !== 'object') throw invalid('draft');
    const input = createFromPayload(draft);
    const assets = input.assets.map((it) => ({ ...it, position: 0, asset: getAsset(it.assetId) }));
    return validatePostLike({ ...input, id: draft.id == null ? null : toId(draft.id), scheduledAt: input.scheduledAt ?? null, assets });
  });

  handle('planner:assets:import', async (p, event) => {
    const paths = Array.isArray(p?.paths) ? p.paths : await pickMediaFiles(event);
    if (paths.length > MAX_IMPORT_PATHS || paths.some((x) => typeof x !== 'string' || !x)) throw invalid('paths');
    const imported = [];
    let firstError = null;
    for (const filePath of paths) {
      try { imported.push(await importFile(filePath, { makeThumb: electronThumb })); } catch (e) { firstError ??= e; console.error('[planner] import failed:', filePath, e?.message); }
    }
    if (!imported.length && firstError) throw firstError;
    return imported;
  });

  handle('planner:assets:importData', (p = {}) => importDataUrl({ name: p.name, dataUrl: p.dataUrl }, { makeThumb: electronThumb }));

  handle('planner:assets:setThumb', (p = {}) => setThumbFromDataUrl(toId(p.assetId, 'assetId'), p.dataUrl));

  handle('planner:assets:remove', async (p = {}) => { await removeAsset(toId(p.assetId, 'assetId')); return true; });

  handle('planner:audit', (p = {}) => listAudit({
    postId: p?.postId == null ? undefined : toId(p.postId, 'postId'),
    limit: p?.limit,
    before: p?.before == null ? undefined : toId(p.before, 'before'),
  }));

  // ===== BEGIN CHUNK C: best-time suggestions and approval packs — replace ONLY these three stubs =====
  // planner:suggestSlots     ({ accountIds, from?, days?, count? }) → Slot[]
  // planner:approval:export  ({ postIds?, from?, to?, accountIds?, format: 'html'|'pdf', title?, clientName?, lang?, includeNotes? }) → { filePath, packId, count }
  // planner:approval:import  ({ code }) → { applied: [{ ref, decision, note }], stale: [{ ref, packVersion, currentVersion }], unknown: string[] }
  handle('planner:suggestSlots', () => { throw notImplemented(); });
  handle('planner:approval:export', () => { throw notImplemented(); });
  handle('planner:approval:import', () => { throw notImplemented(); });
  // ===== END CHUNK C =====
}
