import { MetaError } from '../meta/errors.js';
import { listAccounts } from '../db/queries/accounts.js';
import { pollCandidates } from '../db/queries/inbox.js';
import { capabilitiesFor } from '../providers/capabilities.js';
import { getProvider } from '../providers/index.js';
import { adapterFor } from './registry.js';
import { inboxSettings } from './settings.js';
import { pollPosts } from './poller.js';
import { emitInboxUpdated } from './events.js';

/**
 * On-demand refresh (inbox:refresh, `metadash inbox pull`): polls the inbox posts of the given (or every tracked inbox)
 * accounts outside a sync run, with the publishing token context (user tokens + cached Page tokens). One failing
 * account (token / permission) is counted and skipped; the others continue. Demo mode fetches nothing.
 * → { fetched, errors, accounts, demo? }
 */
export async function refreshInbox({ accountIds } = {}, deps = {}) {
  const demo = deps.isDemo ?? (await import('../publishing/context.js').then((m) => m.isDemoMode()).catch(() => false));
  if (demo) return { fetched: 0, errors: 0, accounts: 0, demo: true };
  const ids = accountIds?.length ? new Set(accountIds.map(String)) : null;
  const accounts = (deps.accounts ?? listAccounts()).filter((a) => capabilitiesFor(a.platform ?? 'instagram').inbox && (!ids || ids.has(a.igId)));
  const ctx = deps.ctx ?? { ...(await import('../publishing/context.js')).createPublishContext(), pageTokens: new Map() };
  const now = deps.now ?? Date.now();
  const { lookbackDays } = inboxSettings();
  let fetched = 0;
  let errors = 0;
  const touched = [];
  for (const account of accounts) {
    const platform = account.platform ?? 'instagram';
    const adapter = deps.adapterFor ? deps.adapterFor(platform) : adapterFor(platform);
    if (!adapter) continue;
    const delay = deps.delay ?? (() => getProvider(platform)?.client?.delay?.() ?? Promise.resolve());
    try {
      const res = await pollPosts(ctx, adapter, account, pollCandidates(account.igId, { now, lookbackDays }), { now, delay, log: deps.log ?? (() => {}) });
      fetched += res.fetched;
      errors += res.errors;
      if (res.fetched) touched.push(account.igId);
    } catch (e) {
      if (!(e instanceof MetaError) && e?.name !== 'NetworkError' && e?.code !== 'page_token_missing' && e?.kind !== 'permission') throw e;
      errors += 1;
      deps.log?.({ igId: account.igId, platform, code: e.code, message: e.message });
    }
  }
  if (touched.length) emitInboxUpdated({ accountIds: touched, reason: 'poll' });
  return { fetched, errors, accounts: accounts.length };
}
