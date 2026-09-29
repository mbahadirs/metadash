import fs from 'node:fs';
import { subDays } from 'date-fns';
import { accountAnalytics, accountStories, accountDemographics } from '../analytics/account.js';
import { portfolio } from '../analytics/portfolio.js';
import { bestTime } from '../analytics/besttime.js';
import { weeklyDigest } from '../analytics/weeklyDigest.js';
import { blended } from '../analytics/blended.js';
import { contentAnalysis, mediaDetail, comparePosts } from '../analytics/content.js';
import { healthScores } from '../analytics/health.js';
import { listMedia, getMediaByIds, mediaTypeKey } from '../db/queries/media.js';
import { listCompetitors, competitorSeries } from '../db/queries/competitors.js';
import { adBreakdown } from '../db/queries/ads.js';
import { rangeMs, round, previousPeriod, pctChange, mean, fmtDate, toDate } from '../analytics/util.js';
import { lineChart, barChart, heatmap, sparkline, esc, fmt } from './svgCharts.js';
import { makeL, kpiLabelKey, metricLabelKey } from './reportI18n.js';
import { capabilitiesFor, platformLabel, platformsIn } from '../analytics/platform.js';
import { msg, locale, reportLocale } from '../i18n.js';
import { resolveBranding, safeLogo } from './branding.js';
import { brandBar, footerHtml, recolorAccent, BRAND_CSS } from './brandingHtml.js';
import { getClientLogo, sharedClientLogo } from '../db/queries/accountLogos.js';
import { renderExtraSections } from './reportSections/index.js';

const CSS = `
:root{--surface-0:#10131A;--surface-1:#171B24;--surface-2:#1F2430;--ink-1:#E8EAF0;--ink-2:#9AA3B2;--line:#2A3040;--accent:#4F7CFF;--pos:#3FBF8F;--neg:#E5605F;--warn:#E8B44A}
*{box-sizing:border-box}body{margin:0;background:var(--surface-0);color:var(--ink-1);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;line-height:1.5}
.page{max-width:960px;margin:0 auto;padding:40px 32px}.cover{padding:80px 0 48px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:flex-end;gap:24px}
.cover h1{font-size:34px;font-weight:600;margin:0 0 8px;letter-spacing:-.01em}.cover .sub{color:var(--ink-2);font-size:15px}.cover img{max-height:64px;max-width:200px}
h2{font-size:18px;font-weight:600;margin:40px 0 12px;page-break-after:avoid;border-left:3px solid var(--accent);padding-left:10px}h3{font-size:15px;font-weight:600;margin:24px 0 8px;color:var(--ink-1)}h4{font-size:13px;font-weight:600;margin:16px 0 6px;color:var(--ink-2)}
.kpis{display:flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;flex-wrap:wrap}.kpi{flex:1 1 140px;padding:14px 16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.kpi .l{color:var(--ink-2);font-size:12px}.kpi .v{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px;white-space:nowrap}.kpi .d{font-size:12px;font-variant-numeric:tabular-nums}
.pos{color:var(--pos)}.neg{color:var(--neg)}.muted{color:var(--ink-2)}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}th{text-align:left;font-weight:500;color:var(--ink-2);font-size:12px;padding:8px 10px;border-bottom:1px solid var(--line);background:var(--surface-2)}
td{padding:7px 10px;border-bottom:1px solid var(--line);height:36px}td.n,th.n{text-align:right}tr:hover td{background:var(--surface-1)}
.panel{background:var(--surface-1);border:1px solid var(--line);border-radius:6px;padding:16px;margin-top:12px;page-break-inside:avoid}.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.posts{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.post{background:var(--surface-1);border:1px solid var(--line);border-radius:6px;padding:12px;page-break-inside:avoid}.post .c{color:var(--ink-2);font-size:12px;min-height:34px}
.post .m{display:flex;justify-content:space-between;margin-top:8px;font-variant-numeric:tabular-nums}.note{color:var(--ink-2);font-size:12px}.badge{display:inline-block;padding:1px 6px;border-radius:4px;background:var(--surface-2);font-size:11px;color:var(--ink-2)}
.bar{display:flex;align-items:center;gap:8px;font-size:12px;margin:3px 0}.bar .lab{width:110px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bar .tr{flex:1;height:10px;background:var(--surface-2);border-radius:3px;overflow:hidden}.bar .fl{height:100%;background:var(--accent)}.bar .v{width:70px;text-align:right;font-variant-numeric:tabular-nums}
.commentary{font-size:15px;line-height:1.7;white-space:pre-wrap}.score{font-size:34px;font-weight:600}.comp{display:flex;gap:16px}.comp>div{flex:1}.meter{height:6px;background:var(--surface-2);border-radius:3px;margin-top:4px}.meter>div{height:100%;background:var(--accent);border-radius:3px}
.foot{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);color:var(--ink-2);font-size:12px}
@media print{body{background:#fff;color:#111}:root{--surface-0:#fff;--surface-1:#f6f7f9;--surface-2:#eef0f4;--ink-1:#111;--ink-2:#555;--line:#d9dde5}.page{padding:16px}h2{margin-top:28px}}
`;

const pct = (v) => (v == null ? '<span class="muted">—</span>' : `<span class="${v >= 0 ? 'pos' : 'neg'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(round(v, 1))}%</span>`);
const money = (v, cur) => new Intl.NumberFormat(locale(), { style: 'currency', currency: cur ?? 'TRY', maximumFractionDigits: 0 }).format(v ?? 0);
const dateStr = (d, lang) => new Date(d).toLocaleDateString(reportLocale(lang));
const TYPE_KEY = (p) => mediaTypeKey(p);
const PALETTE = ['#4F7CFF', '#3FBF8F', '#E8B44A', '#C06CE8', '#E5605F', '#48C3D6'];
const platformBadge = (L, platform) => `<span class="badge">${esc(L(platform ?? 'instagram'))}</span>`;

/**
 * Metric columns a list of posts can show, from the platforms present (`fallback` when the list is empty):
 * reach (IG/FB), saves (IG), reposts (Threads). Instagram-only lists keep the original columns.
 */
function postFlags(posts, fallback) {
  return flagsFor(posts.length ? platformsIn(posts) : fallback);
}

function flagsFor(list) {
  const platforms = list?.length ? list : ['instagram'];
  return {
    reach: platforms.some((p) => capabilitiesFor(p).reach),
    saves: platforms.some((p) => capabilitiesFor(p).saveRate),
    reposts: platforms.includes('threads'),
    mixed: platforms.length > 1,
  };
}

function kpiBox(L, label, value, change, suffix = '', prev = null) {
  return `<div class="kpi"><div class="l">${esc(label)}</div><div class="v">${value}${suffix}</div><div class="d">${change !== null ? `${pct(change)} <span class="muted">${L('vs_prev')}</span>` : ''}${prev != null ? `<span class="muted"> · ${L('prev')}: ${prev}${suffix}</span>` : ''}</div></div>`;
}

