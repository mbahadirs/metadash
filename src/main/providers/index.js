import instagram from './instagram/index.js';
import facebook from './facebook/index.js';
import threads from './threads/index.js';

/** Registration order = display/sync order. Stub providers ({ enabled: false }) are skipped. */
const REGISTERED = [instagram, facebook, threads];

/** Every known platform, including stubs. */
export const ALL_PLATFORMS = REGISTERED.map((p) => p.platform);

const overrides = new Map();

function resolve(p) {
  return overrides.has(p.platform) ? overrides.get(p.platform) : p;
}

/** Enabled providers in registration order. */
export function listProviders() {
  return REGISTERED.map(resolve).filter((p) => p && p.enabled);
}

/** Enabled provider for a platform, or null (unknown platform or stub). */
export function getProvider(platform) {
  const p = REGISTERED.find((r) => r.platform === platform);
  const resolved = p ? resolve(p) : null;
  return resolved?.enabled ? resolved : null;
}

/** True when the platform has an enabled provider. */
export function isPlatformEnabled(platform) {
  return !!getProvider(platform);
}

/** Test hook: replace a platform's provider (pass null to disable, undefined to restore). */
export function __setProviderForTests(platform, provider) {
  if (provider === undefined) overrides.delete(platform);
  else overrides.set(platform, provider);
}
