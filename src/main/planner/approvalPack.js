import crypto from 'node:crypto';
import { getPost, listPosts, setPostStatus, addAudit, insertPack, getPack, plannerError } from '../db/queries/planner.js';
import { CODE_PREFIX } from './approvalClient.js';
import { toIds, invalid } from './input.js';

/**
 * Client approval packs (v1.4 plan §8): pack records, the response-code codec and applying a pasted response.
 * Response code: `MDAP1.<base64url(JSON { packId, items: [{ ref, v, d: 'a'|'c', note }], by })>.<hmac8>` where hmac8 is
 * the first 8 hex chars of HMAC-SHA256(pack.secret, "MDAP1.<payload>"). The secret is embedded in the HTML, so the
 * HMAC only catches corrupted codes and codes from another pack — it is NOT authentication (see SECURITY.md).
 */
export { CODE_PREFIX };
export const MAX_PACK_POSTS = 100;
const MAX_CODE_CHARS = 200_000;
const MAX_NOTE = 2000;
const MAX_BY = 200;
/** Statuses a range export picks up (live work, not history). */
export const PACK_STATUSES = Object.freeze(['draft', 'in_review', 'changes_requested', 'approved', 'scheduled']);
const DECISIONS = { a: 'approved', c: 'changes_requested' };
/** Status steps (actor client) from the current status to the decision; [] = already there; missing = not possible here. */
const PATHS = {
  a: { draft: ['in_review', 'approved'], changes_requested: ['in_review', 'approved'], in_review: ['approved'], approved: [], scheduled: [] },
  c: { draft: ['in_review', 'changes_requested'], in_review: ['changes_requested'], changes_requested: [], approved: ['draft', 'in_review', 'changes_requested'] },
};

const codeError = (key) => plannerError(key, 'APPROVAL_CODE_INVALID');

export const newPackId = () => crypto.randomBytes(9).toString('base64url');
export const newSecret = () => crypto.randomBytes(18).toString('base64url');
export const hmac8 = (secret, body) => crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex').slice(0, 8);

/** Node-side encoder (same format the pack's inline script produces). */
export function encodeResponse({ packId, items, by = null }, secret) {
  const body = `${CODE_PREFIX}.${Buffer.from(JSON.stringify({ packId, items, by }), 'utf8').toString('base64url')}`;
  return `${body}.${hmac8(secret, body)}`;
}

/** Parses a pasted code (whitespace tolerant) without verifying it. Throws APPROVAL_CODE_INVALID. */
export function decodeResponse(code) {
  if (typeof code !== 'string' || !code.trim() || code.length > MAX_CODE_CHARS) throw codeError('approval_code_invalid');
  const clean = code.replace(/\s+/g, '');
  const m = /^(MDAP1\.([A-Za-z0-9_-]+))\.([0-9a-f]{8})$/.exec(clean);
  if (!m) throw codeError('approval_code_invalid');
  let payload;
  try { payload = JSON.parse(Buffer.from(m[2], 'base64url').toString('utf8')); } catch { throw codeError('approval_code_invalid'); }
  if (!payload || typeof payload.packId !== 'string' || !Array.isArray(payload.items)) throw codeError('approval_code_invalid');
  const items = payload.items
    .filter((it) => it && typeof it.ref === 'string' && Number.isInteger(it.v) && (it.d === 'a' || it.d === 'c'))
    .map((it) => ({ ref: it.ref.slice(0, 32), v: it.v, d: it.d, note: typeof it.note === 'string' && it.note.trim() ? it.note.trim().slice(0, MAX_NOTE) : null }));
  const by = typeof payload.by === 'string' && payload.by.trim() ? payload.by.trim().slice(0, MAX_BY) : null;
  return { body: m[1], mac: m[3], packId: payload.packId, items, by };
}

/** Decodes and checks the HMAC with the pack secret. Throws APPROVAL_CODE_INVALID on mismatch. */
export function verifyResponse(code, secret) {
  const decoded = decodeResponse(code);
  const expected = hmac8(secret, decoded.body);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(decoded.mac))) throw plannerError('approval_code_mismatch', 'APPROVAL_CODE_INVALID');
  return decoded;
}

/**
 * Pure: splits response items into apply / stale / unknown. An item is stale when the post changed after the pack
 * was made (its version moved on), so the client approved content that no longer exists.
 * @param {{ items: {ref,v,d,note}[] }} decoded
 * @param {{ items: {postId, ref, version}[] }} pack
 * @param {(postId:number) => object|null} findPost
 */
