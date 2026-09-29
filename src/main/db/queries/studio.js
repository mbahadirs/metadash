import { q } from '../index.js';

/**
 * AI studio queries (migration 010). Chunks B/C/D add their own query modules (e.g. db/queries/comments.js,
 * db/queries/abtests.js) instead of editing this file.
 */

/** Every studio table, children first (seed clearAll deletes them before the planner tables). */
export const STUDIO_TABLES = ['comment_replies', 'ab_test_items', 'ab_tests', 'caption_variants', 'ai_generations', 'brand_voice'];

const parseJson = (s, fallback = null) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};
const toJson = (v) => (v == null ? null : JSON.stringify(v));

// ---------------------------------------------------------------- brand voice

function mapVoice(r) {
  if (!r) return null;
  return {
    accountId: r.account_id, brief: r.brief, profile: parseJson(r.profile), source: r.source,
    derivedFrom: r.derived_from, derivedAt: r.derived_at, provider: r.provider, model: r.model,
    aiDisabled: r.ai_disabled === 1, updatedAt: r.updated_at,
  };
}

export function getBrandVoice(accountId) {
  return mapVoice(q.get('SELECT * FROM brand_voice WHERE account_id = ?', String(accountId)));
}

const VOICE_FIELDS = { brief: 'brief', source: 'source', derivedFrom: 'derived_from', derivedAt: 'derived_at', provider: 'provider', model: 'model' };

/**
 * Inserts or patches the account's voice. patch: { brief?, profile?, source?, derivedFrom?, derivedAt?, provider?, model?, aiDisabled? }.
 * Omitted fields keep their stored value. Returns the mapped row.
 */
export function upsertBrandVoice(accountId, patch = {}, { now = Date.now() } = {}) {
  const id = String(accountId);
  q.tx(() => {
    q.run('INSERT INTO brand_voice (account_id, updated_at) VALUES (?, ?) ON CONFLICT(account_id) DO NOTHING', id, now);
    const sets = [];
    const params = [];
    for (const [key, col] of Object.entries(VOICE_FIELDS)) {
      if (key in patch) { sets.push(`${col} = ?`); params.push(patch[key] ?? (key === 'brief' ? '' : key === 'source' ? 'manual' : null)); }
    }
    if ('profile' in patch) { sets.push('profile = ?'); params.push(toJson(patch.profile)); }
    if ('aiDisabled' in patch) { sets.push('ai_disabled = ?'); params.push(patch.aiDisabled ? 1 : 0); }
    sets.push('updated_at = ?');
    params.push(now);
    q.run(`UPDATE brand_voice SET ${sets.join(', ')} WHERE account_id = ?`, ...params, id);
  })();
  return getBrandVoice(id);
}

/** Subset of accountIds that opted out of AI (brand_voice.ai_disabled = 1). */
export function aiDisabledAccounts(accountIds = []) {
  const ids = [...new Set((accountIds ?? []).filter((x) => x != null).map(String))];
  if (!ids.length) return [];
  const rows = q.all(`SELECT account_id FROM brand_voice WHERE ai_disabled = 1 AND account_id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const disabled = new Set(rows.map((r) => r.account_id));
  return ids.filter((id) => disabled.has(id));
}

// ---------------------------------------------------------------- generations / usage

/** Raw insert (use ai/usage.js recordGeneration, which prices and sanitizes). Returns the id. */
export function insertGeneration(row) {
  const res = q.run(
    `INSERT INTO ai_generations (at, feature, account_id, post_id, provider, model, input_tokens, output_tokens, images, est_cost_usd, duration_ms, status, error_code, sent_summary, output)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.at ?? Date.now(), row.feature, row.accountId ?? null, row.postId ?? null, row.provider ?? null, row.model ?? null,
    row.inputTokens ?? null, row.outputTokens ?? null, row.images ?? 0, row.estCostUsd ?? null, row.durationMs ?? null,
    row.status ?? null, row.errorCode ?? null, toJson(row.sentSummary), toJson(row.output),
  );
  return Number(res.lastInsertRowid);
}

function mapGeneration(r) {
  if (!r) return null;
  return {
    id: r.id, at: r.at, feature: r.feature, accountId: r.account_id, postId: r.post_id, provider: r.provider, model: r.model,
    inputTokens: r.input_tokens, outputTokens: r.output_tokens, images: r.images, estCostUsd: r.est_cost_usd,
    durationMs: r.duration_ms, status: r.status, errorCode: r.error_code, sentSummary: parseJson(r.sent_summary), output: parseJson(r.output),
  };
}

