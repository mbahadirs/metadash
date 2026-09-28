import { accountAnalytics, accountStories, accountDemographics } from '../analytics/account.js';
import { portfolio } from '../analytics/portfolio.js';
import { contentAnalysis, comparePosts } from '../analytics/content.js';
import { blended } from '../analytics/blended.js';
import { weeklyDigest } from '../analytics/weeklyDigest.js';
import { healthScores } from '../analytics/health.js';
import { listMedia } from '../db/queries/media.js';
import { adObjects, adBreakdown } from '../db/queries/ads.js';
import { rangeMs } from '../analytics/util.js';
import { makeL, weekdays } from './reportI18n.js';
import { msg } from '../i18n.js';

/** Ad metric columns (post/account rows), localized via L. */
const adXlsx = (L) => [{ key: 'paidCurrency', label: L('currency'), type: 'text' }, { key: 'paidImpressions', label: L('ad_impressions'), type: 'int' }, { key: 'paidResults', label: L('results'), type: 'int' }, { key: 'paidResultType', label: L('result_type'), type: 'text' }, { key: 'costPerResult', label: L('cost_per_result'), type: 'money' }, { key: 'spend', label: L('amount_spent'), type: 'money' }, { key: 'paidReach', label: L('paid_reach'), type: 'int' }, { key: 'paidFrequency', label: L('frequency'), type: 'float' }, { key: 'paidCpc', label: 'CPC', type: 'money' }, { key: 'paidCtr', label: 'CTR %', type: 'percent' }, { key: 'paidCpm', label: 'CPM', type: 'money' }, { key: 'paidPostEngagement', label: L('post_engagement'), type: 'int' }, { key: 'costPerPostEngagement', label: L('cost_per_post_engagement'), type: 'money' }, { key: 'paidPageEngagement', label: L('page_engagement'), type: 'int' }, { key: 'costPerPageEngagement', label: L('cost_per_page_engagement'), type: 'money' }];
const adXlsxAcc = (L) => { const a = adXlsx(L); return [a[0], ...a.slice(1, 5), { key: 'monthlyBudget', label: L('monthly_budget'), type: 'money' }, ...a.slice(5)]; };

const TYPE = (p) => (p.mediaProductType === 'REELS' ? 'reels' : p.mediaType === 'CAROUSEL_ALBUM' ? 'carousel' : p.mediaType === 'VIDEO' ? 'video' : 'image');

function postColumns(L, { account = true, deltas = false, paid = true } = {}) {
  return [
    ...(account ? [{ key: 'username', label: L('account'), type: 'text' }] : []),
    { key: 'postedAt', label: L('date'), type: 'datetime' }, { key: 'type', label: L('type'), type: 'text' }, { key: 'caption', label: L('caption'), type: 'text' },
    { key: 'permalink', label: 'URL', type: 'text' },
    { key: 'reach', label: L('reach'), type: 'int' }, ...(deltas ? [{ key: 'vsReach', label: `${L('reach')} Δ%`, type: 'percent' }] : []),
    { key: 'views', label: L('views'), type: 'int' }, { key: 'likes', label: L('likes'), type: 'int' }, { key: 'comments', label: L('comments'), type: 'int' },
    { key: 'saved', label: L('saves'), type: 'int' }, ...(deltas ? [{ key: 'vsSaved', label: `${L('saves')} Δ%`, type: 'percent' }] : []),
    { key: 'shares', label: L('shares'), type: 'int' }, { key: 'engagementRate', label: 'ER %', type: 'percent' }, ...(deltas ? [{ key: 'vsEr', label: 'ER Δ%', type: 'percent' }] : []),
    { key: 'saveRate', label: `${L('save_rate')} %`, type: 'percent' },
    { key: 'hashtagCount', label: 'Hashtag', type: 'int' }, { key: 'captionLength', label: `${L('caption')} (${L('chars_short')})`, type: 'int' },
    ...(paid ? [{ key: 'totalImpressions', label: L('total_impressions'), type: 'int' }, { key: 'paidImpressionShare', label: `${L('paid_impression_share')} %`, type: 'percent' }, { key: 'totalReach', label: L('total_reach'), type: 'int' }, { key: 'paidReachShare', label: `${L('paid_share')} %`, type: 'percent' }, { key: 'paidClicks', label: L('clicks'), type: 'int' }, ...adXlsx(L)] : []),
  ];
}
const postRows = (posts, L) => posts.map((p) => ({ ...p, type: L(TYPE(p)) }));

