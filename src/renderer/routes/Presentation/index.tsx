import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAccounts, useAccountAnalytics, useBestTime, useBlended, useContentAnalysis, useAdInsights, useSettings, useComparePosts } from '@/hooks/queries';
import { useAppStore } from '@/store/app';
import { useT, t as tr, type Key } from '@/lib/i18n';
import { api, call } from '@/lib/api';
import { fmtNum, fmtPct, fmtCompact, fmtMoney, fmtDate, fmtDateTime, WEEKDAYS, locale } from '@/lib/format';
import type { Media, TypeKey } from '@/lib/types';
import { Section, Loading, Delta, Avatar, Toggle } from '@/components/ui';
import { TimeSeries } from '@/charts/TimeSeries';
import { Heatmap } from '@/charts/Heatmap';
import { BarList } from '@/charts/BarList';
import { PostThumb } from '@/components/PostThumb';
import { TypeBadge, typeLabel } from '@/components/TypeFilter';
import { useBranding } from '@/hooks/useBranding';
import { usePlatformCaps } from '@/hooks/usePlatforms';
import { PLATFORM_LABELS, isPlatform, platformOf, typeKeyOf as mediaTypeKey, type AccountAnalyticsV13 } from '@/lib/platforms';
import { accountChart, accountKpiDefs } from '@/lib/accountKpis';
import type { PlatformCapabilities } from '@/lib/types';

const SLIDES = ['cover', 'kpi', 'growth', 'content', 'top', 'spotlight', 'recent', 'hashtags', 'besttime', 'ads', 'campaigns', 'breakdown', 'blended', 'boosted', 'basket', 'next'] as const;
type SlideId = (typeof SLIDES)[number];
const AD_SLIDES: SlideId[] = ['ads', 'campaigns', 'breakdown', 'blended', 'boosted'];

export function PresentationPage() {
  const t = useT();
  const nav = useNavigate();
  const accounts = useAccounts();
  const settings = useSettings();
  const { period } = useAppStore();
  const [igId, setIgId] = useState('');
  const [notes, setNotes] = useState('');
  const [enabled, setEnabled] = useState<Record<SlideId, boolean>>(() => Object.fromEntries(SLIDES.map((s) => [s, true])) as Record<SlideId, boolean>);
  const pc = usePlatformCaps();
  const selected = (accounts.data ?? []).find((a) => a.igId === igId);
  const na = (s: SlideId) => !!selected && !slideSupported(s, pc.caps(platformOf(selected)));
  useEffect(() => {
    const saved = (settings.data as { 'ui.presentationSlides'?: Record<string, boolean>; 'ui.presentationNotes'?: string } | undefined);
    if (saved?.['ui.presentationSlides']) setEnabled((e) => ({ ...e, ...saved['ui.presentationSlides'] }));
    if (saved?.['ui.presentationNotes'] && !notes) setNotes(saved['ui.presentationNotes']);
  }, [settings.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    await call(api.settings.set('ui.presentationSlides', enabled)).catch(() => {});
    await call(api.settings.set('ui.presentationNotes', notes)).catch(() => {});
    const slides = SLIDES.filter((s) => enabled[s] && !na(s)).join(',');
    nav(`/presentation/run?igId=${igId}&slides=${slides}&notes=${encodeURIComponent(notes)}`);
  };
  return (
    <div className="grid grid-cols-12 gap-6 max-w-5xl">
      <div className="col-span-7 space-y-5">
        <Section title={t('nav_presentation')}>
          <div className="space-y-4">
            <label className="block"><div className="text-xs text-ink-2 mb-1">{t('account')}</div>
              <select className="input" value={igId} onChange={(e) => setIgId(e.target.value)}><option value="">—</option>{(accounts.data ?? []).map((a) => <option key={a.igId} value={a.igId}>@{a.username}{a.clientName ? ` · ${a.clientName}` : ''}{platformOf(a) !== 'instagram' ? ` · ${PLATFORM_LABELS[platformOf(a)]}` : ''}</option>)}</select></label>
            <div className="text-xs text-ink-2">{t('date')}: {period.from} – {period.to}</div>
            <label className="block"><div className="text-xs text-ink-2 mb-1">{t('next_steps')}</div><textarea className="input" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('next_steps_placeholder')} /></label>
            <div className="text-xs text-ink-2">{t('presentation_hint')}</div>
            <button className="btn btn-primary" disabled={!igId} onClick={start}>{t('start_presentation')}</button>
          </div>
        </Section>
      </div>
      <div className="col-span-5">
        <Section title={`${t('slides')} · ${SLIDES.filter((s) => enabled[s]).length}/${SLIDES.length}`} right={<button className="btn btn-ghost btn-sm" onClick={() => setEnabled(Object.fromEntries(SLIDES.map((s) => [s, true])) as Record<SlideId, boolean>)}>{t('select_all')}</button>}>
          <div className="space-y-2">{SLIDES.map((s, i) => (
            <div key={s} className="flex items-center gap-3"><span className="w-5 text-xs text-ink-2 num text-right">{i + 1}</span><span className={na(s) ? 'opacity-40 pointer-events-none' : ''} title={na(s) ? t('na_for_platform', { p: PLATFORM_LABELS[platformOf(selected)] }) : undefined}><Toggle checked={enabled[s] && !na(s)} onChange={(v) => setEnabled({ ...enabled, [s]: v })} label={t(`slide_${s}` as Key)} /></span>{AD_SLIDES.includes(s) && <span className="badge badge-muted">{t('ads')}</span>}{na(s) && <span className="text-xs text-ink-2">N/A</span>}</div>
          ))}</div>
        </Section>
      </div>
    </div>
  );
}

