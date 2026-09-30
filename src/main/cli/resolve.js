import { msg } from '../i18n.js';

/**
 * Account resolution for CLI arguments: '@username', 'platform:@username' (platform may be an alias: ig, fb, th, yt,
 * tt), an account key ('1784…', 'fb-…', 'th-…', 'yt-…', 'tt-…'; a bare word that is no key is tried as a username),
 * --client "<name>", --tag <name>. Unknown or ambiguous matches → CliUsageError (exit 2) with `candidates`.
 */
export class CliUsageError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'CliUsageError';
    Object.assign(this, extra);
  }
}

export const PLATFORM_ALIASES = Object.freeze({ ig: 'instagram', fb: 'facebook', th: 'threads', yt: 'youtube', tt: 'tiktok' });

const L = (lang) => (key, vars) => msg(key, vars, lang ?? undefined);
const lower = (s) => String(s ?? '').toLowerCase();

/** Parses one account reference into { platform?, username? , key? }. Pure. */
export function parseAccountRef(ref, { lang } = {}) {
  const s = String(ref ?? '').trim();
  if (!s) throw new CliUsageError(L(lang)('cli_err_empty_account'));
  const m = /^([a-z]+):(@?.+)$/.exec(s);
  if (m && !/^\d/.test(m[1])) return { platform: PLATFORM_ALIASES[m[1]] ?? m[1], ...parseAccountRef(m[2], { lang }) };
  if (s.startsWith('@')) return { username: s.slice(1) };
  return { key: s };
}

const label = (a) => `${a.platform ?? 'instagram'}:@${a.username} (${a.igId})`;

/**
 * Resolves references against accounts ({ igId, platform, username, clientName }).
 * @returns {object[]} accounts, in reference order
 */
export function resolveAccounts(refs, accounts, { lang } = {}) {
  const t = L(lang);
  const out = [];
  for (const ref of refs) {
    const r = parseAccountRef(ref, { lang });
    const onPlatform = (a) => !r.platform || (a.platform ?? 'instagram') === r.platform;
    let hits = r.key ? accounts.filter((a) => a.igId === r.key && onPlatform(a)) : [];
    if (!hits.length) {
      const name = lower(r.username ?? r.key);
      hits = accounts.filter((a) => lower(a.username) === name && onPlatform(a));
    }
    if (!hits.length) throw new CliUsageError(t('cli_err_unknown_account', { ref }));
    if (hits.length > 1) throw new CliUsageError(t('cli_err_ambiguous_account', { ref }), { candidates: hits.map(label) });
    out.push(hits[0]);
  }
  return out;
}

/** Validates platform names (aliases allowed) against `known`. */
export function resolvePlatforms(list, known, { lang } = {}) {
  return [...new Set(list.map((p) => {
    const name = PLATFORM_ALIASES[lower(p)] ?? lower(p);
    if (!known.includes(name)) throw new CliUsageError(L(lang)('cli_err_unknown_platform', { value: p, list: known.join(', ') }));
    return name;
  }))];
}

/** Tag names → ids (case-insensitive). tags = [{ id, name }]. */
export function resolveTags(names, tags, { lang } = {}) {
  return names.map((n) => {
    const hit = tags.find((t) => lower(t.name) === lower(n));
    if (!hit) throw new CliUsageError(L(lang)('cli_err_unknown_tag', { value: n }), { candidates: tags.map((t) => t.name) });
    return hit.id;
  });
}

/**
 * Account selection from --account refs, --client names, --tag names and --platform filters.
 * Refs are added as given; clients add every account with that client name; tags add every account carrying the tag.
 * Platforms narrow the result. Deduplicated, first-seen order.
 * @returns {{ accounts: object[], tagIds: number[] }}
 */
export function selectAccounts({ refs = [], clients = [], tags = [], platforms = [] }, { accounts, tagList = [] }, { lang } = {}) {
  const t = L(lang);
  const picked = [...resolveAccounts(refs, accounts, { lang })];
  for (const c of clients) {
    const hits = accounts.filter((a) => lower(a.clientName) === lower(c));
    if (!hits.length) {
      const names = [...new Set(accounts.map((a) => a.clientName).filter(Boolean))].sort();
      throw new CliUsageError(t('cli_err_unknown_client', { value: c }), { candidates: names });
    }
    picked.push(...hits);
  }
  const tagIds = resolveTags(tags, tagList, { lang });
  if (tagIds.length) picked.push(...accounts.filter((a) => (a.tagIds ?? []).some((id) => tagIds.includes(id))));
  const seen = new Set();
  const unique = picked.filter((a) => (seen.has(a.igId) ? false : seen.add(a.igId)));
  return { accounts: platforms.length ? unique.filter((a) => platforms.includes(a.platform ?? 'instagram')) : unique, tagIds };
}
