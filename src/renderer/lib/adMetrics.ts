import { fmtNum, fmtPct, fmtMoney } from './format';
import { t as tr, type Key } from './i18n';
import type { XlsxColumn } from '@/components/ExcelButton';

/** The agency's standard ad metric set, shown in every listing where a post, page or profile appears. */
export interface PaidFields {
  paidCurrency?: string | null; monthlyBudget?: number | null; spend?: number | null; paidImpressions?: number | null; paidReach?: number | null; paidClicks?: number | null;
  paidResults?: number | null; paidResultType?: string | null; costPerResult?: number | null; paidFrequency?: number | null; paidCpc?: number | null; paidCtr?: number | null; paidCpm?: number | null;
  paidPostEngagement?: number | null; costPerPostEngagement?: number | null; paidPageEngagement?: number | null; costPerPageEngagement?: number | null;
}

export interface AdMetricDef { key: keyof PaidFields; label: Key; type: 'int' | 'money' | 'percent' | 'float'; accountsOnly?: boolean; sub?: keyof PaidFields }

export const AD_METRICS: AdMetricDef[] = [
  { key: 'paidImpressions', label: 'impressions', type: 'int' },
  { key: 'paidResults', label: 'results', type: 'int', sub: 'paidResultType' },
  { key: 'costPerResult', label: 'cost_per_result', type: 'money' },
  { key: 'monthlyBudget', label: 'budget', type: 'money', accountsOnly: true },
  { key: 'spend', label: 'spend', type: 'money' },
  { key: 'paidReach', label: 'reach', type: 'int' },
  { key: 'paidFrequency', label: 'frequency', type: 'float' },
  { key: 'paidCpc', label: 'cpc', type: 'money' },
  { key: 'paidCtr', label: 'ctr', type: 'percent' },
  { key: 'paidCpm', label: 'cpm', type: 'money' },
  { key: 'paidPostEngagement', label: 'post_engagement', type: 'int' },
  { key: 'costPerPostEngagement', label: 'cost_per_post_engagement', type: 'money' },
  { key: 'paidPageEngagement', label: 'page_engagement', type: 'int' },
  { key: 'costPerPageEngagement', label: 'cost_per_page_engagement', type: 'money' },
];

export function adMetricList(scope: 'post' | 'account') {
  return AD_METRICS.filter((m) => scope === 'account' || !m.accountsOnly);
}

export function fmtAdMetric(def: AdMetricDef, row: PaidFields): string {
  const v = row[def.key] as number | null | undefined;
  if (v == null) return '—';
  const cur = row.paidCurrency ?? 'USD';
  if (def.type === 'money') return fmtMoney(v, cur, def.key === 'spend' || def.key === 'monthlyBudget' ? 0 : 2);
  if (def.type === 'percent') return fmtPct(v, 2);
  if (def.type === 'float') return fmtNum(v, 2);
  return fmtNum(v);
}

/** Prefixed labels so "Reach" (organic) and "Ad · Reach" stay distinguishable. */
export function adMetricLabel(def: AdMetricDef): string {
  const base = tr(def.label);
  return ['paidImpressions', 'paidReach', 'spend', 'paidResults', 'monthlyBudget'].includes(def.key) ? `${tr('paid')} · ${base}` : base;
}

export function adMetricXlsxColumns(scope: 'post' | 'account'): XlsxColumn[] {
  return [{ key: 'paidCurrency', label: tr('currency'), type: 'text' }, ...adMetricList(scope).map((m) => ({ key: m.key, label: adMetricLabel(m), type: m.type }))];
}
