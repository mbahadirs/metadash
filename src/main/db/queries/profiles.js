import { q } from '../index.js';

/** Auth platforms that own a profile row: 'meta' (Instagram + Facebook + Ads) and 'threads'. */
export const AUTH_PLATFORMS = ['meta', 'threads'];

/** Active profile for one auth platform (default 'meta'). */
export function getActiveProfile(platform = 'meta') {
  return q.get('SELECT * FROM profiles WHERE is_active = 1 AND platform = ? ORDER BY id DESC LIMIT 1', platform) || null;
}

export function listProfiles() {
  return q.all('SELECT * FROM profiles ORDER BY id');
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
