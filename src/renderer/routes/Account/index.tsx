import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAccountAnalytics, useBestTime, useLifecycle, useDemographics, useStories, useBlended, useCompetitorCompare } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { fmtNum, fmtPct, fmtCompact, fmtMoney, fmtDate, fmtDateTime, mediaTypeLabel, daysAgo, WEEKDAYS } from '@/lib/format';
import type { Media } from '@/lib/types';
import { Kpi, KpiStrip, Avatar, Tabs, Loading, ErrorState, EmptyState, Section, InfoTip, Delta, HealthBadge } from '@/components/ui';
import { ChartWrapper } from '@/charts/ChartWrapper';
import { TimeSeries } from '@/charts/TimeSeries';
import { Heatmap } from '@/charts/Heatmap';
import { BarList } from '@/charts/BarList';
import { LifecycleChart } from '@/charts/LifecycleChart';
import { CompareChart } from '@/charts/CompareChart';
import { PostThumb } from '@/components/PostThumb';
import { PostDrawer } from '@/components/PostDrawer';
import { PostCard } from '@/components/PostCard';
import { RecentPostsTable } from '@/components/RecentPostsTable';
import { ExcelButton } from '@/components/ExcelButton';
import { mediaSheet } from '@/lib/xlsx';
import { AdMetricHeaders, AdMetricCells, AdMetricGrid } from '@/components/AdMetricCells';
import { TypeFilter } from '@/components/TypeFilter';
import { ContentAnalysisView } from '@/routes/Content/Analysis';
import { useContentAnalysis } from '@/hooks/queries';
import type { TypeKey } from '@/lib/types';
import { Icon } from '@/components/Icons';
import { useRunSync } from '@/hooks/useSyncEvents';

type Tab = 'overview' | 'posts' | 'stories' | 'demographics' | 'competitors' | 'ads';

