/**
 * Account resolution for CLI arguments (skeleton; F2 implements): '@username', 'platform:@username', an account key
 * ('1784…', 'fb-…', 'th-…', 'yt-…', 'tt-…'), --client "<name>", --tag <name>. Ambiguous matches → CliUsageError with
 * `candidates` (exit 2).
 */
export class CliUsageError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'CliUsageError';
    Object.assign(this, extra);
  }
}

/** Parses one account reference into { platform, username, key }. Pure. */
export function parseAccountRef(ref) {
  const s = String(ref ?? '').trim();
  if (!s) throw new CliUsageError('empty account reference');
  const m = /^([a-z]+):(@?.+)$/.exec(s);
  if (m && !/^\d/.test(m[1])) return { platform: m[1], ...parseAccountRef(m[2]) };
  if (s.startsWith('@')) return { username: s.slice(1) };
  return { key: s };
}

/**
 * Resolves references against a list of accounts ({ igId, platform, username, clientName }).
 * @returns {object[]} accounts
 */
export function resolveAccounts(refs, accounts) {
  const out = [];
  for (const ref of refs) {
    const r = parseAccountRef(ref);
    const hits = accounts.filter((a) => (r.key ? a.igId === r.key : a.username?.toLowerCase() === r.username?.toLowerCase())
      && (!r.platform || a.platform === r.platform));
    if (!hits.length) throw new CliUsageError(`unknown account: ${ref}`);
    if (hits.length > 1) throw new CliUsageError(`ambiguous account: ${ref}`, { candidates: hits.map((a) => `${a.platform}:@${a.username}`) });
    out.push(hits[0]);
  }
  return out;
}
