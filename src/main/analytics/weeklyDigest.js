import { portfolio } from './portfolio.js';
import { listMedia } from '../db/queries/media.js';
import { rangeMs, fmtDate, toDate, round } from './util.js';
import { subDays, addDays } from 'date-fns';
import { makeL } from '../export/reportI18n.js';
import { intlLocale } from '../locales/catalog.js';

const fmtPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${round(v, 0)}%`);

/** Template-based weekly summary. weekOf = any date inside the week; week = 7 days ending on that date. */
export function weeklyDigest({ weekOf, lang = 'en', tagIds, platforms } = {}) {
  const to = weekOf ? fmtDate(toDate(weekOf)) : fmtDate(subDays(new Date(), 1));
  const from = fmtDate(subDays(toDate(to), 6));
  const p = portfolio({ from, to, tagIds, platforms });
  const rows = p.rows.filter((r) => r.reach > 0 || r.followers);
  const up = rows.filter((r) => (r.reachChangePct ?? 0) > 0);
  const sortedByReach = [...rows].filter((r) => r.reachChangePct != null).sort((a, b) => b.reachChangePct - a.reachChangePct);
  const best = sortedByReach[0];
  const worst = sortedByReach[sortedByReach.length - 1];
  const { fromMs, toMs } = rangeMs(from, to);
  const topPosts = p.rows.length ? listMedia({ from: fromMs, to: toMs, igIds: p.rows.map((r) => r.igId), sort: 'reach', limit: 3 }) : [];
  const growth = [...rows].sort((a, b) => (b.followersChange ?? 0) - (a.followersChange ?? 0));
  const sentences = [];
  const L = makeL(lang);
  const nf = new Intl.NumberFormat(intlLocale(lang));
  const fmtNum = (v) => nf.format(Math.round(v ?? 0));
  const avgReachChange = p.kpis.totalReach.changePct;

  sentences.push(L('wd_reach', { up: up.length, pct: fmtPct(avgReachChange), reach: fmtNum(p.kpis.totalReach.value) }));
  if (best && worst && best !== worst) {
    sentences.push(L('wd_movers', { best: best.username, bestPct: fmtPct(best.reachChangePct), worst: worst.username, worstPct: fmtPct(worst.reachChangePct) }));
  }
  const net = p.kpis.netFollowers.value;
  sentences.push(L('wd_followers', { net: `${net >= 0 ? '+' : ''}${fmtNum(net)}`, top: growth[0]?.username ?? '—', gain: fmtNum(growth[0]?.followersChange) }));
  if (topPosts[0]) {
    const t = topPosts[0];
    const caption = `${(t.caption ?? '').slice(0, 60)}${(t.caption ?? '').length > 60 ? '…' : ''}`;
    sentences.push(L('wd_top_post', { user: t.username, caption, reach: fmtNum(t.reach), er: round(t.engagementRate, 2) }));
  }
  if (p.attention.silent.length) {
    sentences.push(L('wd_silent', { n: p.attention.silent.length, list: p.attention.silent.slice(0, 5).map((s) => '@' + s.username).join(', ') }));
  }
  if (p.kpis.totalSpend.value) {
    sentences.push(L('wd_spend', { spend: fmtNum(p.kpis.totalSpend.value), currency: p.kpis.totalSpend.currency, pct: fmtPct(p.kpis.totalSpend.changePct) }));
  }
  return { from, to, text: sentences.join(' '), sentences, kpis: p.kpis, best, worst, topPosts, silent: p.attention.silent, nextWeekStart: fmtDate(addDays(toDate(to), 1)) };
}
