import fs from 'node:fs';
import { publishError } from '../errors.js';

/**
 * EXPERIMENTAL host: uploads the image as an unpublished photo of a Facebook Page you manage and hands Meta the
 * photo's CDN URL. Unofficial: CDN URLs are signed and may expire, and Meta may change this at any time. Images only.
 * The Page is `planner.mediaHost.pageId` or, for Instagram, the Page linked to the account.
 * `temporary=true` is VERIFY (documented for scheduled multi-photo posts).
 */
const CDN_TTL_MS = 60 * 60_000; // assume the signed CDN URL lives at least an hour

export function createFbPageHost({ pageId: configuredPageId, openAsBlob = fs.openAsBlob, now = Date.now } = {}) {
  const pageFor = (account) => configuredPageId || account?.pageId || null;
  return {
    type: 'fbpage',
    supportsVideo: false,
    deleteAfterPublish: true,
    keyFor: (name) => name,
    matches: () => false, // never reuse: CDN URLs expire
    async upload({ filePath, mime, kind, ctx, account }) {
      if (kind === 'video') throw publishError('pub_host_video_unsupported');
      const pageId = pageFor(account);
      if (!pageId) throw publishError('pub_fbpage_no_page');
      const token = await ctx.pageToken(pageId);
      const form = new FormData();
      form.set('source', await openAsBlob(filePath, { type: mime }), 'image');
      form.set('published', 'false');
      form.set('temporary', 'true');
      const created = await ctx.meta.postForm(`/${pageId}/photos`, form, { token });
      const photo = await ctx.meta.get(`/${created.id}`, { fields: 'images' }, { token });
      const best = [...(photo?.images ?? [])].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      if (!best?.source) throw publishError('pub_fbpage_no_url');
      return { objectKey: `${pageId}:${created.id}`, publicUrl: best.source, expiresAt: now() + CDN_TTL_MS };
    },
    async cleanup(upload, { ctx } = {}) {
      const [pageId, photoId] = String(upload.objectKey ?? '').split(':');
      if (!photoId || !ctx) return;
      await ctx.meta.del(`/${photoId}`, {}, { token: await ctx.pageToken(pageId) });
    },
    async test() {
      return { ok: true, url: null, status: null, ms: 0 };
    },
  };
}