function kpiSheet(L, kpis, labels) {
  return { name: L('summary'), columns: [{ key: 'metric', label: L('type'), type: 'text' }, { key: 'value', label: L('value'), type: 'float' }, { key: 'prev', label: L('prev'), type: 'float' }, { key: 'changePct', label: 'Δ%', type: 'percent' }], rows: Object.entries(labels).map(([k, label]) => ({ metric: label, value: kpis[k]?.value ?? null, prev: kpis[k]?.prev ?? null, changePct: kpis[k]?.changePct ?? null })) };
}

function accountSheets(L, igId, from, to) {
  const a = accountAnalytics({ igId, from, to });
  if (!a) return [];
  const u = a.account.username;
  const { fromMs, toMs } = rangeMs(from, to);
  const sheets = [];
  sheets.push({ ...kpiSheet(L, a.kpis, { reach: L('reach'), views: L('views'), profileViews: L('profile_views'), er: L('er'), saveRate: L('save_rate'), newFollowers: L('new_followers'), posts: L('posts') }), name: `${u} · ${L('summary')}` });
  sheets.push({ name: `${u} · ${L('daily')}`, columns: [{ key: 'date', label: L('date'), type: 'date' }, { key: 'reach', label: L('reach'), type: 'int' }, { key: 'views', label: L('views'), type: 'int' }, { key: 'profile_views', label: L('profile_views'), type: 'int' }, { key: 'accounts_engaged', label: L('engaged'), type: 'int' }, { key: 'followers', label: L('followers'), type: 'int' }], rows: a.series.map((d) => ({ ...d, followers: a.followerSeries.find((f) => f.date === d.date)?.followers ?? null })) });
  sheets.push({ name: `${u} · ${L('posts')}`, columns: postColumns(L, { account: false }), rows: postRows(listMedia({ igIds: [igId], from: fromMs, to: toMs, sort: 'date' }), L) });
  const ca = contentAnalysis({ from, to, igIds: [igId] });
  sheets.push({ name: `${u} · ${L('type')}`, columns: [{ key: 'type', label: L('type'), type: 'text' }, { key: 'posts', label: L('posts'), type: 'int' }, { key: 'totalReach', label: L('reach'), type: 'int' }, { key: 'avgReach', label: L('avg_reach'), type: 'int' }, { key: 'avgViews', label: L('avg_views'), type: 'int' }, { key: 'avgLikes', label: L('avg_likes'), type: 'int' }, { key: 'avgSaved', label: L('avg_saved'), type: 'int' }, { key: 'avgEr', label: L('avg_er'), type: 'percent' }, { key: 'avgSaveRate', label: L('save_rate'), type: 'percent' }, { key: 'spend', label: L('ad_spend'), type: 'money' }], rows: ca.types.map((t) => ({ ...t, type: L(t.typeKey) })) });
  if (ca.hashtags.length) sheets.push({ name: `${u} · Hashtag`, columns: [{ key: 'tag', label: L('hashtag'), type: 'text' }, { key: 'posts', label: L('usage'), type: 'int' }, { key: 'avgReach', label: L('avg_reach'), type: 'int' }, { key: 'avgEr', label: L('avg_er'), type: 'percent' }, { key: 'avgSaved', label: L('avg_saved'), type: 'int' }], rows: ca.hashtags });
  const st = accountStories({ igId, from, to });
  if (st.stories.length) sheets.push({ name: `${u} · Story`, columns: [{ key: 'postedAt', label: L('date'), type: 'datetime' }, { key: 'mediaType', label: L('type'), type: 'text' }, { key: 'reach', label: L('reach'), type: 'int' }, { key: 'views', label: L('views'), type: 'int' }, { key: 'replies', label: L('replies'), type: 'int' }, { key: 'navForward', label: L('nav_forward'), type: 'int' }, { key: 'navBack', label: L('nav_back'), type: 'int' }, { key: 'navExit', label: L('nav_exit'), type: 'int' }, { key: 'completionRate', label: L('completion'), type: 'percent' }], rows: st.stories.map((s) => ({ ...s, completionRate: s.completionRate != null ? s.completionRate * 100 : null })) });
  const d = accountDemographics({ igId });
  if (d.capturedAt) sheets.push({ name: `${u} · ${L('demographics')}`, columns: [{ key: 'dimension', label: L('dimension'), type: 'text' }, { key: 'bucket', label: L('value'), type: 'text' }, { key: 'value', label: L('followers'), type: 'int' }], rows: [...d.city.map((x) => ({ dimension: L('city'), ...x })), ...d.genderAge.map((x) => ({ dimension: L('gender_age'), ...x })), ...d.country.map((x) => ({ dimension: L('country'), ...x }))] });
  const b = blended({ igId, from, to });
  if (b.adAccount) {
    sheets.push({ name: `${u} · ${L('ad')}`, columns: [{ key: 'date', label: L('date'), type: 'date' }, { key: 'organicReach', label: L('organic_reach'), type: 'int' }, { key: 'paidReach', label: L('paid_reach'), type: 'int' }, { key: 'impressions', label: L('impressions'), type: 'int' }, { key: 'spend', label: `${L('spend')} (${b.adAccount.currency})`, type: 'money' }], rows: b.series });
    if (b.campaigns.length) sheets.push({ name: `${u} · ${L('campaigns')}`, columns: adColumns(L, b.adAccount.currency), rows: b.campaigns });
  }
  return sheets;
}