/** Page frame: optional agency bar, cover (report logo or client logo), body, footer — all branded. */
function shell({ lang, title, subtitle, logoDataUrl, clientLogo, branding, body }) {
  const L = makeL(lang);
  const b = resolveBranding(branding);
  const coverLogo = safeLogo(logoDataUrl) ?? safeLogo(clientLogo);
  const when = new Date().toLocaleString(reportLocale(lang));
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}${BRAND_CSS}:root{--accent:${b.accent}}</style></head><body><div class="page">
${brandBar(b)}<header class="cover"><div><h1>${esc(title)}</h1><div class="sub">${subtitle}</div></div>${coverLogo ? `<img src="${coverLogo}" alt="logo">` : ''}</header>
${body}
<footer class="foot">${footerHtml(b, L('generated', { d: when }), L('generated_plain', { d: when }))}</footer></div></body></html>`;
  return recolorAccent(html, b.accent);
}

/** Post card metrics: primary metric (reach, or views on Threads), ER and a platform-specific third value. */
function postCardMetrics(L, p) {
  const caps = capabilitiesFor(p.platform ?? 'instagram');
  const first = caps.reach ? `${fmt(p.reach)} ${L(metricLabelKey('reach', p.platform)).toLowerCase()}` : `${fmt(p.views)} ${L('views').toLowerCase()}`;
  const third = caps.saveRate ? `${fmt(p.saved)} ${L('saves').toLowerCase()}` : p.platform === 'threads' ? `${fmt(p.reposts)} ${L('reposts').toLowerCase()}` : `${fmt(p.shares)} ${L('shares').toLowerCase()}`;
  return `<span>${first}</span><span>ER %${round(p.engagementRate, 2) ?? '—'}</span><span>${third}</span>`;
}

function postsGrid(L, lang, posts) {
  const mixed = postFlags(posts).mixed;
  return `<div class="posts">${posts.map((p) => `<div class="post"><div class="muted" style="font-size:12px">@${esc(p.username)}${mixed ? ` ${platformBadge(L, p.platform)}` : ''} · ${dateStr(p.postedAt, lang)} · ${L(TYPE_KEY(p))}${p.spend ? ` · <span class="badge">${L('ad')} ${money(p.spend, p.paidCurrency ?? 'USD')}</span>` : ''}</div>
<div class="c">${esc((p.caption ?? '').slice(0, 90))}</div><div class="m">${postCardMetrics(L, p)}</div></div>`).join('')}</div>`;
}

function postsTable(L, lang, posts, { showAccount = true, deltas = false, platforms } = {}) {
  const f = postFlags(posts, platforms);
  const cols = 7 + (showAccount ? 1 : 0) + (f.reach ? 1 : 0) + (f.saves ? 1 : 0) + (f.reposts ? 1 : 0);
  const na = '<span class="muted">—</span>';
  return `<table><thead><tr>${showAccount ? `<th>${L('account')}</th>` : ''}<th>${L('date')}</th><th>${L('type')}</th><th>${L('caption')}</th>${f.reach ? `<th class="n">${L('reach')}</th>` : ''}<th class="n">${L('views')}</th><th class="n">ER</th>${f.saves ? `<th class="n">${L('saves')}</th>` : ''}<th class="n">${L('comments')}</th>${f.reposts ? `<th class="n">${L('reposts')}</th>` : ''}<th class="n">${L('ad')}</th></tr></thead><tbody>
${posts.map((p) => `<tr>${showAccount ? `<td>@${esc(p.username)}${f.mixed ? ` ${platformBadge(L, p.platform)}` : ''}</td>` : ''}<td class="muted">${dateStr(p.postedAt, lang)}</td><td>${L(p.typeKey ?? TYPE_KEY(p))}</td><td class="muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((p.caption ?? '').slice(0, 70))}</td>
${f.reach ? `<td class="n">${p.reach == null ? na : fmt(p.reach)}${deltas ? `<br>${pct(p.vsReach)}` : ''}</td>` : ''}<td class="n">${fmt(p.views)}</td><td class="n">%${round(p.engagementRate, 2) ?? '—'}${deltas ? `<br>${pct(p.vsEr)}` : ''}</td>${f.saves ? `<td class="n">${p.saved == null && !capabilitiesFor(p.platform ?? 'instagram').saveRate ? na : fmt(p.saved)}${deltas ? `<br>${pct(p.vsSaved)}` : ''}</td>` : ''}<td class="n">${fmt(p.comments)}</td>${f.reposts ? `<td class="n">${p.reposts == null ? na : fmt(p.reposts)}</td>` : ''}<td class="n">${p.spend ? money(p.spend, p.paidCurrency ?? 'USD') : na}</td></tr>`).join('')}
${posts.length ? '' : `<tr><td colspan="${cols}" class="muted">${L('none')}</td></tr>`}</tbody></table>`;
}

/** Ad metric columns: [field, label key (or literal via L fallback), type]. */
const AD_COLS = [['paidImpressions', 'ad_impressions', 'int'], ['paidResults', 'results', 'int'], ['costPerResult', 'cost_per_result', 'money'], ['spend', 'amount_spent', 'money'], ['paidReach', 'paid_reach', 'int'], ['paidFrequency', 'frequency', 'float'], ['paidCpc', 'CPC', 'money'], ['paidCtr', 'CTR', 'percent'], ['paidCpm', 'CPM', 'money'], ['paidPostEngagement', 'post_eng_short', 'int'], ['costPerPostEngagement', 'cost_post_eng_short', 'money'], ['paidPageEngagement', 'page_eng_short', 'int'], ['costPerPageEngagement', 'cost_page_eng_short', 'money']];
const adCell = (v, type, cur) => (v == null ? '<span class="muted">—</span>' : type === 'money' ? money(v, cur) : type === 'percent' ? `%${round(v, 2)}` : type === 'float' ? round(v, 2) : fmt(v));

/** Full ad metric table for a list of posts or accounts (only rows with spend). */
function adMetricsTable(L, lang, rows, { label = (r) => `@${esc(r.username)}`, withBudget = false, date = true } = {}) {
  const paid = rows.filter((r) => (r.spend ?? 0) > 0 || (withBudget && r.monthlyBudget));
  if (!paid.length) return '';
  const cols = withBudget ? [...AD_COLS.slice(0, 3), ['monthlyBudget', 'budget', 'money'], ...AD_COLS.slice(3)] : AD_COLS;
  return `<h3>${L('ad')} · ${L('ad_metrics')}</h3><div style="overflow-x:auto"><table style="font-size:11px"><thead><tr><th></th>${date ? `<th>${L('date')}</th>` : ''}${cols.map(([, l, type]) => `<th class="${type === 'text' ? '' : 'n'}">${L(l)}</th>`).join('')}</tr></thead><tbody>
