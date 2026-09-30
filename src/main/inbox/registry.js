import { getProvider } from '../providers/index.js';
import { instagramInbox } from './adapters/instagram.js';
import { facebookInbox } from './adapters/facebook.js';
import { threadsInbox } from './adapters/threads.js';

/**
 * Inbox adapter lookup: a provider's own `inbox` hook (e.g. YouTube, chunk C1) wins, then the built-in adapters.
 * Returns null for platforms without an inbox (TikTok, or YouTube while its provider has no adapter).
 */
export const BUILTIN = Object.freeze({ instagram: instagramInbox, facebook: facebookInbox, threads: threadsInbox });

export function adapterFor(platform, { lookup = getProvider } = {}) {
  let own = null;
  try { own = lookup(platform)?.inbox ?? null; } catch { own = null; }
  const adapter = own ?? BUILTIN[platform] ?? null;
  return adapter && typeof adapter.fetch === 'function' ? adapter : null;
}

/** Platforms that currently have a usable adapter (enabled providers only). */
export function inboxPlatforms(platforms, opts) {
  return platforms.filter((p) => adapterFor(p, opts));
}
