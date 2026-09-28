import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useAccounts, useContent, useComparePosts } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { fmtNum, fmtPct, fmtCompact, fmtDate, fmtDateTime, fmtMoney, WEEKDAYS } from '@/lib/format';
import type { Media, TypeKey } from '@/lib/types';
import { Avatar, Delta, EmptyState, Loading, ErrorState, Section } from '@/components/ui';
import { PostThumb } from '@/components/PostThumb';
import { PostDrawer } from '@/components/PostDrawer';
import { TypeFilter, TypeBadge } from '@/components/TypeFilter';
import { ChartWrapper } from '@/charts/ChartWrapper';
import { rechartsTooltip } from '@/charts/Tooltip';
import { ExcelButton } from '@/components/ExcelButton';
import { adMetricList, fmtAdMetric, adMetricLabel } from '@/lib/adMetrics';

const COLORS = ['#4F7CFF', '#3FBF8F', '#E8B44A', '#C06CE8', '#E5605F', '#48C3D6'];
const METRICS: { key: 'reach' | 'views' | 'likes' | 'comments' | 'saved' | 'shares' | 'engagementRate' | 'saveRate'; label: string; fmt: (v: number | null) => string }[] = [
  { key: 'reach', label: 'reach', fmt: (v) => fmtNum(v) }, { key: 'views', label: 'views', fmt: (v) => fmtNum(v) }, { key: 'likes', label: 'likes', fmt: (v) => fmtNum(v) },
  { key: 'comments', label: 'comments', fmt: (v) => fmtNum(v) }, { key: 'saved', label: 'saved', fmt: (v) => fmtNum(v) }, { key: 'shares', label: 'shares', fmt: (v) => fmtNum(v) },
  { key: 'engagementRate', label: 'er', fmt: (v) => fmtPct(v, 2) }, { key: 'saveRate', label: 'save_rate', fmt: (v) => fmtPct(v, 2) },
];