export function planImport(decoded, pack, findPost) {
  const byRef = new Map(pack.items.map((i) => [i.ref, i]));
  const apply = [];
  const stale = [];
  const unknown = [];
  const seen = new Set();
  for (const it of decoded.items) {
    if (seen.has(it.ref)) continue;
    seen.add(it.ref);
    const packItem = byRef.get(it.ref);
    const post = packItem ? findPost(packItem.postId) : null;
    if (!packItem || !post) { unknown.push(it.ref); continue; }
    if (it.v !== packItem.version || post.version !== it.v) { stale.push({ ref: it.ref, packVersion: it.v, currentVersion: post.version }); continue; }
    apply.push({ post, item: it });
  }
  return { apply, stale, unknown };
}

/** Posts for a pack: explicit ids (order kept) or a date range/accounts filter over live statuses. */
export function selectPackPosts(p = {}) {
  let posts;
  if (Array.isArray(p.postIds) && p.postIds.length) posts = toIds(p.postIds).map((id) => getPost(id)).filter(Boolean);
  else {
    const from = Number.isFinite(p.from) ? p.from : undefined;
    const to = Number.isFinite(p.to) ? p.to : undefined;
    if (from == null && to == null) throw invalid('postIds');
    const accountIds = Array.isArray(p.accountIds) ? p.accountIds.filter((x) => typeof x === 'string' && x) : undefined;
    posts = listPosts({ from, to, accountIds, statuses: [...PACK_STATUSES] }).map((s) => getPost(s.id)).filter(Boolean);
  }
  if (!posts.length) throw plannerError('approval_no_posts', 'NOT_FOUND');
  if (posts.length > MAX_PACK_POSTS) throw plannerError('approval_too_many', 'INVALID_PAYLOAD', { max: MAX_PACK_POSTS });
  return posts;
}

/** Stores a pack record; items pin each post's version at export time. */
export function createPackRecord({ posts, title = null, clientName = null, lang = null, filePath = null, now = Date.now() }) {
  return insertPack({
    id: newPackId(), secret: newSecret(), title, clientName, lang, filePath,
    items: posts.map((p) => ({ postId: p.id, ref: p.ref, version: p.version })),
  }, { now });
}

function applyDecision({ post, item }, { packId, by, requireApproval, now }) {
  const steps = PATHS[item.d][post.status];
  if (!steps) return { ok: false, reason: post.status === 'scheduled' ? 'use_publishing' : 'transition_not_allowed' };
  for (const to of steps) {
    const res = setPostStatus(post.id, to, { actor: 'client', requireApproval, note: item.note, approver: by, now });
    if (!res.ok) return res;
  }
  addAudit({ postId: post.id, actor: 'client', action: 'client_response', detail: { packId, decision: DECISIONS[item.d], note: item.note, by, version: item.v }, at: now });
  return { ok: true };
}

/**
 * planner:approval:import — verifies a pasted code against its pack and applies current decisions (actor 'client').
 * @returns {{ applied: {ref, decision, note}[], stale: {ref, packVersion, currentVersion}[], unknown: string[], rejected: {ref, reason}[], postIds: number[] }}
 */
export function importResponse(code, { requireApproval = false, now = Date.now() } = {}) {
  const decoded = decodeResponse(code);
  const pack = getPack(decoded.packId);
  if (!pack) throw plannerError('approval_pack_unknown', 'NOT_FOUND');
  verifyResponse(code, pack.secret);
  const plan = planImport(decoded, pack, (id) => getPost(id));
  const applied = [];
  const rejected = [];
  const postIds = [];
  for (const entry of plan.apply) {
    const res = applyDecision(entry, { packId: pack.id, by: decoded.by, requireApproval, now });
    if (res.ok) { applied.push({ ref: entry.item.ref, decision: DECISIONS[entry.item.d], note: entry.item.note }); postIds.push(entry.post.id); } else {
      rejected.push({ ref: entry.item.ref, reason: res.reason });
      addAudit({ postId: entry.post.id, actor: 'client', action: 'client_response', detail: { packId: pack.id, decision: DECISIONS[entry.item.d], note: entry.item.note, by: decoded.by, version: entry.item.v, notApplied: res.reason }, at: now });
    }
  }
  return { applied, stale: plan.stale, unknown: plan.unknown, rejected, postIds };
}
