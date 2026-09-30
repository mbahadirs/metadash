import { q } from '../db/index.js';
import { upsertComment } from '../db/queries/media.js';
import { ensureState, refreshFirstResponse, setStatus, assign, saveSentiments } from '../db/queries/inbox.js';
import { isQuestion } from '../inbox/question.js';
import { commentKey } from '../inbox/keys.js';
import { rng, pick, between } from './random.js';
import { COMMENTERS, COMMENT_TEXTS } from './data.js';

/**
 * Demo inbox data (v2.0 chunk D), deterministic (own PRNG stream, so existing demo data is unchanged):
 *  - inbox_state for every seeded Instagram comment (question rule, first responses);
 *  - Facebook Page and Threads comments on posts of the last 14 days (some answered by the owner, some fresh);
 *  - a few done/ignored items, two assignees and sentiment labels on part of the comments.
 * Called by seed/index.js seedDemo() inside a transaction. YouTube/TikTok demo comments come from their providers.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ASSIGNEES = ['Ayşe', 'Mert'];
const SENTIMENT_OF = { '?': 'question', '👏': 'positive', '😍': 'positive', '🙏': 'positive' };
const EXTRA_TEXTS = [...COMMENT_TEXTS, 'Siparişim hâlâ gelmedi, yardımcı olur musunuz?', 'Great job!', 'Is this available in size M?', 'Follow me for free followers!!!'];

function labelOf(text) {
  if (/free followers/i.test(text)) return 'spam';
  if (/gelmedi/i.test(text)) return 'complaint';
  if (isQuestion(text)) return 'question';
  for (const [mark, label] of Object.entries(SENTIMENT_OF)) if (text.includes(mark)) return label;
  return 'neutral';
}

function seedPlatformComments(r, platform, nowMs) {
  const posts = q.all(
    `SELECT m.media_id, m.ig_id, m.posted_at, a.username FROM media m JOIN accounts a ON a.ig_id = m.ig_id
     WHERE a.platform = ? AND m.posted_at >= ? ORDER BY m.posted_at DESC`,
    platform, nowMs - 14 * DAY,
  );
  let n = 0;
  for (const p of posts) {
    const count = Math.floor(r() * 4);
    for (let i = 0; i < count; i += 1) {
      const raw = `${p.media_id.replace(/[^0-9A-Za-z]/g, '')}${i}${Math.floor(r() * 1e6)}`;
      const commentId = commentKey(platform, raw);
      const createdAt = Math.min(nowMs - 10 * 60_000, p.posted_at + between(r, 0.5, 72) * HOUR);
      const text = pick(r, EXTRA_TEXTS);
      upsertComment({
        commentId, externalId: raw, mediaId: p.media_id, accountId: p.ig_id, platform, username: platform === 'facebook' ? pick(r, ['Ayşe Kaya', 'Mehmet Yılmaz', 'Zeynep D.', '']) : pick(r, COMMENTERS),
        text, likeCount: Math.floor(r() * 5), createdAt, isFromOwner: false, parentId: null, fetchedAt: nowMs,
      });
      ensureState(commentId, { isQuestion: isQuestion(text) });
      if (r() < 0.55) {
        const latency = between(r, 15, 60 * 40);
        const at = createdAt + latency * 60_000;
        if (at < nowMs) {
          upsertComment({
            commentId: commentKey(platform, `${raw}r`), externalId: `${raw}r`, mediaId: p.media_id, accountId: p.ig_id, platform, username: p.username,
            text: 'Thank you! Feel free to send us a DM 🙏', likeCount: 0, createdAt: at, isFromOwner: true, parentId: commentId, replyLatencyMinutes: Math.round(latency), fetchedAt: nowMs,
          });
          refreshFirstResponse([commentId]);
        }
      }
      n += 1;
    }
  }
  return n;
}

/** @param {{ now: Date }} o */
export function seedInbox({ now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const r = rng(20260930);
  // Instagram demo comments (seed/index.js) → workflow state + first responses.
  const ig = q.all("SELECT c.comment_id, c.text FROM comments c WHERE c.parent_id IS NULL AND c.is_from_owner = 0 AND COALESCE(c.platform, 'instagram') = 'instagram' ORDER BY c.comment_id");
  for (const c of ig) ensureState(c.comment_id, { isQuestion: isQuestion(c.text) });
  refreshFirstResponse(q.all('SELECT DISTINCT parent_id FROM comments WHERE parent_id IS NOT NULL AND is_from_owner = 1').map((x) => x.parent_id));
  const fb = seedPlatformComments(r, 'facebook', nowMs);
  const th = seedPlatformComments(r, 'threads', nowMs);
  const yt = seedPlatformComments(r, 'youtube', nowMs); // no-op without demo YouTube channels

  // Workflow variety on the open, recent comments: some done/ignored, some assigned; sentiment on ~60 %.
  const open = q.all(
    `SELECT c.comment_id, c.text FROM comments c LEFT JOIN inbox_state s ON s.comment_id = c.comment_id
     WHERE c.parent_id IS NULL AND c.is_from_owner = 0 AND c.created_at >= ? AND COALESCE(s.status, 'open') = 'open'
       AND NOT EXISTS (SELECT 1 FROM comments x WHERE x.parent_id = c.comment_id AND x.is_from_owner = 1)
     ORDER BY c.comment_id`,
    nowMs - 30 * DAY,
  );
  const done = [];
  const ignored = [];
  const assigned = new Map(ASSIGNEES.map((a) => [a, []]));
  const labels = [];
  for (const c of open) {
    const x = r();
    if (x < 0.12) done.push(c.comment_id);
    else if (x < 0.16) ignored.push(c.comment_id);
    else if (x < 0.36) assigned.get(pick(r, ASSIGNEES)).push(c.comment_id);
    if (r() < 0.6) labels.push({ commentId: c.comment_id, label: labelOf(c.text ?? ''), score: Math.round(between(r, 0.6, 0.98) * 100) / 100 });
  }
  const at = nowMs - HOUR;
  setStatus(done, 'done', { by: 'demo', at });
  setStatus(ignored, 'ignored', { by: 'demo', at });
  for (const [who, ids] of assigned) assign(ids, who, { by: 'demo', at });
  saveSentiments(labels, { model: 'demo', at });
  return { instagram: ig.length, facebook: fb, threads: th, youtube: yt, done: done.length, assigned: [...assigned.values()].flat().length, classified: labels.length };
}