export function PresentationRun() {
  const t = useT();
  const nav = useNavigate();
  const lang = useAppStore((s) => s.lang);
  const [params] = useSearchParams();
  const igId = params.get('igId') ?? '';
  const notes = params.get('notes') ?? '';
  const wanted = (params.get('slides') ?? SLIDES.join(',')).split(',') as SlideId[];
  const { period, basket } = useAppStore();
  const basketCmp = useComparePosts(basket.length >= 2 ? basket : basket.length === 1 ? [...basket, ...basket] : []);
  const a = useAccountAnalytics(igId);
  const { branding } = useBranding();
  const bt = useBestTime(igId);
  const bl = useBlended(igId);
  const ca = useContentAnalysis({ igIds: [igId], recentDays: 28 }, !!igId);
  const actId = bl.data?.adAccount?.actId;
  const ads = useAdInsights({ actIds: actId ? [actId] : [], level: 'campaign', breakdowns: ['age', 'gender', 'publisher_platform'] }, !!actId);
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const go = (n: number) => { setDir(n >= i ? 'fwd' : 'back'); setI(n); };
  const pc = usePlatformCaps();
  const ad = a.data as AccountAnalyticsV13 | null | undefined;
  const platform = isPlatform(ad?.platform) ? ad!.platform! : platformOf(ad?.account ?? { igId });
  const caps: PlatformCapabilities = ad?.capabilities ?? pc.caps(platform);
  const hasAds = caps.ads && !!bl.data?.adAccount;
  const slides = useMemo(() => SLIDES.filter((s) => wanted.includes(s) && slideSupported(s, caps) && (hasAds || !AD_SLIDES.includes(s)) && (s !== 'boosted' || (ca.data?.summary.paidPosts ?? 0) > 0) && (s !== 'basket' || basket.length > 0)), [wanted, hasAds, ca.data, basket.length, caps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { setDir('fwd'); setI((x) => Math.min(slides.length - 1, x + 1)); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { setDir('back'); setI((x) => Math.max(0, x - 1)); }
      if (e.key === 'Home') { setDir('back'); setI(0); }
      if (e.key === 'End') { setDir('fwd'); setI(slides.length - 1); }
      if (e.key === 'Escape') { document.exitFullscreen?.().catch(() => {}); nav('/presentation'); }
      if (e.key.toLowerCase() === 'f') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slides.length, nav]);
  if (a.isLoading || !a.data || bl.isLoading || ca.isLoading) return <div className="h-full flex items-center justify-center bg-surface-0"><Loading /></div>;
  const d = a.data as AccountAnalyticsV13;
  const acc = d.account;
  const primary: 'reach' | 'views' = caps.reach ? 'reach' : 'views';
  const kpiDefs = accountKpiDefs(d, platform, caps, t, { posts: true, maxExtra: 0 }).slice(0, 6);
  const chart = accountChart(platform, t);
  const slide = slides[Math.min(i, slides.length - 1)];
  const cur = bl.data?.adAccount?.currency ?? 'USD';
  const top = [...d.posts].sort((x, y) => (y[primary] ?? 0) - (x[primary] ?? 0)).slice(0, 6);

  return (
    <div className="h-full bg-surface-0 flex flex-col select-none" onClick={() => { setDir('fwd'); setI((x) => Math.min(slides.length - 1, x + 1)); }}>
      <div key={`${slide}-${i}`} className={`flex-1 min-h-0 px-16 py-12 flex flex-col max-w-[1500px] w-full mx-auto ${dir === 'fwd' ? 'slide-enter' : 'slide-enter-back'}`}>
        {slide === 'cover' && (
          <Center>{branding && (branding.agencyName || branding.logo) && <div className="flex items-center gap-4 mb-12 pb-4" style={{ borderBottom: `2px solid ${branding.accent}` }}>{branding.logo && <img src={branding.logo} alt="" className="h-12 max-w-[240px] object-contain" />}{branding.agencyName && <span className="text-xl font-semibold">{branding.agencyName}</span>}</div>}<div className="flex items-center gap-8"><Avatar username={acc.username} url={acc.profilePicUrl} color={acc.color} size={120} platform={acc.platform} />
            <div><div className="text-3xl font-semibold">{acc.name ?? acc.username}</div><div className="text-xl text-ink-2 mt-2">@{acc.username}{acc.clientName ? ` · ${acc.clientName}` : ''}</div><div className="text-lg text-ink-2 mt-6">{fmtDate(period.from, { day: 'numeric', month: 'long' })} – {fmtDate(period.to, { day: 'numeric', month: 'long', year: 'numeric' })}</div></div></div></Center>
        )}
        {slide === 'kpi' && (
          <Center><Title>{t('overview')}</Title><div className="grid grid-cols-3 gap-x-12 gap-y-10">
            {kpiDefs.map((k) => <Big key={k.key} label={k.label} value={k.format(k.kpi.value)} change={k.kpi.changePct} />)}
          </div></Center>
        )}
        {slide === 'growth' && (
          <><Title>{t('chart_followers')} <span className="text-ink-2 font-normal num">· {fmtNum(acc.followers)} {t('followers').toLowerCase()}</span></Title>
            <div className="flex-1 min-h-0"><TimeSeries data={d.followerSeries} legend={false} series={[{ key: 'followers', name: t('followers'), color: acc.color ?? '#4F7CFF', type: 'area' }]} /></div>
            <div className="flex-1 min-h-0 mt-6"><TimeSeries data={d.series} series={chart.series} /></div></>
        )}
        {slide === 'content' && ca.data && (
          <><Title>{t('content_analysis')} <span className="text-ink-2 font-normal num">· {ca.data.summary.posts} {t('posts').toLowerCase()} · {t('avg_er')} {fmtPct(ca.data.summary.avgEr, 2)}</span></Title>
            <div className="grid grid-cols-12 gap-10 flex-1 min-h-0">
              <div className="col-span-7"><BigTable head={[t('type'), t('posts'), t('share_of_reach'), t('avg_reach'), t('avg_er'), t('save_rate'), t('ad_spend')]} rows={ca.data.types.map((ty) => [typeLabel(ty.typeKey as TypeKey, t), String(ty.posts), fmtPct((ty.totalReach / Math.max(1, ca.data!.summary.reach)) * 100, 0), fmtNum(ty.avgReach), fmtPct(ty.avgEr, 2), fmtPct(ty.avgSaveRate, 2), ty.spend ? fmtMoney(ty.spend, cur) : '—'])} /></div>
              <div className="col-span-5 space-y-6">
                <ul className="m-0 pl-5 text-lg leading-relaxed space-y-1">{contentInsights(ca.data, t, cur).map((line) => <li key={line}>{line}</li>)}</ul>
                <div><div className="text-ink-2 text-lg mb-3">{t('avg_reach')}</div><BarList animate items={ca.data.types.map((ty) => ({ label: typeLabel(ty.typeKey as TypeKey, t), value: ty.avgReach ?? 0 }))} /></div>
                <div><div className="text-ink-2 text-lg mb-3">{t('avg_er')}</div><BarList animate items={ca.data.types.map((ty) => ({ label: typeLabel(ty.typeKey as TypeKey, t), value: ty.avgEr ?? 0 }))} format={(v) => fmtPct(v, 2)} color="#3FBF8F" /></div>
              </div>
            </div></>
        )}
        {slide === 'top' && (
          <><Title>{t('top6_posts')}</Title><div className="grid grid-cols-3 gap-6 flex-1 min-h-0">{top.map((p) => <BigPostCard key={p.mediaId} p={p} cur={cur} />)}</div></>
        )}
        {slide === 'spotlight' && top[0] && <Spotlight p={top[0]} avg={ca.data?.types.find((ty) => ty.typeKey === typeKeyOf(top[0]))} cur={cur} />}
        {slide === 'recent' && ca.data && (
          <><Title>{t('posts')} <span className="text-ink-2 font-normal num">· {fmtDate(period.from)} – {fmtDate(period.to)}</span></Title>
            <div className="flex-1 min-h-0 overflow-hidden"><BigTable head={[t('date'), t('type'), t('caption'), t('reach'), t('views'), t('er_short'), t('saved'), t('comments'), t('ad_spend')]} rows={ca.data.recent.slice(0, 12).map((r) => [fmtDate(r.postedAt), typeLabel(r.typeKey, t), (r.caption ?? '').slice(0, 44) + ((r.caption ?? '').length > 44 ? '…' : ''), fmtNum(r.reach), fmtNum(r.views), fmtPct(r.engagementRate, 2), fmtNum(r.saved), fmtNum(r.comments), r.spend ? fmtMoney(r.spend, r.paidCurrency ?? cur) : '—'])} numericFrom={3} /></div>
            <div className="text-ink-2 text-sm mt-3 num">{ca.data.recent.length > 12 ? `+${ca.data.recent.length - 12}` : ''}</div></>
        )}
        {slide === 'hashtags' && ca.data && (
          <><Title>{t('hashtag_perf')}</Title><div className="grid grid-cols-2 gap-12 flex-1 min-h-0">
            <BigTable head={[t('hashtag'), t('usage'), t('avg_reach'), t('avg_er'), t('avg_saved')]} rows={ca.data.hashtags.slice(0, 10).map((h) => [h.tag, String(h.posts), fmtNum(h.avgReach), fmtPct(h.avgEr, 2), fmtNum(h.avgSaved)])} numericFrom={1} />
            <div><div className="text-ink-2 text-lg mb-3">{t('avg_reach')}</div><BarList animate items={ca.data.hashtags.slice(0, 8).map((h) => ({ label: h.tag, value: h.avgReach ?? 0 }))} /></div>
          </div></>
        )}
        {slide === 'besttime' && bt.data && (
          <><Title>{t('best_time')}</Title><div className="max-w-5xl"><Heatmap matrix={bt.data.matrix} minPosts={bt.data.minPosts} /></div>
            <div className="flex gap-10 mt-8 text-2xl num">{bt.data.best.map((b, idx) => <div key={idx}><span className="text-ink-2 text-lg">#{idx + 1}</span> {WEEKDAYS[lang][b.weekday]} {b.hour}:00 <span className="text-ink-2 text-lg">ER {fmtPct(b.value, 2)}</span></div>)}</div></>
        )}
        {slide === 'ads' && ads.data && bl.data?.adAccount && (
          <><Title>{t('ads')} <span className="text-ink-2 font-normal">· {bl.data.adAccount.name}</span></Title>
            <div className="grid grid-cols-5 gap-x-10 gap-y-8 mb-8">
              <Big label={t('spend')} value={fmtMoney(ads.data.kpis.spend.value, cur)} change={ads.data.kpis.spend.changePct} />
              <Big label={t('reach')} value={fmtCompact(ads.data.kpis.reach.value)} change={ads.data.kpis.reach.changePct} />
              <Big label={t('impressions')} value={fmtCompact(ads.data.kpis.impressions.value)} change={ads.data.kpis.impressions.changePct} />
              <Big label={t('clicks')} value={fmtCompact(ads.data.kpis.clicks.value)} change={ads.data.kpis.clicks.changePct} />
              <Big label={t('results')} value={fmtCompact(ads.data.kpis.results.value)} change={ads.data.kpis.results.changePct} />
              <Big label="CTR" value={fmtPct(ads.data.kpis.ctr.value, 2)} change={ads.data.kpis.ctr.changePct} />
              <Big label="CPC" value={fmtMoney(ads.data.kpis.cpc.value, cur, 2)} change={ads.data.kpis.cpc.changePct} />
              <Big label="CPM" value={fmtMoney(ads.data.kpis.cpm.value, cur, 2)} change={ads.data.kpis.cpm.changePct} />
              <Big label={t('cost_per_result')} value={fmtMoney(ads.data.kpis.costPerResult.value, cur, 2)} change={ads.data.kpis.costPerResult.changePct} />
              <Big label={t('frequency')} value={fmtNum(ads.data.kpis.frequency.value, 2)} change={ads.data.kpis.frequency.changePct} />
            </div>
            <div className="flex-1 min-h-0"><TimeSeries data={ads.data.series} rightFormat={(v) => fmtNum(v, 1)} series={[{ key: 'spend', name: t('spend'), color: '#E8B44A', type: 'bar', format: (v) => fmtMoney(v, cur) }, { key: 'cpm', name: 'CPM', color: '#4F7CFF', axis: 'right', format: (v) => fmtMoney(v, cur, 2) }, { key: 'ctr', name: 'CTR %', color: '#3FBF8F', axis: 'right', format: (v) => fmtPct(v, 2) }]} /></div></>
        )}
        {slide === 'campaigns' && ads.data && (
          <><Title>{t('campaigns')}</Title><div className="flex-1 min-h-0 overflow-hidden"><BigTable head={[t('campaigns'), t('spend'), t('reach'), t('impressions'), t('clicks'), 'CTR', 'CPM', t('results'), t('cost_per_result')]} rows={ads.data.objects.slice(0, 10).map((o) => [`${o.objectName ?? o.objectId}`, fmtMoney(o.spend, cur), fmtNum(o.reach), fmtNum(o.impressions), fmtNum(o.clicks), fmtPct(o.ctr, 2), fmtMoney(o.cpm, cur, 2), fmtNum(o.results), o.costPerResult != null ? fmtMoney(o.costPerResult, cur, 2) : '—'])} numericFrom={1} /></div></>
        )}
        {slide === 'breakdown' && ads.data?.breakdowns && (
          <><Title>{t('breakdown')} <span className="text-ink-2 font-normal">· {t('spend')}</span></Title><div className="grid grid-cols-3 gap-12 flex-1 min-h-0">
            {([['age', t('age')], ['gender', t('gender')], ['publisher_platform', t('platform')]] as const).map(([k, label]) => (
              <div key={k}><div className="text-ink-2 text-lg mb-3">{label}</div><BarList animate items={(ads.data!.breakdowns![k] ?? []).map((b) => ({ label: bucketLabel(b.bucket ?? '', lang), value: b.spend }))} format={(v) => fmtMoney(v, cur)} color="#E8B44A" /></div>
            ))}
          </div></>
        )}
        {slide === 'blended' && bl.data?.adAccount && (
          <><Title>{t('blended')}</Title>
            <div className="grid grid-cols-4 gap-8 mb-8"><Big label={`${t('reach')} (${t('organic').toLowerCase()})`} value={fmtCompact(bl.data.totals.organicReach)} /><Big label={`${t('reach')} (${t('paid').toLowerCase()})`} value={fmtCompact(bl.data.totals.paidReach)} change={bl.data.totals.paidReachChangePct} /><Big label={t('paid_share')} value={fmtPct(bl.data.totals.paidShare, 1)} /><Big label={t('spend')} value={fmtMoney(bl.data.totals.spend, cur)} change={bl.data.totals.spendChangePct} /></div>
            <div className="flex-1 min-h-0"><TimeSeries data={bl.data.series} rightFormat={(v) => fmtMoney(v, cur)} series={[{ key: 'organicReach', name: t('organic'), color: '#4F7CFF', type: 'area' }, { key: 'paidReach', name: t('paid'), color: '#C06CE8', type: 'area' }, { key: 'spend', name: t('spend'), color: '#E8B44A', type: 'bar', axis: 'right', format: (v) => fmtMoney(v, cur) }]} /></div></>
        )}
        {slide === 'boosted' && ca.data && (
          <><Title>{t('slide_boosted')} <span className="text-ink-2 font-normal num">· {ca.data.summary.paidPosts} · {fmtMoney(ca.data.summary.totalSpend, cur)}</span></Title>
            <div className="flex-1 min-h-0 overflow-hidden"><BigTable head={[t('date'), t('type'), t('caption'), `${t('reach')} (${t('organic').toLowerCase()})`, `${t('reach')} (${t('paid').toLowerCase()})`, t('spend'), t('clicks'), t('results'), t('er_short')]} rows={ca.data.recent.filter((r) => (r.spend ?? 0) > 0).slice(0, 10).map((r) => [fmtDate(r.postedAt), typeLabel(r.typeKey, t), (r.caption ?? '').slice(0, 40), fmtNum(r.reach), fmtNum(r.paidReach), fmtMoney(r.spend, r.paidCurrency ?? cur), fmtNum(r.paidClicks), fmtNum(r.paidResults), fmtPct(r.engagementRate, 2)])} numericFrom={3} /></div></>
        )}
        {slide === 'basket' && (
          <><Title>{t('report_basket')} <span className="text-ink-2 font-normal num">· {basket.length} {t('posts').toLowerCase()}</span></Title>
            {basketCmp.data ? (
              <div className="grid gap-5 flex-1 min-h-0" style={{ gridTemplateColumns: `repeat(${Math.min(4, basketCmp.data.items.length)}, minmax(0, 1fr))` }}>
                {basketCmp.data.items.slice(0, 8).map((d) => (
                  <div key={d.media.mediaId} className="panel overflow-hidden flex flex-col min-h-0">
                    <div className="aspect-[4/3] flex-none"><PostThumb mediaId={d.media.mediaId} thumbnailPath={d.media.thumbnailPath} mediaType={d.media.mediaType} mediaProductType={d.media.mediaProductType} size="100%" rounded={0} /></div>
                    <div className="p-4 space-y-2"><div className="flex justify-between text-ink-2 text-sm"><span>@{d.media.username}</span><span>{fmtDate(d.media.postedAt)}</span></div><div className="text-base truncate">{d.media.caption}</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 num text-sm">
                        <span className="text-ink-2">{t('reach')}</span><span className="text-right font-semibold">{fmtNum(d.media.reach)} <Delta value={d.deltas.reach} /></span>
                        <span className="text-ink-2">{t('er_short')}</span><span className="text-right font-semibold">{fmtPct(d.media.engagementRate, 2)} <Delta value={d.deltas.engagementRate} /></span>
                        <span className="text-ink-2">{t('saved')}</span><span className="text-right font-semibold">{fmtNum(d.media.saved)} <Delta value={d.deltas.saved} /></span>
                        <span className="text-ink-2">{t('comments')}</span><span className="text-right font-semibold">{fmtNum(d.media.comments)}</span>
                        {d.paid && <><span className="text-ink-2">{t('ad_spend')}</span><span className="text-right font-semibold">{fmtMoney(d.paid.totals.spend, d.paid.currency)}</span></>}
                      </div></div>
                  </div>
                ))}
              </div>
            ) : <Loading />}</>
        )}
        {slide === 'next' && (
          <><Title>{t('next_steps')}</Title><div className="text-2xl leading-relaxed whitespace-pre-wrap max-w-4xl">{notes || '—'}</div></>
        )}
      </div>
      <div className="h-[2px] bg-line"><div className="h-full bg-accent pres-progress" style={{ width: `${((i + 1) / slides.length) * 100}%` }} /></div>
      <div className="h-10 px-6 flex items-center justify-between text-ink-2 text-sm num">
        <span>{t('presentation_hint')}</span>
        <div className="flex items-center gap-3"><span>{t(`slide_${slide}` as Key)}</span><div className="flex gap-1">{slides.map((s, idx) => <span key={s} className={`w-1.5 h-1.5 rounded-full ${idx === i ? 'bg-accent' : 'bg-line'}`} />)}</div><span>{i + 1} / {slides.length}</span></div>
      </div>
    </div>
  );
}

const BUCKET_KEYS: Record<string, Key> = { female: 'female', male: 'male', unknown: 'unknown' };
const BUCKET_NAMES: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', audience_network: 'Audience Network', messenger: 'Messenger' };
function bucketLabel(b: string, lang: 'tr' | 'en') {
  return BUCKET_KEYS[b] ? tr(BUCKET_KEYS[b], lang) : BUCKET_NAMES[b] ?? b;
}

/** Template sentences for the content slide — no LLM, just the data. */
function contentInsights(ca: NonNullable<ReturnType<typeof useContentAnalysis>['data']>, t: ReturnType<typeof useT>, cur: string): string[] {
  const out: string[] = [];
  const byEr = [...ca.types].sort((a, b) => (b.avgEr ?? 0) - (a.avgEr ?? 0))[0];
  const byReach = [...ca.types].sort((a, b) => (b.avgReach ?? 0) - (a.avgReach ?? 0))[0];
  const bySave = [...ca.types].sort((a, b) => (b.avgSaveRate ?? 0) - (a.avgSaveRate ?? 0))[0];
  if (byReach) out.push(`${t('avg_reach')}: ${typeLabel(byReach.typeKey as TypeKey, t)} ${fmtNum(byReach.avgReach)} (${byReach.posts} ${t('posts').toLowerCase()})`);
  if (byEr && byEr !== byReach) out.push(`${t('avg_er')}: ${typeLabel(byEr.typeKey as TypeKey, t)} ${fmtPct(byEr.avgEr, 2)}`);
  if (bySave) out.push(`${t('save_rate')}: ${typeLabel(bySave.typeKey as TypeKey, t)} ${fmtPct(bySave.avgSaveRate, 2)}`);
  if (ca.summary.paidPosts) out.push(`${t('paid_posts')}: ${ca.summary.paidPosts} · ${fmtMoney(ca.summary.totalSpend, cur)} · ${t('paid_reach')} ${fmtCompact(ca.summary.paidReach)}`);
  if (ca.hashtags[0]) out.push(`${t('hashtag')}: ${ca.hashtags[0].tag} · ${fmtNum(ca.hashtags[0].avgReach)} ${t('avg_reach').toLowerCase()}`);
  return out;
}

/** Slides that need a platform capability (ads slides also need a linked ad account at run time). */
function slideSupported(s: SlideId, caps: PlatformCapabilities): boolean {
  return caps.ads || !AD_SLIDES.includes(s);
}

function typeKeyOf(p: Media): TypeKey {
  return mediaTypeKey(p);
}

function Center({ children }: { children: ReactNode }) {
  return <div className="flex-1 flex flex-col justify-center">{children}</div>;
}
function Title({ children }: { children: ReactNode }) {
  return <h2 className="text-2xl font-semibold m-0 mb-8 flex items-baseline gap-2">{children}</h2>;
}
let bigCounter = 0;
function Big({ label, value, change }: { label: string; value: string; change?: number | null }) {
  const idx = bigCounter++ % 12;
  return <div className="rise" style={{ ['--i' as string]: idx }}><div className="text-ink-2 text-lg">{label}</div><div className="text-3xl font-semibold num leading-tight"><CountUp text={value} /></div>{change !== undefined && <div className="text-lg"><Delta value={change} /></div>}</div>;
}

/** Animates the numeric part of a formatted string from 0 to its value (keeps prefix/suffix such as currency or %). */
function CountUp({ text, ms = 700 }: { text: string; ms?: number }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(text); return; }
    const m = /^([^\d-]*)(-?[\d.,]+)(.*)$/.exec(text);
    if (!m) { setShown(text); return; }
    const [, pre, numStr, post] = m;
    const decimals = (numStr.split(/[.,]/).pop() ?? '').length < numStr.length && /[.,]\d{1,2}$/.test(numStr) ? (numStr.match(/[.,](\d{1,2})$/)?.[1].length ?? 0) : 0;
    const loc = locale();
    const target = Number(loc === 'tr-TR' ? numStr.replace(/\./g, '').replace(',', '.') : numStr.replace(/,/g, ''));
    if (!Number.isFinite(target)) { setShown(text); return; }
    const start = performance.now();
    let raf = 0;
    const fmtLike = (v: number) => {
      const s = new Intl.NumberFormat(loc, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
      return pre + s + post;
    };
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(p < 1 ? fmtLike(target * eased) : text);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms]);
  return <>{shown}</>;
}
function BigTable({ head, rows, numericFrom = 1 }: { head: string[]; rows: string[][]; numericFrom?: number }) {
  return (
    <table className="w-full text-lg num border-collapse">
      <thead><tr>{head.map((h, i) => <th key={h} className={`text-ink-2 font-normal text-base py-2 border-b border-line ${i >= numericFrom ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, ri) => <tr key={ri} className="rise" style={{ ['--i' as string]: ri }}>{r.map((c, ci) => <td key={ci} className={`py-2.5 border-b border-line ${ci >= numericFrom ? 'text-right' : 'text-left'} ${ci < numericFrom ? 'max-w-[420px] truncate' : ''}`}>{c}</td>)}</tr>)}
      {!rows.length && <tr><td colSpan={head.length} className="text-ink-2 py-6">—</td></tr>}</tbody>
    </table>
  );
}
let cardCounter = 0;
function BigPostCard({ p, cur }: { p: Media; cur: string }) {
  const t = useT();
  const idx = cardCounter++ % 6;
  return (
    <div className="panel overflow-hidden flex flex-col min-h-0 rise" style={{ ['--i' as string]: idx }}>
      <div className="aspect-[4/3] w-full relative flex-none"><PostThumb mediaId={p.mediaId} thumbnailPath={p.thumbnailPath} mediaType={p.mediaType} mediaProductType={p.mediaProductType} size="100%" rounded={0} />{(p.spend ?? 0) > 0 && <span className="absolute left-2 top-2 badge badge-warn">{t('ad_spend')} · {fmtMoney(p.spend, p.paidCurrency ?? cur)}</span>}</div>
      <div className="p-4 flex-1 min-h-0">
        <div className="flex justify-between text-ink-2 text-sm"><span>{fmtDate(p.postedAt)}</span><TypeBadge typeKey={typeKeyOf(p)} /></div>
        <div className="text-base truncate mt-1">{p.caption}</div>
        <div className="grid grid-cols-3 gap-2 mt-3 num"><Mini label={t('reach')} value={fmtCompact(p.reach)} /><Mini label={t('er_short')} value={fmtPct(p.engagementRate, 2)} /><Mini label={t('saved')} value={fmtCompact(p.saved)} /></div>
      </div>
    </div>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-ink-2">{label}</div><div className="text-lg font-semibold">{value}</div></div>;
}
function Spotlight({ p, avg, cur }: { p: Media; avg?: { avgReach: number | null; avgEr: number | null; avgSaved: number | null; avgViews: number | null; avgComments: number | null; avgShares: number | null }; cur: string }) {
  const t = useT();
  const lang = useAppStore((s) => s.lang);
  const pctVs = (v: number | null, base: number | null | undefined) => (v != null && base ? ((v - base) / base) * 100 : null);
  const tiles: [string, string, number | null][] = [
    [t('reach'), fmtNum(p.reach), pctVs(p.reach, avg?.avgReach)], [t('views'), fmtNum(p.views), pctVs(p.views, avg?.avgViews)],
    [t('er'), fmtPct(p.engagementRate, 2), pctVs(p.engagementRate, avg?.avgEr)], [t('saved'), fmtNum(p.saved), pctVs(p.saved, avg?.avgSaved)],
    [t('comments'), fmtNum(p.comments), pctVs(p.comments, avg?.avgComments)], [t('shares'), fmtNum(p.shares), pctVs(p.shares, avg?.avgShares)],
  ];
  return (
    <><Title>{t('slide_spotlight')} <span className="text-ink-2 font-normal">· {fmtDateTime(p.postedAt)} · {WEEKDAYS[lang][p.postedWeekday]} {p.postedHour}:00</span></Title>
      <div className="grid grid-cols-12 gap-12 flex-1 min-h-0">
        <div className="col-span-4"><div className="aspect-[4/5] w-full max-h-[60vh]"><PostThumb mediaId={p.mediaId} thumbnailPath={p.thumbnailPath} mediaType={p.mediaType} mediaProductType={p.mediaProductType} size="100%" rounded={12} /></div></div>
        <div className="col-span-8 flex flex-col">
          <div className="flex items-center gap-2 mb-3"><TypeBadge typeKey={typeKeyOf(p)} />{(p.spend ?? 0) > 0 && <span className="badge badge-warn">{t('ad_spend')} · {fmtMoney(p.spend, p.paidCurrency ?? cur)} · {t('paid_reach')} {fmtCompact(p.paidReach)}</span>}</div>
          <p className="text-xl leading-relaxed m-0 mb-8 max-h-40 overflow-hidden">{p.caption}</p>
          <div className="grid grid-cols-3 gap-x-10 gap-y-8">{tiles.map(([l, v, c]) => <div key={l}><div className="text-ink-2 text-lg">{l}</div><div className="text-3xl font-semibold num">{v}</div><div className="text-base num"><Delta value={c} /> <span className="text-ink-2">{t('vs_type_avg')}</span></div></div>)}</div>
        </div>
      </div></>
  );
}
