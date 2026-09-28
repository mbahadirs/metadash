import { q } from '../index.js';

export function getActiveProfile() {
  return q.get('SELECT * FROM profiles WHERE is_active = 1 ORDER BY id DESC LIMIT 1') || null;
}

export function listProfiles() {
  return q.all('SELECT * FROM profiles ORDER BY id');
}

export function upsertProfile({ id, label, appId, tokenRef, tokenExpiresAt }) {
  if (id) {
    q.run(
      'UPDATE profiles SET label = ?, app_id = ?, token_ref = ?, token_expires_at = ? WHERE id = ?',
      label, appId, tokenRef, tokenExpiresAt ?? null, id,
    );
    return id;
  }
  q.run('UPDATE profiles SET is_active = 0');
  const res = q.run(
    'INSERT INTO profiles (label, app_id, token_ref, token_expires_at, created_at, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    label, appId, tokenRef, tokenExpiresAt ?? null, Date.now(),
  );
  return Number(res.lastInsertRowid);
}

export function updateProfileToken(id, tokenRef, tokenExpiresAt) {
  q.run('UPDATE profiles SET token_ref = ?, token_expires_at = ? WHERE id = ?', tokenRef, tokenExpiresAt ?? null, id);
}
