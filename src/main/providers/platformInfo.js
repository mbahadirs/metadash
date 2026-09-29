import { ALL_PLATFORMS, isPlatformEnabled } from './index.js';
import { CAPABILITIES, PRIMARY_METRIC, PLATFORM_LABELS, PLATFORM_AUTH } from './capabilities.js';
import { getActiveProfile } from '../db/queries/profiles.js';
import { listAccounts } from '../db/queries/accounts.js';

/**
 * One row per known platform for the renderer (`platforms:list`):
 * { platform, label, enabled, auth, connected, trackedCount, capabilities, primaryMetric }.
 * `connected` = an active profile exists for the platform's auth ('meta' | 'threads'); `enabled` = provider implemented.
 */
export function listPlatformInfo() {
  const profiles = { meta: getActiveProfile('meta'), threads: getActiveProfile('threads') };
  const tracked = listAccounts();
  return ALL_PLATFORMS.map((platform) => {
    const auth = PLATFORM_AUTH[platform];
    return {
      platform,
      label: PLATFORM_LABELS[platform],
      enabled: isPlatformEnabled(platform),
      auth,
      connected: !!profiles[auth],
      trackedCount: tracked.filter((a) => a.platform === platform).length,
      capabilities: { ...CAPABILITIES[platform] },
      primaryMetric: PRIMARY_METRIC[platform],
    };
  });
}
