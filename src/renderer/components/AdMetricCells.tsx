import { adMetricList, fmtAdMetric, adMetricLabel, type PaidFields } from '@/lib/adMetrics';

/** Table header cells for the ad metric set. */
export function AdMetricHeaders({ scope }: { scope: 'post' | 'account' }) {
  return <>{adMetricList(scope).map((m) => <th key={m.key} className="num" title={adMetricLabel(m)}>{adMetricLabel(m)}</th>)}</>;
}

/** Table body cells for the ad metric set. Rows without any spend render dashes. */
export function AdMetricCells({ row, scope }: { row: PaidFields; scope: 'post' | 'account' }) {
  const hasPaid = (row.spend ?? 0) > 0 || (row.paidImpressions ?? 0) > 0;
  return <>{adMetricList(scope).map((m) => (
    <td key={m.key} className="num">
      {!hasPaid && m.key !== 'monthlyBudget' ? <span className="text-ink-2">—</span> : (
        <div className="leading-tight">{fmtAdMetric(m, row)}{m.sub && row[m.sub] ? <div className="text-xs text-ink-2">{String(row[m.sub])}</div> : null}</div>
      )}
    </td>
  ))}</>;
}

/** Compact grid (label/value) used in detail headers and drawers. */
export function AdMetricGrid({ row, scope, cols = 7 }: { row: PaidFields; scope: 'post' | 'account'; cols?: number }) {
  return (
    <div className="grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {adMetricList(scope).map((m) => (
        <div key={m.key}><div className="text-xs text-ink-2 truncate" title={adMetricLabel(m)}>{adMetricLabel(m)}</div><div className="num font-semibold text-sm">{fmtAdMetric(m, row)}{m.sub && row[m.sub] ? <span className="text-xs text-ink-2 font-normal ml-1">{String(row[m.sub])}</span> : null}</div></div>
      ))}
    </div>
  );
}
