import { q } from '../index.js';

export function upsertAdAccount(a) {
  q.run(
    `INSERT INTO ad_accounts (act_id, profile_id, name, currency, status, linked_ig_id, is_tracked)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(act_id) DO UPDATE SET name = excluded.name, currency = excluded.currency, status = excluded.status,
       profile_id = excluded.profile_id`,
    a.actId, a.profileId ?? null, a.name, a.currency ?? 'USD', a.status ?? 'ACTIVE', a.linkedIgId ?? null, a.isTracked === false ? 0 : 1,
  );
}

export function linkAdAccount(actId, igId) {
  q.run('UPDATE ad_accounts SET linked_ig_id = ? WHERE act_id = ?', igId || null, actId);
}

export function setAdAccountTracked(actId, tracked) {
  q.run('UPDATE ad_accounts SET is_tracked = ? WHERE act_id = ?', tracked ? 1 : 0, actId);
}

export function setAdBudget(actId, monthlyBudget, note) {
  q.run('UPDATE ad_accounts SET monthly_budget = ?, budget_note = ? WHERE act_id = ?', monthlyBudget == null || monthlyBudget === '' ? null : Number(monthlyBudget), note ?? null, actId);
}

export function listAdAccounts() {
  return q.all(
    `SELECT ad.act_id AS actId, ad.profile_id AS profileId, ad.name, ad.currency, ad.status, ad.linked_ig_id AS linkedIgId,
       ad.monthly_budget AS monthlyBudget, ad.budget_note AS budgetNote,
       ad.is_tracked AS isTracked, a.username AS linkedUsername,
       (SELECT MAX(date) FROM ad_insights_daily i WHERE i.act_id = ad.act_id) AS lastDate
     FROM ad_accounts ad LEFT JOIN accounts a ON a.ig_id = ad.linked_ig_id ORDER BY ad.name`,
  ).map((r) => ({ ...r, isTracked: !!r.isTracked }));
}

export function adAccountForIg(igId) {
  return q.get('SELECT act_id AS actId, currency, name FROM ad_accounts WHERE linked_ig_id = ? AND is_tracked = 1 LIMIT 1', igId) || null;
}

export function upsertAdInsight(r) {
  q.run(
    `INSERT INTO ad_insights_daily (act_id, date, level, object_id, object_name, spend, impressions, reach, frequency, clicks, ctr, cpc, cpm,
       results, cost_per_result, result_type, post_engagement, page_engagement, link_clicks, parent_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(act_id, date, level, object_id) DO UPDATE SET object_name = excluded.object_name, spend = excluded.spend,
       impressions = excluded.impressions, reach = excluded.reach, frequency = excluded.frequency, clicks = excluded.clicks,
       ctr = excluded.ctr, cpc = excluded.cpc, cpm = excluded.cpm, results = excluded.results,
       cost_per_result = excluded.cost_per_result, result_type = excluded.result_type,
       post_engagement = excluded.post_engagement, page_engagement = excluded.page_engagement, link_clicks = excluded.link_clicks,
       parent_id = COALESCE(excluded.parent_id, ad_insights_daily.parent_id)`,
    r.actId, r.date, r.level, r.objectId, r.objectName ?? null, r.spend ?? 0, r.impressions ?? 0, r.reach ?? 0,
    r.frequency ?? null, r.clicks ?? 0, r.ctr ?? null, r.cpc ?? null, r.cpm ?? null, r.results ?? null,
    r.costPerResult ?? null, r.resultType ?? null, r.postEngagement ?? null, r.pageEngagement ?? null, r.linkClicks ?? null, r.parentId ?? null,
  );
}

export function upsertAdBreakdown(r) {
  q.run(
    `INSERT INTO ad_insights_breakdown (act_id, date, breakdown, bucket, spend, impressions, reach, clicks, results)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(act_id, date, breakdown, bucket) DO UPDATE SET spend = excluded.spend, impressions = excluded.impressions,
       reach = excluded.reach, clicks = excluded.clicks, results = excluded.results`,
    r.actId, r.date, r.breakdown, r.bucket, r.spend ?? 0, r.impressions ?? 0, r.reach ?? 0, r.clicks ?? 0, r.results ?? 0,
  );
}

function actFilter(actIds) {
  return actIds?.length ? `AND act_id IN (${actIds.map(() => '?').join(',')})` : '';
}

/** Daily series at account level for one or more ad accounts. */
export function adDailySeries(actIds, from, to) {
  return q.all(
    `SELECT date, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(reach) AS reach, SUM(clicks) AS clicks, SUM(results) AS results,
       SUM(post_engagement) AS postEngagement, SUM(page_engagement) AS pageEngagement, SUM(link_clicks) AS linkClicks
     FROM ad_insights_daily WHERE level = 'account' AND date BETWEEN ? AND ? ${actFilter(actIds)} GROUP BY date ORDER BY date`,
    from, to, ...(actIds ?? []),
  ).map(withDerived);
}

