import { deriveKey, seal, open } from './shared.js';

/**
 * Encryption at rest. Tokens received from the desktop (sealed with K_tok, see protocol.js) are opened once and
 * re-sealed with a key derived from MD_WORKER_DATA_KEY, which comes from the environment or a Docker secret and is
 * never written to /data. Losing the data volume alone exposes nothing.
 */
export const MIN_DATA_KEY_LENGTH = 32;

/** @param {string} dataKey @returns {{ seal: (plain: string, aad: string) => string, open: (env: string, aad: string) => string }} */
export function createDataVault(dataKey) {
  if (typeof dataKey !== 'string' || dataKey.length < MIN_DATA_KEY_LENGTH) {
    throw Object.assign(new Error(`MD_WORKER_DATA_KEY must be at least ${MIN_DATA_KEY_LENGTH} characters`), { code: 'BAD_DATA_KEY' });
  }
  const key = deriveKey(dataKey, 'data');
  return {
    seal: (plain, aad) => seal(key, plain, `data:${aad}`),
    open: (envelope, aad) => open(key, envelope, `data:${aad}`),
  };
}

/** Opens a token envelope sealed by the desktop with the shared secret (AAD = token key). */
export function openTokenEnvelope(secret, envelope, tokenKey) {
  return open(deriveKey(secret, 'token'), envelope, tokenKey);
}

/** Opens a rotation envelope (new secret sealed with the current secret). */
export function openRotation(secret, envelope) {
  return open(deriveKey(secret, 'rotate'), envelope, 'rotate');
}
