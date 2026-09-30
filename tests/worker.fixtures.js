/** Shared setup for the worker tests (not a test file). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { createStore } from '../worker/src/store.js';
import { createDataVault } from '../worker/src/crypto.js';
import { createMediaStore } from '../worker/src/media.js';
import { createTokenVault } from '../worker/src/tokens.js';
import { createScheduler } from '../worker/src/scheduler.js';
import { upsertItems } from '../worker/src/items.js';
import { silentLogger } from '../worker/src/log.js';
import { generateSecret } from '../src/shared/publish/protocol.js';

export const DATA_KEY = 'd'.repeat(48);
export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

export function tmpDir(prefix = 'mdw-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Store + vault + media + tokens + scheduler wired like server.js, with a controllable clock. */
export function makeWorkerParts({ dir = tmpDir(), fetchImpl, publicUrl = 'https://worker.test', strictScopes = false } = {}) {
  const clock = { t: T0 };
  const now = () => clock.t;
  const secret = generateSecret();
  const store = createStore({ dir, now });
  const vault = createDataVault(DATA_KEY);
  const media = createMediaStore({ dir, store, getSecret: () => secret, publicUrl, now });
  const tokens = createTokenVault({ store, vault, getSecret: () => secret, fetchImpl, now, strictScopes, log: silentLogger });
  const scheduler = createScheduler({ store, tokens, media, fetchImpl, now, log: silentLogger });
  const addToken = (key, token, extra = {}) => store.putToken(key, { platform: key.split(':')[0], accountId: key.split(':')[1], sealed: vault.seal(token, key), expiresAt: null, scopes: [], valid: true, ...extra });
  const push = (items) => upsertItems({ store, tokens, media, now }, items);
  async function addMedia(bytes = crypto.randomBytes(64), mime = 'image/jpeg') {
    const sha = crypto.createHash('sha256').update(bytes).digest('hex');
    await media.put(sha, Readable.from([bytes]), { mime });
    return sha;
  }
  return { dir, clock, now, secret, store, vault, media, tokens, scheduler, addToken, push, addMedia };
}

export function igItem(overrides = {}) {
  return {
    id: crypto.randomUUID(), revision: 1, platform: 'instagram', accountId: '17840000', tokenKey: 'instagram:17840000', scheduledAt: T0 + 10 * 60_000,
    policy: { maxLateMinutes: 360 },
    payload: { format: 'image', caption: 'Hello worker', firstComment: null, options: {}, externalId: '17840000', media: [] },
    ...overrides,
  };
}
