import { q } from '../index.js';

/**
 * Settings key/value store (values JSON-encoded).
 *
 * v2.0 team subscriber mode: the open database is a replaceable snapshot of someone else's workspace, so
 * machine-local keys live in a sidecar store (userData/local.db, team/localStore.js) while it is registered with
 * setLocalSettingsStore(). A snapshot swap then never loses the subscriber's language, theme, UI state, team
 * membership, session, notification preferences or its own AI key. Without a sidecar everything goes to the open DB.
 */
export const LOCAL_KEYS = Object.freeze(['lang', 'theme']);
export const LOCAL_KEY_PREFIXES = Object.freeze(['ui.', 'team.', 'notify.', 'session.', 'ai.', 'app.', 'token:team:', 'token:ai:']);

export function isLocalKey(key) {
  const k = String(key);
  return LOCAL_KEYS.includes(k) || LOCAL_KEY_PREFIXES.some((p) => k.startsWith(p));
}

/** Sidecar: { get(key) → raw JSON string | undefined, set(key, raw), all() → [{ key, value }], delete(key) } or null. */
let localStore = null;
export function setLocalSettingsStore(store) {
  localStore = store && typeof store.get === 'function' && typeof store.set === 'function' ? store : null;
}
export const hasLocalSettingsStore = () => localStore != null;

const decode = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

function readRaw(key) {
  if (localStore && isLocalKey(key)) return localStore.get(key);
  return q.get('SELECT value FROM settings WHERE key = ?', key)?.value;
}

export function getSetting(key, fallback = null) {
  const raw = readRaw(key);
  return raw === undefined || raw === null ? fallback : decode(raw);
}

export function setSetting(key, value) {
  const raw = JSON.stringify(value);
  if (localStore && isLocalKey(key)) {
    localStore.set(key, raw);
    return;
  }
  q.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, raw);
}

/** Removes a key (from the sidecar for machine-local keys while one is registered). */
export function deleteSetting(key) {
  if (localStore && isLocalKey(key)) {
    localStore.delete?.(key);
    return;
  }
  q.run('DELETE FROM settings WHERE key = ?', key);
}

export function getAllSettings() {
  const rows = q.all('SELECT key, value FROM settings');
  const merged = localStore ? [...rows.filter((r) => !isLocalKey(r.key)), ...localStore.all()] : rows;
  return Object.fromEntries(merged.map((r) => [r.key, decode(r.value)]));
}
