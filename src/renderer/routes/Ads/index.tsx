import { useMemo, useState } from 'react';
import { useAdAccounts, useAdInsights, useBlended, useAccounts } from '@/hooks/queries';
import { useT } from '@/lib/i18n';
import { fmtNum, fmtPct, fmtMoney, fmtCompact, fmtMoneyCompact } from '@/lib/format';
import { Kpi, KpiStrip, Tabs, Loading, ErrorState, EmptyState, Section } from '@/components/ui';
import { ChartWrapper } from '@/charts/ChartWrapper';
import { TimeSeries } from '@/charts/TimeSeries';
import { BarList } from '@/charts/BarList';
import { Icon } from '@/components/Icons';
import { ExcelButton } from '@/components/ExcelButton';
import { AdAccountsTable, BudgetTracking } from './AccountsTable';

type Level = 'campaign' | 'adset' | 'ad';

export function AdsPage() {
  const t = useT();
  const adAccounts = useAdAccounts();
  const accounts = useAccounts();
  const [actIds, setActIds] = useState<string[]>([]);
  const [level, setLevel] = useState<Level>('campaign');
  const [breakdown, setBreakdown] = useState<'age' | 'gender' | 'publisher_platform' | ''>('');
  const [blendIg, setBlendIg] = useState('');
  const tracked = useMemo(() => (adAccounts.data ?? []).filter((a) => a.isTracked), [adAccounts.data]);
  const selected = actIds.length ? actIds : tracked.map((a) => a.actId);
  const q = useAdInsights({ actIds: selected, level, breakdown: breakdown || undefined });
  const blended = useBlended(blendIg || undefined);
  const cur = q.data?.currency ?? 'TRY';
  const money = (v: number | null) => fmtMoney(v, cur);
  const money2 = (v: number | null) => fmtMoney(v, cur, 2);

  if (adAccounts.isLoading) return <Loading />;
  if (!tracked.length) return <EmptyState title={t('no_ad_account')} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        <select className="input w-64" value={actIds[0] ?? ''} onChange={(e) => setActIds(e.target.value ? [e.target.value] : [])}>
          <option value="">{t('ad_account')}: {t('all')} ({tracked.length})</option>
          {tracked.map((a) => <option key={a.actId} value={a.actId}>{a.name} · {a.currency}{a.linkedUsername ? ` · @${a.linkedUsername}` : ''}</option>)}
        </select>
        {q.data?.mixedCurrency && <span className="badge badge-warn"><Icon.warn /> {t('mixed_currency_note')}</span>}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : q.data && (
        <>
          <KpiStrip>
            <Kpi label={t('spend')} kpi={q.data.kpis.spend} format={(v) => fmtMoneyCompact(v, cur)} />
            <Kpi label={t('reach')} kpi={q.data.kpis.reach} format={fmtCompact} />
            <Kpi label={t('impressions')} kpi={q.data.kpis.impressions} format={fmtCompact} />
            <Kpi label={t('clicks')} kpi={q.data.kpis.clicks} format={fmtCompact} />
            <Kpi label="CTR" kpi={q.data.kpis.ctr} format={(v) => fmtPct(v, 2)} />
            <Kpi label="CPC" kpi={q.data.kpis.cpc} format={money2} />
            <Kpi label="CPM" kpi={q.data.kpis.cpm} format={money2} />
            <Kpi label={t('results')} kpi={q.data.kpis.results} format={fmtCompact} />
            <Kpi label={t('cost_per_result')} kpi={q.data.kpis.costPerResult} format={money2} />
            <Kpi label={t('post_engagement')} kpi={q.data.kpis.postEngagement} format={fmtCompact} />
            <Kpi label={t('cost_per_post_engagement')} kpi={q.data.kpis.costPerPostEngagement} format={money2} />
            <Kpi label={t('page_engagement')} kpi={q.data.kpis.pageEngagement} format={fmtCompact} />
            <Kpi label={t('cost_per_page_engagement')} kpi={q.data.kpis.costPerPageEngagement} format={money2} />
          </KpiStrip>
          <AdAccountsTable rows={q.data.accounts} />
          <BudgetTracking />
          <ChartWrapper id="ads-spend" title={t('chart_spend')} height={280}>
            <TimeSeries data={q.data.series} rightFormat={(v) => fmtNum(v, 1)} series={[{ key: 'spend', name: t('spend'), color: '#E8B44A', type: 'bar', format: money }, { key: 'cpm', name: 'CPM', color: '#4F7CFF', axis: 'right', format: money2 }, { key: 'ctr', name: 'CTR %', color: '#3FBF8F', axis: 'right', format: (v) => fmtPct(v, 2) }]} />
          </ChartWrapper>
          <div className="grid grid-cols-12 gap-5">
            <Section className="col-span-12 xl:col-span-8" title={<Tabs tabs={[{ id: 'campaign', label: t('campaigns') }, { id: 'adset', label: t('adsets') }, { id: 'ad', label: t('ads_level') }]} value={level} onChange={setLevel} />} right={<ExcelButton name={`ads-${level}`} getData={() => ({ name: level === 'campaign' ? t('campaigns') : level === 'adset' ? t('adsets') : t('ads_level'), columns: [{ key: 'objectName', label: t('type'), type: 'text' }, { key: 'resultType', label: t('result_type'), type: 'text' }, { key: 'spend', label: `${t('spend')} (${cur})`, type: 'money' }, { key: 'reach', label: t('reach'), type: 'int' }, { key: 'impressions', label: t('impressions'), type: 'int' }, { key: 'clicks', label: t('clicks'), type: 'int' }, { key: 'ctr', label: 'CTR %', type: 'percent' }, { key: 'cpc', label: 'CPC', type: 'money' }, { key: 'cpm', label: 'CPM', type: 'money' }, { key: 'results', label: t('results'), type: 'int' }, { key: 'costPerResult', label: t('cost_per_result'), type: 'money' }], rows: q.data!.objects })} />}>
              <div className="-m-4 overflow-auto max-h-[420px]"><table className="table">
                <thead><tr><th>{level === 'campaign' ? t('campaigns') : level === 'adset' ? t('adsets') : t('ads_level')}</th><th className="num">{t('spend')}</th><th className="num">{t('reach')}</th><th className="num">{t('impressions')}</th><th className="num">{t('clicks')}</th><th className="num">CTR</th><th className="num">CPC</th><th className="num">CPM</th><th className="num">{t('results')}</th><th className="num">{t('cost_per_result')}</th></tr></thead>
                <tbody>{q.data.objects.map((o) => <tr key={o.objectId}><td>{o.objectName ?? o.objectId}<span className="text-ink-2 text-xs ml-2">{o.resultType}</span></td><td className="num">{money(o.spend)}</td><td className="num">{fmtNum(o.reach)}</td><td className="num">{fmtNum(o.impressions)}</td><td className="num">{fmtNum(o.clicks)}</td><td className="num">{fmtPct(o.ctr, 2)}</td><td className="num">{money2(o.cpc)}</td><td className="num">{money2(o.cpm)}</td><td className="num">{fmtNum(o.results)}</td><td className="num">{money2(o.costPerResult)}</td></tr>)}
                {!q.data.objects.length && <tr><td colSpan={10} className="text-center text-ink-2">{t('no_data')}</td></tr>}</tbody>
              </table></div>
            </Section>
            <Section className="col-span-12 xl:col-span-4" title={t('breakdown')} right={<div className="flex gap-1">{q.data.breakdown && <ExcelButton name={`breakdown-${breakdown}`} getData={() => ({ name: t('breakdown'), columns: [{ key: 'bucket', label: t('breakdown'), type: 'text' }, { key: 'spend', label: `${t('spend')} (${cur})`, type: 'money' }, { key: 'reach', label: t('reach'), type: 'int' }, { key: 'impressions', label: t('impressions'), type: 'int' }, { key: 'clicks', label: t('clicks'), type: 'int' }, { key: 'ctr', label: 'CTR %', type: 'percent' }, { key: 'results', label: t('results'), type: 'int' }], rows: q.data!.breakdown! })} />}{([['age', t('age')], ['gender', t('gender')], ['publisher_platform', t('platform')]] as const).map(([k, l]) => <button key={k} className={`chip ${breakdown === k ? 'active' : ''}`} onClick={() => setBreakdown(breakdown === k ? '' : k)}>{l}</button>)}</div>}>
              {q.data.breakdown ? <BarList items={q.data.breakdown.map((b) => ({ label: b.bucket ?? '', value: b.spend }))} format={(v) => money(v)} color="#E8B44A" /> : <div className="text-ink-2 text-sm">{t('breakdown')}: {t('age')} / {t('gender')} / {t('platform')}</div>}
            </Section>
          </div>
        </>
      )}
      <Section title={t('blended')} right={<select className="input w-56" value={blendIg} onChange={(e) => setBlendIg(e.target.value)}><option value="">{t('account')}…</option>{(accounts.data ?? []).filter((a) => tracked.some((ad) => ad.linkedIgId === a.igId)).map((a) => <option key={a.igId} value={a.igId}>@{a.username}</option>)}</select>}>
        {!blendIg ? <div className="text-ink-2 text-sm">{t('linked_account')}</div> : blended.isLoading ? <Loading /> : blended.data?.adAccount ? (
          <div data-chart-id={`blended-${blendIg}`} style={{ height: 280 }}>
            <TimeSeries data={blended.data.series} rightFormat={(v) => fmtMoney(v, blended.data!.adAccount!.currency)} series={[{ key: 'organicReach', name: `${t('reach')} (organik)`, color: '#4F7CFF', type: 'area' }, { key: 'paidReach', name: `${t('reach')} (reklam)`, color: '#C06CE8', type: 'area' }, { key: 'spend', name: t('spend'), color: '#E8B44A', type: 'bar', axis: 'right', format: (v) => fmtMoney(v, blended.data!.adAccount!.currency) }]} />
          </div>
        ) : <div className="text-ink-2 text-sm">{t('no_ad_account')}</div>}
      </Section>
    </div>
  );
}