export function AccountPage() {
  const { igId } = useParams();
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const q = useAccountAnalytics(igId);
  const runSync = useRunSync();
  const [tab, setTab] = useState<Tab>('overview');
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data) return <EmptyState title={t('no_data')} />;
  const a = q.data;
  const acc = a.account;
  const tabs = [
    { id: 'overview' as Tab, label: t('overview') }, { id: 'posts' as Tab, label: t('posts') }, { id: 'stories' as Tab, label: t('stories') },
    { id: 'demographics' as Tab, label: t('demographics') }, { id: 'competitors' as Tab, label: t('competitors') }, { id: 'ads' as Tab, label: t('ads') },
  ];
  const prevMap = new Map(a.prevSeries.map((d, i) => [i, d]));
  const prevLookup = (label: string, key: string) => {
    const idx = a.series.findIndex((d) => d.date === label);
    const prev = prevMap.get(idx);
    return prev ? (prev[key] as number | null) ?? null : null;
  };

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          <Avatar username={acc.username} url={acc.profilePicUrl} color={acc.color} size={56} />
          <div>
            <div className="flex items-center gap-2"><h1 className="text-xl font-semibold m-0">@{acc.username}</h1>{acc.clientName && <span className="badge badge-muted">{acc.clientName}</span>}{a.health && <span className="flex items-center gap-1 text-xs text-ink-2">{t('health_score')} <HealthBadge score={a.health.score} /></span>}</div>
            <div className="text-ink-2 mt-0.5">{acc.name}{acc.biography ? ` · ${acc.biography}` : ''}</div>
            <div className="text-sm mt-1 num flex items-center gap-3">
              <span><strong>{fmtNum(acc.followers)}</strong> {t('followers').toLowerCase()}</span>
              <span className="text-ink-2">{fmtNum(acc.mediaCount)} {t('posts').toLowerCase()}</span>
              <button className="btn btn-ghost btn-sm text-accent" onClick={() => api.system.openExternal(`https://www.instagram.com/${acc.username}/`)}>{t('open_in_instagram')} <Icon.external /></button>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to={`/reports?igId=${acc.igId}`} className="btn">{t('reports')}</Link>
          <button className="btn" onClick={() => runSync({ scope: 'organic', igIds: [acc.igId] })}><Icon.refresh />{t('update')}</button>
        </div>
      </header>

      <KpiStrip>
        <Kpi label={t('reach')} kpi={a.kpis.reach} format={fmtCompact} />
        <Kpi label={t('views')} kpi={a.kpis.views} format={fmtCompact} />
        <Kpi label={t('profile_views')} kpi={a.kpis.profileViews} format={fmtCompact} />
        <Kpi label={t('er')} kpi={a.kpis.er} format={(v) => fmtPct(v, 2)} tip={t('er_formula')} />
        <Kpi label={t('save_rate')} kpi={a.kpis.saveRate} format={(v) => fmtPct(v, 2)} tip={t('save_rate_formula')} />
        <Kpi label={t('new_followers')} kpi={a.kpis.newFollowers} format={(v) => (v == null ? '—' : (v >= 0 ? '+' : '') + fmtNum(v))} />
      </KpiStrip>
      <OrgPaidStrip igId={acc.igId} organicReach={a.kpis.reach.value ?? 0} organicViews={a.kpis.views.value ?? 0} />
      {a.paid && <PaidStrip paid={a.paid} />}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-12 xl:col-span-8">
            <ChartWrapper id={`reach-${acc.igId}`} title={t('chart_reach_engaged')} height={280}>
              <TimeSeries data={a.series} prevLookup={prevLookup} series={[{ key: 'reach', name: t('reach'), color: '#4F7CFF', type: 'area' }, { key: 'accounts_engaged', name: t('engaged'), color: '#3FBF8F', axis: 'right' }]} />
            </ChartWrapper>
          </div>
          <div className="col-span-12 xl:col-span-4">
            <ChartWrapper id={`followers-${acc.igId}`} title={t('chart_followers')} height={280}>
              <TimeSeries data={a.followerSeries} legend={false} series={[{ key: 'followers', name: t('followers'), color: acc.color ?? '#C06CE8' }]} />
            </ChartWrapper>
          </div>
          <div className="col-span-12 xl:col-span-7"><BestTimePanel igId={acc.igId} /></div>
          <div className="col-span-12 xl:col-span-5">
            <Section title={t('content_types')} right={<ExcelButton name="content-types" getData={() => ({ name: t('content_types'), columns: [{ key: 'type', label: t('type'), type: 'text' }, { key: 'posts', label: t('posts'), type: 'int' }, { key: 'avgReach', label: t('reach'), type: 'int' }, { key: 'avgLikes', label: t('likes'), type: 'int' }, { key: 'avgComments', label: t('comments'), type: 'int' }, { key: 'avgSaved', label: t('saved'), type: 'int' }, { key: 'avgEr', label: t('er_short'), type: 'percent' }], rows: a.byType.map((r) => ({ ...r, type: mediaTypeLabel({ mediaProductType: r.productType, mediaType: r.mediaType }, lang) })) })} />}>
              <table className="table -m-4 w-[calc(100%+2rem)]">
                <thead><tr><th>{t('type')}</th><th className="num">{t('posts')}</th><th className="num">{t('reach')}</th><th className="num">{t('likes')}</th><th className="num">{t('saved')}</th><th className="num">{t('er_short')}</th></tr></thead>
                <tbody>{a.byType.map((r) => <tr key={r.productType + r.mediaType}><td>{mediaTypeLabel({ mediaProductType: r.productType, mediaType: r.mediaType }, lang)}</td><td className="num">{r.posts}</td><td className="num">{fmtNum(r.avgReach)}</td><td className="num">{fmtNum(r.avgLikes)}</td><td className="num">{fmtNum(r.avgSaved)}</td><td className="num">{fmtPct(r.avgEr, 2)}</td></tr>)}
                {!a.byType.length && <tr><td colSpan={6} className="text-ink-2 text-center">{t('no_posts')}</td></tr>}</tbody>
              </table>
              <div className="text-xs text-ink-2 mt-4">{t('per_post_avg_note')}</div>
            </Section>
            <div className="mt-5"><LifecyclePanel igId={acc.igId} /></div>
          </div>
          {a.health && (
            <div className="col-span-12">{(() => { const h = a.health!; return (
              <Section title={<span>{t('health_score')} <InfoTip text={t('health_formula')} /></span>}>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  {(['growth', 'engagement', 'consistency', 'response'] as const).map((k) => (
                    <div key={k}><div className="text-ink-2 text-xs">{k === 'growth' ? t('growth') : k === 'engagement' ? t('er') : k === 'consistency' ? t('consistency') : t('response_rate')}</div>
                      <div className="flex items-baseline gap-2 num"><span className="text-lg font-semibold">{h.components[k].pct}</span><span className="text-ink-2 text-xs">pct · {k === 'consistency' ? `σ ${h.components[k].raw}` : fmtPct(h.components[k].raw, 2)}</span></div>
                      <div className="h-1.5 bg-surface-2 rounded mt-1"><div className="h-full bg-accent rounded" style={{ width: `${h.components[k].pct}%` }} /></div></div>
                  ))}
                </div>
                {a.comments && <div className="text-xs text-ink-2 mt-3 num">{t('comments')}: {fmtNum(a.comments.incoming)} · {t('response_rate')}: {a.comments.incoming ? fmtPct((a.comments.answered / a.comments.incoming) * 100, 0) : '—'} · {t('avg_reply')}: {a.comments.avgLatency != null ? `${Math.round(a.comments.avgLatency)} ${t('min_short')}` : '—'}</div>}
              </Section>
            ); })()}</div>
          )}
        </div>
      )}
      {tab === 'posts' && <PostsPanel posts={a.posts} igId={acc.igId} />}
      {tab === 'stories' && <StoriesPanel igId={acc.igId} />}
      {tab === 'demographics' && <DemographicsPanel igId={acc.igId} />}
      {tab === 'competitors' && <CompetitorPanel igId={acc.igId} />}
      {tab === 'ads' && <AdsPanel igId={acc.igId} />}
    </div>
  );
}

