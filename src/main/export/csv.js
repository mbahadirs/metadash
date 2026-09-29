import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { msg } from '../i18n.js';

const READ_ONLY = /^\s*(select|with)\b/i;
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|replace)\b/i;

export function assertReadOnly(sql) {
  if (!READ_ONLY.test(sql) || FORBIDDEN.test(sql)) throw new Error(msg('select_only'));
}

export function runReadOnly(sql, limit = 1000) {
  assertReadOnly(sql);
  const stmt = getDb().prepare(sql);
  const rows = stmt.all();
  const columns = stmt.columns().map((c) => c.name);
  return { columns, rows: rows.slice(0, limit), truncated: rows.length > limit, total: rows.length };
}

export function toCsv(columns, rows) {
  const cell = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(Array.isArray(r) ? r[columns.indexOf(c)] : r[c])).join(','))];
  return '﻿' + lines.join('\r\n');
}

export const CSV_QUERIES = {
  accounts: 'SELECT a.ig_id, a.platform, a.username, a.name, a.client_name, s.followers, s.follows, s.media_count, s.date AS snapshot_date FROM accounts a LEFT JOIN account_snapshots s ON s.ig_id = a.ig_id AND s.date = (SELECT MAX(date) FROM account_snapshots x WHERE x.ig_id = a.ig_id) WHERE a.is_tracked = 1 ORDER BY a.username',
  media: `SELECT a.username, a.platform, m.media_id, m.media_product_type, m.media_type, datetime(m.posted_at/1000,'unixepoch','localtime') AS posted_at, m.caption, m.permalink, l.reach, l.views, l.likes, l.comments, l.saved, l.shares, l.reposts, l.quotes, l.clicks, l.engagement_rate FROM media m JOIN accounts a ON a.ig_id = m.ig_id LEFT JOIN media_latest l ON l.media_id = m.media_id WHERE m.is_deleted = 0 ORDER BY m.posted_at DESC`,
  account_insights: 'SELECT a.username, a.platform, i.date, i.metric, i.value FROM account_insights_daily i JOIN accounts a ON a.ig_id = i.ig_id ORDER BY a.username, i.date, i.metric',
  snapshots: 'SELECT a.username, a.platform, s.date, s.followers, s.follows, s.media_count FROM account_snapshots s JOIN accounts a ON a.ig_id = s.ig_id ORDER BY a.username, s.date',
  stories: `SELECT a.username, s.story_id, datetime(s.posted_at/1000,'unixepoch','localtime') AS posted_at, s.reach, s.views, s.replies, s.nav_forward, s.nav_back, s.nav_exit, s.nav_next_story, s.completion_rate FROM stories s JOIN accounts a ON a.ig_id = s.ig_id ORDER BY s.posted_at DESC`,
  ads: 'SELECT ad.name AS ad_account, i.date, i.level, i.object_name, i.spend, i.impressions, i.reach, i.clicks, i.ctr, i.cpc, i.cpm, i.results, i.cost_per_result, i.result_type, ad.currency FROM ad_insights_daily i JOIN ad_accounts ad ON ad.act_id = i.act_id ORDER BY i.date DESC',
  competitors: 'SELECT c.username, a.username AS tracked_account, s.date, s.followers, s.media_count, s.avg_likes, s.avg_comments, s.posts_last_7d FROM competitor_snapshots s JOIN competitors c ON c.id = s.competitor_id JOIN accounts a ON a.ig_id = c.linked_ig_id ORDER BY c.username, s.date',
  sync_errors: 'SELECT e.id, e.run_id, a.username, COALESCE(e.platform, a.platform) AS platform, e.endpoint, e.code, e.message, datetime(e.at/1000,\'unixepoch\',\'localtime\') AS at FROM sync_errors e LEFT JOIN accounts a ON a.ig_id = e.ig_id ORDER BY e.id DESC',
};

export function exportCsv({ query, sql, filePath }) {
  const text = sql ?? CSV_QUERIES[query];
  if (!text) throw new Error(`Bilinmeyen CSV sorgusu: ${query}`);
  const { columns, rows } = runReadOnly(text, 1_000_000);
  fs.writeFileSync(filePath, toCsv(columns, rows), 'utf8');
  return { filePath, rows: rows.length };
}
