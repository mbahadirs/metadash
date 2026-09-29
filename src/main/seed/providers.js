import { listProviders, getProvider } from '../providers/index.js';
import { rng } from './random.js';

/**
 * Provider demo registry (v2.0): every ENABLED provider with a `demo` hook seeds its own demo accounts
 * ({ seed({ now, rng }), extendDay?(key, r, date) }). Built-in platforms keep their seeders in seed/index.js and
 * seed/platforms.js. Each provider gets its own PRNG stream, so existing demo data never changes.
 */
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function seedProviderDemos({ now = new Date(), onProgress } = {}) {
  const out = {};
  for (const p of listProviders()) {
    if (typeof p.demo?.seed !== 'function') continue;
    onProgress?.(`${p.label ?? p.platform} demo`);
    out[p.platform] = p.demo.seed({ now, rng: rng(hash(p.platform)) });
  }
  return out;
}

/** One more demo day for an account of a provider with demo.extendDay; false when no hook applies. */
export function extendProviderDay(key, platform, r, date) {
  const hook = getProvider(platform)?.demo?.extendDay;
  if (typeof hook !== 'function') return false;
  hook(key, r, date);
  return true;
}