export function adTotals(actIds, from, to) {
  const row = q.get(
    `SELECT SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(reach) AS reach, SUM(clicks) AS clicks, SUM(results) AS results,
       SUM(post_engagement) AS postEngagement, SUM(page_engagement) AS pageEngagement, SUM(link_clicks) AS linkClicks, MAX(result_type) AS resultType,
       COUNT(DISTINCT date) AS days
     FROM ad_insights_daily WHERE level = 'account' AND date BETWEEN ? AND ? ${actFilter(actIds)}`,
    from, to, ...(actIds ?? []),
  );
  return withDerived(row ?? {});
}

export function adObjects(actIds, from, to, level) {
  return q.all(
    `SELECT object_id AS objectId, MAX(object_name) AS objectName, MAX(result_type) AS resultType,
       SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(reach) AS reach, SUM(clicks) AS clicks, SUM(results) AS results,
       SUM(post_engagement) AS postEngagement, SUM(page_engagement) AS pageEngagement, SUM(link_clicks) AS linkClicks
     FROM ad_insights_daily WHERE level = ? AND date BETWEEN ? AND ? ${actFilter(actIds)}
     GROUP BY object_id ORDER BY spend DESC`,
    level, from, to, ...(actIds ?? []),
  ).map(withDerived);
}

export function adBreakdown(actIds, from, to, breakdown) {
  return q.all(
    `SELECT bucket, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(reach) AS reach, SUM(clicks) AS clicks, SUM(results) AS results
     FROM ad_insights_breakdown WHERE breakdown = ? AND date BETWEEN ? AND ? ${actFilter(actIds)} GROUP BY bucket ORDER BY spend DESC`,
    breakdown, from, to, ...(actIds ?? []),
  ).map(withDerived);
}

export function withDerived(r) {
  const spend = r.spend ?? 0;
  const impressions = r.impressions ?? 0;
  const clicks = r.clicks ?? 0;
  const results = r.results ?? 0;
  const postEngagement = r.postEngagement ?? 0;
  const pageEngagement = r.pageEngagement ?? 0;
  return {
    ...r,
    spend,
    impressions,
    clicks,
    results,
    postEngagement,
    pageEngagement,
    reach: r.reach ?? 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpc: clicks > 0 ? spend / clicks : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    frequency: r.reach > 0 ? impressions / r.reach : null,
    costPerResult: results > 0 ? spend / results : null,
    costPerPostEngagement: postEngagement > 0 ? spend / postEngagement : null,
    costPerPageEngagement: pageEngagement > 0 ? spend / pageEngagement : null,
  };
}

export function lastAdDate(actId) {
  return q.get('SELECT MAX(date) AS d FROM ad_insights_daily WHERE act_id = ?', actId)?.d ?? null;
}

/** Links an ad to the Instagram post it promotes (creative.effective_instagram_media_id). */
export function upsertAdMediaLink({ actId, adId, mediaId, adName }) {
  q.run(
    `INSERT INTO ad_media_links (act_id, ad_id, media_id, ad_name, linked_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(act_id, ad_id) DO UPDATE SET media_id = excluded.media_id, ad_name = excluded.ad_name`,
    actId, adId, mediaId, adName ?? null, Date.now(),
  );
}

/** Paid totals per media for a set of media ids (single grouped query). */
export function paidByMedia(mediaIds) {
  if (!mediaIds?.length) return new Map();
  const rows = q.all(
    `SELECT l.media_id AS mediaId, SUM(i.spend) AS spend, SUM(i.impressions) AS impressions, SUM(i.reach) AS reach,
       SUM(i.clicks) AS clicks, SUM(i.results) AS results, SUM(i.post_engagement) AS postEngagement, SUM(i.page_engagement) AS pageEngagement, COUNT(DISTINCT l.ad_id) AS ads, MAX(a.currency) AS currency
     FROM ad_media_links l
     JOIN ad_insights_daily i ON i.level = 'ad' AND i.object_id = l.ad_id AND i.act_id = l.act_id
     JOIN ad_accounts a ON a.act_id = l.act_id
     WHERE l.media_id IN (${mediaIds.map(() => '?').join(',')}) GROUP BY l.media_id`,
    ...mediaIds,
  );
  return new Map(rows.map((r) => [r.mediaId, withDerived(r)]));
}

