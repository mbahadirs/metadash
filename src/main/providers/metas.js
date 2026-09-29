import instagram from './instagram/meta.js';
import facebook from './facebook/meta.js';
import threads from './threads/meta.js';
import youtube from './youtube/meta.js';
import tiktok from './tiktok/meta.js';

/**
 * Static metadata of every known platform in display/sync order (pure: only meta.js files, so db/analytics modules
 * can import it without loading provider code). Must list the same platforms, in the same order, as REGISTERED in
 * providers/index.js — tests/providers.contract.test.js checks it. Adding a platform = one line here + one there.
 */
export const PROVIDER_METAS = Object.freeze([instagram, facebook, threads, youtube, tiktok]);

export const ALL_PLATFORM_KEYS = Object.freeze(PROVIDER_METAS.map((m) => m.platform));

export function metaFor(platform) {
  return PROVIDER_METAS.find((m) => m.platform === platform) ?? null;
}
