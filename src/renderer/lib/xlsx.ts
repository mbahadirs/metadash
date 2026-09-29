import type { Media, RecentPost, PortfolioRow } from './types';
import type { XlsxColumn, XlsxSheet } from '@/components/ExcelButton';
import { t as tr, type Key } from './i18n';
import { adMetricXlsxColumns } from './adMetrics';

import { PLATFORM_LABELS, platformOf, typeKeyOf } from './platforms';

/** Platform column (brand name) — only added when rows span several platforms. */
function platformColumn(rows: { platform?: Media['platform']; igId?: string }[]): XlsxColumn[] {
  return new Set(rows.map((r) => platformOf(r))).size > 1 ? [{ key: 'platformLabel', label: tr('platform_filter'), type: 'text' }] : [];
}

/** Column preset for post lists (Content, Account posts, Recent posts). */
export function mediaSheet(name: string, rows: (Media | RecentPost)[], { account = true, deltas = false }: { account?: boolean; deltas?: boolean } = {}): XlsxSheet {
  const L = (k: Key) => tr(k);
  const columns: XlsxColumn[] = [
    ...(account ? [{ key: 'username', label: L('account'), type: 'text' as const }] : []), ...platformColumn(rows),
    { key: 'postedAt', label: L('date'), type: 'datetime' }, { key: 'type', label: L('type'), type: 'text' }, { key: 'caption', label: L('caption'), type: 'text' }, { key: 'permalink', label: 'URL', type: 'text' },
    { key: 'reach', label: L('reach'), type: 'int' }, ...(deltas ? [{ key: 'vsReach', label: `${L('reach')} Δ%`, type: 'percent' as const }] : []),
    { key: 'views', label: L('views'), type: 'int' }, { key: 'likes', label: L('likes'), type: 'int' }, { key: 'comments', label: L('comments'), type: 'int' },
    { key: 'saved', label: L('saved'), type: 'int' }, ...(deltas ? [{ key: 'vsSaved', label: `${L('saved')} Δ%`, type: 'percent' as const }] : []),
    { key: 'shares', label: L('shares'), type: 'int' }, ...optionalCounts(rows), { key: 'engagementRate', label: 'ER %', type: 'percent' }, ...(deltas ? [{ key: 'vsEr', label: 'ER Δ%', type: 'percent' as const }] : []),
    { key: 'saveRate', label: `${L('save_rate')} %`, type: 'percent' }, { key: 'hashtagCount', label: 'Hashtag', type: 'int' },
    { key: 'totalImpressions', label: L('total_impressions'), type: 'int' }, { key: 'paidImpressionShare', label: `${L('paid_share_short')} % (${L('impressions').toLowerCase()})`, type: 'percent' }, { key: 'totalReach', label: L('total_reach'), type: 'int' }, { key: 'paidReachShare', label: `${L('paid_share_short')} % (${L('reach').toLowerCase()})`, type: 'percent' }, { key: 'paidClicks', label: L('clicks'), type: 'int' }, ...adMetricXlsxColumns('post'),
  ];
  return { name, columns, rows: rows.map((m) => ({ ...m, type: tr(`type_${typeKeyOf(m)}` as Key), platformLabel: PLATFORM_LABELS[platformOf(m)] })) };
}

export function portfolioSheet(name: string, rows: PortfolioRow[]): XlsxSheet {
  const L = (k: Key) => tr(k);
  return {
    name,
    columns: [
      { key: 'username', label: L('account'), type: 'text' }, ...platformColumn(rows), { key: 'clientName', label: L('client'), type: 'text' }, { key: 'followers', label: L('followers'), type: 'int' }, { key: 'followersChange', label: L('net_change'), type: 'int' }, { key: 'followersChangePct', label: `${L('net_change')} %`, type: 'percent' },
      { key: 'reach', label: L('reach'), type: 'int' }, { key: 'reachChangePct', label: `${L('reach')} Δ%`, type: 'percent' }, ...(rows.some((r) => (r as { views?: number | null }).views != null) ? [{ key: 'views', label: L('views'), type: 'int' as const }] : []), { key: 'er', label: 'ER %', type: 'percent' }, { key: 'erChangePct', label: 'ER Δ%', type: 'percent' }, { key: 'saveRate', label: `${L('save_rate')} %`, type: 'percent' },
      { key: 'posts', label: L('posts'), type: 'int' }, { key: 'health', label: L('health_score'), type: 'int' }, { key: 'daysSincePost', label: L('last_post_days'), type: 'int' },
      { key: 'totalReach', label: L('total_reach'), type: 'int' }, { key: 'paidShare', label: `${L('paid_share_short')} %`, type: 'percent' }, ...adMetricXlsxColumns('account'),
    ],
    rows: rows.map((r) => ({ ...r, platformLabel: PLATFORM_LABELS[platformOf(r)] })),
  };
}

/** Threads/Facebook-only counters, added when any row has them. */
function optionalCounts(rows: Media[]): XlsxColumn[] {
  const cols: [keyof Media, Key][] = [['reposts', 'reposts'], ['quotes', 'quotes'], ['clicks', 'clicks']];
  return cols.filter(([k]) => rows.some((r) => r[k] != null)).map(([k, label]) => ({ key: k, label: tr(label), type: 'int' as const }));
}