function adColumns(L, cur) {
  return [{ key: 'objectName', label: L('name'), type: 'text' }, { key: 'spend', label: `${L('spend')} (${cur})`, type: 'money' }, { key: 'reach', label: L('reach'), type: 'int' }, { key: 'impressions', label: L('impressions'), type: 'int' }, { key: 'clicks', label: L('clicks'), type: 'int' }, { key: 'ctr', label: 'CTR %', type: 'percent' }, { key: 'cpc', label: 'CPC', type: 'money' }, { key: 'cpm', label: 'CPM', type: 'money' }, { key: 'results', label: L('results'), type: 'int' }, { key: 'costPerResult', label: L('cost_per_result'), type: 'money' }, { key: 'resultType', label: L('result_type'), type: 'text' }, { key: 'postEngagement', label: L('post_engagement'), type: 'int' }, { key: 'costPerPostEngagement', label: L('cost_per_post_engagement'), type: 'money' }, { key: 'pageEngagement', label: L('page_engagement'), type: 'int' }, { key: 'costPerPageEngagement', label: L('cost_per_page_engagement'), type: 'money' }, { key: 'frequency', label: L('frequency'), type: 'float' }];
}

/** Builds workbook sheets for a report template. */
export function reportSheets(template, params) {
  const lang = params.lang ?? 'en';
  const L = makeL(lang);
  const { from, to } = params;
  const igIds = params.igIds?.length ? params.igIds : params.igId ? [params.igId] : [];
  switch (template) {
    case 'monthly':
    case 'weekly_client':
    case 'custom': {
      const sheets = igIds.flatMap((id) => accountSheets(L, id, from, to));
      if (igIds.length > 1) {
        const rows = igIds.map((id) => accountAnalytics({ igId: id, from, to })).filter(Boolean).map((a) => ({ username: a.account.username, clientName: a.account.clientName, followers: a.account.followers, newFollowers: a.kpis.newFollowers.value, reach: a.kpis.reach.value, reachChange: a.kpis.reach.changePct, views: a.kpis.views.value, er: a.kpis.er.value, erChange: a.kpis.er.changePct, saveRate: a.kpis.saveRate.value, posts: a.kpis.posts.value, ...(a.paid ?? {}) }));
        sheets.unshift({ name: L('accounts_table'), columns: [{ key: 'username', label: L('account'), type: 'text' }, { key: 'clientName', label: L('client'), type: 'text' }, { key: 'followers', label: L('followers'), type: 'int' }, { key: 'newFollowers', label: L('new_followers'), type: 'int' }, { key: 'reach', label: L('reach'), type: 'int' }, { key: 'reachChange', label: `${L('reach')} Δ%`, type: 'percent' }, { key: 'views', label: L('views'), type: 'int' }, { key: 'er', label: 'ER %', type: 'percent' }, { key: 'erChange', label: 'ER Δ%', type: 'percent' }, { key: 'saveRate', label: L('save_rate'), type: 'percent' }, { key: 'posts', label: L('posts'), type: 'int' }, ...adXlsxAcc(L)], rows });
      }
      if (params.basket?.length) sheets.push(...basketSheets(L, params.basket, lang));
      return sheets;
    }
    case 'portfolio': {
      const p = portfolio({ from, to, tagIds: params.tagIds });
      const { fromMs, toMs } = rangeMs(from, to);
      const health = new Map(healthScores({ from, to }).map((h) => [h.igId, h]));
      return [
        kpiSheet(L, p.kpis, { totalFollowers: L('followers'), netFollowers: L('net_followers'), totalReach: L('reach'), avgEr: L('avg_er'), totalSpend: L('spend'), totalPosts: L('posts') }),
        { name: L('league'), columns: [{ key: 'username', label: L('account'), type: 'text' }, { key: 'clientName', label: L('client'), type: 'text' }, { key: 'followers', label: L('followers'), type: 'int' }, { key: 'followersChange', label: L('change'), type: 'int' }, { key: 'followersChangePct', label: `${L('change')} %`, type: 'percent' }, { key: 'reach', label: L('reach'), type: 'int' }, { key: 'reachChangePct', label: `${L('reach')} Δ%`, type: 'percent' }, { key: 'posts', label: L('posts'), type: 'int' }, { key: 'er', label: 'ER %', type: 'percent' }, { key: 'erChangePct', label: 'ER Δ%', type: 'percent' }, { key: 'saveRate', label: L('save_rate'), type: 'percent' }, { key: 'health', label: L('health'), type: 'int' }, { key: 'growthPct', label: L('growth'), type: 'int' }, { key: 'engagementPct', label: L('engagement'), type: 'int' }, { key: 'consistencyPct', label: L('consistency'), type: 'int' }, { key: 'responsePct', label: L('response'), type: 'int' }, { key: 'daysSincePost', label: L('days_since_post'), type: 'int' }, { key: 'totalReach', label: L('total_reach'), type: 'int' }, ...adXlsxAcc(L)], rows: p.rows.map((r) => ({ ...r, growthPct: health.get(r.igId)?.components.growth.pct, engagementPct: health.get(r.igId)?.components.engagement.pct, consistencyPct: health.get(r.igId)?.components.consistency.pct, responsePct: health.get(r.igId)?.components.response.pct })) },
        { name: L('posts'), columns: postColumns(L), rows: postRows(listMedia({ from: fromMs, to: toMs, igIds: p.rows.map((r) => r.igId), sort: 'reach' }), L) },
        { name: L('anomalies'), columns: [{ key: 'username', label: L('account'), type: 'text' }, { key: 'kind', label: L('type'), type: 'text' }, { key: 'date', label: L('date'), type: 'date' }, { key: 'value', label: L('value'), type: 'float' }, { key: 'mean', label: L('mean'), type: 'float' }, { key: 'sigma', label: 'σ', type: 'float' }, { key: 'z', label: 'z', type: 'float' }, { key: 'direction', label: L('direction'), type: 'text' }], rows: p.attention.anomalies },
      ];
    }
    case 'campaign': {
      const igId = igIds[0];
      const b = blended({ igId, from, to });
      const { fromMs, toMs } = rangeMs(from, to);
      const cur = b.adAccount?.currency ?? 'TRY';
      const sheets = [{ name: L('organic_paid'), columns: [{ key: 'date', label: L('date'), type: 'date' }, { key: 'organicReach', label: L('organic_reach'), type: 'int' }, { key: 'paidReach', label: L('paid_reach'), type: 'int' }, { key: 'impressions', label: L('impressions'), type: 'int' }, { key: 'spend', label: `${L('spend')} (${cur})`, type: 'money' }], rows: b.series }];
      if (b.adAccount) {
        for (const level of ['campaign', 'adset', 'ad']) sheets.push({ name: level === 'campaign' ? L('campaigns') : level === 'adset' ? L('adsets') : L('ads_list'), columns: adColumns(L, cur), rows: adObjects([b.adAccount.actId], from, to, level) });
        for (const bd of ['age', 'gender', 'publisher_platform']) sheets.push({ name: `${L('breakdown')} · ${L(bd === 'publisher_platform' ? 'platform' : bd)}`, columns: [{ key: 'bucket', label: L(bd === 'publisher_platform' ? 'platform' : bd), type: 'text' }, { key: 'spend', label: `${L('spend')} (${cur})`, type: 'money' }, { key: 'reach', label: L('reach'), type: 'int' }, { key: 'impressions', label: L('impressions'), type: 'int' }, { key: 'clicks', label: L('clicks'), type: 'int' }, { key: 'ctr', label: 'CTR %', type: 'percent' }, { key: 'results', label: L('results'), type: 'int' }], rows: adBreakdown([b.adAccount.actId], from, to, bd) });
      }
      sheets.push({ name: L('boosted_posts'), columns: postColumns(L, { account: false }), rows: postRows(listMedia({ igIds: [igId], from: fromMs, to: toMs, onlyPaid: true, sort: 'spend' }), L) });
      return sheets;
    }
    case 'weekly': {
      const d = weeklyDigest({ weekOf: params.weekOf ?? to, tagIds: params.tagIds, lang });
      return [
        { name: L('weekly_digest'), columns: [{ key: 'sentence', label: L('weekly_digest'), type: 'text' }], rows: d.sentences.map((s) => ({ sentence: s })) },
        kpiSheet(L, d.kpis, { totalReach: L('reach'), netFollowers: L('net_followers'), avgEr: L('avg_er'), totalPosts: L('posts'), totalSpend: L('spend') }),
        { name: L('week_posts'), columns: postColumns(L), rows: postRows(d.topPosts, L) },
      ];
    }
    case 'basket': return basketSheets(L, params.basket ?? [], lang);
    default: throw new Error(msg('unknown_template', { t: template }, lang));
  }
}

