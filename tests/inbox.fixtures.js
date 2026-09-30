/** Shared setup for the chunk D inbox tests: a temp DB with IG / FB / Threads accounts, posts and comments. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { upsertAccount } from '../src/main/db/queries/accounts.js';
import { upsertMedia, upsertComment } from '../src/main/db/queries/media.js';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const IG = '1784000001';
export const FB = 'fb-55';
export const TH = 'th-7';

export function openTempDb(prefix = 'metadash-inbox-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  openDb(path.join(dir, 'data.db'));
  return () => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); };
}

export function seedAccounts() {
  upsertAccount({ igId: IG, username: 'cafe_brand', platform: 'instagram' });
  upsertAccount({ igId: FB, username: 'Cafe Page', platform: 'facebook', externalId: '55' });
  upsertAccount({ igId: TH, username: 'cafe', platform: 'threads', externalId: '7' });
}

export function post(mediaId, igId, postedAt, extra = {}) {
  upsertMedia({ mediaId, externalId: extra.externalId ?? mediaId, igId, mediaType: 'IMAGE', mediaProductType: extra.productType ?? 'FEED', caption: 'Autumn menu', postedAt, postedHour: 10, postedWeekday: 1 });
}

export function comment(commentId, mediaId, { at, username = 'ayse', text = 'Hi', owner = false, parentId = null, platform, accountId } = {}) {
  upsertComment({ commentId, mediaId, username, text, likeCount: 0, createdAt: at, isFromOwner: owner, parentId, platform, accountId });
}
