import { publishError } from '../errors.js';

/**
 * "Already hosted" media: the user mirrors the planner media folder (files are named <sha256>.<ext>) to a public web
 * folder and enters its base URL. Each file is checked with an anonymous HEAD before Meta gets the URL. Converted
 * variants (IG JPEG conversion) cannot exist there, so such images fail with a clear message.
 */
const HEAD_TIMEOUT_MS = 15_000;

export function createUrlHost({ baseUrl, fetchImpl = (...a) => fetch(...a) }) {
  let base;
  try { base = new URL(baseUrl); } catch { throw publishError('pub_url_base_invalid'); }
  if (!/^https?:$/.test(base.protocol)) throw publishError('pub_url_base_invalid');
  const root = base.toString().replace(/\/+$/, '');

  async function check(url) {
    let res;
    try {
      res = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
    } catch (e) {
      throw publishError('pub_url_unreachable', { url, status: e?.message ?? 'network' }, { kind: 'transient', code: 'url_network' });
    }
    if (res.status !== 200) throw publishError('pub_url_unreachable', { url, status: res.status }, { code: `url_${res.status}` });
    return res;
  }

  return {
    type: 'url',
    supportsVideo: true,
    deleteAfterPublish: false,
    keyFor: (name) => name,
    matches: () => false,
    persist: false, // nothing is uploaded: no planner_uploads row
    async upload({ name, variant }) {
      if (variant) throw publishError('pub_url_needs_original', { name });
      const url = `${root}/${encodeURIComponent(name)}`;
      await check(url);
      return { objectKey: null, publicUrl: url, expiresAt: null };
    },
    async cleanup() {},
    async test() {
      const started = Date.now();
      try {
        const res = await fetchImpl(root + '/', { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
        return { ok: res.status < 500, url: root, status: res.status, ms: Date.now() - started };
      } catch (e) {
        return { ok: false, url: root, status: null, ms: Date.now() - started, error: e?.message ?? String(e) };
      }
    },
  };
}
