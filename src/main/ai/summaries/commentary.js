import { isSupportedLang, LANGUAGE } from '../../locales/catalog.js';
import { subDays } from 'date-fns';
import { accountAnalytics } from '../../analytics/account.js';
import { portfolio } from '../../analytics/portfolio.js';
import { comparePosts } from '../../analytics/content.js';
import { listMedia } from '../../db/queries/media.js';
import { previousPeriod, rangeMs, pctChange, fmtDate, toDate } from '../../analytics/util.js';
import { AiError } from '../errors.js';
import { compact, postSummary, typeKey, assertRange, assertIds } from './compact.js';

const ACCOUNT_TEMPLATES = ['monthly', 'weekly_client', 'custom', 'campaign'];
const PORTFOLIO_TEMPLATES = ['portfolio', 'weekly'];
const MAX_ACCOUNTS = 8;
const MAX_BASKET = 12;
const TOP_N = 3;

/**
 * Compact JSON summary of the analytics behind a report (same params as export:preview), for the AI commentary prompt.
 * Only aggregated metrics + truncated captions; no nulls/undefined.
 */
export function commentarySummary(params = {}) {
  const { template } = params;
  const lang = isSupportedLang(params.lang) ? params.lang : 'en';
  if (ACCOUNT_TEMPLATES.includes(template)) return accountReport(params, lang);
  if (PORTFOLIO_TEMPLATES.includes(template)) return portfolioReport(params, lang);
  if (template === 'basket') return basketReport(params, lang);
  throw new AiError('ai_bad_input', { vars: { field: 'template' } });
}

function header(template, from, to, lang) {
  const prev = previousPeriod(from, to);
  return { template, from, to, days: prev.days, previousPeriod: { from: prev.from, to: prev.to }, language: LANGUAGE[lang] };
}

function accountReport(params, lang) {
  const { from, to } = assertRange(params.from, params.to);
  const requested = params.igIds?.length ? params.igIds : params.igId ? [params.igId] : [];
  const ids = assertIds(requested, 'igIds');
  const accounts = ids.slice(0, MAX_ACCOUNTS).map((igId) => accountSummary(igId, from, to)).filter(Boolean);
  if (!accounts.length) throw new AiError('ai_bad_input', { vars: { field: 'igIds' } });
  return compact({ report: header(params.template, from, to, lang), accounts, omittedAccounts: ids.length - Math.min(ids.length, MAX_ACCOUNTS) || undefined });
}

function accountSummary(igId, from, to) {
  const a = accountAnalytics({ igId, from, to });
  if (!a) return null;
  // Ranked by the platform's primary metric: reach, or views on Threads (no reach there).
  const m = a.primaryMetric ?? 'reach';
  const byReach = a.posts.filter((p) => p[m] != null).sort((x, y) => y[m] - x[m]);
  const bottom = byReach.slice(Math.max(TOP_N, byReach.length - TOP_N)).reverse();
  return {
    username: `@${a.account.username}`,
    platform: a.platform,
    primaryMetric: m,
    unavailableMetrics: unavailable(a.capabilities),
    name: a.account.name,
    client: a.account.clientName,
    followers: a.account.followers,
    kpis: Object.fromEntries(Object.entries(a.kpis).map(([k, v]) => [k, { value: v.value, previous: v.prev, changePct: v.changePct }])),
    contentMix: a.byType.map((t) => ({ type: typeKey({ mediaProductType: t.productType, mediaType: t.mediaType }), posts: t.posts, avgReach: t.avgReach ?? undefined, avgErPct: t.avgEr })),
    topPosts: byReach.slice(0, TOP_N).map((p) => postSummary(p)),
    bottomPosts: bottom.map((p) => postSummary(p)),
    ads: a.paid ? adsSummary(a.paid) : undefined,
    healthScore: a.health?.score,
  };
}

/** Metrics the platform does not report, so the model does not read their absence as zero. */
function unavailable(caps) {
  const out = [...(caps?.reach ? [] : ['reach']), ...(caps?.saveRate ? [] : ['saves', 'saveRate']), ...(caps?.stories ? [] : ['stories'])];
  return out.length ? out : undefined;
}

function adsSummary(paid) {
  return {
    adAccount: paid.name,
    currency: paid.paidCurrency,
    spend: paid.spend,
    previousSpend: paid.prev?.spend,
    spendChangePct: pctChange(paid.spend, paid.prev?.spend),
    paidReach: paid.paidReach,
    impressions: paid.paidImpressions,
    clicks: paid.paidClicks,
    ctrPct: paid.paidCtr,
    cpm: paid.paidCpm,
    results: paid.paidResults,
    resultType: paid.paidResultType,
    costPerResult: paid.costPerResult,
    monthlyBudget: paid.monthlyBudget,
  };
}

