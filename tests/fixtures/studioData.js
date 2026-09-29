import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../../src/main/db/index.js';
import { upsertProfile } from '../../src/main/db/queries/profiles.js';
import { upsertAccount } from '../../src/main/db/queries/accounts.js';
import { upsertMedia, upsertLatest } from '../../src/main/db/queries/media.js';

/** Shared fixtures for the v1.5 chunk B tests (voice, captions, hashtags): temp DB, accounts, posts, fake provider. */
export const DAY = 86_400_000;

export function tempDb(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  openDb(path.join(dir, 'data.db'));
  return () => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); };
}

export function addAccount(igId, { platform = 'instagram', username = igId } = {}) {
  const profileId = upsertProfile({ label: 'Test', appId: '1', tokenRef: 'token:test', tokenExpiresAt: null });
  upsertAccount({ igId, platform, externalId: igId, profileId, username, name: username });
}

/** posts: [{ id, caption, reach, er?, daysAgo, type? ('IMAGE'|'VIDEO'|…), product?, views? }] */
export function addPosts(igId, posts, now) {
  for (const p of posts) {
    const postedAt = now - p.daysAgo * DAY;
    const d = new Date(postedAt);
    upsertMedia({ mediaId: p.id, igId, mediaType: p.type ?? 'IMAGE', mediaProductType: p.product ?? 'FEED', caption: p.caption, thumbnailPath: p.thumb ?? null, postedAt, postedHour: d.getHours(), postedWeekday: d.getDay() });
    upsertLatest(p.id, { reach: p.reach, views: p.views ?? null, likes: 10, comments: 1, saved: 1, shares: 0 }, p.er ?? 5, now);
  }
}

/** Fake provider replaying scripted responses (normalized shape); records each complete() request. */
export function fakeProvider(script, { id = 'anthropic', model = 'claude-haiku-4-5', structuredModes = ['schema'] } = {}) {
  const calls = [];
  let i = 0;
  return {
    id, model, calls, structuredModes,
    userMessage: (text, { images = [] } = {}) => ({ role: 'user', content: text, images: images.length }),
    appendAssistant: (messages, res) => [...messages, { role: 'assistant', content: res.text }],
    appendToolResults: (messages, res, results) => [...messages, { role: 'assistant', calls: res.toolCalls }, { role: 'user', results }],
    complete: async (req) => {
      calls.push(req);
      const next = script[Math.min(i++, script.length - 1)];
      const body = typeof next === 'function' ? next(req) : next;
      return { text: typeof body === 'string' ? body : JSON.stringify(body), toolCalls: [], stopReason: 'end', usage: { inputTokens: 100, outputTokens: 50 } };
    },
  };
}

export const CAPS = { vision: true, structuredModes: ['schema'], local: false };
