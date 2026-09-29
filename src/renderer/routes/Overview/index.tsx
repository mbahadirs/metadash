import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { usePortfolio, useTags } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { fmtNum, fmtPct, fmtCompact, fmtMoneyCompact } from '@/lib/format';
import type { PortfolioRow } from '@/lib/types';
import { Kpi, KpiStrip, Avatar, Delta, HealthBadge, Loading, ErrorState, EmptyState, TagChip, Section } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { Sparkline } from '@/charts/Sparkline';
import { ExcelButton } from '@/components/ExcelButton';
import { portfolioSheet } from '@/lib/xlsx';
import { adMetricList, fmtAdMetric, adMetricLabel } from '@/lib/adMetrics';
import { Toggle } from '@/components/ui';
import { useRunSync } from '@/hooks/useSyncEvents';
import { AttentionPanel } from './AttentionPanel';
import { PlatformFilter } from '@/components/PlatformFilter';
import { PlatformSplitStrip } from './PlatformSplitStrip';
import { useActivePlatforms, usePlatformCaps, usePlatformScope } from '@/hooks/usePlatforms';
import { PLATFORM_LABELS, platformOf, portfolioSplit } from '@/lib/platforms';

type RowV13 = PortfolioRow & { primaryValue?: number | null; primaryChangePct?: number | null };
const primaryOf = (r: RowV13) => ({ value: r.primaryValue !== undefined ? r.primaryValue : r.reach, change: r.primaryChangePct !== undefined ? r.primaryChangePct : r.reachChangePct });

