import { getActiveProfile } from '../db/queries/profiles.js';
import { readToken } from '../config/store.js';
import { debugToken, missingScopesFor } from '../meta/auth.js';
import { MetaError } from '../meta/errors.js';
import { upsertAccount, insertSnapshot, listAccounts, getAccount, setTrackedAccounts, updateAccount } from '../db/queries/accounts.js';
import { findOrCreateTag, setAccountTags } from '../db/queries/tags.js';
import { isDemoProfile } from '../sync/orchestrator.js';
import facebook from '../providers/facebook/index.js';
import { fmtDate } from '../analytics/util.js';
import { msg } from '../i18n.js';

/**
 * Facebook Pages setup channels. Contract:
 *  setup:facebook:discover    () → { items: [{ accountId, pageId, name, pictureUrl, followers, linkedIgId, canAnalyze, tracked, known }], missingScopes: string[], warnings }
 *  setup:facebook:saveTracked ({ accountIds: string[], meta?: Record<accountId, { clientName?, tags?: string[] }> }) → { tracked: number }
 * Pages are stored untracked (opt-in). Ticking a Page linked to an Instagram account copies that account's client name
 * and tags when the Page has none.
 */
export const FACEBOOK_SETUP_CHANNELS = ['setup:facebook:discover', 'setup:facebook:saveTracked'];

const KEY_RE = /^fb-[A-Za-z0-9_]+$/;

function requireMetaToken() {
  const profile = getActiveProfile('meta');
  if (!profile) throw new MetaError({ code: 190, message: 'no profile' });
  if (isDemoProfile(profile)) return { profile, token: null, demo: true };
  const token = readToken(profile.token_ref);
  if (!token) throw new MetaError({ code: 190, message: 'token missing' });
  return { profile, token, demo: false };
}

const knownPages = () => new Map(listAccounts({ onlyTracked: false, platforms: ['facebook'] }).map((a) => [a.igId, a]));

function demoDiscovery() {
  const items = listAccounts({ onlyTracked: false, platforms: ['facebook'] }).map((a) => ({
    accountId: a.igId, pageId: a.externalId, name: a.name ?? a.username, pictureUrl: a.profilePicUrl ?? null, followers: a.followers,
    linkedIgId: a.linkedAccountId, canAnalyze: true, tracked: a.isTracked, known: true,
  }));
  return { items, missingScopes: [], warnings: [] };
}

async function grantedMissingScopes(token) {
  try {
    const health = await debugToken(token);
    return missingScopesFor('facebook', health.scopes);
  } catch (e) {
    console.warn('[facebook] debug_token failed during Page discovery:', e?.message ?? e);
    return []; // advisory only; discovery errors surface on their own
  }
}

export async function discoverFacebookPages() {
  const { profile, token, demo } = requireMetaToken();
  if (demo) return demoDiscovery();
  const ctx = { tokenFor: () => token, token };
  const { items, warnings } = await facebook.discover(ctx);
  const missingScopes = await grantedMissingScopes(token);
  const known = knownPages();
  const today = fmtDate(new Date());
  for (const p of items) {
    upsertAccount({
      igId: p.accountId, platform: 'facebook', externalId: p.externalId, profileId: profile.id, pageId: p.pageId,
      username: p.username, name: p.name, profilePicUrl: p.pictureUrl, linkedAccountId: p.linkedIgId, isTracked: false,
    });
    if (typeof p.followers === 'number') insertSnapshot({ igId: p.accountId, date: today, followers: p.followers });
  }
  return {
    items: items.map((p) => ({
      accountId: p.accountId, pageId: p.pageId, name: p.name, pictureUrl: p.pictureUrl, followers: p.followers,
      linkedIgId: p.linkedIgId, canAnalyze: p.canAnalyze, tracked: known.get(p.accountId)?.isTracked ?? false, known: known.has(p.accountId),
    })),
    missingScopes,
    warnings,
  };
}

/** Copies client name + tags from the linked Instagram account onto a Page that has none. */
function inheritFromLinked(page) {
  const ig = page.linkedAccountId ? getAccount(page.linkedAccountId) : null;
  if (!ig) return;
  if (!page.clientName && ig.clientName) updateAccount(page.igId, { clientName: ig.clientName });
  if (!page.tagIds.length && ig.tagIds.length) setAccountTags(page.igId, ig.tagIds);
}

export function saveTrackedFacebookPages({ accountIds, meta = {} } = {}) {
  if (!Array.isArray(accountIds) || accountIds.some((id) => typeof id !== 'string' || !KEY_RE.test(id))) throw new Error(msg('fb_page_not_found'));
  const known = knownPages();
  if (accountIds.some((id) => !known.has(id))) throw new Error(msg('fb_page_not_found'));
  const ids = [...new Set(accountIds)];
  setTrackedAccounts(ids, { platform: 'facebook' });
  for (const [id, m] of Object.entries(meta ?? {})) {
    if (!known.has(id)) continue;
    if (m?.clientName !== undefined) updateAccount(id, { clientName: m.clientName });
    if (Array.isArray(m?.tags) && m.tags.length) setAccountTags(id, m.tags.map((name) => findOrCreateTag(name).id));
  }
  for (const id of ids) inheritFromLinked(getAccount(id));
  return { tracked: ids.length };
}

export function registerFacebookSetupHandlers(handle) {
  handle('setup:facebook:discover', () => discoverFacebookPages());
  handle('setup:facebook:saveTracked', (payload) => saveTrackedFacebookPages(payload));
}
