import { portfolio } from './portfolio.js';
import { listMedia } from '../db/queries/media.js';
import { rangeMs, fmtDate, toDate, round } from './util.js';
import { subDays, addDays } from 'date-fns';

const fmtPct = (v, lang) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${round(v, 0)}%`);
const fmtNum = (v, lang) => new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'tr-TR').format(Math.round(v ?? 0));

/** Template-based weekly summary. weekOf = any date inside the week; week = 7 days ending on that date. */
export function weeklyDigest({ weekOf, lang = 'en', tagIds } = {}) {
  const to = weekOf ? fmtDate(toDate(weekOf)) : fmtDate(subDays(new Date(), 1));
  const from = fmtDate(subDays(toDate(to), 6));
  const p = portfolio({ from, to, tagIds });
  const rows = p.rows.filter((r) => r.reach > 0 || r.followers);
  const up = rows.filter((r) => (r.reachChangePct ?? 0) > 0);
  const sortedByReach = [...rows].filter((r) => r.reachChangePct != null).sort((a, b) => b.reachChangePct - a.reachChangePct);
  const best = sortedByReach[0];
  const worst = sortedByReach[sortedByReach.length - 1];
  const { fromMs, toMs } = rangeMs(from, to);
  const topPosts = listMedia({ from: fromMs, to: toMs, sort: 'reach', limit: 3 });
  const growth = [...rows].sort((a, b) => (b.followersChange ?? 0) - (a.followersChange ?? 0));
  const sentences = [];
  const tr = lang === 'tr';
  const avgReachChange = p.kpis.totalReach.changePct;

  sentences.push(tr
    ? `Bu hafta ${up.length} hesapta erişim arttı; portföy erişimi ${fmtPct(avgReachChange)} (${fmtNum(p.kpis.totalReach.value)} kişi).`
    : `Reach grew on ${up.length} accounts this week; portfolio reach ${fmtPct(avgReachChange)} (${fmtNum(p.kpis.totalReach.value, 'en')} people).`);
  if (best && worst && best !== worst) {
    sentences.push(tr
      ? `En çok yükselen @${best.username} (${fmtPct(best.reachChangePct)}), en çok düşen @${worst.username} (${fmtPct(worst.reachChangePct)}).`
      : `Biggest riser @${best.username} (${fmtPct(best.reachChangePct)}), biggest drop @${worst.username} (${fmtPct(worst.reachChangePct)}).`);
  }
  sentences.push(tr
    ? `Net takipçi değişimi ${p.kpis.netFollowers.value >= 0 ? '+' : ''}${fmtNum(p.kpis.netFollowers.value)}; en çok kazanan @${growth[0]?.username ?? '—'} (+${fmtNum(growth[0]?.followersChange)}).`
    : `Net follower change ${p.kpis.netFollowers.value >= 0 ? '+' : ''}${fmtNum(p.kpis.netFollowers.value, 'en')}; top gainer @${growth[0]?.username ?? '—'} (+${fmtNum(growth[0]?.followersChange, 'en')}).`);
  if (topPosts[0]) {
    const t = topPosts[0];
    sentences.push(tr
      ? `En iyi gönderi: @${t.username} — "${(t.caption ?? '').slice(0, 60)}${(t.caption ?? '').length > 60 ? '…' : ''}" (${fmtNum(t.reach)} erişim, ER %${round(t.engagementRate, 2)}).`
      : `Top post: @${t.username} — "${(t.caption ?? '').slice(0, 60)}${(t.caption ?? '').length > 60 ? '…' : ''}" (${fmtNum(t.reach, 'en')} reach, ER ${round(t.engagementRate, 2)}%).`);
  }
  if (p.attention.silent.length) {
    sentences.push(tr
      ? `${p.attention.silent.length} hesap 7+ gündür paylaşım yapmadı: ${p.attention.silent.slice(0, 5).map((s) => '@' + s.username).join(', ')}.`
      : `${p.attention.silent.length} accounts have not posted for 7+ days: ${p.attention.silent.slice(0, 5).map((s) => '@' + s.username).join(', ')}.`);
  }
  if (p.kpis.totalSpend.value) {
    sentences.push(tr
      ? `Reklam harcaması ${fmtNum(p.kpis.totalSpend.value)} ${p.kpis.totalSpend.currency} (${fmtPct(p.kpis.totalSpend.changePct)}).`
      : `Ad spend ${fmtNum(p.kpis.totalSpend.value, 'en')} ${p.kpis.totalSpend.currency} (${fmtPct(p.kpis.totalSpend.changePct)}).`);
  }
  return { from, to, text: sentences.join(' '), sentences, kpis: p.kpis, best, worst, topPosts, silent: p.attention.silent, nextWeekStart: fmtDate(addDays(toDate(to), 1)) };
}
