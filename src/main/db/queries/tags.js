import { q } from '../index.js';

export function listTags() {
  return q.all('SELECT t.*, (SELECT COUNT(*) FROM account_tags a WHERE a.tag_id = t.id) AS count FROM tags t ORDER BY name');
}

export function createTag({ name, color }) {
  const res = q.run('INSERT INTO tags (name, color) VALUES (?, ?)', name, color ?? '#4F7CFF');
  return q.get('SELECT * FROM tags WHERE id = ?', res.lastInsertRowid);
}

export function deleteTag(id) {
  q.run('DELETE FROM account_tags WHERE tag_id = ?', id);
  q.run('DELETE FROM tags WHERE id = ?', id);
}

export function setAccountTags(igId, tagIds) {
  const tx = q.tx(() => {
    q.run('DELETE FROM account_tags WHERE ig_id = ?', igId);
    for (const tagId of tagIds) q.run('INSERT OR IGNORE INTO account_tags (ig_id, tag_id) VALUES (?, ?)', igId, tagId);
  });
  tx();
}

export function findOrCreateTag(name, color) {
  const existing = q.get('SELECT * FROM tags WHERE name = ?', name);
  return existing ?? createTag({ name, color });
}