/** Basket: one row per post with all metrics, benchmark deltas, rank, paid; plus lifecycle points and comparison. */
function basketSheets(L, basket, lang = 'en') {
  const days = weekdays(lang);
  const ids = [...new Set(basket)];
  const items = [];
  for (let i = 0; i < ids.length; i += 6) items.push(...comparePosts({ mediaIds: ids.slice(i, i + 6) }).items);
  const rows = items.map((d) => ({
    ...d.media, type: L(d.media.typeKey), vsReach: d.deltas.reach, vsEr: d.deltas.engagementRate, vsSaved: d.deltas.saved, vsViews: d.deltas.views, vsComments: d.deltas.comments, vsShares: d.deltas.shares,
    rank: d.rank.rank, rankTotal: d.rank.total, hoursTo80: d.lifecycle.hoursTo80, benchPosts: d.benchmark?.posts ?? null, benchReach: d.benchmark?.reach ?? null, benchEr: d.benchmark?.engagementRate ?? null,
    slot: d.slot ? `${days[d.slot.weekday]} ${d.slot.hour}:00` : null, slotEr: d.slot?.value ?? null,
    viewsPerReach: d.derived.viewsPerReach, interactionsPerK: d.derived.interactionsPerThousandReach, paidShare: d.derived.paidShare,
    paidSpend: d.paid?.totals.spend ?? null, paidCurrency: d.paid?.currency ?? null, paidReachTotal: d.paid?.totals.reach ?? null, paidImpressions: d.paid?.totals.impressions ?? null, paidClicksTotal: d.paid?.totals.clicks ?? null, paidResultsTotal: d.paid?.totals.results ?? null, paidCpm: d.paid?.totals.cpm ?? null, adCount: d.paid?.ads.length ?? 0,
  }));
  const cols = [
    { key: 'username', label: L('account'), type: 'text' }, { key: 'postedAt', label: L('date'), type: 'datetime' }, { key: 'type', label: L('type'), type: 'text' }, { key: 'caption', label: L('caption'), type: 'text' }, { key: 'permalink', label: 'URL', type: 'text' },
    { key: 'reach', label: L('reach'), type: 'int' }, { key: 'vsReach', label: `${L('reach')} Δ% (${L('type_avg')})`, type: 'percent' }, { key: 'views', label: L('views'), type: 'int' }, { key: 'vsViews', label: `${L('views')} Δ%`, type: 'percent' },
    { key: 'likes', label: L('likes'), type: 'int' }, { key: 'comments', label: L('comments'), type: 'int' }, { key: 'vsComments', label: `${L('comments')} Δ%`, type: 'percent' }, { key: 'saved', label: L('saves'), type: 'int' }, { key: 'vsSaved', label: `${L('saves')} Δ%`, type: 'percent' }, { key: 'shares', label: L('shares'), type: 'int' }, { key: 'vsShares', label: `${L('shares')} Δ%`, type: 'percent' },
    { key: 'engagementRate', label: 'ER %', type: 'percent' }, { key: 'vsEr', label: 'ER Δ%', type: 'percent' }, { key: 'saveRate', label: `${L('save_rate')} %`, type: 'percent' }, { key: 'viewsPerReach', label: L('views_per_reach'), type: 'float' }, { key: 'interactionsPerK', label: L('interactions_per_k'), type: 'float' },
    { key: 'rank', label: L('reach_rank'), type: 'int' }, { key: 'rankTotal', label: L('post_count_28'), type: 'int' }, { key: 'hoursTo80', label: L('hours_to_80'), type: 'float' }, { key: 'slot', label: L('post_slot'), type: 'text' }, { key: 'slotEr', label: L('slot_er'), type: 'percent' },
    { key: 'benchPosts', label: L('bench_posts'), type: 'int' }, { key: 'benchReach', label: L('bench_reach'), type: 'int' }, { key: 'benchEr', label: L('bench_er'), type: 'percent' },
    { key: 'hashtagCount', label: 'Hashtag', type: 'int' }, { key: 'mentionCount', label: 'Mention', type: 'int' }, { key: 'emojiCount', label: 'Emoji', type: 'int' }, { key: 'captionLength', label: L('char_count'), type: 'int' },
    { key: 'paidSpend', label: L('ad_spend'), type: 'money' }, { key: 'paidCurrency', label: L('currency'), type: 'text' }, { key: 'paidReachTotal', label: L('paid_reach'), type: 'int' }, { key: 'paidImpressions', label: L('impressions'), type: 'int' }, { key: 'paidClicksTotal', label: L('clicks'), type: 'int' }, { key: 'paidResultsTotal', label: L('results'), type: 'int' }, { key: 'paidCpm', label: 'CPM', type: 'money' }, { key: 'paidShare', label: `${L('paid_share')} %`, type: 'percent' }, { key: 'adCount', label: L('ad_count'), type: 'int' },
  ];
  const lifecycle = items.flatMap((d) => (d.lifecycle.series.reach ?? []).map((p) => ({ username: d.media.username, postedAt: d.media.postedAt, caption: (d.media.caption ?? '').slice(0, 60), ageHours: p.ageHours, reach: p.value, capturedAt: p.capturedAt })));
  const ads = items.flatMap((d) => (d.paid?.ads ?? []).map((a) => ({ username: d.media.username, postedAt: d.media.postedAt, caption: (d.media.caption ?? '').slice(0, 60), adName: a.adName, accountName: a.accountName, currency: a.currency, spend: a.spend, reach: a.reach, impressions: a.impressions, clicks: a.clicks, ctr: a.ctr, results: a.results, firstDate: a.firstDate, lastDate: a.lastDate })));
  return [
    { name: L('selected_posts'), columns: cols, rows },
    { name: L('lifecycle'), columns: [{ key: 'username', label: L('account'), type: 'text' }, { key: 'postedAt', label: L('date'), type: 'datetime' }, { key: 'caption', label: L('caption'), type: 'text' }, { key: 'ageHours', label: L('age_hours'), type: 'int' }, { key: 'reach', label: L('reach'), type: 'int' }, { key: 'capturedAt', label: L('captured'), type: 'datetime' }], rows: lifecycle },
    { name: L('ad'), columns: [{ key: 'username', label: L('account'), type: 'text' }, { key: 'postedAt', label: L('date'), type: 'datetime' }, { key: 'caption', label: L('caption'), type: 'text' }, { key: 'adName', label: L('ad_name'), type: 'text' }, { key: 'accountName', label: L('ad_account'), type: 'text' }, { key: 'currency', label: L('currency'), type: 'text' }, { key: 'spend', label: L('spend'), type: 'money' }, { key: 'reach', label: L('reach'), type: 'int' }, { key: 'impressions', label: L('impressions'), type: 'int' }, { key: 'clicks', label: L('clicks'), type: 'int' }, { key: 'ctr', label: 'CTR %', type: 'percent' }, { key: 'results', label: L('results'), type: 'int' }, { key: 'firstDate', label: L('first_day'), type: 'date' }, { key: 'lastDate', label: L('last_day'), type: 'date' }], rows: ads },
  ];
}
