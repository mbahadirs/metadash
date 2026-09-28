import { subDays } from 'date-fns';
import * as ads from '../../meta/ads.js';
import { graphDelay } from '../../meta/client.js';
import { upsertAdInsight, upsertAdBreakdown, lastAdDate, upsertAdMediaLink } from '../../db/queries/ads.js';
import { MetaError } from '../../meta/errors.js';
import { fmtDate, toDate } from '../../analytics/util.js';

const LEVELS = ['account', 'campaign', 'adset', 'ad'];
const BREAKDOWNS = ['age', 'gender', 'publisher_platform'];

export async function syncAdsAccount(ctx, adAccount) {
  const { token, report, signal, settings } = ctx;
  report('ads');
  const last = lastAdDate(adAccount.actId);
  const since = last ? fmtDate(subDays(toDate(last), 3)) : fmtDate(subDays(new Date(), settings.adsLookbackDays ?? 90));
  const until = fmtDate(new Date());
  for (const level of LEVELS) {
    if (signal?.aborted) return;
    const rows = await ads.fetchAdInsights(adAccount.actId, token, { since, until, level });
    for (const r of rows) upsertAdInsight(r);
    await graphDelay();
  }
  for (const breakdown of BREAKDOWNS) {
    if (signal?.aborted) return;
    const rows = await ads.fetchAdInsights(adAccount.actId, token, { since, until, level: 'account', breakdowns: breakdown });
    for (const r of rows) upsertAdBreakdown({ actId: adAccount.actId, date: r.date, breakdown, bucket: r.breakdownBucket ?? 'unknown', spend: r.spend, impressions: r.impressions, reach: r.reach, clicks: r.clicks, results: r.results });
    await graphDelay();
  }
  try {
    const links = await ads.fetchAdMediaLinks(adAccount.actId, token);
    for (const l of links) upsertAdMediaLink(l);
  } catch (e) {
    if (e instanceof MetaError && (e.isPermissionError || e.isInvalidParam)) ctx.log?.({ igId: null, endpoint: `/${adAccount.actId}/ads`, code: e.code, message: e.message });
    else throw e;
  }
}
