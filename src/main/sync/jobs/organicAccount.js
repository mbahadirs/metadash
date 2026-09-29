import { subDays, differenceInHours } from 'date-fns';
import { getProvider } from '../../providers/index.js';
import { syncPlatformAccount } from './platformAccount.js';

// needsRefresh moved to providers/shared/tiers.js (v1.3); re-exported for existing imports.
export { needsRefresh } from '../../providers/shared/tiers.js';

/** Instagram organic sync — the generic platform job with the Instagram provider. */
export async function syncOrganicAccount(ctx, account) {
  return syncPlatformAccount(ctx, getProvider('instagram'), account);
}

export { differenceInHours, subDays };
