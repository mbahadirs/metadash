import { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { daysAgo, isoDate, fmtNum, fmtPct } from '@/lib/format';
import { PLATFORM_LABELS } from '@/lib/platforms';
import { useAccounts } from '@/hooks/queries';
import { useInboxSla } from '@/hooks/useInbox';
import { PlatformIcon } from '@/components/PlatformBadge';
import { EmptyState, ErrorState, Loading } from '@/components/ui';
import { fmtMinutes } from './format';

const PERIODS = [7, 28, 90] as const;

/** First-response KPIs (answered %, within target %, median / p90, backlog) and a per-account table. */
export function SlaPanel({ accountIds }: { accountIds?: string[] }) {
  const t = useT();
  const [days, setDays] = useState<(typeof PERIODS)[number]>(28);
  const params = useMemo(() => ({ from: daysAgo(days - 1), to: isoDate(new Date()), accountIds }), [days, accountIds]);
  const sla = useInboxSla(params);
  const accounts = useAccounts();
  const names = useMemo(() => new Map((accounts.data ?? []).map((a) => [a.igId, a.username])), [accounts.data]);
  const pct = (v: number | null) => (v == null ? '—' : fmtPct(v, 1));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-2">{t('ix_sla_intro', { hours: sla.data?.slaHours ?? 24 })}</span>
        <select className="input w-32 ml-auto" aria-label={t('ix_period')} value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof PERIODS)[number])}>
          {PERIODS.map((d) => <option key={d} value={d}>{t('ix_last_days', { n: d })}</option>)}
        </select>
      </div>
      {sla.isLoading ? <Loading /> : sla.error ? <ErrorState error={sla.error} /> : !sla.data?.totals.incoming ? <EmptyState title={t('ix_sla_empty')} /> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {[
              [t('ix_kpi_incoming'), fmtNum(sla.data.totals.incoming)],
              [t('ix_kpi_answered'), pct(sla.data.totals.answeredPct)],
              [t('ix_kpi_within', { hours: sla.data.slaHours }), pct(sla.data.totals.withinSlaPct)],
              [t('ix_kpi_median'), fmtMinutes(t, sla.data.totals.medianFrtMin)],
              [t('ix_kpi_p90'), fmtMinutes(t, sla.data.totals.p90FrtMin)],
              [t('ix_kpi_backlog'), fmtNum(sla.data.totals.backlog)],
            ].map(([label, value]) => (
              <div key={label} className="panel p-3"><div className="text-xs text-ink-2">{label}</div><div className="text-lg num">{value}</div></div>
            ))}
          </div>
          <div className="panel overflow-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-ink-2 text-left">
                <th className="p-2">{t('ix_account')}</th><th className="p-2 text-right">{t('ix_kpi_incoming')}</th><th className="p-2 text-right">{t('ix_kpi_answered')}</th>
                <th className="p-2 text-right">{t('ix_kpi_within', { hours: sla.data.slaHours })}</th><th className="p-2 text-right">{t('ix_kpi_median')}</th>
                <th className="p-2 text-right">{t('ix_kpi_p90')}</th><th className="p-2 text-right">{t('ix_kpi_backlog')}</th>
              </tr></thead>
              <tbody>
                {sla.data.rows.map((r) => (
                  <tr key={`${r.accountId}|${r.platform}`} className="border-t border-line">
                    <td className="p-2"><span className="inline-flex items-center gap-1.5"><PlatformIcon platform={r.platform} size={12} title={PLATFORM_LABELS[r.platform]} />@{names.get(r.accountId) ?? r.accountId}</span></td>
                    <td className="p-2 text-right num">{fmtNum(r.incoming)}</td>
                    <td className="p-2 text-right num">{pct(r.answeredPct)}</td>
                    <td className="p-2 text-right num">{pct(r.withinSlaPct)}</td>
                    <td className="p-2 text-right num">{fmtMinutes(t, r.medianFrtMin)}</td>
                    <td className="p-2 text-right num">{fmtMinutes(t, r.p90FrtMin)}</td>
                    <td className={`p-2 text-right num ${r.backlog ? 'text-neg' : ''}`}>{fmtNum(r.backlog)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
