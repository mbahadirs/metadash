import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ColumnDef, SortingState, RowSelectionState } from '@tanstack/react-table';
import { useContent, useContentAnalysis, useAccounts, useTags } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { fmtNum, fmtPct, fmtDate, fmtMoney, mediaTypeLabel } from '@/lib/format';
import type { Media, TypeKey } from '@/lib/types';
import { Loading, ErrorState, Avatar, TagChip, Toggle } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { PostThumb } from '@/components/PostThumb';
import { PostDrawer } from '@/components/PostDrawer';
import { TypeFilter } from '@/components/TypeFilter';
import { ContentAnalysisView } from './Analysis';
import { ExcelButton } from '@/components/ExcelButton';
import { mediaSheet } from '@/lib/xlsx';
import { adMetricList, fmtAdMetric, adMetricLabel } from '@/lib/adMetrics';

export function ContentPage() {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const { basket, addToBasket, clearBasket } = useAppStore();
  const accounts = useAccounts();
  const tags = useTags();
  const [view, setView] = useState<'table' | 'analysis'>('table');
  const [igIds, setIgIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [typeKeys, setTypeKeys] = useState<TypeKey[]>([]);
  const [hashtag, setHashtag] = useState('');
  const [minReach, setMinReach] = useState('');
  const [search, setSearch] = useState('');
  const [onlyPaid, setOnlyPaid] = useState(false);
  const [showAdCols, setShowAdCols] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'postedAt', desc: true }]);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [open, setOpen] = useState<string | null>(null);
  const exportRef = useRef<((name: string) => import('@/components/ExcelButton').XlsxSheet) | null>(null);

  const accountIds = useMemo(() => {
    if (igIds.length) return igIds;
    if (tagIds.length) return (accounts.data ?? []).filter((a) => a.tagIds.some((tg) => tagIds.includes(tg))).map((a) => a.igId);
    return undefined;
  }, [igIds, tagIds, accounts.data]);
  const q = useContent({ igIds: accountIds, filters: { typeKeys: typeKeys.length ? typeKeys : undefined, hashtag: hashtag || undefined, minReach: minReach ? Number(minReach) : undefined, search: search || undefined, onlyPaid: onlyPaid || undefined } });
  const analysis = useContentAnalysis({ igIds: accountIds, typeKeys: typeKeys.length ? typeKeys : undefined }, view === 'analysis');
  const hasPaid = useMemo(() => (q.data ?? []).some((m) => (m.spend ?? 0) > 0), [q.data]);

  const columns = useMemo<ColumnDef<Media, any>[]>(() => [ // eslint-disable-line @typescript-eslint/no-explicit-any
    { id: 'select', size: 36, enableSorting: false, header: ({ table }) => <input type="checkbox" checked={table.getIsAllRowsSelected()} onChange={table.getToggleAllRowsSelectedHandler()} aria-label={t('select_all')} />, cell: ({ row }) => <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} /> },
    { id: 'thumb', size: 44, enableSorting: false, header: '', cell: ({ row }) => <PostThumb mediaId={row.original.mediaId} thumbnailPath={row.original.thumbnailPath} mediaType={row.original.mediaType} mediaProductType={row.original.mediaProductType} size={28} /> },
    { id: 'username', header: t('account'), accessorKey: 'username', size: 160, cell: ({ row }) => <Link to={`/account/${row.original.igId}`} className="flex items-center gap-2 no-underline text-ink-1 hover:text-accent" onClick={(e) => e.stopPropagation()}><Avatar username={row.original.username} url={row.original.profilePicUrl} color={row.original.accountColor} size={20} />@{row.original.username}</Link> },
    { id: 'postedAt', header: t('date'), accessorKey: 'postedAt', size: 90, cell: ({ getValue }) => fmtDate(getValue() as number) },
    { id: 'type', header: t('type'), accessorFn: (r) => mediaTypeLabel(r, lang), size: 80 },
    { id: 'caption', header: t('caption'), accessorKey: 'caption', enableSorting: false, cell: ({ getValue }) => <span className="block max-w-[300px] truncate" title={String(getValue() ?? '')}>{String(getValue() ?? '').slice(0, 60)}</span> },
    { id: 'reach', header: t('reach'), accessorKey: 'reach', meta: { align: 'right' }, cell: ({ getValue }) => fmtNum(getValue() as number) },
    { id: 'views', header: t('views'), accessorKey: 'views', meta: { align: 'right' }, cell: ({ getValue }) => fmtNum(getValue() as number) },
    { id: 'likes', header: t('likes'), accessorKey: 'likes', meta: { align: 'right' }, cell: ({ getValue }) => fmtNum(getValue() as number) },
    { id: 'comments', header: t('comments'), accessorKey: 'comments', meta: { align: 'right' }, cell: ({ getValue }) => fmtNum(getValue() as number) },
    { id: 'saved', header: t('saved'), accessorKey: 'saved', meta: { align: 'right' }, cell: ({ getValue }) => fmtNum(getValue() as number) },
    { id: 'shares', header: t('shares'), accessorKey: 'shares', meta: { align: 'right' }, cell: ({ getValue }) => fmtNum(getValue() as number) },
    { id: 'er', header: t('er_short'), accessorKey: 'engagementRate', meta: { align: 'right' }, cell: ({ getValue }) => fmtPct(getValue() as number, 2) },
    { id: 'saveRate', header: t('save_rate'), accessorKey: 'saveRate', meta: { align: 'right' }, cell: ({ getValue }) => fmtPct(getValue() as number, 2) },
    ...(hasPaid && showAdCols ? ([
      { id: 'paidImpressions', header: t('paid_impressions'), accessorKey: 'paidImpressions', meta: { align: 'right', xlsx: 'int' }, cell: ({ getValue }) => fmtNum(getValue() as number) },
      { id: 'totalImpressions', header: t('total_impressions'), accessorKey: 'totalImpressions', meta: { align: 'right', xlsx: 'int' }, cell: ({ row }) => <div className="leading-tight">{fmtNum(row.original.totalImpressions)}<div className="text-xs text-ink-2">{row.original.paidImpressionShare != null ? `${t('paid_share_short')} ${fmtPct(row.original.paidImpressionShare, 0)}` : ''}</div></div> },
      { id: 'paidReach', header: t('paid_reach'), accessorKey: 'paidReach', meta: { align: 'right', xlsx: 'int' }, cell: ({ getValue }) => fmtNum(getValue() as number) },
      { id: 'totalReach', header: t('total_reach'), accessorKey: 'totalReach', meta: { align: 'right', xlsx: 'int' }, cell: ({ row }) => <div className="leading-tight">{fmtNum(row.original.totalReach)}<div className="text-xs text-ink-2">{row.original.paidReachShare != null ? `${t('paid_share_short')} ${fmtPct(row.original.paidReachShare, 0)}` : ''}</div></div> },
      ...adMetricList('post').map((m) => ({ id: m.key, header: adMetricLabel(m), accessorKey: m.key, meta: { align: 'right', xlsx: m.type }, cell: ({ row }: { row: { original: Media } }) => ((row.original.spend ?? 0) > 0 ? <div className="leading-tight">{fmtAdMetric(m, row.original)}{m.sub && row.original[m.sub as 'paidResultType'] ? <div className="text-xs text-ink-2">{String(row.original[m.sub as 'paidResultType'])}</div> : null}</div> : <span className="text-ink-2">—</span>) })),
    ] as ColumnDef<Media, any>[]) : []), // eslint-disable-line @typescript-eslint/no-explicit-any
  ], [t, lang, hasPaid, showAdCols]);

  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const exportSheet = () => { const sheet = exportRef.current?.('x'); const order = sheet ? (sheet.rows as Record<string, unknown>[]).map((r) => r.mediaId as string) : []; const byId = new Map((q.data ?? []).map((m) => [m.mediaId, m])); const rows = order.length ? order.map((id) => byId.get(id)!).filter(Boolean) : (q.data ?? []); return mediaSheet(t('nav_content'), rows); };

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1"><button className={`chip ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')}>{t('table')}</button><button className={`chip ${view === 'analysis' ? 'active' : ''}`} onClick={() => setView('analysis')}>{t('analysis')}</button></div>
        <span className="w-px h-5 bg-line mx-1" />
        <select className="input w-52" value={igIds[0] ?? ''} onChange={(e) => setIgIds(e.target.value ? [e.target.value] : [])}>
          <option value="">{t('accounts')}: {t('all')}</option>
          {(accounts.data ?? []).map((a) => <option key={a.igId} value={a.igId}>@{a.username}</option>)}
        </select>
        <TypeFilter value={typeKeys} onChange={setTypeKeys} />
        <span className="w-px h-5 bg-line mx-1" />
        <input className="input w-36" placeholder={`#${t('hashtag').toLowerCase()}`} value={hashtag} onChange={(e) => setHashtag(e.target.value)} />
        <input className="input w-32 num" type="number" placeholder={t('min_reach')} value={minReach} onChange={(e) => setMinReach(e.target.value)} />
        <input className="input w-44" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Toggle checked={onlyPaid} onChange={setOnlyPaid} label={t('only_paid')} />
        {hasPaid && <Toggle checked={showAdCols} onChange={setShowAdCols} label={t('ad_columns')} />}
        <div className="flex-1" />
        {view === 'table' && <button className="btn" disabled={!selectedIds.length} onClick={() => { addToBasket(selectedIds); setSelection({}); }}>{t('add_to_report')} {selectedIds.length ? `(${selectedIds.length})` : ''}</button>}
        {basket.length > 0 && <Link to="/reports" className="btn btn-primary">{t('report_basket')} · {basket.length}</Link>}
        {basket.length > 0 && <button className="btn btn-ghost btn-sm" onClick={clearBasket}>{t('clear')}</button>}
      </div>
      <div className="flex flex-wrap gap-1">{(tags.data ?? []).map((tg) => <TagChip key={tg.id} small name={tg.name} color={tg.color} active={tagIds.includes(tg.id)} onClick={() => setTagIds(tagIds.includes(tg.id) ? tagIds.filter((x) => x !== tg.id) : [...tagIds, tg.id])} />)}</div>

      {view === 'table' ? (
        <>
          <div className="panel flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-3 h-10 border-b border-line flex-none">
              <span className="text-sm text-ink-2 num">{q.data?.length ?? 0} {t('posts').toLowerCase()}{hasPaid ? ` · ${(q.data ?? []).filter((m) => (m.spend ?? 0) > 0).length} ${t('paid_posts').toLowerCase()}` : ''}</span>
              <ExcelButton name="content" title={t('nav_content')} getData={exportSheet} />
            </div>
            <div className="flex-1 min-h-0">
            {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
              <DataTable data={q.data ?? []} columns={columns} sorting={sorting} onSortingChange={setSorting} getRowId={(r) => r.mediaId} rowSelection={selection} onRowSelectionChange={setSelection}
                onRowClick={(r) => setOpen(r.mediaId)} selectedId={open} virtual height="100%" empty={t('no_data')} onExportReady={(fn) => { exportRef.current = fn; }} />
            )}
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto">{analysis.isLoading ? <Loading /> : analysis.error ? <ErrorState error={analysis.error} /> : analysis.data && <ContentAnalysisView data={analysis.data} onOpen={setOpen} />}</div>
      )}
      <PostDrawer mediaId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
