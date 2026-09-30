import crypto from 'node:crypto';
import { generateSecret, encodePairing, decodePairing } from '../../shared/publish/protocol.js';

/**
 * Pairing: the desktop generates a 32-byte secret and shows (1) a .env snippet for the worker host and (2) a pairing
 * string 'mdw1:<base64url(url|secret)>' that another MetaDash install can paste. The data key is generated too but is
 * only shown once in the snippet; the desktop never stores it (the worker needs it, the desktop does not).
 */
export const PLACEHOLDER_URL = 'https://worker.example.com';

export function generatePairing({ url = null } = {}) {
  const secret = generateSecret();
  const dataKey = crypto.randomBytes(32).toString('base64url');
  const envSnippet = [
    '# MetaDash worker (.env). Keep this file private.',
    `MD_WORKER_SECRET=${secret}`,
    `MD_WORKER_DATA_KEY=${dataKey}`,
    '# Optional: public https URL of this worker (signed media links for Meta)',
    `MD_PUBLIC_URL=${url ?? ''}`,
    `TZ=${Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'}`,
  ].join('\n');
  return { secret, envSnippet, pairing: encodePairing(url ?? PLACEHOLDER_URL, secret) };
}

/** { url, pairing? , secret? } → { url, secret }. Throws { code: 'BAD_PAIRING' | 'NO_SECRET' }. */
export function resolveConfigureInput({ url, pairing, secret }) {
  if (pairing) {
    const p = decodePairing(pairing);
    return { url: url || p.url, secret: p.secret };
  }
  if (!secret || String(secret).length < 32) throw Object.assign(new Error('secret missing or too short'), { code: 'NO_SECRET' });
  return { url, secret: String(secret).trim() };
}
