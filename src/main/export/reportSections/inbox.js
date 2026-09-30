import { msg } from '../../i18n.js';
import { inboxSla } from '../../inbox/sla.js';

/**
 * "Community response" report section (v2.0 chunk D): first-response KPIs for the account and period (inbox/sla.js).
 * Appended after the health section of client reports for platforms with capabilities.inbox; an account without
 * incoming comments in the period gets a one-line note. Labels come from the main `inbox` namespace (msg, report lang).
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

/** Minutes → "45 min" / "3.5 h" / "2.1 d" (localized units). */
export function fmtDuration(min, lang) {
  if (min == null) return '—';
  if (min < 60) return msg('inbox_rep_min', { n: Math.round(min) }, lang);
  if (min < 48 * 60) return msg('inbox_rep_hours', { n: Math.round((min / 60) * 10) / 10 }, lang);
  return msg('inbox_rep_days', { n: Math.round((min / 1440) * 10) / 10 }, lang);
}

function slaFor({ igId, from, to }) {
  return inboxSla({ from, to, accountIds: [igId] });
}

function tiles(s, lang) {
  const t = s.totals;
  const tile = (label, value) => `<div class="kpi"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div><div class="d"></div></div>`;
  return `<div class="kpis">${[
    tile(msg('inbox_rep_incoming', null, lang), num(t.incoming)),
    tile(msg('inbox_rep_answered', null, lang), num(t.answeredPct, '%')),
    tile(msg('inbox_rep_within', { hours: s.slaHours }, lang), num(t.withinSlaPct, '%')),
    tile(msg('inbox_rep_median', null, lang), fmtDuration(t.medianFrtMin, lang)),
    tile(msg('inbox_rep_p90', null, lang), fmtDuration(t.p90FrtMin, lang)),
    tile(msg('inbox_rep_backlog', null, lang), num(t.backlog)),
  ].join('')}</div>`;
}

export const communityResponse = {
  key: 'community_response',
  templates: ['monthly', 'weekly_client', 'custom'],
  capability: 'inbox',
  html(ctx) {
    const s = slaFor(ctx);
    const title = `<h2>${esc(msg('inbox_rep_title', null, ctx.lang))}</h2>`;
    if (!s.totals.incoming) return `${title}<div class="note">${esc(msg('inbox_rep_empty', null, ctx.lang))}</div>`;
    return `${title}${tiles(s, ctx.lang)}<div class="note" style="margin-top:8px">${esc(msg('inbox_rep_note', { hours: s.slaHours }, ctx.lang))}</div>`;
  },
  sheets(ctx) {
    const s = slaFor(ctx);
    if (!s.totals.incoming) return [];
    const lbl = (k, v) => msg(k, v, ctx.lang);
    const name = `${ctx.analysis?.account?.username ?? ctx.igId} · ${lbl('inbox_rep_sheet')}`.slice(0, 31);
    return [{
      name,
      columns: [
        { key: 'incoming', label: lbl('inbox_rep_incoming'), type: 'int' },
        { key: 'answered', label: lbl('inbox_rep_answered_n'), type: 'int' },
        { key: 'answeredPct', label: `${lbl('inbox_rep_answered')} %`, type: 'float' },
        { key: 'withinSlaPct', label: `${lbl('inbox_rep_within', { hours: s.slaHours })} %`, type: 'float' },
        { key: 'medianFrtMin', label: lbl('inbox_rep_median_min'), type: 'float' },
        { key: 'p90FrtMin', label: lbl('inbox_rep_p90_min'), type: 'float' },
        { key: 'backlog', label: lbl('inbox_rep_backlog'), type: 'int' },
      ],
      rows: [s.totals],
    }];
  },
};

export const sections = [communityResponse];
