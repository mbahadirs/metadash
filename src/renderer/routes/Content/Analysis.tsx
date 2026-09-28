import { useT } from '@/lib/i18n';
import { fmtNum, fmtPct, fmtCompact, fmtMoney } from '@/lib/format';
import type { ContentAnalysis as CA, TypeKey } from '@/lib/types';
import { Section, Kpi, KpiStrip, EmptyState } from '@/components/ui';
import { RecentPostsTable } from '@/components/RecentPostsTable';
import { PostCard } from '@/components/PostCard';
import { typeLabel } from '@/components/TypeFilter';
import { BarList } from '@/charts/BarList';
import { ExcelButton } from '@/components/ExcelButton';
import { mediaSheet } from '@/lib/xlsx';

/** Content analysis view: type breakdown, this-week table, hashtag performance, top posts. */
export function ContentAnalysisView({ data, onOpen, showAccount = true, compact = false }: { data: CA; onOpen: (id: string) => void; showAccount?: boolean; compact?: boolean }) {
  const t = useT();
  const s = data.summary;
  const cur = s.currency ?? 'USD';
  if (!s.posts) return <EmptyState title={t('no_posts')} />;
  const totalReach = Math.max(1, s.reach);
  return (
    <div className="space-y-5">
      {!compact && (
        <KpiStrip>
          <Kpi label={t('posts')} kpi={{ value: s.posts, changePct: null }} />
          <Kpi label={t('reach')} kpi={{ value: s.reach, changePct: null }} format={fmtCompact} />
          <Kpi label={t('avg_reach')} kpi={{ value: s.avgReach, changePct: null }} format={fmtCompact} />
          <Kpi label={t('avg_er')} kpi={{ value: s.avgEr, changePct: null }} format={(v) => fmtPct(v, 2)} />
          <Kpi label={t('save_rate')} kpi={{ value: s.avgSaveRate, changePct: null }} format={(v) => fmtPct(v, 2)} />
          <Kpi label={t('paid_posts')} kpi={{ value: s.paidPosts, changePct: null }} />
          <Kpi label={t('ad_spend')} kpi={{ value: s.totalSpend, changePct: null }} format={(v) => fmtMoney(v, cur)} tip={Object.entries(s.spendByCurrency ?? {}).map(([c, v]) => `${c}: ${fmtNum(v)}`).join(' · ') || undefined} />
        </KpiStrip>
      )}

      <Section title={`${t('this_week')} · ${data.recent.length}`} right={<><span className="text-xs text-ink-2">{t('recent_posts_hint', { d: data.period.recentDays })}</span><ExcelButton name="this-week" getData={() => mediaSheet(t('this_week'), data.recent, { account: showAccount, deltas: true })} /></>}>
        <div className="-m-4"><RecentPostsTable rows={data.recent} onOpen={onOpen} showAccount={showAccount} maxHeight={compact ? 300 : 420} /></div>
      </Section>

      <div className="grid grid-cols-12 gap-5">
        <Section className="col-span-12 xl:col-span-7" title={t('type_breakdown')} right={<ExcelButton name="type-breakdown" getData={() => ({ name: t('type_breakdown'), columns: [{ key: 'type', label: t('type'), type: 'text' }, { key: 'posts', label: t('posts'), type: 'int' }, { key: 'totalReach', label: t('reach'), type: 'int' }, { key: 'avgReach', label: t('avg_reach'), type: 'int' }, { key: 'avgViews', label: t('avg_views'), type: 'int' }, { key: 'avgLikes', label: t('likes'), type: 'int' }, { key: 'avgSaved', label: t('avg_saved'), type: 'int' }, { key: 'avgShares', label: t('shares'), type: 'int' }, { key: 'avgEr', label: t('avg_er'), type: 'percent' }, { key: 'avgSaveRate', label: t('save_rate'), type: 'percent' }, { key: 'spend', label: t('ad_spend'), type: 'money' }, { key: 'paidPosts', label: t('paid_posts'), type: 'int' }], rows: data.types.map((ty) => ({ ...ty, type: typeLabel(ty.typeKey as TypeKey, t) })) })} />}>
          <div className="-m-4 overflow-auto"><table className="table">
            <thead><tr><th>{t('type')}</th><th className="num">{t('posts')}</th><th className="num" title={t('reach_share_hint')}>{t('reach')} %</th><th className="num">{t('avg_reach')}</th><th className="num">{t('avg_views')}</th><th className="num">{t('likes')}</th><th className="num">{t('avg_saved')}</th><th className="num">{t('shares')}</th><th className="num">{t('avg_er')}</th><th className="num">{t('save_rate')}</th><th className="num">{t('ad_spend')}</th></tr></thead>
            <tbody>{data.types.map((ty) => (
              <tr key={ty.typeKey}><td>{typeLabel(ty.typeKey as TypeKey, t)}</td><td className="num">{ty.posts}</td>
                <td className="num"><div className="flex items-center justify-end gap-2"><div className="w-16 h-1.5 bg-surface-2 rounded overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(ty.totalReach / totalReach) * 100}%` }} /></div>{fmtPct((ty.totalReach / totalReach) * 100, 0)}</div></td>
                <td className="num">{fmtNum(ty.avgReach)}</td><td className="num">{fmtNum(ty.avgViews)}</td><td className="num">{fmtNum(ty.avgLikes)}</td><td className="num">{fmtNum(ty.avgSaved)}</td><td className="num">{fmtNum(ty.avgShares)}</td><td className="num">{fmtPct(ty.avgEr, 2)}</td><td className="num">{fmtPct(ty.avgSaveRate, 2)}</td><td className="num">{ty.spend ? `${fmtMoney(ty.spend, cur)} · ${ty.paidPosts}` : <span className="text-ink-2">—</span>}</td></tr>
            ))}</tbody>
          </table></div>
        </Section>
        <Section className="col-span-12 xl:col-span-5" title={t('hashtag_perf')} right={<><span className="text-xs text-ink-2">{t('avg_reach')}</span><ExcelButton name="hashtag" getData={() => ({ name: t('hashtag_perf'), columns: [{ key: 'tag', label: t('hashtag'), type: 'text' }, { key: 'posts', label: t('usage'), type: 'int' }, { key: 'avgReach', label: t('avg_reach'), type: 'int' }, { key: 'avgEr', label: t('avg_er'), type: 'percent' }, { key: 'avgSaved', label: t('avg_saved'), type: 'int' }], rows: data.hashtags })} /></>}>
          {data.hashtags.length ? (
            <div className="-m-4 overflow-auto max-h-80"><table className="table">
              <thead><tr><th>{t('hashtag')}</th><th className="num">{t('usage')}</th><th className="num">{t('avg_reach')}</th><th className="num">{t('avg_er')}</th><th className="num">{t('avg_saved')}</th></tr></thead>
              <tbody>{data.hashtags.map((h) => <tr key={h.tag}><td>{h.tag}</td><td className="num">{h.posts}</td><td className="num">{fmtNum(h.avgReach)}</td><td className="num">{fmtPct(h.avgEr, 2)}</td><td className="num">{fmtNum(h.avgSaved)}</td></tr>)}</tbody>
            </table></div>
          ) : <div className="text-ink-2 text-sm">{t('no_data')}</div>}
        </Section>
      </div>

      {!compact && (
        <div className="grid grid-cols-12 gap-5">
          <Section className="col-span-12 xl:col-span-8" title={t('top_posts')}>
            <div className="grid grid-cols-3 xl:grid-cols-6 gap-3">{data.top.map((m) => <PostCard key={m.mediaId} m={m} onOpen={onOpen} showAccount={showAccount} />)}</div>
          </Section>
          <Section className="col-span-12 xl:col-span-4" title={t('top_saved')}>
            <BarList items={data.topSaved.map((m) => ({ label: `@${m.username} · ${(m.caption ?? '').slice(0, 24)}`, value: m.saveRate ?? 0 }))} format={(v) => fmtPct(v, 2)} color="#3FBF8F" />
          </Section>
        </div>
      )}
    </div>
  );
}