/** Post-vs-post comparison inside one account (or across accounts): pick 2–6 posts, compare metrics + lifecycle, send to basket. */
export function PostCompare() {
  const t = useT();
  const accounts = useAccounts();
  const { basket, addToBasket, lang } = useAppStore();
  const [igId, setIgId] = useState('');
  const [typeKeys, setTypeKeys] = useState<TypeKey[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'date' | 'reach' | 'er'>('date');
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const posts = useContent({ igIds: igId ? [igId] : undefined, filters: { typeKeys: typeKeys.length ? typeKeys : undefined, search: search || undefined, sort, limit: 300 } });
  const cmp = useComparePosts(selected);
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : selected.length < 6 ? [...selected, id] : selected);
  const items = cmp.data?.items ?? [];
  const colorOf = useMemo(() => new Map(selected.map((id, i) => [id, COLORS[i % COLORS.length]])), [selected]);
  const tooltipFmt = Object.fromEntries(items.map((d) => [d.media.mediaId, { name: `${fmtDate(d.media.postedAt)} @${d.media.username}` }]));

  return (
    <div className="flex gap-6 h-full">
      <aside className="w-[340px] flex-none panel flex flex-col">
        <div className="p-3 border-b border-line space-y-2">
          <div className="text-xs text-ink-2">{t('select_posts')} · {selected.length}/6</div>
          <select className="input" value={igId} onChange={(e) => { setIgId(e.target.value); }}><option value="">{t('accounts')}: {t('all')}</option>{(accounts.data ?? []).map((a) => <option key={a.igId} value={a.igId}>@{a.username}</option>)}</select>
          <TypeFilter value={typeKeys} onChange={setTypeKeys} />
          <div className="flex gap-2"><input className="input" placeholder={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} /><select className="input w-28" value={sort} onChange={(e) => setSort(e.target.value as 'date')}><option value="date">{t('date')}</option><option value="reach">{t('reach')}</option><option value="er">{t('er_short')}</option></select></div>
        </div>
        <div className="overflow-auto flex-1">
          {posts.isLoading ? <Loading /> : (posts.data ?? []).map((m: Media) => {
            const on = selected.includes(m.mediaId);
            return (
              <button key={m.mediaId} className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2 border-b border-line ${on ? 'bg-surface-2' : ''}`} onClick={() => toggle(m.mediaId)} disabled={!on && selected.length >= 6}>
                <span className="w-3.5 h-3.5 rounded border flex-none" style={{ background: on ? colorOf.get(m.mediaId) : 'transparent', borderColor: on ? 'transparent' : 'var(--line)' }} />
                <PostThumb mediaId={m.mediaId} thumbnailPath={m.thumbnailPath} mediaType={m.mediaType} mediaProductType={m.mediaProductType} size={32} />
                <div className="min-w-0 flex-1"><div className="flex items-center gap-1 text-xs text-ink-2">{!igId && <span>@{m.username} ·</span>}<span>{fmtDate(m.postedAt)}</span><TypeBadge typeKey={m.mediaProductType === 'REELS' ? 'reels' : m.mediaType === 'CAROUSEL_ALBUM' ? 'carousel' : m.mediaType === 'VIDEO' ? 'video' : 'image'} /></div><div className="truncate text-sm">{m.caption || '—'}</div></div>
                <div className="text-right text-xs num flex-none"><div>{fmtCompact(m.reach)}</div><div className="text-ink-2">{fmtPct(m.engagementRate, 2)}</div></div>
              </button>
            );
          })}
        </div>
        {selected.length > 0 && <div className="p-2 border-t border-line flex gap-2"><button className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>{t('clear')}</button><button className="btn btn-primary btn-sm flex-1" onClick={() => addToBasket(selected)}>{t('add_selected_to_basket')}</button></div>}
      </aside>

      <div className="flex-1 min-w-0 space-y-5">
        {selected.length < 2 ? <EmptyState title={t('select_posts')} /> : cmp.isLoading ? <Loading /> : cmp.error ? <ErrorState error={cmp.error} /> : cmp.data && (
          <>
            <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
              {items.map((d) => (
                <button key={d.media.mediaId} className="panel overflow-hidden text-left hover:border-accent" style={{ borderTopColor: colorOf.get(d.media.mediaId), borderTopWidth: 3 }} onClick={() => setOpen(d.media.mediaId)}>
                  <div className="aspect-[4/3]"><PostThumb mediaId={d.media.mediaId} thumbnailPath={d.media.thumbnailPath} mediaType={d.media.mediaType} mediaProductType={d.media.mediaProductType} size="100%" rounded={0} /></div>
                  <div className="p-2.5 text-xs"><div className="flex items-center justify-between text-ink-2"><span className="flex items-center gap-1"><Avatar username={d.media.username} url={d.media.profilePicUrl} color={d.media.accountColor} size={16} />@{d.media.username}</span><span>{fmtDateTime(d.media.postedAt)}</span></div><div className="truncate mt-1">{d.media.caption || '—'}</div><div className="flex items-center gap-1 mt-1.5"><TypeBadge typeKey={d.media.typeKey} />{basket.includes(d.media.mediaId) && <span className="badge badge-pos">{t('in_basket')}</span>}{d.paid && <span className="badge badge-warn">{fmtMoney(d.paid.totals.spend, d.paid.currency)}</span>}</div></div>
                </button>
              ))}
            </div>

            <Section title={t('metric')} right={<><span className="text-xs text-ink-2">{t('best_in_row')} · {t('vs_type_avg')}</span><ExcelButton name="post-comparison" getData={() => ({ name: t('compare_posts'), columns: [{ key: 'metric', label: t('metric'), type: 'text' }, ...items.map((d) => ({ key: d.media.mediaId, label: `@${d.media.username} ${fmtDate(d.media.postedAt)}`, type: 'float' as const }))], rows: [...METRICS.map((m) => ({ metric: t(m.label as 'reach'), ...Object.fromEntries(items.map((d) => [d.media.mediaId, d.media[m.key]])) })), { metric: t('reach_rank'), ...Object.fromEntries(items.map((d) => [d.media.mediaId, d.rank.rank])) }, { metric: t('hours_to_80'), ...Object.fromEntries(items.map((d) => [d.media.mediaId, d.lifecycle.hoursTo80])) }, { metric: t('total_reach'), ...Object.fromEntries(items.map((d) => [d.media.mediaId, d.media.totalReach])) }, ...adMetricList('post').map((m) => ({ metric: adMetricLabel(m), ...Object.fromEntries(items.map((d) => [d.media.mediaId, d.media[m.key as 'spend'] ?? null])) }))] })} /></>}>
              <div className="-m-4 overflow-auto"><table className="table">
                <thead><tr><th>{t('metric')}</th>{items.map((d) => <th key={d.media.mediaId} className="num"><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: colorOf.get(d.media.mediaId) }} />{fmtDate(d.media.postedAt)}</th>)}</tr></thead>
                <tbody>
                  {METRICS.map((m) => (
                    <tr key={m.key}><td className="text-ink-2">{t(m.label as 'reach')}</td>{items.map((d) => <td key={d.media.mediaId} className={`num ${cmp.data!.best[m.key] === d.media.mediaId ? 'text-pos font-semibold' : ''}`}><div className="leading-tight">{m.fmt(d.media[m.key])}<div className="text-xs font-normal"><Delta value={d.deltas[m.key]} /></div></div></td>)}</tr>
                  ))}
                  <tr><td className="text-ink-2">{t('reach_rank')}</td>{items.map((d) => <td key={d.media.mediaId} className="num">{d.rank.rank != null ? `#${d.rank.rank} / ${d.rank.total}` : '—'}</td>)}</tr>
                  <tr><td className="text-ink-2">{t('hours_to_80')}</td>{items.map((d) => <td key={d.media.mediaId} className="num">{d.lifecycle.hoursTo80 != null ? `${d.lifecycle.hoursTo80} ${t('hours')}` : '—'}</td>)}</tr>
                  <tr><td className="text-ink-2">{t('total_reach')}</td>{items.map((d) => <td key={d.media.mediaId} className="num">{fmtNum(d.media.totalReach)} <span className="text-xs text-ink-2">{d.media.paidReach ? fmtPct(d.media.paidReachShare, 0) : ''}</span></td>)}</tr>
                  {adMetricList('post').map((m) => <tr key={m.key}><td className="text-ink-2">{adMetricLabel(m)}</td>{items.map((d) => <td key={d.media.mediaId} className="num">{(d.media.spend ?? 0) > 0 ? fmtAdMetric(m, d.media) : <span className="text-ink-2">—</span>}</td>)}</tr>)}
                  <tr><td className="text-ink-2">{t('time_slot')}</td>{items.map((d) => <td key={d.media.mediaId} className="num">{d.slot ? `${WEEKDAYS[lang][d.slot.weekday]} ${d.slot.hour}:00${d.slot.qualified ? ` · ER ${fmtPct(d.slot.value, 2)}` : ''}` : '—'}</td>)}</tr>
                </tbody>
              </table></div>
            </Section>

            <ChartWrapper id="post-compare-lifecycle" title={t('lifecycle_compare')} height={300}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cmp.data.lifecycle} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--line)" />
                  <XAxis dataKey="ageHours" tickFormatter={(v) => `${v}s`} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
                  <YAxis tickFormatter={(v) => fmtCompact(v)} tickLine={false} axisLine={false} width={52} />
                  <Tooltip content={rechartsTooltip(tooltipFmt)} isAnimationActive={false} />
                  <Legend iconType="square" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  {items.map((d) => <Line key={d.media.mediaId} dataKey={d.media.mediaId} name={`${fmtDate(d.media.postedAt)} @${d.media.username}`} stroke={colorOf.get(d.media.mediaId)} strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} connectNulls />)}
                </LineChart>
              </ResponsiveContainer>
            </ChartWrapper>
            <div className="text-xs text-ink-2">{t('basket_usage')} <Link to="/reports">{t('reports')} →</Link></div>
          </>
        )}
      </div>
      <PostDrawer mediaId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
