import { listMedia } from '../../db/queries/media.js';
import { rangeMs, round } from '../../analytics/util.js';
import { msg, locale } from '../../i18n.js';

/**
 * YouTube report section (export/reportSections registry): watch time KPIs and a Shorts / Videos / Live breakdown.
 * Appended to monthly, weekly_client and custom client reports for YouTube accounts.
 */
const TYPES = Object.freeze([['YT_SHORT', 'yt_type_short'], ['YT_VIDEO', 'yt_type_video'], ['YT_LIVE', 'yt_type_live']]);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const duration = (s) => (s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

/** Per-format aggregates of the account's videos posted in [from, to]. */
export function formatBreakdown(igId, from, to) {
  const { fromMs, toMs } = rangeMs(from, to);
  const posts = listMedia({ igIds: [igId], from: fromMs, to: toMs });
  return TYPES.map(([type, label]) => {
    const rows = posts.filter((p) => p.mediaProductType === type);
    const sum = (k) => rows.reduce((s, p) => s + (Number(p[k]) || 0), 0);
    const views = sum('views');
    const withDur = rows.filter((p) => p.avgViewDurationS != null && p.views);
    const avgDur = withDur.length ? withDur.reduce((s, p) => s + p.avgViewDurationS * p.views, 0) / withDur.reduce((s, p) => s + p.views, 0) : null;
    return { type, label, posts: rows.length, views, avgViews: rows.length ? Math.round(views / rows.length) : 0, watchHours: round(sum('watchTimeMin') / 60, 1), avgViewDurationS: avgDur == null ? null : Math.round(avgDur) };
  }).filter((r) => r.posts > 0);
}

function watchSummary(analysis) {
  const k = analysis?.kpis ?? {};
  return {
    watchHours: k.watchTime?.value != null ? round(k.watchTime.value / 60, 1) : null,
    avgViewDurationS: k.avgViewDuration?.value ?? null,
    views: k.views?.value ?? null,
  };
}

export const youtubeReportSections = [
  {
    key: 'youtube_watch',
    templates: ['monthly', 'weekly_client', 'custom'],
    platforms: ['youtube'],
    capability: 'watchTime',
    html({ lang, analysis, igId, from, to }) {
      const nf = new Intl.NumberFormat(locale(lang));
      const n = (v) => (v == null ? '—' : nf.format(v));
      const w = watchSummary(analysis);
      const rows = formatBreakdown(igId, from, to);
      const box = (label, value) => `<div class="kpi"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div></div>`;
      const table = rows.length
        ? `<h3>${esc(msg('yt_report_formats', null, lang))}</h3><table><thead><tr><th>${esc(msg('yt_report_format', null, lang))}</th><th class="n">${esc(msg('yt_report_posts', null, lang))}</th><th class="n">${esc(msg('yt_report_views', null, lang))}</th><th class="n">${esc(msg('yt_report_avg_views', null, lang))}</th><th class="n">${esc(msg('yt_report_watch_hours', null, lang))}</th><th class="n">${esc(msg('yt_report_avg_duration', null, lang))}</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(msg(r.label, null, lang))}</td><td class="n">${n(r.posts)}</td><td class="n">${n(r.views)}</td><td class="n">${n(r.avgViews)}</td><td class="n">${n(r.watchHours)}</td><td class="n">${duration(r.avgViewDurationS)}</td></tr>`).join('')}</tbody></table>`
        : '';
      return `<h2>${esc(msg('yt_report_title', null, lang))}</h2><div class="kpis">${box(msg('yt_report_watch_hours', null, lang), n(w.watchHours))}${box(msg('yt_report_avg_duration', null, lang), duration(w.avgViewDurationS))}${box(msg('yt_report_views', null, lang), n(w.views))}</div>${table}<div class="note muted">${esc(msg('yt_report_note', null, lang))}</div>`;
    },
    sheets({ lang, igId, from, to, analysis }) {
      const rows = formatBreakdown(igId, from, to).map((r) => ({ ...r, format: msg(r.label, null, lang) }));
      const name = `${analysis?.account?.username ?? igId}`.slice(0, 20);
      return [{
        name: `${name} · ${msg('yt_report_formats', null, lang)}`.slice(0, 31),
        columns: [
          { key: 'format', label: msg('yt_report_format', null, lang), type: 'text' },
          { key: 'posts', label: msg('yt_report_posts', null, lang), type: 'int' },
          { key: 'views', label: msg('yt_report_views', null, lang), type: 'int' },
          { key: 'avgViews', label: msg('yt_report_avg_views', null, lang), type: 'int' },
          { key: 'watchHours', label: msg('yt_report_watch_hours', null, lang), type: 'float' },
          { key: 'avgViewDurationS', label: msg('yt_report_avg_duration_s', null, lang), type: 'int' },
        ],
        rows,
      }];
    },
  },
];
