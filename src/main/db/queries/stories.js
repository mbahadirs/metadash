import { q } from '../index.js';

export function upsertStory(s) {
  const completion = s.views > 0 ? Math.max(0, 1 - (s.navExit ?? 0) / s.views) : null;
  q.run(
    `INSERT INTO stories (story_id, ig_id, media_type, permalink, thumbnail_path, posted_at, reach, views, replies,
       nav_forward, nav_back, nav_exit, nav_next_story, completion_rate, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(story_id) DO UPDATE SET reach = excluded.reach, views = excluded.views, replies = excluded.replies,
       nav_forward = excluded.nav_forward, nav_back = excluded.nav_back, nav_exit = excluded.nav_exit,
       nav_next_story = excluded.nav_next_story, completion_rate = excluded.completion_rate, captured_at = excluded.captured_at`,
    s.storyId, s.igId, s.mediaType ?? null, s.permalink ?? null, s.thumbnailPath ?? null, s.postedAt,
    s.reach ?? null, s.views ?? null, s.replies ?? null, s.navForward ?? null, s.navBack ?? null, s.navExit ?? null,
    s.navNextStory ?? null, s.completionRate ?? completion, s.capturedAt ?? Date.now(),
  );
}

export function listStories(igId, fromMs, toMs) {
  return q.all(
    `SELECT story_id AS storyId, ig_id AS igId, media_type AS mediaType, permalink, posted_at AS postedAt, reach, views, replies,
       nav_forward AS navForward, nav_back AS navBack, nav_exit AS navExit, nav_next_story AS navNextStory,
       completion_rate AS completionRate
     FROM stories WHERE ig_id = ? AND posted_at BETWEEN ? AND ? ORDER BY posted_at DESC`,
    igId, fromMs, toMs,
  );
}

export function storySummary(igId, fromMs, toMs) {
  return q.get(
    `SELECT COUNT(*) AS count, AVG(reach) AS avgReach, AVG(views) AS avgViews, AVG(completion_rate) AS avgCompletion,
       AVG(CASE WHEN views > 0 THEN nav_exit * 1.0 / views END) AS avgExitRate, SUM(replies) AS replies
     FROM stories WHERE ig_id = ? AND posted_at BETWEEN ? AND ?`,
    igId, fromMs, toMs,
  );
}
