import { startOfMonth, endOfMonth, subDays, differenceInCalendarDays, getDaysInMonth } from 'date-fns';
import { listAdAccounts, adTotals, spendByDay, adObjectsInWindow, adObjectSpendByDay, listBudgetOverrides } from '../db/queries/ads.js';
import { listMedia } from '../db/queries/media.js';
import { fmtDate, toDate, round, rangeMs } from './util.js';
import { msg } from '../i18n.js';

/**
 * Monthly-budget pacing per ad account (data only, nothing is changed on Meta).
 * Month = calendar month containing `asOf` (default today). Pace compares spend-to-date with the linear expectation.
 */
export function budgetPacing({ asOf } = {}) {
  const today = asOf ? toDate(asOf) : new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const daysInMonth = getDaysInMonth(today);
  const elapsed = differenceInCalendarDays(today, monthStart) + 1;
  const remainingDays = Math.max(0, daysInMonth - elapsed);
  const from = fmtDate(monthStart);
  const to = fmtDate(today);
  return listAdAccounts().filter((a) => a.isTracked).map((a) => {
    const mtd = adTotals([a.actId], from, to).spend;
    const days = new Map(spendByDay(a.actId, fmtDate(subDays(today, 13)), to).map((d) => [d.date, d.spend]));
    const spentToday = days.get(to) ?? 0;
    const spentYesterday = days.get(fmtDate(subDays(today, 1))) ?? 0;
    const last7 = [...Array(7)].reduce((s, _, i) => s + (days.get(fmtDate(subDays(today, i))) ?? 0), 0);
    const prev7 = [...Array(7)].reduce((s, _, i) => s + (days.get(fmtDate(subDays(today, i + 7))) ?? 0), 0);
    const budget = a.monthlyBudget ?? null;
    const dailyTarget = budget ? budget / daysInMonth : null;
    const expectedMtd = dailyTarget ? dailyTarget * elapsed : null;
    const remaining = budget != null ? budget - mtd : null;
    const dailyNeeded = remaining != null && remainingDays > 0 ? Math.max(0, remaining) / remainingDays : null;
    const pacePct = expectedMtd ? (mtd / expectedMtd) * 100 : null;
    const projected = elapsed > 0 ? (mtd / elapsed) * daysInMonth : null;
    let status = 'no_budget';
    if (budget) status = pacePct == null ? 'no_budget' : pacePct < 85 ? 'under' : pacePct > 115 ? 'over' : 'on';
    return {
      actId: a.actId, name: a.name, currency: a.currency, linkedIgId: a.linkedIgId, linkedUsername: a.linkedUsername, status: a.status,
      month: { from, to: fmtDate(monthEnd), daysInMonth, elapsed, remainingDays },
      budget, note: a.budgetNote ?? null, spentMtd: round(mtd, 2), expectedMtd: round(expectedMtd, 2), pacePct: round(pacePct, 1), remaining: round(remaining, 2),
      dailyTarget: round(dailyTarget, 2), dailyNeeded: round(dailyNeeded, 2), projected: round(projected, 2), projectedPct: budget ? round((projected / budget) * 100, 1) : null,
      weeklyTarget: round(dailyTarget != null ? dailyTarget * 7 : null, 2), spentToday: round(spentToday, 2), spentYesterday: round(spentYesterday, 2), last7: round(last7, 2), prev7: round(prev7, 2),
      todayVsTarget: dailyTarget ? round((spentToday / dailyTarget) * 100, 0) : null, weekVsTarget: dailyTarget ? round((last7 / (dailyTarget * 7)) * 100, 0) : null,
      paceStatus: status,
    };
  });
}

/** Recent organic posts of the linked account that have no ad spend yet — candidates to boost when pacing is under target. */
export function boostCandidates({ actId, limit = 8, days = 21 }) {
  const acc = listAdAccounts().find((a) => a.actId === actId);
  if (!acc?.linkedIgId) return { account: acc ?? null, candidates: [] };
  const to = fmtDate(new Date());
  const from = fmtDate(subDays(new Date(), days - 1));
  const { fromMs, toMs } = rangeMs(from, to);
  const posts = listMedia({ igIds: [acc.linkedIgId], from: fromMs, to: toMs, sort: 'reach' }).filter((m) => !(m.spend > 0));
  const reels = posts.filter((m) => m.mediaProductType === 'REELS');
  const picked = [...reels, ...posts.filter((m) => m.mediaProductType !== 'REELS')].slice(0, limit);
  return { account: acc, candidates: picked, window: { from, to } };
}

/**
 * Splits a parent budget among children: manual overrides are fixed, the remainder is shared evenly by the rest.
 * Returns [{ id, amount, mode: 'manual'|'auto' }], plus `overAllocated` when manual amounts exceed the parent.
 */
export function distributeBudget(parentBudget, children, overrides) {
  const manual = children.filter((c) => overrides.has(c.id));
  const auto = children.filter((c) => !overrides.has(c.id));
  const manualSum = manual.reduce((s, c) => s + Number(overrides.get(c.id) ?? 0), 0);
  const pool = parentBudget == null ? null : Math.max(0, parentBudget - manualSum);
  const each = pool == null ? null : auto.length ? pool / auto.length : 0;
  const rows = children.map((c) => (overrides.has(c.id) ? { id: c.id, amount: Number(overrides.get(c.id)), mode: 'manual' } : { id: c.id, amount: each, mode: 'auto' }));
  return { rows, overAllocated: parentBudget != null && manualSum > parentBudget + 0.005, manualSum, pool };
}

