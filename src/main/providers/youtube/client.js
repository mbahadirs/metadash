import { getProfileById } from '../../db/queries/profiles.js';
import { createYtClient } from './api.js';
import { quotaKeyFor } from './quota.js';

/**
 * API client for one YouTube account inside a sync/inbox run: the channel's own token (ctx.tokenForAccount refreshes
 * it through provider.refreshToken when it is about to expire) and the quota ledger of the OAuth client it was
 * connected with (profiles.app_id).
 */
export async function clientFor(ctx, account) {
  const token = await ctx.tokenForAccount(account);
  const profile = account?.profileId != null ? getProfileById(account.profileId) : null;
  return createYtClient({ token, quotaKey: profile?.app_id ? quotaKeyFor(profile.app_id) : null, signal: ctx.signal });
}

/** Granted scopes of an account's profile. */
export function profileOfAccount(account) {
  return account?.profileId != null ? getProfileById(account.profileId) : null;
}
