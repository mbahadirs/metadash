import { q } from '../index.js';

/**
 * Auth platforms that own profile rows: 'meta' (Instagram + Facebook + Ads) and 'threads' keep ONE active row;
 * v2.0 multi-profile auths ('google' = one row per YouTube channel, 'tiktok' = one per TikTok account) keep one
 * active row per external_id. The registry-driven list is providers/capabilities.js AUTHS.
 */
export const AUTH_PLATFORMS = ['meta', 'threads', 'google', 'tiktok'];
export const MULTI_PROFILE_AUTHS = ['google', 'tiktok'];

/** Active profile for one auth platform (default 'meta'). */
export function getActiveProfile(platform = 'meta') {
  return q.get('SELECT * FROM profiles WHERE is_active = 1 AND platform = ? ORDER BY id DESC LIMIT 1', platform) || null;
}

/** Every profile row, or only one auth platform's rows (`auth`), optionally only active ones. */
export function listProfiles(auth, { activeOnly = false } = {}) {
  const where = [];
  const params = [];
  if (auth) { where.push('platform = ?'); params.push(auth); }
  if (activeOnly) where.push('is_active = 1');
  return q.all(`SELECT * FROM profiles ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id`, ...params);
}

/** Active profiles of an auth platform (multi-profile auths: one per channel/account), oldest first. */
export function activeProfiles(auth) {
  return listProfiles(auth, { activeOnly: true });
}

export function getProfileById(id) {
  return q.get('SELECT * FROM profiles WHERE id = ?', id) || null;
}

/**
 * Multi-profile upsert keyed by (platform, externalId): updates the existing row for that channel/account (and
 * re-activates it) or inserts a new active one. Other profiles of the same auth are left active.
 * scopes: string[] (stored as JSON). Returns the profile id.
 */
export function upsertExternalProfile({ platform, externalId, label, appId, tokenRef, tokenExpiresAt, refreshRef, scopes, refreshedAt }) {
  if (!platform || !externalId) throw new Error('upsertExternalProfile: platform and externalId are required');
  const existing = q.get('SELECT id FROM profiles WHERE platform = ? AND external_id = ?', platform, String(externalId));
  const scopesJson = scopes ? JSON.stringify([...scopes]) : null;
  if (existing) {
    q.run(
      `UPDATE profiles SET label = ?, app_id = ?, token_ref = ?, token_expires_at = ?, refresh_ref = COALESCE(?, refresh_ref),
         scopes = COALESCE(?, scopes), refreshed_at = COALESCE(?, refreshed_at), is_active = 1 WHERE id = ?`,
      label, appId, tokenRef, tokenExpiresAt ?? null, refreshRef ?? null, scopesJson, refreshedAt ?? null, existing.id,
    );
    return existing.id;
  }
  const res = q.run(
    `INSERT INTO profiles (label, app_id, token_ref, token_expires_at, created_at, is_active, platform, refreshed_at, external_id, scopes, refresh_ref)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    label, appId, tokenRef, tokenExpiresAt ?? null, Date.now(), platform, refreshedAt ?? null, String(externalId), scopesJson, refreshRef ?? null,
  );
  return Number(res.lastInsertRowid);
}

/** Granted scopes of a profile row (JSON column) as an array. */
export function profileScopes(profile) {
  try { const v = JSON.parse(profile?.scopes ?? 'null'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Deactivates one profile row (multi-profile disconnect). */
export function deactivateProfile(id) {
  q.run('UPDATE profiles SET is_active = 0 WHERE id = ?', id);
}

/**
 * Updates profile `id`, or inserts a new active profile for `platform` (deactivating only that platform's other profiles).
 */
export function upsertProfile({ id, label, appId, tokenRef, tokenExpiresAt, platform = 'meta', refreshedAt }) {
  if (id) {
    q.run(
      'UPDATE profiles SET label = ?, app_id = ?, token_ref = ?, token_expires_at = ?, refreshed_at = COALESCE(?, refreshed_at) WHERE id = ?',
      label, appId, tokenRef, tokenExpiresAt ?? null, refreshedAt ?? null, id,
    );
    return id;
  }
  q.run('UPDATE profiles SET is_active = 0 WHERE platform = ?', platform);
  const res = q.run(
    'INSERT INTO profiles (label, app_id, token_ref, token_expires_at, created_at, is_active, platform, refreshed_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
    label, appId, tokenRef, tokenExpiresAt ?? null, Date.now(), platform, refreshedAt ?? null,
  );
  return Number(res.lastInsertRowid);
}

/** Replaces a profile's token reference/expiry; `refreshedAt` (ms) is recorded when given (Threads refresh). */
export function updateProfileToken(id, tokenRef, tokenExpiresAt, refreshedAt) {
  q.run(
    'UPDATE profiles SET token_ref = ?, token_expires_at = ?, refreshed_at = COALESCE(?, refreshed_at) WHERE id = ?',
    tokenRef, tokenExpiresAt ?? null, refreshedAt ?? null, id,
  );
}

/** Deactivates every profile of an auth platform (e.g. Threads disconnect). Rows are kept for history. */
export function deactivateProfiles(platform) {
  q.run('UPDATE profiles SET is_active = 0 WHERE platform = ?', platform);
}