function OrgPaidStrip({ igId, organicReach, organicViews }: { igId: string; organicReach: number; organicViews: number }) {
  const t = useT();
  const q = useBlended(igId);
  const b = q.data;
  if (!b?.adAccount) return null;
  const cur = b.adAccount.currency;
  const paidReach = b.totals.paidReach; const paidImp = b.totals.impressions;
  const cell = (label: string, org: number, paid: number) => <div><div className="text-ink-2 text-sm flex items-center">{label} <InfoTip text={t('impressions_note')} /></div><div className="flex items-baseline gap-3 num mt-0.5"><span><span className="text-xs text-ink-2">{t('organic')} </span><span className="text-lg font-semibold">{fmtCompact(org)}</span></span><span><span className="text-xs text-ink-2">{t('paid')} </span><span className="text-lg font-semibold">{fmtCompact(paid)}</span></span><span><span className="text-xs text-ink-2">{t('total')} </span><span className="text-lg font-semibold">{fmtCompact(org + paid)}</span></span><span className="text-xs text-ink-2">{org + paid > 0 ? `${t('paid_share_short')} ${fmtPct((paid / (org + paid)) * 100, 0)}` : ''}</span></div></div>;
  return (
    <KpiStrip>
      {cell(t('reach'), organicReach, paidReach)}
      {cell(t('impressions'), organicViews, paidImp)}
      <div><div className="text-ink-2 text-sm">{t('ad_spend')}</div><div className="flex items-baseline gap-3 num mt-0.5"><span className="text-lg font-semibold">{fmtMoney(b.totals.spend, cur)}</span><span className="text-xs text-ink-2">{fmtNum(b.totals.results)} {t('results').toLowerCase()} · {b.totals.costPerResult != null ? fmtMoney(b.totals.costPerResult, cur, 2) : '—'}</span><Delta value={b.totals.spendChangePct} /></div></div>
    </KpiStrip>
  );
}