function pacingFor(budget, days, today) {
  const daysInMonth = getDaysInMonth(today);
  const elapsed = differenceInCalendarDays(today, startOfMonth(today)) + 1;
  const remainingDays = Math.max(0, daysInMonth - elapsed);
  const to = fmtDate(today);
  const mtd = [...days.entries()].filter(([d]) => d >= fmtDate(startOfMonth(today)) && d <= to).reduce((s, [, v]) => s + v, 0);
  const spentToday = days.get(to) ?? 0;
  const spentYesterday = days.get(fmtDate(subDays(today, 1))) ?? 0;
  const last7 = [...Array(7)].reduce((s, _, i) => s + (days.get(fmtDate(subDays(today, i))) ?? 0), 0);
  const dailyTarget = budget ? budget / daysInMonth : null;
  const expectedMtd = dailyTarget ? dailyTarget * elapsed : null;
  const remaining = budget != null ? budget - mtd : null;
  const dailyNeeded = remaining != null && remainingDays > 0 ? Math.max(0, remaining) / remainingDays : null;
  const pacePct = expectedMtd ? (mtd / expectedMtd) * 100 : null;
  const projected = elapsed > 0 ? (mtd / elapsed) * daysInMonth : null;
  const paceStatus = !budget ? 'no_budget' : pacePct < 85 ? 'under' : pacePct > 115 ? 'over' : 'on';
  return { spentMtd: round(mtd, 2), expectedMtd: round(expectedMtd, 2), pacePct: round(pacePct, 1), remaining: round(remaining, 2), dailyTarget: round(dailyTarget, 2), dailyNeeded: round(dailyNeeded, 2), projected: round(projected, 2), projectedPct: budget ? round((projected / budget) * 100, 1) : null, weeklyTarget: round(dailyTarget != null ? dailyTarget * 7 : null, 2), spentToday: round(spentToday, 2), spentYesterday: round(spentYesterday, 2), last7: round(last7, 2), todayVsTarget: dailyTarget ? round((spentToday / dailyTarget) * 100, 0) : null, weekVsTarget: dailyTarget ? round((last7 / (dailyTarget * 7)) * 100, 0) : null, paceStatus };
}

/**
 * Account → campaigns → ad sets → ads budget tree for the current month. Children are the objects with activity this month;
 * each level's budget is distributed from its parent (auto) unless overridden (manual).
 */
export function budgetTree({ actId, asOf } = {}) {
  const today = asOf ? toDate(asOf) : new Date();
  const from = fmtDate(startOfMonth(today));
  const to = fmtDate(today);
  const acc = listAdAccounts().find((a) => a.actId === actId);
  if (!acc) throw new Error(msg('ad_account_not_found'));
  const overrides = listBudgetOverrides(actId);
  const levels = ['campaign', 'adset', 'ad'];
  const objs = Object.fromEntries(levels.map((l) => [l, adObjectsInWindow(actId, l, from, to)]));
  const spend = Object.fromEntries(levels.map((l) => [l, adObjectSpendByDay(actId, l, fmtDate(subDays(today, 13)), to)]));
  const accountDays = new Map(spendByDay(actId, fmtDate(subDays(today, 13)), to).map((d) => [d.date, d.spend]));
  const warnings = [];

  const build = (level, parentId, parentBudget, depth) => {
    const children = objs[level].filter((o) => (level === 'campaign' ? true : o.parentId === parentId));
    const dist = distributeBudget(parentBudget, children.map((c) => ({ id: `${level}:${c.objectId}` })), overrides);
    if (dist.overAllocated) warnings.push({ level, parentId, manualSum: round(dist.manualSum, 2), parentBudget });
    return children.map((c, i) => {
      const alloc = dist.rows[i];
      const pacing = pacingFor(alloc.amount, spend[level].get(c.objectId) ?? new Map(), today);
      const next = level === 'campaign' ? 'adset' : level === 'adset' ? 'ad' : null;
      const kids = next ? build(next, c.objectId, alloc.amount, depth + 1) : [];
      const manualChildSum = kids.filter((k) => k.mode === 'manual').reduce((s, k) => s + (k.budget ?? 0), 0);
      return { level, objectId: c.objectId, name: c.objectName ?? c.objectId, parentId: c.parentId, depth, budget: alloc.amount != null ? round(alloc.amount, 2) : null, mode: alloc.mode, ...pacing, children: kids, childManualSum: round(manualChildSum, 2), firstDate: c.firstDate, lastDate: c.lastDate };
    });
  };
  const campaigns = build('campaign', actId, acc.monthlyBudget ?? null, 1);
  const accountPacing = pacingFor(acc.monthlyBudget ?? null, accountDays, today);
  const totalManualCampaigns = campaigns.filter((c) => c.mode === 'manual').reduce((s, c) => s + (c.budget ?? 0), 0);
  return {
    account: { actId, name: acc.name, currency: acc.currency, linkedUsername: acc.linkedUsername, budget: acc.monthlyBudget ?? null, ...accountPacing, manualChildSum: round(totalManualCampaigns, 2) },
    month: { from, to, daysInMonth: getDaysInMonth(today), elapsed: differenceInCalendarDays(today, startOfMonth(today)) + 1 },
    campaigns,
    warnings,
  };
}
