import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getAccount } from '../db/queries/accounts.js';
import { jobMedia } from '../publishing/steps.js';
import { getMediaRoot } from '../planner/assets.js';
import { createMediaHost, ensureHosted } from '../publishing/hosts/index.js';
import { createPublishContext } from '../publishing/context.js';
import { msg } from '../i18n.js';
import { getSharedPublisher, captionOf, firstCommentOf, tokenKeyFor } from '../../shared/publish/index.js';
import { itemIdFor } from './config.js';

/**
 * Builds the worker item for one planner target and uploads its media.
 *   item = { id (uuid), revision, platform, accountId, tokenKey, scheduledAt, policy, payload }
 *   payload = { format, caption (override applied), firstComment, options, externalId, media: MediaRef[], cover }
 *   MediaRef = { sha256, url?, kind, mime, bytes, fileName, format, width, altText, assetId }
 * Media go to the worker content-addressed (PUT /v1/media/:sha256). Items that need a public URL (IG images, all
 * Threads media) use the worker's signed URLs when MD_PUBLIC_URL is set, otherwise the desktop's own media host
 * (v1.4 BYO storage) must provide one — checked here, at push time. IG images that need conversion (PNG/WebP/wide)
 * are converted locally first; the worker has no image tooling.
 */
/** Items whose publish call has not happened this long after their time become `missed` on the worker (plan §4). */
export const WORKER_MAX_LATE_MIN = 360;

const workerError = (key, code, vars = {}) => Object.assign(new Error(msg(key, vars)), { code });

async function convertedCopy(item, variant, convertImage) {
  if (!convertImage) throw workerError('worker_err_convert', 'CONVERT_UNAVAILABLE');
  const outPath = path.join(getMediaRoot(), 'tmp', `${item.asset.sha256}-${variant.variant}-worker.jpg`);
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await convertImage({ filePath: item.filePath, outPath, maxWidth: variant.maxWidth, quality: 90 });
  const buf = await fsp.readFile(outPath);
  return { filePath: outPath, sha256: crypto.createHash('sha256').update(buf).digest('hex'), mime: 'image/jpeg', bytes: buf.length, format: 'jpeg', temp: true };
}

/**
 * @param {{ target: object, post: object, client: object, info: { publicMediaUrl: boolean }, convertImage?: Function,
 *   createHost?: Function, now?: number, publishNow?: boolean }} p
 * @returns {Promise<object>} the item to push
 */
export async function buildItem({ target, post, client, info, convertImage = null, createHost = createMediaHost, now = Date.now(), publishNow = false }) {
  const publisher = getSharedPublisher(target.platform);
  if (!publisher) throw workerError('worker_err_platform', 'PLATFORM_UNSUPPORTED', { platform: target.platform });
  const account = getAccount(target.accountId);
  if (!account) throw workerError('worker_err_account_unknown', 'ACCOUNT_UNKNOWN', { id: target.accountId });
  const { media, cover } = jobMedia(post);
  const job = { target, post, account, media, cover };
  const needsUrl = new Set([...publisher.hostedItems(job), ...publisher.optionalHosted(job)]);
  let host;

  async function refFor(item) {
    if (!item) return null;
    const variant = publisher.imageVariant(item);
    const file = variant ? await convertedCopy(item, variant, convertImage) : { filePath: item.filePath, sha256: item.asset.sha256, mime: item.asset.mime, bytes: item.asset.bytes, format: item.asset.format };
    try {
      const up = await client.putMediaFile(file.sha256, file.filePath, file.mime);
      let url = null;
      if (needsUrl.has(item) && !info?.publicMediaUrl) {
        host ??= createHost();
        if (!host) throw workerError('worker_err_media_host', 'MEDIA_HOST_REQUIRED');
        url = (await ensureHosted({ host, assetId: item.assetId, name: path.basename(file.filePath), filePath: file.filePath, mime: file.mime, kind: item.asset.kind, ctx: createPublishContext(), account, now })).url;
      }
      return {
        sha256: file.sha256, url: url ?? null, kind: item.asset.kind, mime: file.mime, bytes: up?.bytes ?? file.bytes ?? null, fileName: item.asset.fileName ?? null,
        format: file.format ?? null, width: variant ? Math.min(item.asset.width ?? variant.maxWidth, variant.maxWidth) : item.asset.width ?? null, altText: item.altText ?? null, assetId: String(item.assetId),
      };
    } finally {
      if (file.temp) await fsp.rm(file.filePath, { force: true }).catch(() => {});
    }
  }

  const refs = [];
  for (const m of media) refs.push(await refFor(m));
  const coverRef = cover ? await refFor(cover) : null;
  return {
    id: itemIdFor(target),
    revision: Math.max(1, target.revision ?? 1),
    platform: target.platform,
    accountId: account.igId,
    tokenKey: tokenKeyFor(target.platform, account.igId),
    scheduledAt: post.scheduledAt,
    policy: { maxLateMinutes: WORKER_MAX_LATE_MIN, publishNow },
    payload: {
      format: target.format, caption: captionOf(job), firstComment: firstCommentOf(job), options: target.options ?? {}, externalId: String(account.externalId),
      media: refs, cover: coverRef,
    },
  };
}
