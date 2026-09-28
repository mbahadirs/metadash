import { q } from '../index.js';

export function listCompetitors(igId) {
  const filter = igId ? 'WHERE c.linked_ig_id = ?' : '';
  return q.all(
    `SELECT c.id, c.username, c.linked_ig_id AS linkedIgId, c.label, a.username AS ownerUsername,
       (SELECT followers FROM competitor_snapshots s WHERE s.competitor_id = c.id ORDER BY date DESC LIMIT 1) AS followers,
       (SELECT date FROM competitor_snapshots s WHERE s.competitor_id = c.id ORDER BY date DESC LIMIT 1) AS lastDate
     FROM competitors c LEFT JOIN accounts a ON a.ig_id = c.linked_ig_id ${filter} ORDER BY c.username`,
    ...(igId ? [igId] : []),
  );
}

export function addCompetitor({ username, igId, label }) {
  const clean = String(username).replace(/^@/, '').trim().toLowerCase();
  q.run('INSERT OR IGNORE INTO competitors (username, linked_ig_id, label) VALUES (?, ?, ?)', clean, igId, label ?? null);
  return q.get('SELECT * FROM competitors WHERE username = ? AND linked_ig_id = ?', clean, igId);
}

export function removeCompetitor(id) {
  q.run('DELETE FROM competitor_snapshots WHERE competitor_id = ?', id);
  q.run('DELETE FROM competitors WHERE id = ?', id);
}

export function upsertCompetitorSnapshot(s) {
  q.run(
    `INSERT INTO competitor_snapshots (competitor_id, date, followers, media_count, avg_likes, avg_comments, posts_last_7d)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(competitor_id, date) DO UPDATE SET followers = excluded.followers, media_count = excluded.media_count,
       avg_likes = excluded.avg_likes, avg_comments = excluded.avg_comments, posts_last_7d = excluded.posts_last_7d`,
    s.competitorId, s.date, s.followers ?? null, s.mediaCount ?? null, s.avgLikes ?? null, s.avgComments ?? null, s.postsLast7d ?? null,
  );
}

export function competitorSeries(competitorId, from, to) {
  return q.all(
    `SELECT date, followers, media_count AS mediaCount, avg_likes AS avgLikes, avg_comments AS avgComments, posts_last_7d AS postsLast7d
     FROM competitor_snapshots WHERE competitor_id = ? AND date BETWEEN ? AND ? ORDER BY date`,
    competitorId, from, to,
  );
}

export function allCompetitors() {
  return q.all('SELECT c.*, a.username AS owner_username FROM competitors c JOIN accounts a ON a.ig_id = c.linked_ig_id WHERE a.is_tracked = 1');
}