${paid.map((r) => `<tr><td>${label(r)}</td>${date ? `<td class="muted">${r.postedAt ? dateStr(r.postedAt, lang) : ''}</td>` : ''}${cols.map(([k, , type]) => `<td class="n">${adCell(r[k], type, r.paidCurrency ?? 'USD')}${k === 'paidResults' && r.paidResultType ? `<br><span class="muted">${esc(r.paidResultType)}</span>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function bars(items, format = fmt) {
  const max = Math.max(1, ...items.map((i) => i.value ?? 0));
  return items.map((i) => `<div class="bar"><span class="lab" title="${esc(i.label)}">${esc(i.label)}</span><span class="tr"><span class="fl" style="width:${((i.value ?? 0) / max) * 100}%;display:block"></span></span><span class="v">${format(i.value)}</span></div>`).join('');
}

// ---------- sections ----------

/** KPI tiles in the account's platform order (a.kpiKeys); the headline metrics also show the previous value. */
function kpiSection(L, a) {
  const keys = a.kpiKeys ?? Object.keys(a.kpis);
  const withPrev = new Set([a.primaryMetric ?? 'reach', 'views']);
  const tile = (k) => {
    const v = a.kpis[k];
    if (!v) return '';
    const label = L(kpiLabelKey(k, a.platform));
    if (k === 'er') return kpiBox(L, label, round(v.value, 2) ?? '—', v.changePct, '%', v.prev);
    if (k === 'saveRate') return kpiBox(L, label, round(v.value, 2) ?? '—', v.changePct, '%');
    return kpiBox(L, label, fmt(v.value), v.changePct, '', withPrev.has(k) ? fmt(v.prev) : null);
  };
  return `<h2>${L('summary')}</h2><div class="kpis">${keys.map(tile).join('')}</div>`;
}

function reachSection(L, a) {
  const labels = a.series.map((d) => d.date.slice(5));
  const [m1, m2] = a.chartMetrics ?? ['reach', 'accounts_engaged'];
  const title = m1 === 'reach' ? 'reach_engagement' : 'views_engagement';
  return `<h2>${L(title)}</h2><div class="panel">${lineChart({ labels, series: [{ name: L(metricLabelKey(m1, a.platform)), color: '#4F7CFF', values: a.series.map((d) => d[m1]) }, { name: L(metricLabelKey(m2, a.platform)), color: '#3FBF8F', values: a.series.map((d) => d[m2]) }] })}</div>`;
}

function followersSection(L, a) {
  return `<h2>${L('follower_growth')}</h2><div class="panel">${lineChart({ labels: a.followerSeries.map((d) => d.date.slice(5)), series: [{ name: L('followers'), color: '#C06CE8', values: a.followerSeries.map((d) => d.followers) }], fromMin: true })}</div>`;
}

function typesSection(L, a) {
  const caps = a.capabilities ?? capabilitiesFor('instagram');
  return `<h2>${L('type_breakdown')}</h2><table><thead><tr><th>${L('type')}</th><th class="n">${L('posts')}</th>${caps.reach ? `<th class="n">${L('avg_reach')}</th>` : ''}<th class="n">${L('avg_likes')}</th>${caps.saveRate ? `<th class="n">${L('avg_saved')}</th>` : ''}<th class="n">${L('avg_er')}</th></tr></thead><tbody>${a.byType.map((t) => `<tr><td>${L(mediaTypeKey({ mediaProductType: t.productType, mediaType: t.mediaType }))}</td><td class="n">${t.posts}</td>${caps.reach ? `<td class="n">${fmt(t.avgReach)}</td>` : ''}<td class="n">${fmt(t.avgLikes)}</td>${caps.saveRate ? `<td class="n">${fmt(t.avgSaved)}</td>` : ''}<td class="n">%${t.avgEr ?? '—'}</td></tr>`).join('')}</tbody></table>`;
}

function bestTimeSection(L, igId, from, to, lang = 'en') {
  const bt = bestTime({ igId, from: fmtDate(subDays(toDate(to), 89)), to });
  return `<h2>${L('best_time')}</h2><div class="panel">${heatmap({ matrix: bt.matrix, lang })}<div class="note">${L('best_time_note', { n: bt.minPosts })}</div></div>`;
}

function storiesSection(L, igId, from, to) {
  const st = accountStories({ igId, from, to });
  if (!st.summary?.count) return '';
  return `<h2>${L('stories')}</h2><div class="kpis">${kpiBox(L, L('story_count'), st.summary.count, null)}${kpiBox(L, L('views'), fmt(st.summary.avgViews), null)}${kpiBox(L, L('completion'), round((st.summary.avgCompletion ?? 0) * 100, 1), null, '%')}${kpiBox(L, L('exit_rate'), round((st.summary.avgExitRate ?? 0) * 100, 1), null, '%')}</div>`;
}

/** Threads-style demographics: separate age and gender breakdowns (plus city/country). */
function splitDemographics(L, d) {
  const genderLabel = (b) => (b === 'F' ? L('female') : b === 'M' ? L('male') : L('gender_unknown'));
  const panels = [
    d.city.length ? `<div class="panel"><h4>${L('city')}</h4>${bars(d.city.slice(0, 8).map((c) => ({ label: c.bucket, value: c.value })))}</div>` : '',
    `<div class="panel"><h4>${L('age')}</h4>${bars(d.age.map((c) => ({ label: c.bucket, value: c.value })))}${d.gender.length ? `<h4>${L('gender')}</h4>${bars(d.gender.map((c) => ({ label: genderLabel(c.bucket), value: c.value })))}` : ''}</div>`,
    `<div class="panel"><h4>${L('country')}</h4>${bars(d.country.slice(0, 8).map((c) => ({ label: c.bucket, value: c.value })))}</div>`,
  ];
  return `<h2>${L('demographics')}</h2><div class="grid3">${panels.join('')}</div>`;
}

function demographicsSection(L, igId) {
  const d = accountDemographics({ igId });
  if (!d.capturedAt) return '';
  if (!d.genderAge.length && (d.age.length || d.gender.length)) return splitDemographics(L, d);
  const ga = {};
  for (const b of d.genderAge) { const [g, age] = b.bucket.split('.'); ga[age] = ga[age] ?? { F: 0, M: 0 }; if (g === 'F' || g === 'M') ga[age][g] += b.value; }
  const ages = Object.keys(ga).sort();
  return `<h2>${L('demographics')}</h2><div class="grid3"><div class="panel"><h4>${L('city')}</h4>${bars(d.city.slice(0, 8).map((c) => ({ label: c.bucket, value: c.value })))}</div><div class="panel"><h4>${L('gender_age')}</h4>${ages.map((age) => `<div class="bar"><span class="lab">${age}</span><span class="tr"><span class="fl" style="width:${(ga[age].F / Math.max(1, ...ages.map((x) => ga[x].F + ga[x].M))) * 100}%;display:inline-block;background:#C06CE8"></span><span class="fl" style="width:${(ga[age].M / Math.max(1, ...ages.map((x) => ga[x].F + ga[x].M))) * 100}%;display:inline-block;background:#4F7CFF"></span></span><span class="v">${fmt(ga[age].F + ga[age].M)}</span></div>`).join('')}<div class="note"><span style="color:#C06CE8">■</span> ${L('female')} <span style="color:#4F7CFF">■</span> ${L('male')}</div></div><div class="panel"><h4>${L('country')}</h4>${bars(d.country.slice(0, 8).map((c) => ({ label: c.bucket, value: c.value })))}</div></div>`;
}

function healthSection(L, igId, from, to) {
  const h = healthScores({ from, to }).find((x) => x.igId === igId);
  if (!h) return '';
  const comp = (key, label) => (h.components[key] ? `<div><div class="muted" style="font-size:12px">${label}</div><div style="font-size:18px;font-weight:600">${h.components[key].pct}<span class="muted" style="font-size:12px"> pct</span></div><div class="meter"><div style="width:${h.components[key].pct}%"></div></div></div>` : '');
  return `<h2>${L('health_score')}</h2><div class="panel"><div class="comp"><div><div class="score">${h.score}<span class="muted" style="font-size:14px">/100</span></div></div>${comp('growth', L('growth'))}${comp('engagement', L('engagement'))}${comp('consistency', L('consistency'))}${comp('response', L('response'))}</div><div class="note" style="margin-top:8px">${L(h.components.response ? 'health_note' : 'health_note_no_response')}</div></div>`;
}

function competitorsSection(L, igId, from, to, account) {
  const rows = listCompetitors(igId);
  if (!rows.length) return '';
  const own = account;
  const table = rows.map((c) => {
    const s = competitorSeries(c.id, from, to);
    const first = s[0]; const last = s[s.length - 1];
    return { username: c.username, followers: last?.followers ?? c.followers, growthPct: first && last ? pctChange(last.followers, first.followers) : null, postsPerWeek: last?.postsLast7d ?? null, avgLikes: last?.avgLikes, avgComments: last?.avgComments };
  });
  return `<h2>${L('competitors')}</h2><div class="note">${L('competitor_note')}</div><table><thead><tr><th>${L('account')}</th><th class="n">${L('followers')}</th><th class="n">${L('growth')}</th><th class="n">${L('posts_per_week')}</th><th class="n">${L('avg_likes')}</th><th class="n">${L('avg_comments')}</th></tr></thead><tbody>
<tr><td>@${esc(own.username)} <span class="badge">${L('you')}</span></td><td class="n">${fmt(own.followers)}</td><td class="n">${pct(own.growthPct)}</td><td class="n">${own.postsPerWeek ?? '—'}</td><td class="n">${fmt(own.avgLikes)}</td><td class="n">${fmt(own.avgComments)}</td></tr>
${table.map((r) => `<tr><td>@${esc(r.username)}</td><td class="n">${fmt(r.followers)}</td><td class="n">${pct(r.growthPct)}</td><td class="n">${r.postsPerWeek ?? '—'}</td><td class="n">${fmt(r.avgLikes)}</td><td class="n">${fmt(r.avgComments)}</td></tr>`).join('')}</tbody></table>`;
}

function adsSection(L, igId, from, to) {
  const b = blended({ igId, from, to });
  if (!b.adAccount) return '';
  return `<h2>${L('ads_summary')}</h2><div class="kpis">${kpiBox(L, L('spend'), money(b.totals.spend, b.adAccount.currency), b.totals.spendChangePct)}${kpiBox(L, L('paid_reach'), fmt(b.totals.paidReach), b.totals.paidReachChangePct)}${kpiBox(L, L('organic_reach'), fmt(b.totals.organicReach), null)}${kpiBox(L, 'CPM', money(b.totals.cpm, b.adAccount.currency), null)}${kpiBox(L, L('results'), fmt(b.totals.results), null)}${kpiBox(L, L('cost_per_result'), b.totals.costPerResult != null ? money(b.totals.costPerResult, b.adAccount.currency) : '—', null)}</div><div class="panel">${lineChart({ labels: b.series.map((d) => d.date.slice(5)), series: [{ name: L('organic_reach'), color: '#4F7CFF', values: b.series.map((d) => d.organicReach) }, { name: L('paid_reach'), color: '#C06CE8', values: b.series.map((d) => d.paidReach) }], dual: { name: L('spend'), color: '#E8B44A', values: b.series.map((d) => d.spend) } })}</div>`;
}

function campaignsTable(L, b) {
  const cur = b.adAccount?.currency ?? 'TRY';
  return `<h3>${L('campaigns')}</h3><table><thead><tr><th>${L('campaigns')}</th><th class="n">${L('spend')}</th><th class="n">${L('reach')}</th><th class="n">${L('impressions')}</th><th class="n">${L('clicks')}</th><th class="n">CTR</th><th class="n">CPM</th><th class="n">${L('results')}</th><th class="n">${L('cost_per_result')}</th></tr></thead><tbody>${b.campaigns.map((c) => `<tr><td>${esc(c.objectName)}</td><td class="n">${money(c.spend, cur)}</td><td class="n">${fmt(c.reach)}</td><td class="n">${fmt(c.impressions)}</td><td class="n">${fmt(c.clicks)}</td><td class="n">%${round(c.ctr, 2) ?? '—'}</td><td class="n">${money(c.cpm, cur)}</td><td class="n">${fmt(c.results)}</td><td class="n">${c.costPerResult != null ? money(c.costPerResult, cur) : '—'}</td></tr>`).join('')}</tbody></table>`;
}

function breakdownSection(L, b, from, to) {
  if (!b.adAccount) return '';
  const cur = b.adAccount.currency;
  const block = (key, label) => `<div class="panel"><h4>${label}</h4>${bars(adBreakdown([b.adAccount.actId], from, to, key).map((r) => ({ label: r.bucket, value: r.spend })), (v) => money(v, cur))}</div>`;
  return `<h2>${L('breakdown')}</h2><div class="grid3">${block('age', L('age'))}${block('gender', L('gender'))}${block('publisher_platform', L('platform'))}</div>`;
}

function contentSections(L, lang, ca, { showAccount = true } = {}) {
  const totalReach = Math.max(1, ca.summary.reach);
  const cur = ca.summary.currency ?? 'USD';
  const f = flagsFor(ca.summary.platforms);
  const reachTile = f.reach ? kpiBox(L, L('avg_reach'), fmt(ca.summary.avgReach), null) : kpiBox(L, L('avg_views'), fmt(ca.summary.avgViews), null);
  const th = (key) => `<th class="n">${L(key)}</th>`;
  return `<h2>${L('content_analysis')}</h2>
<div class="kpis">${kpiBox(L, L('posts'), ca.summary.posts, null)}${reachTile}${kpiBox(L, L('avg_er'), ca.summary.avgEr ?? '—', null, '%')}${f.saves ? kpiBox(L, L('save_rate'), ca.summary.avgSaveRate ?? '—', null, '%') : ''}${kpiBox(L, L('boosted_posts'), ca.summary.paidPosts, null)}${kpiBox(L, L('ad_spend'), money(ca.summary.totalSpend, cur), null)}</div>
<h3>${L('type_breakdown')}</h3><table><thead><tr><th>${L('type')}</th>${th('posts')}${f.reach ? th('reach_share') + th('avg_reach') : ''}${th('avg_views')}${th('avg_likes')}${f.saves ? th('avg_saved') : ''}${th('avg_er')}${f.saves ? th('save_rate') : ''}${th('ad')}</tr></thead><tbody>
${ca.types.map((ty) => `<tr><td>${L(ty.typeKey)}</td><td class="n">${ty.posts}</td>${f.reach ? `<td class="n">${Math.round((ty.totalReach / totalReach) * 100)}%</td><td class="n">${fmt(ty.avgReach)}</td>` : ''}<td class="n">${fmt(ty.avgViews)}</td><td class="n">${fmt(ty.avgLikes)}</td>${f.saves ? `<td class="n">${fmt(ty.avgSaved)}</td>` : ''}<td class="n">%${ty.avgEr ?? '—'}</td>${f.saves ? `<td class="n">%${ty.avgSaveRate ?? '—'}</td>` : ''}<td class="n">${ty.spend ? `${money(ty.spend, cur)} · ${ty.paidPosts}` : '—'}</td></tr>`).join('')}</tbody></table>
<h3>${L('recent_posts', { n: ca.period.recentDays })} · ${ca.recent.length}</h3><div class="note" style="margin-bottom:8px">${L('recent_note')}</div>${postsTable(L, lang, ca.recent, { showAccount, deltas: true, platforms: ca.summary.platforms })}${adMetricsTable(L, lang, ca.recent, { label: (r) => `@${esc(r.username)} · ${esc((r.caption ?? '').slice(0, 30))}` })}
${ca.hashtags.length ? `<h3>${L('hashtags')}</h3><table><thead><tr><th>${L('hashtag')}</th>${th('usage')}${f.reach ? th('avg_reach') : ''}${th('avg_er')}${f.saves ? th('avg_saved') : ''}</tr></thead><tbody>${ca.hashtags.slice(0, 12).map((h) => `<tr><td>${esc(h.tag)}</td><td class="n">${h.posts}</td>${f.reach ? `<td class="n">${fmt(h.avgReach)}</td>` : ''}<td class="n">%${h.avgEr ?? '—'}</td>${f.saves ? `<td class="n">${fmt(h.avgSaved)}</td>` : ''}</tr>`).join('')}</tbody></table>` : ''}`;
}

function basketSection(L, lang, basket) {
  const posts = getMediaByIds(basket ?? []);
  if (!posts.length) return '';
  return `<h2>${L('selected_posts')} · ${posts.length}</h2>${postsTable(L, lang, posts)}`;
}

function commentarySection(L, text) {
  if (!text?.trim()) return '';
  return `<h2>${L('commentary')}</h2><div class="panel commentary">${esc(text.trim())}</div>`;
}

// ---------- templates ----------

/** Client report: monthly / weekly / custom period, one or more accounts. */
export function clientReport(params) {
  const { template = 'monthly', from, to, coverTitle, logoDataUrl, branding, sections = {}, lang = 'en', commentary, basket } = params;
  const igIds = params.igIds?.length ? params.igIds : params.igId ? [params.igId] : [];
  if (!igIds.length) throw new Error(msg('no_account_selected', null, lang));
  const L = makeL(lang);
  const analyses = igIds.map((igId) => accountAnalytics({ igId, from, to })).filter(Boolean);
  if (!analyses.length) throw new Error(msg('account_not_found', null, lang));
  // Single account: the template's sections that apply to its platform. Multi: per-account blocks check their own platform.
  const allowed = analyses.length === 1 ? sectionsFor(template, analyses[0].platform) : TEMPLATE_SECTIONS[template] ?? TEMPLATE_SECTIONS.monthly;
  const inc = (k) => allowed.includes(k) && sections[k] !== false;
  const incFor = (a, k) => inc(k) && sectionsFor(template, a.platform).includes(k);
  const prev = previousPeriod(from, to);
  const recentDays = template === 'weekly_client' ? 7 : Math.min(28, prev.days);
  const parts = [];
  const multi = analyses.length > 1;

  if (multi) {
    const sum = (k) => analyses.reduce((s, a) => s + (a.kpis[k]?.value ?? 0), 0);
    const sumPrev = (k) => analyses.reduce((s, a) => s + (a.kpis[k]?.prev ?? 0), 0);
    const avgEr = mean(analyses.map((a) => a.kpis.er?.value));
    const avgErPrev = mean(analyses.map((a) => a.kpis.er?.prev));
    const f = flagsFor(platformsIn(analyses));
    const has = (k) => analyses.some((a) => a.kpis[k]);
    const na = '<span class="muted">—</span>';
    const total = (k, label) => (has(k) ? kpiBox(L, L(label), fmt(sum(k)), pctChange(sum(k), sumPrev(k))) : '');
    if (inc('kpis')) parts.push(`<h2>${L('summary')} · ${analyses.length} ${L('accounts')}</h2>${f.mixed ? `<div class="note">${L('mixed_platforms_note')}</div>` : ''}<div class="kpis">${total('reach', 'reach')}${total('views', 'views')}${total('profileViews', 'profile_views')}${kpiBox(L, L('er'), round(avgEr, 2) ?? '—', pctChange(avgEr, avgErPrev), '%')}${total('newFollowers', 'new_followers')}${total('posts', 'posts')}</div>
<h3>${L('accounts_table')}</h3><table><thead><tr><th>${L('account')}</th><th class="n">${L('followers')}</th><th class="n">${L('new_followers')}</th>${f.reach ? `<th class="n">${L('reach')}</th>` : ''}<th class="n">${L('views')}</th><th class="n">ER</th>${f.saves ? `<th class="n">${L('save_rate')}</th>` : ''}<th class="n">${L('posts')}</th></tr></thead><tbody>${analyses.map((a) => `<tr><td>@${esc(a.account.username)}${f.mixed ? ` ${platformBadge(L, a.platform)}` : ''}<span class="muted"> ${esc(a.account.clientName ?? '')}</span></td><td class="n">${fmt(a.account.followers)}</td><td class="n">${fmt(a.kpis.newFollowers.value)} ${pct(a.kpis.newFollowers.changePct)}</td>${f.reach ? `<td class="n">${a.kpis.reach ? `${fmt(a.kpis.reach.value)} ${pct(a.kpis.reach.changePct)}` : na}</td>` : ''}<td class="n">${fmt(a.kpis.views.value)}</td><td class="n">%${round(a.kpis.er.value, 2) ?? '—'} ${pct(a.kpis.er.changePct)}</td>${f.saves ? `<td class="n">${a.kpis.saveRate ? `%${round(a.kpis.saveRate.value, 2) ?? '—'}` : na}</td>` : ''}<td class="n">${a.kpis.posts.value}</td></tr>`).join('')}</tbody></table>${adMetricsTable(L, lang, analyses.filter((a) => a.paid).map((a) => ({ username: a.account.username, ...a.paid })), { withBudget: true, date: false })}`);
    if (inc('reach')) parts.push(`<h2>${L(f.mixed && f.reach && analyses.some((a) => a.primaryMetric !== 'reach') ? 'reach_or_views' : f.reach ? 'reach' : 'views')}</h2><div class="panel">${lineChart({ labels: analyses[0].series.map((d) => d.date.slice(5)), series: analyses.slice(0, 6).map((a, i) => ({ name: '@' + a.account.username, color: PALETTE[i], values: a.series.map((d) => d[a.primaryMetric ?? 'reach']) })) })}</div>`);
    if (inc('posts')) parts.push(`<h2>${L('top6')}</h2>${postsGrid(L, lang, listMedia({ igIds, from: rangeMs(from, to).fromMs, to: rangeMs(from, to).toMs, sort: 'reach', limit: 6 }))}`);
    if (inc('content')) parts.push(contentSections(L, lang, contentAnalysis({ from, to, igIds, recentDays }), { showAccount: true }));
    if (inc('basket')) parts.push(basketSection(L, lang, basket));
    const h3 = (html) => html.replace('<h2>', '<h3>').replace('</h2>', '</h3>');
    for (const a of analyses) {
      const igId = a.account.igId;
      parts.push(`<h2 style="border-top:1px solid var(--line);padding-top:24px">${L('account_detail')} · @${esc(a.account.username)}${f.mixed ? ` ${platformBadge(L, a.platform)}` : ''}</h2>`);
      if (incFor(a, 'kpis')) parts.push(h3(kpiSection(L, a)));
      if (incFor(a, 'followers')) parts.push(h3(followersSection(L, a)));
      if (incFor(a, 'types')) parts.push(h3(typesSection(L, a)));
      if (incFor(a, 'besttime')) parts.push(h3(bestTimeSection(L, igId, from, to, lang)));
      if (incFor(a, 'stories')) parts.push(h3(storiesSection(L, igId, from, to)));
      if (incFor(a, 'demographics')) parts.push(h3(demographicsSection(L, igId)));
      if (incFor(a, 'health')) parts.push(h3(healthSection(L, igId, from, to)));
      if (incFor(a, 'ads')) parts.push(h3(adsSection(L, igId, from, to)));
      parts.push(h3(renderExtraSections(template, { L, lang, analysis: a, igId, from, to }, { sections })));
    }
  } else {
    const a = analyses[0];
    const igId = a.account.igId;
    if (inc('kpis')) parts.push(kpiSection(L, a));
    if (inc('reach')) parts.push(reachSection(L, a));
    if (inc('followers')) parts.push(followersSection(L, a));
    if (inc('posts')) parts.push(`<h2>${L('top6')}</h2>${postsGrid(L, lang, topPosts(a))}`);
    if (inc('types')) parts.push(typesSection(L, a));
    if (inc('besttime')) parts.push(bestTimeSection(L, igId, from, to, lang));
    if (inc('content')) parts.push(contentSections(L, lang, contentAnalysis({ from, to, igIds: [igId], recentDays }), { showAccount: false }));
    if (inc('basket')) parts.push(basketSection(L, lang, basket));
    if (inc('stories')) parts.push(storiesSection(L, igId, from, to));
    if (inc('demographics')) parts.push(demographicsSection(L, igId));
    if (inc('health')) parts.push(healthSection(L, igId, from, to));
    parts.push(renderExtraSections(template, { L, lang, analysis: a, igId, from, to }, { sections }));
    if (inc('competitors')) {
      const agg = a.posts;
      parts.push(competitorsSection(L, igId, from, to, { username: a.account.username, followers: a.account.followers, growthPct: a.kpis.newFollowers.value != null && a.account.followers ? (a.kpis.newFollowers.value / Math.max(1, a.account.followers - a.kpis.newFollowers.value)) * 100 : null, postsPerWeek: round((agg.length / prev.days) * 7, 1), avgLikes: round(mean(agg.map((p) => p.likes)), 0), avgComments: round(mean(agg.map((p) => p.comments)), 0) }));
    }
    if (inc('ads')) { parts.push(adsSection(L, igId, from, to)); if (a.paid) parts.push(adMetricsTable(L, lang, [{ username: a.account.username, ...a.paid }], { withBudget: true, date: false })); }
  }
  if (inc('commentary')) parts.push(commentarySection(L, commentary));

  const names = analyses.map((a) => a.account.name ?? a.account.username);
  const title = coverTitle || `${multi ? (analyses[0].account.clientName ?? names[0]) : names[0]} — ${L(template === 'weekly_client' ? 'weekly_client' : template === 'custom' ? 'custom' : 'monthly')}`;
  const subtitle = `${analyses.map((a) => '@' + a.account.username).join(', ')} · ${from} – ${to}<br><span style="font-size:12px">${L('compare_prev', { a: prev.from, b: prev.to })}</span>`;
  return shell({ lang, title, subtitle, logoDataUrl, branding, clientLogo: sharedClientLogo(analyses.map((x) => x.account.igId)), body: parts.filter(Boolean).join('') });
}

/** Portfolio summary — all accounts. */
export function portfolioReport({ from, to, tagIds, platforms, coverTitle, logoDataUrl, branding, lang = 'en', sections = {}, commentary }) {
  const L = makeL(lang);
  const inc = (k) => sections[k] !== false;
  const p = portfolio({ from, to, tagIds, platforms });
  const k = p.kpis;
  const f = flagsFor(p.platforms);
  const parts = [];
  const viewsTile = p.platforms.includes('threads') ? kpiBox(L, L('views'), fmt(k.totalViews.value), k.totalViews.changePct) : '';
  const reachCell = (r) => (r.reach == null ? `<span class="muted">${fmt(r.views)} ${L('views').toLowerCase()}</span>` : fmt(r.reach));
  if (inc('kpis')) parts.push(`<h2>${L('summary')}</h2><div class="kpis">${kpiBox(L, L('followers'), fmt(k.totalFollowers.value), k.totalFollowers.changePct)}${kpiBox(L, L('net_followers'), fmt(k.netFollowers.value), k.netFollowers.changePct)}${kpiBox(L, L('reach'), fmt(k.totalReach.value), k.totalReach.changePct)}${viewsTile}${kpiBox(L, L('avg_er'), k.avgEr.value ?? '—', k.avgEr.changePct, '%')}${kpiBox(L, L('spend'), money(k.totalSpend.value, k.totalSpend.currency), k.totalSpend.changePct)}${kpiBox(L, L('posts'), fmt(k.totalPosts.value), k.totalPosts.changePct)}</div>`);
  if (inc('league')) parts.push(`<h2>${L('league')}</h2><table><thead><tr><th>${L('account')}</th><th>${L('client')}</th><th class="n">${L('followers')}</th><th class="n">${L('change')}</th><th class="n">${L('reach')}</th><th class="n">ER</th><th class="n">${L('save_rate')}</th><th class="n">${L('health')}</th><th>${L('last30')}</th></tr></thead><tbody>
${[...p.rows].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0)).map((r) => `<tr><td>@${esc(r.username)}${f.mixed ? ` ${platformBadge(L, r.platform)}` : ''}</td><td class="muted">${esc(r.clientName ?? '')}</td><td class="n">${fmt(r.followers)}</td><td class="n">${pct(r.followersChangePct)}</td><td class="n">${reachCell(r)}</td><td class="n">%${r.er ?? '—'}</td><td class="n">%${r.saveRate ?? '—'}</td><td class="n">${r.health ?? '—'}</td><td>${sparkline(r.sparkline, { color: r.color })}</td></tr>`).join('')}</tbody></table>${adMetricsTable(L, lang, p.rows, { withBudget: true, date: false })}`);
  if (inc('top10')) parts.push(`<h2>${L('top10')}</h2>${postsTable(L, lang, listMedia({ from: rangeMs(from, to).fromMs, to: rangeMs(from, to).toMs, igIds: p.rows.map((r) => r.igId), sort: 'reach', limit: 10 }))}`);
  if (inc('attention')) parts.push(`<h2>${L('attention')}</h2><div class="grid2"><div class="panel"><h3>${L('silent')}</h3>${p.attention.silent.length ? p.attention.silent.map((s) => `<div>@${esc(s.username)} <span class="muted">${s.daysSincePost ?? '—'} ${L('days')}</span></div>`).join('') : `<div class="muted">${L('none')}</div>`}</div><div class="panel"><h3>${L('anomalies')}</h3>${p.attention.anomalies.length ? p.attention.anomalies.slice(0, 10).map((a) => `<div>@${esc(a.username)} <span class="${a.direction === 'up' ? 'pos' : 'neg'}">${a.kind === 'post_er' ? 'ER' : L(a.kind)} ${a.direction === 'up' ? '▲' : '▼'} ${a.z}σ</span></div>`).join('') : `<div class="muted">${L('none')}</div>`}</div></div>`);
  if (inc('content') && p.rows.length) parts.push(contentSections(L, lang, contentAnalysis({ from, to, igIds: p.rows.map((r) => r.igId) })));
  if (inc('commentary')) parts.push(commentarySection(L, commentary));
  return shell({ lang, title: coverTitle || L('portfolio'), subtitle: `${p.rows.length} ${L('accounts')} · ${from} – ${to}`, logoDataUrl, branding, body: parts.join('') });
}

/** Campaign report — organic + paid for one account. */
export function campaignReport(params) {
  const { from, to, coverTitle, logoDataUrl, branding, lang = 'en', sections = {}, commentary } = params;
  const igId = params.igIds?.[0] ?? params.igId;
  const L = makeL(lang);
  const a = accountAnalytics({ igId, from, to });
  if (!a) throw new Error(msg('account_not_found', null, lang));
  const allowed = sectionsFor('campaign', a.platform);
  const inc = (k) => allowed.includes(k) && sections[k] !== false;
  const b = blended({ igId, from, to });
  const cur = b.adAccount?.currency ?? 'TRY';
  const parts = [];
  if (inc('kpis') && !a.capabilities.ads) parts.push(kpiSection(L, a));
  else if (inc('kpis')) parts.push(`<h2>${L('organic_paid')}</h2><div class="kpis">${kpiBox(L, L('organic_reach'), fmt(b.totals.organicReach), a.kpis.reach.changePct)}${kpiBox(L, L('paid_reach'), fmt(b.totals.paidReach), b.totals.paidReachChangePct)}${kpiBox(L, L('spend'), money(b.totals.spend, cur), b.totals.spendChangePct)}${kpiBox(L, L('impressions'), fmt(b.totals.impressions), null)}${kpiBox(L, L('clicks'), fmt(b.totals.clicks), null)}${kpiBox(L, L('results'), fmt(b.totals.results), null)}${kpiBox(L, L('cost_per_result'), b.totals.costPerResult != null ? money(b.totals.costPerResult, cur) : '—', null)}</div>`);
  if (inc('blended')) parts.push(`<div class="panel">${lineChart({ labels: b.series.map((d) => d.date.slice(5)), series: [{ name: L('organic_reach'), color: '#4F7CFF', values: b.series.map((d) => d.organicReach) }, { name: L('paid_reach'), color: '#C06CE8', values: b.series.map((d) => d.paidReach) }], dual: { name: `${L('spend')} (${cur})`, color: '#E8B44A', values: b.series.map((d) => d.spend) } })}</div>`);
  if (inc('campaigns')) parts.push(b.campaigns.length ? campaignsTable(L, b) : `<p class="muted">${L('no_ad_account')}</p>`);
  if (inc('breakdown')) parts.push(breakdownSection(L, b, from, to));
  if (inc('boosted')) {
    const boosted = listMedia({ igIds: [igId], from: rangeMs(from, to).fromMs, to: rangeMs(from, to).toMs, onlyPaid: true, sort: 'spend' });
    if (boosted.length) parts.push(`<h2>${L('boosted_posts')} · ${boosted.length}</h2>${postsTable(L, lang, boosted, { showAccount: false })}`);
  }
  if (inc('posts')) parts.push(`<h2>${L('top6')}</h2>${postsGrid(L, lang, topPosts(a))}`);
  if (inc('commentary')) parts.push(commentarySection(L, commentary));
  return shell({ lang, title: coverTitle || `${a.account.name ?? a.account.username} — ${L('campaign')}`, subtitle: `@${a.account.username} · ${from} – ${to}`, logoDataUrl, branding, clientLogo: getClientLogo(igId), body: parts.join('') });
}

/** Selected-posts report: one detailed block per basket post plus a comparison table. */
export function basketReport({ basket, coverTitle, logoDataUrl, branding, lang = 'en', sections = {}, commentary, from, to }) {
  const L = makeL(lang);
  const inc = (k) => sections[k] !== false;
  const cmp = comparePosts({ mediaIds: basket ?? [] });
  if (!cmp.items.length) throw new Error(msg('basket_empty', null, lang));
  const parts = [];
  const f = postFlags(cmp.items.map((d) => d.media));
  const metricRows = [
    ...(f.reach ? [['reach', L('reach'), fmt]] : []), ['views', L('views'), fmt], ['likes', L('likes'), fmt], ['comments', L('comments'), fmt],
    ...(f.saves ? [['saved', L('saves'), fmt]] : []), ['shares', L('shares'), fmt], ...(f.reposts ? [['reposts', L('reposts'), fmt], ['quotes', L('quotes'), fmt]] : []),
    ['engagementRate', 'ER', (v) => `%${round(v, 2) ?? '—'}`], ...(f.saves ? [['saveRate', L('save_rate'), (v) => `%${round(v, 2) ?? '—'}`]] : []),
  ];
  if (inc('comparison') && cmp.items.length > 1) {
    parts.push(`<h2>${L('comparison')}</h2><table><thead><tr><th></th>${cmp.items.map((d) => `<th class="n">@${esc(d.media.username)}<br><span class="muted">${dateStr(d.media.postedAt, lang)} · ${L(d.media.typeKey)}</span></th>`).join('')}</tr></thead><tbody>
${metricRows.map(([k, label, f]) => `<tr><td class="muted">${label}</td>${cmp.items.map((d) => `<td class="n" ${cmp.best[k] === d.media.mediaId ? 'style="color:var(--pos);font-weight:600"' : ''}>${f(d.media[k])}</td>`).join('')}</tr>`).join('')}
<tr><td class="muted">${L('ad_spend')}</td>${cmp.items.map((d) => `<td class="n">${d.paid ? money(d.paid.totals.spend, d.paid.currency) : '—'}</td>`).join('')}</tr></tbody></table>
<div class="panel">${lineChart({ labels: cmp.lifecycle.map((r) => `${r.ageHours}s`), series: cmp.items.slice(0, 6).map((d, i) => ({ name: '@' + d.media.username + ' ' + dateStr(d.media.postedAt, lang), color: ['#4F7CFF', '#3FBF8F', '#E8B44A', '#C06CE8', '#E5605F', '#48C3D6'][i], values: cmp.lifecycle.map((r) => r[d.media.mediaId] ?? 0) })) })}<div class="note">${L('lifecycle_note')}</div></div>`);
  }
  if (inc('details')) {
    for (const d of cmp.items) {
      const m = d.media;
      const tiles = metricRows.map(([k, label, f]) => kpiBox(L, label, f(m[k]), d.deltas[k] ?? null)).join('');
      parts.push(`<h2>@${esc(m.username)} · ${dateStr(m.postedAt, lang)} · ${L(m.typeKey)}</h2>
<div class="panel"><div style="font-size:14px;line-height:1.6">${esc(m.caption ?? '')}</div><div class="note" style="margin-top:6px">${m.captionLength} ${L('chars')} · ${m.hashtagCount} hashtag · ${m.mentionCount} mention · ${d.rank.rank != null ? `${L('reach_rank')}: #${d.rank.rank}/${d.rank.total}` : ''}${m.permalink ? ` · <a href="${esc(m.permalink)}" style="color:var(--accent)">${esc(platformLabel(m.platform ?? 'instagram'))}</a>` : ''}</div></div>
<div class="kpis">${tiles}</div>${d.benchmark ? `<div class="note">${L('bench_note', { n: d.benchmark.posts, t: L(m.typeKey), d: d.benchmark.days })}</div>` : ''}
${d.paid ? `<h4>${L('ad')}</h4><div class="kpis">${kpiBox(L, L('spend'), money(d.paid.totals.spend, d.paid.currency), null)}${kpiBox(L, L('paid_reach'), fmt(d.paid.totals.reach), null)}${kpiBox(L, L('impressions'), fmt(d.paid.totals.impressions), null)}${kpiBox(L, L('clicks'), fmt(d.paid.totals.clicks), null)}${kpiBox(L, L('results'), fmt(d.paid.totals.results), null)}${kpiBox(L, L('paid_share'), round(d.derived.paidShare, 1) ?? '—', null, '%')}</div>` : ''}`);
    }
  }
  if (inc('commentary')) parts.push(commentarySection(L, commentary));
  const subtitle = `${cmp.items.length} ${L('posts').toLowerCase()}${from && to ? ` · ${from} – ${to}` : ''}`;
  return shell({ lang, title: coverTitle || L('basket'), subtitle, logoDataUrl, branding, body: parts.join('') });
}

/** Weekly change digest (portfolio). */
export function weeklyReport({ weekOf, to, tagIds, platforms, coverTitle, logoDataUrl, branding, lang = 'en', sections = {}, commentary }) {
  const L = makeL(lang);
  const inc = (k) => sections[k] !== false;
  const d = weeklyDigest({ weekOf: weekOf ?? to, tagIds, platforms, lang });
  const parts = [`<h2>${L('weekly_digest')}</h2><div class="panel" style="font-size:15px;line-height:1.7">${d.sentences.map((s) => `<p style="margin:0 0 8px">${esc(s)}</p>`).join('')}</div>`];
  if (inc('kpis')) parts.push(`<div class="kpis" style="margin-top:16px">${kpiBox(L, L('reach'), fmt(d.kpis.totalReach.value), d.kpis.totalReach.changePct)}${kpiBox(L, L('net_followers'), fmt(d.kpis.netFollowers.value), d.kpis.netFollowers.changePct)}${kpiBox(L, L('avg_er'), d.kpis.avgEr.value ?? '—', d.kpis.avgEr.changePct, '%')}${kpiBox(L, L('posts'), fmt(d.kpis.totalPosts.value), d.kpis.totalPosts.changePct)}</div>`);
  if (inc('posts')) parts.push(`<h2>${L('week_posts')}</h2>${postsGrid(L, lang, d.topPosts)}`);
  if (inc('commentary')) parts.push(commentarySection(L, commentary));
  return shell({ lang, title: coverTitle || L('weekly'), subtitle: `${d.from} – ${d.to}`, logoDataUrl, branding, body: parts.join('') });
}

export const TEMPLATE_SECTIONS = {
  monthly: ['kpis', 'reach', 'followers', 'posts', 'types', 'besttime', 'content', 'basket', 'stories', 'demographics', 'health', 'competitors', 'ads', 'commentary'],
  weekly_client: ['kpis', 'reach', 'followers', 'posts', 'types', 'content', 'basket', 'stories', 'ads', 'commentary'],
  custom: ['kpis', 'reach', 'followers', 'posts', 'types', 'besttime', 'content', 'basket', 'stories', 'demographics', 'health', 'competitors', 'ads', 'commentary'],
  portfolio: ['kpis', 'league', 'top10', 'attention', 'content', 'commentary'],
  campaign: ['kpis', 'blended', 'campaigns', 'breakdown', 'boosted', 'posts', 'commentary'],
  weekly: ['kpis', 'posts', 'commentary'],
  basket: ['comparison', 'details', 'commentary'],
};

/** Capability an optional section needs (providers/capabilities.js); sections not listed apply to every platform. */
export const SECTION_CAPABILITY = Object.freeze({
  stories: 'stories', demographics: 'demographics', competitors: 'competitors',
  ads: 'ads', blended: 'ads', campaigns: 'ads', breakdown: 'ads', boosted: 'ads',
});

/** The template's sections that apply to an account on `platform` (N/A sections dropped; Instagram keeps all). */
export function sectionsFor(template, platform = 'instagram') {
  const caps = capabilitiesFor(platform);
  return (TEMPLATE_SECTIONS[template] ?? TEMPLATE_SECTIONS.monthly).filter((k) => !SECTION_CAPABILITY[k] || caps[SECTION_CAPABILITY[k]]);
}

/** Top 6 posts of an account by its primary metric (reach; views on Threads). */
function topPosts(a) {
  const m = a.primaryMetric ?? 'reach';
  return [...a.posts].sort((x, y) => (y[m] ?? 0) - (x[m] ?? 0)).slice(0, 6);
}

export function buildReport(template, params) {
  switch (template) {
    case 'monthly':
    case 'weekly_client':
    case 'custom': return clientReport({ ...params, template });
    case 'portfolio': return portfolioReport(params);
    case 'campaign': return campaignReport(params);
    case 'weekly': return weeklyReport(params);
    case 'basket': return basketReport(params);
    default: throw new Error(msg('unknown_template', { t: template }, params?.lang));
  }
}

export function writeHtmlReport(template, params, filePath) {
  fs.writeFileSync(filePath, buildReport(template, params), 'utf8');
  return filePath;
}
