import { insightSeries } from '../db/queries/accounts.js';
import { adAccountForIg, adDailySeries, adTotals, adObjects } from '../db/queries/ads.js';
import { eachDay, previousPeriod, pctChange, round } from './util.js';

/** Organic reach + paid reach on one date axis; spend for a second Y axis. */
export function blended({ igId, from, to }) {
  const adAccount = adAccountForIg(igId);
  const days = eachDay(from, to);
  const organic = new Map(insightSeries(igId, from, to, ['reach']).map((d) => [d.date, d.reach ?? 0]));
  const paid = new Map(adAccount ? adDailySeries([adAccount.actId], from, to).map((d) => [d.date, d]) : []);
  const series = days.map((date) => ({ date, organicReach: organic.get(date) ?? 0, paidReach: paid.get(date)?.reach ?? 0, spend: round(paid.get(date)?.spend ?? 0, 2), impressions: paid.get(date)?.impressions ?? 0 }));
  const prev = previousPeriod(from, to);
  const totals = adAccount ? adTotals([adAccount.actId], from, to) : { spend: 0, reach: 0, impressions: 0, clicks: 0, results: 0, cpm: null, costPerResult: null };
  const prevTotals = adAccount ? adTotals([adAccount.actId], prev.from, prev.to) : { spend: 0, reach: 0 };
  const organicReach = series.reduce((s, d) => s + d.organicReach, 0);
  return {
    adAccount,
    series,
    totals: {
      organicReach, paidReach: totals.reach, spend: round(totals.spend, 2), impressions: totals.impressions, clicks: totals.clicks, results: totals.results,
      cpm: round(totals.cpm, 2), costPerResult: round(totals.costPerResult, 2),
      spendChangePct: pctChange(totals.spend, prevTotals.spend), paidReachChangePct: pctChange(totals.reach, prevTotals.reach),
      paidShare: organicReach + totals.reach > 0 ? round((totals.reach / (organicReach + totals.reach)) * 100, 1) : null,
    },
    campaigns: adAccount ? adObjects([adAccount.actId], from, to, 'campaign') : [],
  };
}