function portfolioReport(params, lang) {
  const weekly = params.template === 'weekly';
  const end = weekly ? params.weekOf ?? params.to : params.to;
  const { from, to } = assertRange(weekly ? fmtDate(subDays(toDate(String(end)), 6)) : params.from, end);
  const tagIds = Array.isArray(params.tagIds) ? params.tagIds.filter(Number.isInteger) : [];
  const p = portfolio({ from, to, tagIds });
  const accRow = (r) => ({ account: `@${r.username}`, platform: r.platform, client: r.clientName, followers: r.followers, followersChange: r.followersChange, reach: r.reach, reachChangePct: r.reachChangePct, views: r.reach == null ? r.views : undefined, viewsChangePct: r.reach == null ? r.primaryChangePct : undefined, erPct: r.er, posts: r.posts, adSpend: r.spend || undefined, healthScore: r.health });
  const ranked = p.rows.filter((r) => r.reachChangePct != null).sort((x, y) => y.reachChangePct - x.reachChangePct);
  const { fromMs, toMs } = rangeMs(from, to);
  const posts = p.rows.length ? listMedia({ igIds: p.rows.map((r) => r.igId), from: fromMs, to: toMs, sort: 'reach', limit: 5 }) : [];
  const k = p.kpis;
  return compact({
    report: header(params.template, from, to, lang),
    portfolio: {
      accounts: p.rows.length,
      byPlatform: Object.keys(p.kpis.byPlatform ?? {}).length > 1 ? p.kpis.byPlatform : undefined,
      notes: p.platforms?.includes('threads') ? 'Threads has no reach (views instead); totalReach covers Instagram and Facebook only.' : undefined,
      kpis: {
        totalFollowers: { value: k.totalFollowers.value, changePct: k.totalFollowers.changePct },
        netFollowers: { value: k.netFollowers.value, previous: k.netFollowers.prev, changePct: k.netFollowers.changePct },
        totalReach: { value: k.totalReach.value, previous: k.totalReach.prev, changePct: k.totalReach.changePct },
        avgErPct: { value: k.avgEr.value, previous: k.avgEr.prev, changePct: k.avgEr.changePct },
        posts: { value: k.totalPosts.value, previous: k.totalPosts.prev, changePct: k.totalPosts.changePct },
        adSpend: { value: k.totalSpend.value, previous: k.totalSpend.prev, changePct: k.totalSpend.changePct, currency: k.totalSpend.currency },
      },
      topAccounts: ranked.slice(0, 5).map(accRow),
      bottomAccounts: ranked.length > 5 ? ranked.slice(Math.max(5, ranked.length - 5)).reverse().map(accRow) : undefined,
      topPosts: posts.map((x) => postSummary(x, { withAccount: true })),
      anomalies: p.attention.anomalies.slice(0, 5).map((a) => ({ account: `@${a.username}`, platform: a.platform, metric: a.kind, date: a.date, direction: a.direction, value: a.value, baselineMean: a.mean, z: a.z })),
      silentAccounts: p.attention.silent.length ? { count: p.attention.silent.length, examples: p.attention.silent.slice(0, 5).map((s) => `@${s.username}`) } : undefined,
    },
  });
}

function basketReport(params, lang) {
  const ids = assertIds(params.basket, 'basket', MAX_BASKET);
  const cmp = comparePosts({ mediaIds: ids });
  if (!cmp.items.length) throw new AiError('ai_bad_input', { vars: { field: 'basket' } });
  const dates = cmp.items.map((d) => fmtDate(new Date(d.media.postedAt))).sort();
  const from = params.from ?? dates[0];
  const to = params.to ?? dates.at(-1);
  return compact({
    report: { template: 'basket', from, to, language: LANGUAGE[lang] },
    posts: cmp.items.map((d) => ({
      ...postSummary(d.media, { withAccount: true }),
      vsAccountTypeAvgPct: d.benchmark ? { reach: d.deltas.reach, erPct: d.deltas.engagementRate, saves: d.deltas.saved } : undefined,
      paid: d.paid ? { currency: d.paid.currency, spend: d.paid.totals.spend, paidReach: d.paid.totals.reach, results: d.paid.totals.results } : undefined,
    })),
  });
}
