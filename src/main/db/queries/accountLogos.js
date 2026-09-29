import { q } from '../index.js';
import { checkLogo } from '../../export/branding.js';

/** Per-account client logos, kept out of the accounts table so account lists stay small. */
export function getClientLogo(igId) {
  return q.get('SELECT data_url FROM account_logos WHERE ig_id = ?', igId)?.data_url ?? null;
}

/** { igId: true } for every account that has a client logo. */
export function clientLogoFlags() {
  return Object.fromEntries(q.all('SELECT ig_id FROM account_logos').map((r) => [r.ig_id, true]));
}

/** Sets (validated data URL) or clears (null/empty) an account's client logo. Throws the error key on invalid input. */
export function setClientLogo(igId, dataUrl) {
  if (!dataUrl) { q.run('DELETE FROM account_logos WHERE ig_id = ?', igId); return null; }
  const r = checkLogo(dataUrl);
  if (!r.ok) throw new Error(r.error);
  q.run(`INSERT INTO account_logos (ig_id, data_url, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(ig_id) DO UPDATE SET data_url = excluded.data_url, updated_at = excluded.updated_at`, igId, dataUrl, Date.now());
  return dataUrl;
}

/** Shared client logo for a report: only when every account resolves to the same single logo. */
export function sharedClientLogo(igIds) {
  const logos = [...new Set((igIds ?? []).map(getClientLogo))];
  return logos.length === 1 ? logos[0] : null;
}
