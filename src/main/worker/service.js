import { q } from '../db/index.js';
import { setSetting } from '../db/queries/settings.js';
import { msg } from '../i18n.js';
import { createWorkerClient, normalizeUrl, WorkerHttpError } from './client.js';
import { resolveConfigureInput, generatePairing } from './pairing.js';
import { generateSecret } from '../../shared/publish/protocol.js';
import { saveConnection, clearConnection, isConfigured, setInfo, setDefaultExecutor, setEnabled, setCursor, workerConfig } from './config.js';
import { getClient, workerState, syncNow, setWorkerSyncDeps } from './sync.js';
import { pushToken as pushTokenImpl, revokeToken as revokeTokenImpl, listWorkerTokens, applyRemoteTokens } from './tokens.js';
import { progressBus } from '../sync/progress.js';

/**
 * Connection management used by ipc/worker.handlers.js and cli/commands/worker.js:
 * configure (pairing string or url + secret, verified with a signed /v1/info before saving), test, tokens, disconnect.
 */
let fetchImpl = null;
let nowFn = Date.now;
/** Test hook (also forwards to sync.js): { fetchImpl, now, convertImage, createHost, steps }. */
export function setWorkerServiceDeps(overrides = {}) {
  if (overrides.fetchImpl) fetchImpl = overrides.fetchImpl;
  if (overrides.now) nowFn = overrides.now;
  setWorkerSyncDeps(overrides);
}

const workerError = (key, code, vars = {}) => Object.assign(new Error(msg(key, vars)), { code });

function friendly(e) {
  if (e?.code === 'WORKER_OFFLINE') return workerError('worker_err_offline', 'WORKER_OFFLINE');
  if (e instanceof WorkerHttpError && e.status === 401) return workerError('worker_err_auth', 'WORKER_AUTH');
  if (e instanceof WorkerHttpError && e.status === 429) return workerError('worker_err_rate_limited', 'WORKER_RATE_LIMITED');
  if (e instanceof WorkerHttpError && e.status === 422 && e.code === 'broad_scopes') return workerError('worker_err_broad_scopes', 'BROAD_SCOPES', { scopes: (e.body?.error?.scopes ?? []).join(', ') });
  if (e instanceof WorkerHttpError && e.status === 422 && e.code === 'token_invalid') return workerError('worker_err_token_rejected', 'TOKEN_REJECTED');
  if (e instanceof WorkerHttpError) return workerError('worker_err_http', 'WORKER_ERROR', { code: e.code });
  return e;
}

export const generate = () => generatePairing();

/** worker:configure — verifies the URL and secret against the worker, then stores them. */
export async function configure(payload = {}) {
  let input;
  try { input = resolveConfigureInput(payload); } catch (e) { throw workerError(e.code === 'BAD_PAIRING' ? 'worker_err_pairing' : 'worker_err_secret', e.code); }
  let url;
  try { url = normalizeUrl(input.url); } catch { throw workerError('worker_err_url', 'BAD_URL'); }
  const client = createWorkerClient({ url, secret: input.secret, fetchImpl: fetchImpl ?? globalThis.fetch, now: nowFn });
  try {
    await client.health();
    const info = await client.info();
    saveConnection({ url, secret: input.secret });
    setInfo(info);
    applyRemoteTokens(info.tokens ?? []);
  } catch (e) {
    throw friendly(e);
  }
  progressBus.emit('worker:status', { configured: true, state: 'idle', lastSyncAt: null, lastError: null, queue: null });
  return workerState();
}

/** worker:test → { ok, version, protocol, latencyMs } */
export async function test() {
  const client = getClient();
  try {
    const h = await client.health();
    await client.info(); // signed: proves the secret matches
    return { ok: true, version: h.version, protocol: h.protocol, latencyMs: h.latencyMs };
  } catch (e) {
    throw friendly(e);
  }
}

export const tokens = () => listWorkerTokens();

export async function pushToken(p = {}) {
  try {
    return await pushTokenImpl(p, { client: getClient() });
  } catch (e) {
    throw friendly(e);
  }
}

export async function revokeToken({ tokenKey } = {}) {
  try {
    await revokeTokenImpl(String(tokenKey ?? ''), { client: getClient() });
    return listWorkerTokens();
  } catch (e) {
    throw friendly(e);
  }
}

export async function sync() {
  try {
    return await syncNow({ reason: 'manual' });
  } catch (e) {
    throw friendly(e);
  }
}

/** Preferences (via worker:configure without url/secret): default executor, sync on/off, notify.worker. */
export function setPreferences({ defaultExecutor, enabled, notify } = {}) {
  if (defaultExecutor !== undefined) setDefaultExecutor(defaultExecutor);
  if (enabled !== undefined) setEnabled(enabled === true);
  if (notify !== undefined) setSetting('notify.worker', notify !== false);
  return workerState();
}

/**
 * worker:disconnect — deletes all items, tokens and media on the worker (best effort), then hands every worker target
 * back to this computer and forgets the connection.
 */
export async function disconnect() {
  if (isConfigured()) {
    try { await getClient().reset(); } catch (e) { console.warn('[worker] remote reset failed:', e?.message ?? e); }
  }
  q.run("UPDATE planner_targets SET executor = 'local', worker_revision = NULL, worker_status = NULL, worker_error = NULL, worker_synced_at = NULL WHERE executor = 'worker' OR worker_revision IS NOT NULL");
  q.run('DELETE FROM worker_tokens');
  setCursor(0);
  clearConnection();
  progressBus.emit('worker:status', { configured: false, state: 'idle', lastSyncAt: null, lastError: null, queue: null });
  progressBus.emit('planner:changed', { postIds: [], reason: 'executor', source: 'worker' });
  return true;
}

/**
 * Secret rotation (CLI `metadash worker rotate`): POST /v1/rotate signed with the old secret carries the new secret
 * sealed with the old one; the worker keeps it encrypted in /data (it wins over MD_WORKER_SECRET until that env value
 * changes). The desktop switches only after the worker confirmed.
 * @returns {{ rotated: true, envLine: string }}
 */
export async function rotateSecret() {
  const next = generateSecret();
  try {
    await getClient().rotate(next);
  } catch (e) {
    throw friendly(e);
  }
  saveConnection({ url: workerConfig().url, secret: next });
  return { rotated: true, envLine: `MD_WORKER_SECRET=${next}` };
}