export function getGeneration(id) {
  return mapGeneration(q.get('SELECT * FROM ai_generations WHERE id = ?', id));
}

export function listGenerations({ limit = 50, before, feature } = {}) {
  const where = ['1 = 1'];
  const params = [];
  if (before) { where.push('id < ?'); params.push(before); }
  if (feature) { where.push('feature = ?'); params.push(feature); }
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  return q.all(`SELECT * FROM ai_generations WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${n}`, ...params).map(mapGeneration);
}

/** usd is NULL for a group when any of its calls has unknown pricing and none is priced; otherwise the priced sum. */
const GROUP_COLS = `COUNT(*) AS calls, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
  COALESCE(SUM(images), 0) AS images, SUM(est_cost_usd) AS usd, SUM(CASE WHEN est_cost_usd IS NULL THEN 1 ELSE 0 END) AS unknownCost,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors`;

/** Aggregates ai_generations with from ≤ at < to: totals plus byFeature / byModel (sorted by cost, then calls). */
export function usageSummary({ from = 0, to = Date.now() + 1 } = {}) {
  const total = q.get(`SELECT ${GROUP_COLS} FROM ai_generations WHERE at >= ? AND at < ?`, from, to);
  const byFeature = q.all(`SELECT feature, ${GROUP_COLS} FROM ai_generations WHERE at >= ? AND at < ? GROUP BY feature ORDER BY COALESCE(usd, 0) DESC, calls DESC`, from, to);
  const byModel = q.all(`SELECT provider, model, ${GROUP_COLS} FROM ai_generations WHERE at >= ? AND at < ? GROUP BY provider, model ORDER BY COALESCE(usd, 0) DESC, calls DESC`, from, to);
  return {
    from, to,
    totalUsd: total.usd ?? 0, calls: total.calls, inputTokens: total.inputTokens, outputTokens: total.outputTokens,
    images: total.images, unknownCostCalls: total.unknownCost ?? 0, errors: total.errors ?? 0,
    byFeature, byModel,
  };
}

// ---------------------------------------------------------------- caption variants

function mapVariant(r) {
  return { id: r.id, postId: r.post_id, label: r.label, lang: r.lang, angle: r.angle, text: r.text, generationId: r.generation_id, chosen: r.chosen === 1, createdAt: r.created_at };
}

/** Replaces the post's variants. variants: [{ label, lang?, angle?, text }]; chosenLabel marks one as chosen. */
export function insertCaptionVariants(postId, variants = [], { generationId = null, now = Date.now(), chosenLabel = null, replace = true } = {}) {
  q.tx(() => {
    if (replace) q.run('DELETE FROM caption_variants WHERE post_id = ?', postId);
    for (const v of variants) {
      q.run(
        'INSERT INTO caption_variants (post_id, label, lang, angle, text, generation_id, chosen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        postId, String(v.label), v.lang ?? null, v.angle ?? null, String(v.text ?? ''), generationId, chosenLabel && v.label === chosenLabel ? 1 : 0, now,
      );
    }
  })();
  return listCaptionVariants(postId);
}

export function listCaptionVariants(postId) {
  return q.all('SELECT * FROM caption_variants WHERE post_id = ? ORDER BY label, id', postId).map(mapVariant);
}

export function chooseCaptionVariant(postId, label) {
  q.tx(() => {
    q.run('UPDATE caption_variants SET chosen = 0 WHERE post_id = ?', postId);
    q.run('UPDATE caption_variants SET chosen = 1 WHERE post_id = ? AND label = ?', postId, String(label));
  })();
  return listCaptionVariants(postId);
}

// ---------------------------------------------------------------- planner_posts AI columns

/** Sets planner_posts.ai_meta (JSON) and, when given, parent_post_id. Does not bump the post version (not content). */
export function setPostAiMeta(postId, aiMeta, { parentPostId } = {}) {
  if (parentPostId !== undefined) q.run('UPDATE planner_posts SET ai_meta = ?, parent_post_id = ? WHERE id = ?', toJson(aiMeta), parentPostId, postId);
  else q.run('UPDATE planner_posts SET ai_meta = ? WHERE id = ?', toJson(aiMeta), postId);
}

export function getPostAiMeta(postId) {
  const r = q.get('SELECT ai_meta, parent_post_id FROM planner_posts WHERE id = ?', postId);
  return r ? { aiMeta: parseJson(r.ai_meta), parentPostId: r.parent_post_id } : null;
}
