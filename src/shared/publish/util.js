import fs from 'node:fs';
import { publishError } from './errors.js';

/**
 * Helpers shared by the platform publishers (desktop and self-hosted worker; pure, node:fs only).
 *
 * A publish *job* is what the worker hands a publisher:
 *   { target, post, account, media: MediaItem[], cover: MediaItem|null, now }
 *   MediaItem = { assetId, asset, altText, filePath, url? }   (url = public URL from the media host, when hosted)
 * `account` is the accounts row (externalId = raw API id; pageId = linked Page for Instagram).
 */
export const toUnix = (ms) => Math.floor(ms / 1000);

export const captionOf = (job) => job.target.captionOverride ?? job.post.caption ?? '';

export function firstCommentOf(job) {
  const text = job.target.firstCommentOverride ?? job.post.firstComment ?? null;
  return typeof text === 'string' && text.trim() ? text : null;
}

export const optionsOf = (job) => job.target.options ?? {};

/** The hosted URL of a media item; a missing URL is a worker bug or a missing host. */
export function urlOf(item) {
  if (!item?.url) throw publishError('pub_host_missing');
  return item.url;
}

export async function blobOf(item, openAsBlob = fs.openAsBlob) {
  if (!item?.filePath || !fs.existsSync(item.filePath)) throw publishError('pub_file_missing', { name: item?.asset?.fileName ?? item?.assetId ?? '?' });
  return openAsBlob(item.filePath, { type: item.asset?.mime ?? 'application/octet-stream' });
}

export const fileSize = (item) => item.asset?.bytes ?? fs.statSync(item.filePath).size;

/** Whitespace-insensitive caption comparison (Meta may trim/normalize line breaks). */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const sameText = (a, b) => norm(a) === norm(b);

/** Graph timestamps ('2026-09-29T10:00:00+0000') → ms. */
export const parseTime = (s) => {
  if (!s) return null;
  const t = Date.parse(String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(t) ? null : t;
};

/** Clock-skew tolerance when matching a remote post against the local "publishing started" time. */
export const MATCH_SKEW_MS = 2 * 60_000;

/**
 * Finds a post published at/after `since` whose text matches.
 * @param {{ items: object[], text: string, since: number, textField: string, timeField: string }} p
 */
export function findMatch({ items, text, since, textField, timeField }) {
  return (items ?? []).find((m) => sameText(m[textField], text) && (parseTime(m[timeField]) ?? 0) >= since - MATCH_SKEW_MS) ?? null;
}

/** Relative Facebook permalinks ('/123/videos/456') → absolute. */
export const absoluteFbUrl = (u) => (u && u.startsWith('/') ? `https://www.facebook.com${u}` : u ?? null);

/** Children containers waiting for processing are stored as 'children:<id>,<id>' in planner_targets.container_id. */
export const CHILDREN_PREFIX = 'children:';
export const isChildrenRef = (id) => typeof id === 'string' && id.startsWith(CHILDREN_PREFIX);
export const childrenOf = (id) => (isChildrenRef(id) ? id.slice(CHILDREN_PREFIX.length).split(',').filter(Boolean) : []);

/** Aggregate of several container statuses (carousel children): ERROR > EXPIRED > IN_PROGRESS > FINISHED. */
export function combineStatuses(list) {
  for (const s of ['ERROR', 'EXPIRED', 'IN_PROGRESS']) {
    const hit = list.find((x) => x.status === s);
    if (hit) return hit;
  }
  return { status: 'FINISHED', message: null };
}