function PaidStrip({ paid }: { paid: NonNullable<AccountAnalyticsPaid> }) {
  const t = useT();
  return (
    <Section title={`${t('ad_metrics')} · ${paid.name}`}>
      <AdMetricGrid row={paid} scope="account" cols={7} />
    </Section>
  );
}
type AccountAnalyticsPaid = import('@/lib/types').AccountAnalytics['paid'];

function BestTimePanel({ igId }: { igId: string }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const period = useAppStore((s) => s.period);
  const range = useMemo(() => ({ from: period.from < daysAgo(89) ? period.from : daysAgo(89), to: period.to }), [period]);
  const q = useBestTime(igId, range);
  return (
    <ChartWrapper id={`besttime-${igId}`} title={<span>{t('best_time')} <InfoTip text={t('min_posts_note', { n: q.data?.minPosts ?? 3 })} /></span>} height={300} right={<span className="text-xs text-ink-2">{fmtDate(range.from)} – {fmtDate(range.to)} · {q.data?.totalPosts ?? 0} {t('posts').toLowerCase()}</span>}>
      {q.data ? (
        <div>
          <Heatmap matrix={q.data.matrix} minPosts={q.data.minPosts} />
          <div className="flex gap-4 text-xs text-ink-2 mt-2">{q.data.best.map((b) => <span key={b.weekday + '-' + b.hour} className="num">#{q.data!.best.indexOf(b) + 1} {WEEKDAYS[lang][b.weekday]} {b.hour}:00 · ER {fmtPct(b.value, 2)}</span>)}{!q.data.best.length && <span>{t('min_posts_note', { n: q.data.minPosts })}</span>}</div>
        </div>
      ) : <Loading />}
    </ChartWrapper>
  );
}

function LifecyclePanel({ igId }: { igId: string }) {
  const t = useT();
  const period = useAppStore((s) => s.period);
  const range = useMemo(() => ({ from: period.from < daysAgo(89) ? period.from : daysAgo(89), to: period.to }), [period]);
  const q = useLifecycle(igId, range);
  return (
    <ChartWrapper id={`lifecycle-${igId}`} title={<span>{t('lifecycle')} <InfoTip text={t('lifecycle_hint')} /></span>} height={240} right={q.data?.hoursTo80 != null ? <span className="text-xs text-ink-2 num">{t('hours_to_80')} <strong className="text-ink-1">{q.data.hoursTo80} {t('hours')}</strong></span> : null}>
      {q.data ? (q.data.curve.length ? <LifecycleChart curve={q.data.curve} hoursTo80={q.data.hoursTo80} /> : <div className="text-ink-2 text-sm p-4">{t('no_data')}</div>) : <Loading />}
    </ChartWrapper>
  );
}

function PostsPanel({ posts, igId }: { posts: Media[]; igId: string }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const [view, setView] = useState<'grid' | 'table' | 'analysis'>('grid');
  const [sort, setSort] = useState<'reach' | 'er' | 'saved' | 'date'>('reach');
  const [typeKeys, setTypeKeys] = useState<TypeKey[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const analysis = useContentAnalysis({ igIds: [igId], typeKeys: typeKeys.length ? typeKeys : undefined }, true);
  const filtered = useMemo(() => posts.filter((p) => {
    if (!typeKeys.length) return true;
    const key = p.mediaProductType === 'REELS' ? 'reels' : p.mediaType === 'CAROUSEL_ALBUM' ? 'carousel' : p.mediaType === 'VIDEO' ? 'video' : 'image';
    return typeKeys.includes(key as TypeKey);
  }), [posts, typeKeys]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    if (sort === 'date') return b.postedAt - a.postedAt;
    if (sort === 'er') return (b.engagementRate ?? 0) - (a.engagementRate ?? 0);
    return ((b[sort] as number) ?? 0) - ((a[sort] as number) ?? 0);
  }), [filtered, sort]);
  const recent = analysis.data?.recent ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex gap-1"><button className={`chip ${view === 'grid' ? 'active' : ''}`} onClick={() => setView('grid')}>{t('grid')}</button><button className={`chip ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')}>{t('table')}</button><button className={`chip ${view === 'analysis' ? 'active' : ''}`} onClick={() => setView('analysis')}>{t('analysis')}</button></div>
          <span className="w-px h-5 bg-line" />
          <TypeFilter value={typeKeys} onChange={setTypeKeys} />
        </div>
        {view !== 'analysis' && (
          <div className="flex items-center gap-2 text-xs text-ink-2"><ExcelButton name="posts" getData={() => mediaSheet(t('posts'), sorted, { account: false })} />{t('sort_by')}
            {(['reach', 'er', 'saved', 'date'] as const).map((s) => <button key={s} className={`chip ${sort === s ? 'active' : ''}`} onClick={() => setSort(s)}>{s === 'reach' ? t('reach') : s === 'er' ? t('er_short') : s === 'saved' ? t('saved') : t('date')}</button>)}
          </div>
        )}
      </div>

      {view !== 'analysis' && recent.length > 0 && (
        <Section title={`${t('this_week')} · ${recent.length}`} right={<><span className="text-xs text-ink-2">{t('recent_posts_hint', { d: analysis.data?.period.recentDays ?? 7 })}</span><ExcelButton name="this-week" getData={() => mediaSheet(t('this_week'), recent, { account: false, deltas: true })} /></>}>
          <div className="-m-4"><RecentPostsTable rows={recent} onOpen={setOpen} showAccount={false} maxHeight={260} /></div>
        </Section>
      )}

      {view === 'analysis' && (analysis.isLoading ? <Loading /> : analysis.data && <ContentAnalysisView data={analysis.data} onOpen={setOpen} showAccount={false} />)}
      {view === 'grid' && (sorted.length ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6 gap-3">{sorted.map((m) => <PostCard key={m.mediaId} m={m} onOpen={setOpen} />)}</div>
      ) : <EmptyState title={t('no_posts')} />)}
      {view === 'table' && (
        <div className="panel overflow-auto">
          <table className="table">
            <thead><tr><th></th><th>{t('date')}</th><th>{t('type')}</th><th>{t('caption')}</th><th className="num">{t('reach')}</th><th className="num">{t('views')}</th><th className="num">{t('likes')}</th><th className="num">{t('comments')}</th><th className="num">{t('saved')}</th><th className="num">{t('shares')}</th><th className="num">{t('er_short')}</th><th className="num">{t('save_rate')}</th><th className="num" title={t('impressions_note')}>{t('total_reach')}</th><AdMetricHeaders scope="post" /></tr></thead>
            <tbody>{sorted.map((m) => (
              <tr key={m.mediaId} className={`clickable ${open === m.mediaId ? 'selected' : ''}`} onClick={() => setOpen(m.mediaId)}>
                <td><PostThumb mediaId={m.mediaId} thumbnailPath={m.thumbnailPath} mediaType={m.mediaType} mediaProductType={m.mediaProductType} size={28} /></td>
                <td>{fmtDateTime(m.postedAt)}</td><td>{mediaTypeLabel(m, lang)}</td><td className="max-w-[320px] truncate" title={m.caption ?? ''}>{m.caption}</td>
                <td className="num">{fmtNum(m.reach)}</td><td className="num">{fmtNum(m.views)}</td><td className="num">{fmtNum(m.likes)}</td><td className="num">{fmtNum(m.comments)}</td><td className="num">{fmtNum(m.saved)}</td><td className="num">{fmtNum(m.shares)}</td><td className="num">{fmtPct(m.engagementRate, 2)}</td><td className="num">{fmtPct(m.saveRate, 2)}</td><td className="num"><div className="leading-tight">{fmtNum(m.totalReach)}<div className="text-xs text-ink-2">{m.paidReach ? `${t('paid_share_short')} ${fmtPct(m.paidReachShare, 0)}` : t('organic')}</div></div></td><AdMetricCells row={m} scope="post" />
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={27} className="text-center text-ink-2" style={{ height: 64 }}>{t('no_posts')}</td></tr>}</tbody>
          </table>
        </div>
      )}
      <PostDrawer mediaId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function StoriesPanel({ igId }: { igId: string }) {
  const t = useT();
  const q = useStories(igId);
  if (q.isLoading) return <Loading />;
  const s = q.data;
  if (!s || !s.summary?.count) return <EmptyState title={t('no_data')} hint={t('story_hint')} />;
  const series = [...s.stories].reverse().map((st) => ({ date: fmtDateTime(st.postedAt), views: st.views, completion: st.completionRate != null ? Math.round(st.completionRate * 100) : null }));
  return (
    <div className="space-y-5">
      <KpiStrip>
        <Kpi label={t('stories')} kpi={{ value: s.summary.count, changePct: null }} />
        <Kpi label={t('views')} kpi={{ value: s.summary.avgViews, changePct: null }} format={(v) => fmtNum(v)} />
        <Kpi label={t('reach')} kpi={{ value: s.summary.avgReach, changePct: null }} format={(v) => fmtNum(v)} />
        <Kpi label={t('story_completion')} kpi={{ value: (s.summary.avgCompletion ?? 0) * 100, changePct: null }} format={(v) => fmtPct(v, 1)} tip={t('story_completion_formula')} />
        <Kpi label={t('exit_rate')} kpi={{ value: (s.summary.avgExitRate ?? 0) * 100, changePct: null }} format={(v) => fmtPct(v, 1)} />
        <Kpi label={t('replies')} kpi={{ value: s.summary.replies, changePct: null }} />
      </KpiStrip>
      <ChartWrapper id={`stories-${igId}`} title={t('stories')} height={260}>
        <TimeSeries data={series} series={[{ key: 'views', name: t('views'), color: '#4F7CFF', type: 'bar' }, { key: 'completion', name: t('story_completion'), color: '#3FBF8F', axis: 'right', format: (v) => `${v}%` }]} rightFormat={(v) => `${v}%`} />
      </ChartWrapper>
      <div className="flex justify-end"><ExcelButton name="story" getData={() => ({ name: t('stories'), columns: [{ key: 'postedAt', label: t('date'), type: 'datetime' }, { key: 'mediaType', label: t('type'), type: 'text' }, { key: 'reach', label: t('reach'), type: 'int' }, { key: 'views', label: t('views'), type: 'int' }, { key: 'replies', label: t('replies'), type: 'int' }, { key: 'navForward', label: t('story_forward'), type: 'int' }, { key: 'navBack', label: t('back'), type: 'int' }, { key: 'navExit', label: t('story_exit'), type: 'int' }, { key: 'completionPct', label: t('story_completion'), type: 'percent' }], rows: s.stories.map((st) => ({ ...st, completionPct: st.completionRate != null ? st.completionRate * 100 : null })) })} /></div>
      <div className="panel overflow-auto max-h-96">
        <table className="table"><thead><tr><th>{t('date')}</th><th>{t('type')}</th><th className="num">{t('reach')}</th><th className="num">{t('views')}</th><th className="num">{t('replies')}</th><th className="num">{t('story_forward')}</th><th className="num">{t('back')}</th><th className="num">{t('story_exit')}</th><th className="num">{t('story_completion')}</th></tr></thead>
          <tbody>{s.stories.map((st) => <tr key={st.storyId}><td>{fmtDateTime(st.postedAt)}</td><td>{st.mediaType}</td><td className="num">{fmtNum(st.reach)}</td><td className="num">{fmtNum(st.views)}</td><td className="num">{fmtNum(st.replies)}</td><td className="num">{fmtNum(st.navForward)}</td><td className="num">{fmtNum(st.navBack)}</td><td className="num">{fmtNum(st.navExit)}</td><td className="num">{st.completionRate != null ? fmtPct(st.completionRate * 100, 0) : '—'}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function DemographicsPanel({ igId }: { igId: string }) {
  const t = useT();
  const q = useDemographics(igId);
  if (q.isLoading) return <Loading />;
  const d = q.data;
  if (!d || !d.capturedAt) return <EmptyState title={t('no_data')} hint={t('demographics_hint')} />;
  const ga = d.genderAge.reduce<Record<string, { F: number; M: number; U: number }>>((acc, b) => {
    const [g, age] = b.bucket.split('.');
    acc[age] = acc[age] ?? { F: 0, M: 0, U: 0 };
    acc[age][g as 'F' | 'M' | 'U'] += b.value;
    return acc;
  }, {});
  const ages = Object.keys(ga).sort();
  const gaMax = Math.max(1, ...ages.flatMap((a) => [ga[a].F, ga[a].M]));
  return (
    <div className="grid grid-cols-12 gap-5">
      <Section title={t('city')} className="col-span-12 lg:col-span-4"><BarList items={d.city.slice(0, 10).map((c) => ({ label: c.bucket, value: c.value }))} /></Section>
      <Section title={t('gender_age')} className="col-span-12 lg:col-span-5" right={<span className="text-xs text-ink-2"><span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: '#C06CE8' }} />{t('female')} <span className="inline-block w-2 h-2 rounded-sm mr-1 ml-2" style={{ background: '#4F7CFF' }} />{t('male')}</span>}>
        <div className="space-y-1.5">{ages.map((a) => (
          <div key={a} className="flex items-center gap-2 text-xs num"><div className="w-12 text-ink-2">{a}</div>
            <div className="flex-1 flex justify-end"><div className="h-4 rounded-l-sm" style={{ width: `${(ga[a].F / gaMax) * 100}%`, background: '#C06CE8' }} /></div><div className="w-12 text-right">{fmtCompact(ga[a].F)}</div>
            <div className="flex-1"><div className="h-4 rounded-r-sm" style={{ width: `${(ga[a].M / gaMax) * 100}%`, background: '#4F7CFF' }} /></div><div className="w-12">{fmtCompact(ga[a].M)}</div></div>
        ))}</div>
      </Section>
      <Section title={t('country')} className="col-span-12 lg:col-span-3"><BarList items={d.country.slice(0, 8).map((c) => ({ label: c.bucket, value: c.value }))} color="#3FBF8F" /></Section>
      <div className="col-span-12 text-xs text-ink-2">{fmtDateTime(d.capturedAt)} tarihli veri.</div>
    </div>
  );
}

function CompetitorPanel({ igId }: { igId: string }) {
  const t = useT();
  const q = useCompetitorCompare(igId);
  if (q.isLoading) return <Loading />;
  if (!q.data) return null;
  const rows = q.data.rows;
  const dates = rows[0]?.series.map((s) => s.date) ?? [];
  const merged = dates.map((date, i) => Object.fromEntries([['date', date], ...rows.map((r) => [r.username, r.series[i]?.followers ?? null])]));
  return (
    <div className="space-y-4">
      <div className="text-xs text-ink-2 flex items-center gap-1"><Icon.warn /> {t('competitor_note')} <Link to="/competitors" className="ml-2">{t('add_competitor')} →</Link></div>
      {rows.length > 1 ? (
        <>
          <ChartWrapper id={`competitors-${igId}`} title={t('followers')} height={260}><CompareChart merged={merged} series={rows.map((r) => ({ igId: r.username, username: r.username, color: r.color }))} /></ChartWrapper>
          <div className="flex justify-end"><ExcelButton name="competitors" getData={() => ({ name: t('competitors'), columns: [{ key: 'username', label: t('username'), type: 'text' }, { key: 'followers', label: t('followers'), type: 'int' }, { key: 'growth', label: t('growth'), type: 'int' }, { key: 'growthPct', label: `${t('growth')} %`, type: 'percent' }, { key: 'postsPerWeek', label: t('posts_per_week'), type: 'float' }, { key: 'avgLikes', label: t('avg_likes'), type: 'int' }, { key: 'avgComments', label: t('avg_comments'), type: 'int' }], rows })} /></div>
          <div className="panel overflow-auto"><table className="table"><thead><tr><th>{t('username')}</th><th className="num">{t('followers')}</th><th className="num">{t('growth')}</th><th className="num">{t('posts_per_week')}</th><th className="num">{t('avg_likes')}</th><th className="num">{t('avg_comments')}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.username} className={r.isOwn ? 'selected' : ''}><td><span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: r.color }} />@{r.username}{r.isOwn && <span className="badge badge-muted ml-2">{t('you')}</span>}</td><td className="num">{fmtNum(r.followers)}</td><td className="num"><Delta value={r.growthPct} /> <span className="text-ink-2">{r.growth != null ? (r.growth >= 0 ? '+' : '') + fmtNum(r.growth) : ''}</span></td><td className="num">{r.postsPerWeek ?? '—'}</td><td className="num">{fmtNum(r.avgLikes)}</td><td className="num">{fmtNum(r.avgComments)}</td></tr>)}</tbody></table></div>
        </>
      ) : <EmptyState title={t('none')} hint={t('competitor_note')} action={<Link to="/competitors" className="btn btn-primary">{t('add_competitor')}</Link>} />}
    </div>
  );
}

