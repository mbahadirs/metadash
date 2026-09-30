import { useEffect, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMediaDetail } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';
import { fmtNum, fmtPct, fmtDateTime, fmtMoney, fmtCompact, WEEKDAYS, fmtDate } from '@/lib/format';
import type { MediaDetail } from '@/lib/types';
import { Loading, Delta, Avatar, InfoTip } from './ui';
import { PostThumb } from './PostThumb';
import { TypeBadge } from './TypeFilter';
import { LifecycleChart } from '@/charts/LifecycleChart';
import { TimeSeries } from '@/charts/TimeSeries';
import { Icon } from './Icons';
import { AdMetricGrid } from './AdMetricCells';
import { usePlatformCaps } from '@/hooks/usePlatforms';
import { PLATFORM_LABELS, platformOf } from '@/lib/platforms';
import { RepurposeButton } from './RepurposeDialog';
import { NotesThread } from './NotesThread';

/** Right-hand slide-over with the full post analysis. Esc closes. */
export function PostDrawer({ mediaId, onClose }: { mediaId: string | null; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    if (!mediaId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mediaId, onClose]);
  if (!mediaId) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal aria-label={t('post_detail')}>
      <div className="flex-1 bg-black/45" onMouseDown={onClose} />
      <aside className="w-[820px] max-w-[92vw] h-full bg-surface-1 border-l border-line shadow-2xl flex flex-col">
        <PostDrawerBody mediaId={mediaId} onClose={onClose} />
      </aside>
    </div>
  );
}

