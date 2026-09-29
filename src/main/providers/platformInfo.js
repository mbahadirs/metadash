import { listAllProviders, isPlatformEnabled } from './index.js';
import { CAPABILITIES, PRIMARY_METRIC, PLATFORM_LABELS, PLATFORM_AUTH, KEY_PREFIX, metaFor } from './capabilities.js';
import { activeProfiles } from '../db/queries/profiles.js';
import { listAccounts } from '../db/queries/accounts.js';

/**
 * One row per known platform for the renderer (`platforms:list`):
 * { platform, label, enabled, auth, connected, trackedCount, capabilities, primaryMetric, keyPrefix, experimental, multiProfile, profiles }.
 * `connected` = at least one active profile exists for the platform's auth; `enabled` = provider implemented;
 * `profiles` = number of active profiles of that auth (YouTube channels / TikTok accounts).
 * v2.0 stub providers (`contract: true`, e.g. YouTube/TikTok before chunks C1/C2 enable them) are omitted until
 * enabled, so the UI does not change; built-in platforms are always listed (enabled: false = not in this build).
 */
export function listPlatformInfo() {
  const byAuth = new Map();
  const profilesOf = (auth) => {
    if (!byAuth.has(auth)) byAuth.set(auth, activeProfiles(auth).length);
    return byAuth.get(auth);
  };
  const tracked = listAccounts();
  const visible = listAllProviders().filter((p) => p.enabled || !p.contract).map((p) => p.platform);
  return visible.map((platform) => {
    const auth = PLATFORM_AUTH[platform];
    const meta = metaFor(platform);
    return {
      platform,
      label: PLATFORM_LABELS[platform],
      enabled: isPlatformEnabled(platform),
      auth,
      connected: profilesOf(auth) > 0,
      trackedCount: tracked.filter((a) => a.platform === platform).length,
      capabilities: { ...CAPABILITIES[platform] },
      primaryMetric: PRIMARY_METRIC[platform],
      keyPrefix: KEY_PREFIX[platform],
      experimental: !!meta?.experimental,
      multiProfile: !!meta?.multiProfile,
      profiles: profilesOf(auth),
    };
  });
}