function AdsPanel({ igId }: { igId: string }) {
  const t = useT();
  const q = useBlended(igId);
  if (q.isLoading) return <Loading />;
  const b = q.data;
  if (!b?.adAccount) return <EmptyState title={t('no_ad_account')} action={<Link to="/settings#ads" className="btn">{t('settings')}</Link>} />;
  const cur = b.adAccount.currency;
  return (
    <div className="space-y-5">
      <KpiStrip>
        <Kpi label={t('spend')} kpi={{ value: b.totals.spend, changePct: b.totals.spendChangePct }} format={(v) => fmtMoney(v, cur)} />
        <Kpi label={`${t('reach')} (organik)`} kpi={{ value: b.totals.organicReach, changePct: null }} format={fmtCompact} />
        <Kpi label={`${t('reach')} (reklam)`} kpi={{ value: b.totals.paidReach, changePct: b.totals.paidReachChangePct }} format={fmtCompact} />
        <Kpi label={t('paid_share_short')} kpi={{ value: b.totals.paidShare, changePct: null }} format={(v) => fmtPct(v, 1)} tip={t('paid_share_formula')} />
        <Kpi label="CPM" kpi={{ value: b.totals.cpm, changePct: null }} format={(v) => fmtMoney(v, cur, 2)} />
        <Kpi label={t('cost_per_result')} kpi={{ value: b.totals.costPerResult, changePct: null }} format={(v) => fmtMoney(v, cur, 2)} />
      </KpiStrip>
      <ChartWrapper id={`blended-${igId}`} title={`${t('blended')} · ${b.adAccount.name}`} height={300}>
        <TimeSeries data={b.series} rightFormat={(v) => fmtMoney(v, cur)} series={[{ key: 'organicReach', name: `${t('reach')} (organik)`, color: '#4F7CFF', type: 'area' }, { key: 'paidReach', name: `${t('reach')} (reklam)`, color: '#C06CE8', type: 'area' }, { key: 'spend', name: t('spend'), color: '#E8B44A', type: 'bar', axis: 'right', format: (v) => fmtMoney(v, cur) }]} />
      </ChartWrapper>
      <div className="text-right"><Link to="/ads" className="btn">{t('ads')} →</Link></div>
    </div>
  );
}