/** Paid detail for one media: totals, daily series and per-ad rows. */
export function paidForMedia(mediaId) {
  const ads = q.all(
    `SELECT l.ad_id AS adId, l.ad_name AS adName, l.act_id AS actId, a.name AS accountName, a.currency,
       SUM(i.spend) AS spend, SUM(i.impressions) AS impressions, SUM(i.reach) AS reach, SUM(i.clicks) AS clicks, SUM(i.results) AS results,
       SUM(i.post_engagement) AS postEngagement, SUM(i.page_engagement) AS pageEngagement,
       MAX(i.result_type) AS resultType, MIN(i.date) AS firstDate, MAX(i.date) AS lastDate
     FROM ad_media_links l JOIN ad_accounts a ON a.act_id = l.act_id
     LEFT JOIN ad_insights_daily i ON i.level = 'ad' AND i.object_id = l.ad_id AND i.act_id = l.act_id
     WHERE l.media_id = ? GROUP BY l.ad_id ORDER BY spend DESC`,
    mediaId,
  ).map(withDerived);
  if (!ads.length) return null;
  const series = q.all(
    `SELECT i.date, SUM(i.spend) AS spend, SUM(i.reach) AS reach, SUM(i.impressions) AS impressions, SUM(i.clicks) AS clicks, SUM(i.results) AS results
     FROM ad_media_links l JOIN ad_insights_daily i ON i.level = 'ad' AND i.object_id = l.ad_id AND i.act_id = l.act_id
     WHERE l.media_id = ? GROUP BY i.date ORDER BY i.date`,
    mediaId,
  ).map(withDerived);
  const totals = withDerived(ads.reduce((s, a) => ({ spend: s.spend + a.spend, impressions: s.impressions + a.impressions, reach: s.reach + a.reach, clicks: s.clicks + a.clicks, results: s.results + a.results, postEngagement: s.postEngagement + a.postEngagement, pageEngagement: s.pageEngagement + a.pageEngagement }), { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, postEngagement: 0, pageEngagement: 0 }));
  return { currency: ads[0].currency, totals, series, ads };
}

/** Spend per day for one account in a window (for budget pacing). */
export function spendByDay(actId, from, to) {
  return q.all("SELECT date, SUM(spend) AS spend FROM ad_insights_daily WHERE act_id = ? AND level = 'account' AND date BETWEEN ? AND ? GROUP BY date ORDER BY date", actId, from, to);
}

/** Account-level totals for every ad account in one grouped query (portfolio table). */
export function adTotalsByAccount(from, to) {
  return new Map(q.all(
    `SELECT act_id AS actId, SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(reach) AS reach, SUM(clicks) AS clicks, SUM(results) AS results,
       SUM(post_engagement) AS postEngagement, SUM(page_engagement) AS pageEngagement
     FROM ad_insights_daily WHERE level = 'account' AND date BETWEEN ? AND ? GROUP BY act_id`, from, to,
  ).map((r) => [r.actId, withDerived(r)]));
}

/** Objects (campaign/adset/ad) with activity in a window, plus their spend in that window and per-day map for pacing. */
export function adObjectsInWindow(actId, level, from, to) {
  return q.all(
    `SELECT object_id AS objectId, MAX(object_name) AS objectName, MAX(parent_id) AS parentId, SUM(spend) AS spend, MIN(date) AS firstDate, MAX(date) AS lastDate
     FROM ad_insights_daily WHERE act_id = ? AND level = ? AND date BETWEEN ? AND ? GROUP BY object_id ORDER BY spend DESC`,
    actId, level, from, to,
  );
}

export function adObjectSpendByDay(actId, level, from, to) {
  const rows = q.all("SELECT object_id AS objectId, date, SUM(spend) AS spend FROM ad_insights_daily WHERE act_id = ? AND level = ? AND date BETWEEN ? AND ? GROUP BY object_id, date", actId, level, from, to);
  const map = new Map();
  for (const r of rows) { if (!map.has(r.objectId)) map.set(r.objectId, new Map()); map.get(r.objectId).set(r.date, r.spend); }
  return map;
}

export function listBudgetOverrides(actId) {
  return new Map(q.all('SELECT level, object_id AS objectId, amount FROM ad_budget_overrides WHERE act_id = ?', actId).map((r) => [`${r.level}:${r.objectId}`, r.amount]));
}

export function setBudgetOverride(actId, level, objectId, amount) {
  if (amount == null || amount === '') { q.run('DELETE FROM ad_budget_overrides WHERE act_id = ? AND level = ? AND object_id = ?', actId, level, objectId); return; }
  q.run(
    `INSERT INTO ad_budget_overrides (act_id, level, object_id, amount, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(act_id, level, object_id) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at`,
    actId, level, objectId, Number(amount), Date.now(),
  );
}
