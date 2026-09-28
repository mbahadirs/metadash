import { listAdAccounts, adDailySeries, adTotals, adObjects, adBreakdown, linkAdAccount, setAdAccountTracked, setAdBudget } from '../db/queries/ads.js';
import { budgetPacing, boostCandidates, budgetTree } from '../analytics/budget.js';
import { setBudgetOverride } from '../db/queries/ads.js';
import { blended } from '../analytics/blended.js';
import { previousPeriod, pctChange, round } from '../analytics/util.js';

export function registerAdsHandlers(handle) {
  handle('ads:accounts', () => listAdAccounts());
  handle('ads:link', ({ actId, igId }) => { linkAdAccount(actId, igId); return listAdAccounts(); });
  handle('ads:setTracked', ({ actId, tracked }) => { setAdAccountTracked(actId, tracked); return listAdAccounts(); });
  handle('ads:insights', ({ actIds, from, to, level = 'campaign', breakdown, breakdowns }) => {
    const ids = actIds?.length ? actIds : listAdAccounts().filter((a) => a.isTracked).map((a) => a.actId);
    const prev = previousPeriod(from, to);
    const totals = adTotals(ids, from, to);
    const prevTotals = adTotals(ids, prev.from, prev.to);
    const withChange = (k) => ({ value: round(totals[k], 2), prev: round(prevTotals[k], 2), changePct: pctChange(totals[k], prevTotals[k]) });
    const perAccount = listAdAccounts().filter((a) => ids.includes(a.actId)).map((a) => { const cur = adTotals([a.actId], from, to); const prv = adTotals([a.actId], prev.from, prev.to); return { ...a, ...cur, spendChangePct: pctChange(cur.spend, prv.spend), resultsChangePct: pctChange(cur.results, prv.results), reachChangePct: pctChange(cur.reach, prv.reach) }; });
    const accounts = listAdAccounts().filter((a) => ids.includes(a.actId));
    return {
      currency: accounts[0]?.currency ?? 'USD',
      mixedCurrency: new Set(accounts.map((a) => a.currency)).size > 1,
      kpis: { spend: withChange('spend'), reach: withChange('reach'), impressions: withChange('impressions'), clicks: withChange('clicks'), ctr: withChange('ctr'), cpc: withChange('cpc'), cpm: withChange('cpm'), results: withChange('results'), costPerResult: withChange('costPerResult'), frequency: withChange('frequency'), postEngagement: withChange('postEngagement'), costPerPostEngagement: withChange('costPerPostEngagement'), pageEngagement: withChange('pageEngagement'), costPerPageEngagement: withChange('costPerPageEngagement') },
      accounts: perAccount,
      series: adDailySeries(ids, from, to),
      objects: level === 'account' ? [] : adObjects(ids, from, to, level),
      breakdown: breakdown ? adBreakdown(ids, from, to, breakdown) : null,
      breakdowns: breakdowns?.length ? Object.fromEntries(breakdowns.map((b) => [b, adBreakdown(ids, from, to, b)])) : null,
    };
  });
  handle('ads:blended', (p) => blended(p));
  handle('ads:setBudget', ({ actId, monthlyBudget, note }) => { setAdBudget(actId, monthlyBudget, note); return listAdAccounts(); });
  handle('ads:budget', (p = {}) => budgetPacing(p));
  handle('ads:boostCandidates', (p) => boostCandidates(p));
  handle('ads:budgetTree', (p) => budgetTree(p));
  handle('ads:setObjectBudget', ({ actId, level, objectId, amount }) => { setBudgetOverride(actId, level, objectId, amount); return budgetTree({ actId }); });
}
