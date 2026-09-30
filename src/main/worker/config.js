import crypto from 'node:crypto';
import { getSetting, setSetting, deleteSetting } from '../db/queries/settings.js';
import { storeToken, readToken } from '../config/store.js';

/**
 * Worker settings (DB settings table; the secret encrypted with the machine key like every other token):
 *   worker.url, worker.enabled, worker.cursor, worker.defaultExecutor, worker.lastSyncAt, worker.lastError,
 *   worker.installId (namespace for item ids), worker.info (last /v1/info), token:worker:secret
 */
export const SECRET_REF = 'token:worker:secret';
const KEYS = ['worker.url', 'worker.enabled', 'worker.cursor', 'worker.defaultExecutor', 'worker.lastSyncAt', 'worker.lastError', 'worker.info'];

export function workerConfig() {
  return {
    url: getSetting('worker.url', null),
    enabled: getSetting('worker.enabled', false) === true,
    cursor: Number(getSetting('worker.cursor', 0)) || 0,
    defaultExecutor: getSetting('worker.defaultExecutor', 'local') === 'worker' ? 'worker' : 'local',
    lastSyncAt: getSetting('worker.lastSyncAt', null),
    lastError: getSetting('worker.lastError', null),
    info: getSetting('worker.info', null),
  };
}

export const readSecret = () => readToken(SECRET_REF);
export const isConfigured = () => !!getSetting('worker.url', null) && !!readSecret();

export function saveConnection({ url, secret }) {
  setSetting('worker.url', url);
  storeToken('worker:secret', secret);
  setSetting('worker.enabled', true);
}

export const setCursor = (seq) => setSetting('worker.cursor', Number(seq) || 0);
export const setDefaultExecutor = (v) => setSetting('worker.defaultExecutor', v === 'worker' ? 'worker' : 'local');
export const setEnabled = (v) => setSetting('worker.enabled', v === true);
export const setSyncResult = ({ at, error }) => { setSetting('worker.lastSyncAt', at); setSetting('worker.lastError', error ?? null); };
export const setInfo = (info) => setSetting('worker.info', info ?? null);

export function clearConnection() {
  for (const k of KEYS) deleteSetting(k);
  storeToken('worker:secret', '');
}

/** Stable per-install namespace for worker item ids (uuid derived from install id + post id + target id). */
export function installId() {
  let id = getSetting('worker.installId', null);
  if (!id) { id = crypto.randomUUID(); setSetting('worker.installId', id); }
  return id;
}

export function itemIdFor(target) {
  const h = crypto.createHash('sha256').update(`${installId()}:${target.postId}:${target.id}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
