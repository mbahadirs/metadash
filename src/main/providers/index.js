import instagram from './instagram/index.js';
import facebook from './facebook/index.js';
import threads from './threads/index.js';
import youtube from './youtube/index.js';
import tiktok from './tiktok/index.js';

/**
 * Registration order = display/sync order (must match providers/metas.js). Stub providers ({ enabled: false }) are
 * skipped by listProviders/getProvider; built-in stubs stay in ALL_PLATFORMS (platforms:list: not enabled).
 * providers/_template is never registered.
 */
const REGISTERED = [instagram, facebook, threads, youtube, tiktok];

/** Every registered platform, including contract stubs (providers/metas.js order). */
export const KNOWN_PLATFORMS = REGISTERED.map((p) => p.platform);

/**
 * Platforms the app knows about at runtime: enabled providers plus built-in stubs (`enabled: false` without
 * `contract`, shown as "not in this build"). v2.0 contract stubs (YouTube/TikTok) join once their chunk enables them.
 */
export const ALL_PLATFORMS = REGISTERED.filter((p) => p.enabled || !p.contract).map((p) => p.platform);

const overrides = new Map();

function resolve(p) {
  return overrides.has(p.platform) ? overrides.get(p.platform) : p;
}

/** Enabled providers in registration order. */
export function listProviders() {
  return REGISTERED.map(resolve).filter((p) => p && p.enabled);
}

/** Every registered provider module including stubs, ignoring test overrides (contract tests, platforms:list). */
export function listAllProviders() {
  return [...REGISTERED];
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

/** Distinct auth platforms of the enabled providers ('meta', 'threads', 'google', 'tiktok'), registry order. */
export function enabledAuths() {
  return [...new Set(listProviders().map((p) => p.auth))];
}

/** Test hook: replace a platform's provider (pass null to disable, undefined to restore). */
export function __setProviderForTests(platform, provider) {
  if (provider === undefined) overrides.delete(platform);
  else overrides.set(platform, provider);
}