export function OverviewPage() {
  const t = useT();
  const nav = useNavigate();
  const q = usePortfolio();
  const tags = useTags();
  const { tagFilter, setTagFilter, demo } = useAppStore();
  const runSync = useRunSync();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'reach', desc: true }]);
  const [search, setSearch] = useState('');
  const [adCols, setAdCols] = useState(true);
  const exportRef = useRef<((name: string) => import('@/components/ExcelButton').XlsxSheet) | null>(null);
  const scope = usePlatformScope();
  const active = useActivePlatforms();
  const pc = usePlatformCaps();
  const shown = scope.length ? scope : active;

  const columns = useMemo<ColumnDef<PortfolioRow, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { id: 'username', header: t('account'), accessorKey: 'username', size: 240, cell: ({ row }) => (
      <div className="flex items-center gap-2.5">
        <Avatar username={row.original.username} url={row.original.profilePicUrl} color={row.original.color} size={26} platform={row.original.platform} />
        <div className="leading-tight"><div className="font-medium">@{row.original.username}</div><div className="text-ink-2 text-xs truncate max-w-[180px]">{row.original.clientName ?? row.original.name}</div></div>
        {row.original.anomalies.length > 0 && <span className="badge badge-warn" title={row.original.anomalies.map((a) => `${(a.kind as string) === 'views' ? t('views') : a.kind === 'reach' ? t('reach') : 'ER'} ${a.direction === 'up' ? '▲' : '▼'} ${a.z}σ`).join(', ')}>σ</span>}
        {row.original.syncError && <span className="badge badge-neg" title={row.original.syncError.message}>!</span>}
      </div>
    ) },
    { id: 'followers', header: t('followers'), accessorKey: 'followers', meta: { align: 'right' }, cell: ({ row }) => (
      <div className="leading-tight"><div>{fmtNum(row.original.followers)}</div><div className="text-xs"><Delta value={row.original.followersChangePct} /> <span className="text-ink-2">{row.original.followersChange != null ? (row.original.followersChange >= 0 ? '+' : '') + fmtNum(row.original.followersChange) : ''}</span></div></div>
    ) },
    // Primary metric: reach, or views for Threads (primaryValue/primaryChangePct since v1.3; reach before).
    { id: 'reach', header: t('reach'), accessorFn: (r) => primaryOf(r).value, meta: { align: 'right' }, cell: ({ row }) => { const p = platformOf(row.original); const views = pc.primary(p) === 'views'; const pv = primaryOf(row.original); return <div className="leading-tight" title={views ? t('views_as_primary_tip') : p === 'facebook' ? t('viewers_tip') : undefined}><div>{fmtNum(pv.value)}{views && <span className="text-ink-2 text-xs"> ({t('views').toLowerCase()})</span>}</div><div className="text-xs"><Delta value={pv.change} /></div></div>; } },
    { id: 'er', header: t('er_short'), accessorKey: 'er', meta: { align: 'right' }, cell: ({ row }) => <div className="leading-tight"><div>{fmtPct(row.original.er, 2)}</div><div className="text-xs"><Delta value={row.original.erChangePct} /></div></div> },
    { id: 'saveRate', header: t('save_rate'), accessorKey: 'saveRate', meta: { align: 'right' }, cell: ({ row, getValue }) => { const p = platformOf(row.original); return pc.caps(p).saveRate ? fmtPct(getValue() as number, 2) : <span className="text-ink-2" title={t('na_for_platform', { p: PLATFORM_LABELS[p] })}>—</span>; } },
    { id: 'totalReach', header: t('total_reach'), accessorKey: 'totalReach', meta: { align: 'right', xlsx: 'int' }, size: 130, cell: ({ row }) => <div className="leading-tight"><div>{fmtNum(row.original.totalReach)}</div><div className="text-xs text-ink-2">{row.original.paidReach ? `${t('paid')} ${fmtCompact(row.original.paidReach)} · ${fmtPct(row.original.paidShare, 0)}` : t('organic')}</div></div> },
    ...(adCols ? adMetricList('account').map((m) => ({ id: m.key, header: adMetricLabel(m), accessorKey: m.key, meta: { align: 'right', xlsx: m.type }, size: 110, cell: ({ row }: { row: { original: PortfolioRow } }) => ((row.original.spend ?? 0) > 0 || m.key === 'monthlyBudget' ? <div className="leading-tight">{fmtAdMetric(m, row.original)}{m.sub && row.original[m.sub as 'paidResultType'] ? <div className="text-xs text-ink-2">{String(row.original[m.sub as 'paidResultType'])}</div> : null}</div> : <span className="text-ink-2">—</span>) })) : []),
    { id: 'posts', header: t('posts'), accessorKey: 'posts', meta: { align: 'right' }, size: 70 },
    { id: 'health', header: t('health'), accessorKey: 'health', meta: { align: 'right' }, size: 80, cell: ({ getValue }) => <HealthBadge score={getValue() as number} /> },
    { id: 'spark', header: t('last30'), accessorFn: (r) => r.sparkline[r.sparkline.length - 1] ?? 0, enableSorting: false, size: 110, cell: ({ row }) => <Sparkline values={row.original.sparkline} color={row.original.color ?? undefined} /> },
  ], [t, adCols, pc]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.rows ?? []).filter((r) => (!scope.length || scope.includes(platformOf(r))) && (!s || r.username.includes(s) || (r.clientName ?? '').toLowerCase().includes(s)));
  }, [q.data, search, scope]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const p = q.data!;
  if (!p.rows.length && !tagFilter.length) {
    return <EmptyState title={t('no_data_yet')} action={<button className="btn btn-primary" onClick={() => runSync({ scope: 'full' })}>{t('start_first_sync')}</button>} />;
  }
  const k = p.kpis;
  const totalViews = (k as typeof k & { totalViews?: import('@/lib/types').Kpi }).totalViews;
  const onlyViews = shown.length > 0 && shown.every((pl) => pc.primary(pl) === 'views');

  return (
    <div className="flex gap-6 min-h-full">
      <aside className="w-44 flex-none space-y-3">
        {active.length > 1 && <><div className="text-ink-2 text-xs">{t('platform_filter')}</div><PlatformFilter vertical /></>}
        <div className="text-ink-2 text-xs">{t('tag_filter')}</div>
        <div className="flex flex-wrap gap-1.5">
          <TagChip name={t('all')} active={!tagFilter.length} onClick={() => setTagFilter([])} />
          {(tags.data ?? []).map((tg) => (
            <TagChip key={tg.id} name={`${tg.name} · ${tg.count ?? 0}`} color={tg.color} active={tagFilter.includes(tg.id)} onClick={() => setTagFilter(tagFilter.includes(tg.id) ? tagFilter.filter((x) => x !== tg.id) : [...tagFilter, tg.id])} />
          ))}
        </div>
        <input className="input mt-2" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="pt-2"><Toggle checked={adCols} onChange={setAdCols} label={t('ad_columns')} /></div>
        {demo && <div className="text-xs text-ink-2 pt-2 border-t border-line">{t('demo_banner')}</div>}
      </aside>

      <div className="flex-1 min-w-0 space-y-5">
        <KpiStrip>
          <Kpi label={t('followers')} kpi={k.totalFollowers} format={fmtCompact} tip={shown.length > 1 ? t('follower_overlap_note') : undefined} />
          <Kpi label={t('net_change')} kpi={k.netFollowers} format={(v) => (v == null ? '—' : (v >= 0 ? '+' : '') + fmtCompact(v))} />
          {!onlyViews && <Kpi label={t('reach')} kpi={k.totalReach} format={fmtCompact} tip={shown.includes('threads') ? t('views_as_primary_tip') : undefined} />}
          {totalViews && shown.includes('threads') && <Kpi label={t('views')} kpi={totalViews} format={fmtCompact} />}
          <Kpi label={t('er')} kpi={k.avgEr} format={(v) => fmtPct(v, 2)} tip={t('er_formula')} />
          <Kpi label={t('spend')} kpi={k.totalSpend} format={(v) => fmtMoneyCompact(v, k.totalSpend.currency)} tip={k.totalSpend.byCurrency ? Object.entries(k.totalSpend.byCurrency).map(([c, v]) => `${c}: ${fmtNum(v.value)}`).join(' · ') : undefined} />
          <Kpi label={t('posts')} kpi={k.totalPosts} />
        </KpiStrip>
        {shown.length > 1 && <PlatformSplitStrip split={portfolioSplit(p)} rows={p.rows} platforms={shown} />}

        <div className="grid grid-cols-12 gap-6">
          <AttentionPanel anomalies={p.attention.anomalies} />
          <Section title={`${t('league')} · ${rows.length}`} className="col-span-12" right={<ExcelButton name="accounts" getData={() => { const sheet = exportRef.current?.('Hesaplar'); const order = sheet ? (sheet.rows as Record<string, unknown>[]).map((r) => r.username as string) : []; const sorted = order.length ? order.map((u) => rows.find((r) => r.username === u)!).filter(Boolean) : rows; return portfolioSheet(t('league'), sorted); }} />}>
            <div className="-m-4">
              <DataTable data={rows} columns={columns} sorting={sorting} onSortingChange={setSorting} getRowId={(r) => r.igId} onRowClick={(r) => nav(`/account/${r.igId}`)} height="calc(100vh - 300px)" empty={t('no_data')} onExportReady={(fn) => { exportRef.current = fn; }} />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