function PostDrawerBody({ mediaId, onClose }: { mediaId: string; onClose: () => void }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const { basket, toggleBasket } = useAppStore();
  const q = useMediaDetail(mediaId);
  const pc = usePlatformCaps();
  const navigate = useNavigate();
  if (q.isLoading || !q.data) return <div className="p-8"><Loading /></div>;
  const d = q.data;
  const m = d.media;
  const inBasket = basket.includes(m.mediaId);
  const bench = d.benchmark;
  const typeName = t(`type_${m.typeKey}` as 'type_image');
  const reachSeries = d.lifecycle.series.reach?.length ? d.lifecycle.series.reach : (d.lifecycle.series.views ?? []); // Threads: no reach, views curve
  const finalReach = reachSeries[reachSeries.length - 1]?.value ?? 0;
  const curve = reachSeries.map((p) => ({ ageHours: p.ageHours, ratio: finalReach ? p.value / finalReach : null }));
  const cur = d.paid?.currency ?? 'USD';

  const platform = platformOf(m);
  const caps = pc.caps(platform);
  const allTiles: { key: keyof MediaDetail['deltas']; label: string; value: string; tip?: string }[] = [
    { key: 'reach', label: platform === 'facebook' ? t('viewers') : t('reach'), value: fmtNum(m.reach), tip: platform === 'facebook' ? t('viewers_tip') : undefined },
    { key: 'views', label: t('views'), value: fmtNum(m.views), tip: m.typeKey === 'reels' ? t('reels_views_tip') : undefined },
    { key: 'likes', label: t('likes'), value: fmtNum(m.likes) },
    { key: 'comments', label: t('comments'), value: fmtNum(m.comments) },
    { key: 'saved', label: t('saved'), value: fmtNum(m.saved) },
    { key: 'shares', label: t('shares'), value: fmtNum(m.shares) },
    { key: 'engagementRate', label: t('er'), value: fmtPct(m.engagementRate, 2), tip: t('er_formula') },
    { key: 'saveRate', label: t('save_rate'), value: fmtPct(m.saveRate, 2), tip: t('save_rate_formula') },
  ];
  // Hide tiles the platform cannot report instead of showing zeros.
  const tiles = allTiles.filter((x) => (x.key !== 'reach' || caps.reach) && ((x.key !== 'saved' && x.key !== 'saveRate') || caps.saveRate));
  const extras = ([['reposts', t('reposts')], ['quotes', t('quotes')], ['clicks', t('clicks')]] as const).filter(([k]) => m[k] != null);
  const openLabel = platform === 'facebook' ? t('open_in_facebook') : platform === 'threads' ? t('open_in_threads') : platform === 'instagram' ? t('open_in_instagram') : t('open_on_platform', { platform: PLATFORM_LABELS[platform] });

  return (
    <>
      <header className="flex items-center gap-3 px-6 h-14 border-b border-line flex-none">
        <Avatar username={m.username} url={m.profilePicUrl} color={m.accountColor} size={28} platform={m.platform} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><Link to={`/account/${m.igId}`} className="font-medium no-underline text-ink-1 hover:text-accent" onClick={onClose}>@{m.username}</Link><TypeBadge typeKey={m.typeKey} />{(m.spend ?? 0) > 0 && <span className="badge badge-warn">{t('ad_spend')}</span>}</div>
          <div className="text-xs text-ink-2 num">{fmtDateTime(m.postedAt)} · {WEEKDAYS[lang][m.postedWeekday]} {m.postedHour}:00</div>
        </div>
        <button className={`btn btn-sm ${inBasket ? 'btn-primary' : ''}`} onClick={() => toggleBasket(m.mediaId)}>{inBasket ? '✓ ' : '+ '}{t('report_basket')}</button>
        {m.permalink && <button className="btn btn-sm" onClick={() => api.system.openExternal(m.permalink!)}>{openLabel} <Icon.external /></button>}
        <button className="btn btn-sm" title={t('pl_duplicate_as_draft')} aria-label={t('pl_duplicate_as_draft')} onClick={() => { onClose(); navigate('/planner?post=new', { state: { draft: { caption: m.caption ?? '', accountIds: [m.igId] } } }); }}><Icon.calendar /></button>
        <RepurposeButton source={{ mediaId: m.mediaId }} sourceAccountIds={[m.igId]} isVideo={m.typeKey === 'reels' || m.typeKey === 'video'} onCreated={(id) => { onClose(); navigate(`/planner?post=${id}`); }} />
        <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('close')}>✕</button>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="p-6 space-y-6">
          <section className="grid grid-cols-12 gap-5">
            <div className="col-span-4">
              <div className="aspect-[4/5] w-full"><PostThumb mediaId={m.mediaId} thumbnailPath={m.thumbnailPath} mediaType={m.mediaType} mediaProductType={m.mediaProductType} size="100%" rounded={8} /></div>
            </div>
            <div className="col-span-8 min-w-0">
              <p className="text-sm whitespace-pre-wrap m-0 max-h-40 overflow-auto leading-relaxed">{m.caption || <span className="text-ink-2">—</span>}</p>
              <div className="flex flex-wrap gap-1.5 mt-3 text-xs text-ink-2 num">
                <span className="badge badge-muted">{m.captionLength} karakter</span><span className="badge badge-muted">{m.hashtagCount} hashtag</span><span className="badge badge-muted">{m.mentionCount} mention</span><span className="badge badge-muted">{m.emojiCount} emoji</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-4 text-sm">
                <Fact label={t('reach_rank')} value={d.rank.rank != null ? `#${d.rank.rank}` : '—'} sub={t('of_posts', { n: d.rank.total })} />
                {d.slot && <Fact label={t('time_slot')} value={`${WEEKDAYS[lang][d.slot.weekday]} ${d.slot.hour}:00`} sub={d.slot.qualified ? t('slot_vs_best', { v: fmtPct(d.slot.value, 2), b: fmtPct(d.slot.bestValue, 2) }) : `${d.slot.count} ${t('posts').toLowerCase()}`} />}
                <Fact label={t('views_per_reach')} value={d.derived.viewsPerReach != null ? `${d.derived.viewsPerReach}×` : '—'} />
                <Fact label={t('interactions_per_k')} value={fmtNum(d.derived.interactionsPerThousandReach, 1)} />
                <Fact label={t('comment_rate')} value={fmtPct(d.derived.commentRate, 2)} />
                <Fact label={t('share_rate')} value={fmtPct(d.derived.shareRate, 2)} />
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>{t('org_paid_total')} <InfoTip text={t('impressions_note')} /></SectionTitle>
            <div className="panel overflow-hidden"><table className="table"><thead><tr><th></th><th className="num">{t('organic')}</th><th className="num">{t('paid')}</th><th className="num">{t('total')}</th><th className="num">{t('paid_share_short')}</th></tr></thead><tbody>
              <tr><td className="text-ink-2">{t('reach')}</td><td className="num">{fmtNum(m.reach)}</td><td className="num">{fmtNum(m.paidReach)}</td><td className="num font-semibold">{fmtNum(m.totalReach)}</td><td className="num">{fmtPct(m.paidReachShare, 1)}</td></tr>
              <tr><td className="text-ink-2">{t('impressions')}</td><td className="num">{fmtNum(m.views)}</td><td className="num">{fmtNum(m.paidImpressions)}</td><td className="num font-semibold">{fmtNum(m.totalImpressions)}</td><td className="num">{fmtPct(m.paidImpressionShare, 1)}</td></tr>
              <tr><td className="text-ink-2">{t('post_engagement')}</td><td className="num">{fmtNum(m.totalInteractions)}</td><td className="num">{fmtNum(m.paidPostEngagement)}</td><td className="num font-semibold">{fmtNum((m.totalInteractions ?? 0) + (m.paidPostEngagement ?? 0))}</td><td className="num">{(m.totalInteractions ?? 0) + (m.paidPostEngagement ?? 0) > 0 ? fmtPct(((m.paidPostEngagement ?? 0) / ((m.totalInteractions ?? 0) + (m.paidPostEngagement ?? 0))) * 100, 1) : '—'}</td></tr>
              <tr><td className="text-ink-2">{t('results')}</td><td className="num">—</td><td className="num">{fmtNum(m.paidResults)} <span className="text-ink-2 text-xs">{m.paidResultType ?? ''}</span></td><td className="num font-semibold">{fmtNum(m.paidResults)}</td><td className="num">{m.costPerResult != null ? `${fmtMoney(m.costPerResult, m.paidCurrency ?? cur, 2)} / ${t('results').toLowerCase()}` : '—'}</td></tr>
            </tbody></table></div>
          </section>

          <section>
            <SectionTitle>{t('performance')} <span className="text-ink-2 font-normal text-xs ml-2">{bench ? t('vs_account_avg', { n: bench.posts, type: typeName, d: bench.days }) : t('no_benchmark')}</span></SectionTitle>
            {m.ageHours < 48 && <div className="text-xs text-warn mb-2">{t('young_post', { h: m.ageHours })}</div>}
            <div className="grid grid-cols-4 gap-px bg-line rounded-md overflow-hidden border border-line">
              {tiles.map((tile) => (
                <div key={tile.key} className="bg-surface-1 p-3">
                  <div className="text-xs text-ink-2 flex items-center">{tile.label}{tile.tip && <InfoTip text={tile.tip} />}</div>
                  <div className="text-xl font-semibold num leading-tight mt-0.5">{tile.value}</div>
                  <div className="text-xs num mt-0.5 flex items-center gap-1"><Delta value={d.deltas[tile.key]} />{bench && <span className="text-ink-2">{tile.key === 'engagementRate' || tile.key === 'saveRate' ? fmtPct(bench[tile.key], 2) : fmtNum(bench[tile.key])}</span>}</div>
                </div>
              ))}
              {extras.map(([k, label]) => (
                <div key={k} className="bg-surface-1 p-3">
                  <div className="text-xs text-ink-2">{label}</div>
                  <div className="text-xl font-semibold num leading-tight mt-0.5">{fmtNum(m[k])}</div>
                </div>
              ))}
            </div>
            {!caps.saveRate && <div className="text-xs text-ink-2 mt-1">{t('save_rate')}: {t('na_for_platform', { p: PLATFORM_LABELS[platform] })}</div>}
          </section>

          <section className="grid grid-cols-12 gap-5">
            <div className="col-span-7">
              <SectionTitle>{t('lifecycle')} {d.lifecycle.hoursTo80 != null && <span className="text-ink-2 font-normal text-xs ml-2 num">{t('hours_to_80')} {d.lifecycle.hoursTo80} {t('hours')}</span>}</SectionTitle>
              <div className="panel p-2" style={{ height: 200 }} data-chart-id={`media-${m.mediaId}`}>
                {curve.length > 1 ? <LifecycleChart curve={curve} hoursTo80={d.lifecycle.hoursTo80} /> : <div className="text-ink-2 text-xs p-3">{t('not_enough_snapshots', { n: curve.length })}</div>}
              </div>
            </div>
            <div className="col-span-5">
              <SectionTitle>{t('paid_section')}</SectionTitle>
              {d.paid ? (
                <div className="panel p-3 space-y-2 text-sm">
                  <AdMetricGrid row={m} scope="post" cols={2} />
                  <div className="text-xs text-ink-2 num pt-1 border-t border-line">{t('paid_share')}: <strong className="text-ink-1">{fmtPct(d.derived.paidShare, 1)}</strong> · {t('clicks')}: {fmtCompact(d.paid.totals.clicks)}</div>
                </div>
              ) : <div className="panel p-3 text-xs text-ink-2">{t('no_paid')}</div>}
            </div>
          </section>

          {d.paid && (
            <section>
              <SectionTitle>{t('linked_ads')} · {d.paid.ads.length}</SectionTitle>
              <div className="panel" style={{ height: 160 }}>
                <TimeSeries data={d.paid.series} rightFormat={(v) => fmtCompact(v)} legend={false} series={[{ key: 'spend', name: t('spend'), color: '#E8B44A', type: 'bar', format: (v) => fmtMoney(v, cur) }, { key: 'reach', name: t('paid_reach'), color: '#C06CE8', axis: 'right' }]} />
              </div>
              <div className="panel mt-3 overflow-auto max-h-48"><table className="table">
                <thead><tr><th>{t('ads_level')}</th><th>{t('ad_account')}</th><th>{t('date')}</th><th className="num">{t('spend')}</th><th className="num">{t('reach')}</th><th className="num">{t('clicks')}</th><th className="num">CTR</th><th className="num">{t('results')}</th></tr></thead>
                <tbody>{d.paid.ads.map((a) => <tr key={a.adId}><td className="max-w-[200px] truncate">{a.adName ?? a.adId}</td><td className="text-ink-2 max-w-[160px] truncate">{a.accountName}</td><td className="text-ink-2">{a.firstDate ? `${fmtDate(a.firstDate)} – ${fmtDate(a.lastDate)}` : '—'}</td><td className="num">{fmtMoney(a.spend, a.currency)}</td><td className="num">{fmtNum(a.reach)}</td><td className="num">{fmtNum(a.clicks)}</td><td className="num">{fmtPct(a.ctr, 2)}</td><td className="num">{fmtNum(a.results)}</td></tr>)}</tbody>
              </table></div>
            </section>
          )}

          <section>
            <SectionTitle>{t('comments')} · {d.comments.length}</SectionTitle>
            {d.comments.length === 0 ? <div className="text-xs text-ink-2">{t('no_comments')}</div> : (
              <div className="panel divide-y divide-line max-h-72 overflow-auto">
                {d.comments.map((c) => (
                  <div key={c.comment_id} className={`px-3 py-2 text-sm flex gap-3 ${c.parent_id ? 'pl-9 bg-surface-2/40' : ''}`}>
                    <div className="min-w-0 flex-1"><span className={`font-medium ${c.is_from_owner ? 'text-accent' : ''}`}>@{c.username}</span>{c.is_from_owner ? <span className="badge badge-muted ml-2">{t('owner_reply')}</span> : null}<div className="text-ink-1">{c.text}</div></div>
                    <div className="text-xs text-ink-2 num whitespace-nowrap">{fmtDateTime(c.created_at)}{c.like_count ? ` · ♥ ${c.like_count}` : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section><SectionTitle>{t('notes')}</SectionTitle><NotesThread entityType="media" entityId={m.mediaId} /></section>
        </div>
      </div>
    </>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-sm font-semibold m-0 mb-2 flex items-center">{children}</h3>;
}
function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="flex items-baseline justify-between gap-2 border-b border-line py-1"><span className="text-ink-2 text-xs">{label}</span><span className="num text-right"><span className="font-medium">{value}</span>{sub && <span className="text-ink-2 text-xs ml-1">{sub}</span>}</span></div>;
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-ink-2">{label}</div><div className="font-semibold">{value}</div></div>;
}
