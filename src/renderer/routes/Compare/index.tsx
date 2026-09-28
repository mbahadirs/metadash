import { useEffect, useMemo, useState } from 'react';
import { useAccounts, useCompare } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { fmtNum, fmtPct, fmtCompact } from '@/lib/format';
import { Avatar, Delta, EmptyState, HealthBadge, Loading, ErrorState, Section } from '@/components/ui';
import { ChartWrapper } from '@/charts/ChartWrapper';
import { CompareChart } from '@/charts/CompareChart';
import { PostCompare } from './PostCompare';
import { ExcelButton } from '@/components/ExcelButton';
import { AdMetricHeaders, AdMetricCells } from '@/components/AdMetricCells';
import { adMetricXlsxColumns } from '@/lib/adMetrics';

const METRICS = ['reach', 'er', 'followers_growth', 'post_frequency', 'save_rate'] as const;

export function ComparePage() {
  const t = useT();
  const accounts = useAccounts();
  const { compareIds, setCompareIds } = useAppStore();
  const [mode, setMode] = useState<'accounts' | 'posts'>('accounts');
  const [metric, setMetric] = useState<(typeof METRICS)[number]>('reach');
  const [search, setSearch] = useState('');
  useEffect(() => { if (!compareIds.length && accounts.data?.length) setCompareIds(accounts.data.slice(0, 3).map((a) => a.igId)); }, [accounts.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useCompare(compareIds, metric);
  const labels: Record<(typeof METRICS)[number], string> = { reach: t('reach'), er: t('er'), followers_growth: t('growth'), post_frequency: t('posts'), save_rate: t('save_rate') };
  const format = metric === 'er' || metric === 'save_rate' ? (v: number | null) => fmtPct(v, 2) : (v: number | null) => fmtCompact(v);
  const list = useMemo(() => (accounts.data ?? []).filter((a) => !search || a.username.includes(search.toLowerCase()) || (a.clientName ?? '').toLowerCase().includes(search.toLowerCase())), [accounts.data, search]);
  const toggle = (igId: string) => setCompareIds(compareIds.includes(igId) ? compareIds.filter((x) => x !== igId) : compareIds.length < 6 ? [...compareIds, igId] : compareIds);

  const modeBar = (
    <div className="flex gap-1 mb-4"><button className={`chip ${mode === 'accounts' ? 'active' : ''}`} onClick={() => setMode('accounts')}>{t('compare_accounts')}</button><button className={`chip ${mode === 'posts' ? 'active' : ''}`} onClick={() => setMode('posts')}>{t('compare_posts')}</button></div>
  );
  if (mode === 'posts') return <div className="flex flex-col h-full">{modeBar}<div className="flex-1 min-h-0"><PostCompare /></div></div>;
  return (
    <div className="flex flex-col h-full">{modeBar}
    <div className="flex gap-6 flex-1 min-h-0">
      <aside className="w-60 flex-none panel flex flex-col">
        <div className="p-3 border-b border-line"><div className="text-xs text-ink-2 mb-2">{t('select_accounts')} · {compareIds.length}/6</div><input className="input" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="overflow-auto flex-1">
          {list.map((a) => {
            const on = compareIds.includes(a.igId);
            return (
              <button key={a.igId} className={`w-full flex items-center gap-2 px-3 h-9 text-left hover:bg-surface-2 ${on ? 'bg-surface-2' : ''}`} onClick={() => toggle(a.igId)} disabled={!on && compareIds.length >= 6}>
                <span className={`w-3.5 h-3.5 rounded border flex-none ${on ? 'border-transparent' : 'border-line'}`} style={{ background: on ? a.color ?? 'var(--accent)' : 'transparent' }} />
                <Avatar username={a.username} url={a.profilePicUrl} color={a.color} size={20} />
                <span className="truncate">@{a.username}</span>
              </button>
            );
          })}
        </div>
        {compareIds.length > 0 && <button className="btn btn-ghost btn-sm m-2" onClick={() => setCompareIds([])}>{t('clear')}</button>}
      </aside>

      <div className="flex-1 min-w-0 space-y-5">
        <div className="flex items-center gap-2"><span className="text-ink-2 text-xs">{t('metric')}</span>{METRICS.map((m) => <button key={m} className={`chip ${metric === m ? 'active' : ''}`} onClick={() => setMetric(m)}>{labels[m]}</button>)}</div>
        {compareIds.length < 2 ? <EmptyState title={t('select_accounts')} /> : q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : q.data && (
          <>
            <ChartWrapper id="compare" title={labels[metric]} height={340}><CompareChart merged={q.data.merged} series={q.data.series} format={format} /></ChartWrapper>
            <Section title={t('accounts')} right={<ExcelButton name="comparison" getData={() => ({ name: t('compare_accounts'), columns: [{ key: 'username', label: t('account'), type: 'text' }, { key: 'clientName', label: t('client'), type: 'text' }, { key: 'followers', label: t('followers'), type: 'int' }, { key: 'growth', label: t('growth'), type: 'int' }, { key: 'growthPct', label: `${t('growth')} %`, type: 'percent' }, { key: 'reach', label: t('reach'), type: 'int' }, { key: 'reachChangePct', label: `${t('reach')} Δ%`, type: 'percent' }, { key: 'er', label: 'ER %', type: 'percent' }, { key: 'erChangePct', label: 'ER Δ%', type: 'percent' }, { key: 'saveRate', label: t('save_rate'), type: 'percent' }, { key: 'posts', label: t('posts'), type: 'int' }, { key: 'postsPerWeek', label: t('posts_per_week'), type: 'float' }, { key: 'health', label: t('health'), type: 'int' }, { key: 'totalReach', label: t('total_reach'), type: 'int' }, ...adMetricXlsxColumns('account')], rows: q.data!.table })} />}>
              <div className="-m-4 overflow-auto"><table className="table">
                <thead><tr><th>{t('account')}</th><th className="num">{t('followers')}</th><th className="num">{t('growth')}</th><th className="num">{t('reach')}</th><th className="num">{t('er_short')}</th><th className="num">{t('save_rate')}</th><th className="num">{t('posts')}</th><th className="num">{t('posts_per_week')}</th><th className="num">{t('health')}</th><th className="num">{t('total_reach')}</th><AdMetricHeaders scope="account" /></tr></thead>
                <tbody>{q.data.table.map((r) => (
                  <tr key={r.igId}><td><span className="inline-block w-2.5 h-2.5 rounded-sm mr-2" style={{ background: r.color }} />@{r.username} <span className="text-ink-2 text-xs">{r.clientName}</span></td><td className="num">{fmtNum(r.followers)}</td><td className="num"><Delta value={r.growthPct} /> <span className="text-ink-2">{r.growth != null ? (r.growth >= 0 ? '+' : '') + fmtNum(r.growth) : ''}</span></td><td className="num">{fmtNum(r.reach)} <Delta value={r.reachChangePct} /></td><td className="num">{fmtPct(r.er, 2)} <Delta value={r.erChangePct} /></td><td className="num">{fmtPct(r.saveRate, 2)}</td><td className="num">{r.posts}</td><td className="num">{r.postsPerWeek}</td><td className="num"><HealthBadge score={r.health} /></td><td className="num">{fmtNum(r.totalReach)}</td><AdMetricCells row={r} scope="account" /></tr>
                ))}</tbody>
              </table></div>
            </Section>
          </>
        )}
      </div>
    </div>
    </div>
  );
}
