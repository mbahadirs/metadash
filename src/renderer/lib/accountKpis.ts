import { fmtCompact, fmtNum, fmtPct } from './format';
import type { Key } from './i18n';
import type { Kpi, Platform, PlatformCapabilities } from './types';
import type { AccountAnalyticsV13 } from './platforms';
import { EXTRA_PLATFORMS } from '../platforms/index';
import type { KpiSpec, SeriesDef as RegistrySeriesDef } from '../platforms/types';

type T = (key: Key, vars?: Record<string, string | number>) => string;

export interface KpiDef { key: string; label: string; kpi: Kpi; format: (v: number | null) => string; tip?: string }
type Spec = KpiSpec;

const pct = (v: number | null) => fmtPct(v, 2);
const signed = (v: number | null) => (v == null ? '—' : (v >= 0 ? '+' : '') + fmtNum(v));
/** seconds → m:ss */
const duration = (v: number | null) => (v == null ? '—' : `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}`);
/** minutes → hours */
const hours = (v: number | null) => (v == null ? '—' : fmtNum(Math.round(v / 6) / 10));
const FORMATS: Record<NonNullable<Spec['kind']>, (v: number | null) => string> = { pct, signed, count: fmtCompact, duration, hours };

/** KPI order per platform (plan §5). Keys are looked up with aliases so both camelCase and canonical names work. */
const SPECS: Record<Platform, Spec[]> = {
  instagram: [
    { key: 'reach', label: 'reach', needs: 'reach' }, { key: 'views', label: 'views' }, { key: 'profileViews', aliases: ['profile_views'], label: 'profile_views' },
    { key: 'er', label: 'er', kind: 'pct', tip: 'er_formula' }, { key: 'saveRate', label: 'save_rate', kind: 'pct', tip: 'save_rate_formula', needs: 'saveRate' },
    { key: 'newFollowers', aliases: ['follower_count'], label: 'new_followers', kind: 'signed' },
  ],
  facebook: [
    { key: 'reach', aliases: ['viewers'], label: 'viewers', tip: 'viewers_tip', needs: 'reach' }, { key: 'views', label: 'views' },
    { key: 'postEngagements', aliases: ['post_engagements'], label: 'post_engagements' },
    { key: 'pageViews', aliases: ['page_views', 'profileViews', 'profile_views'], label: 'page_views' },
    { key: 'er', label: 'er', kind: 'pct', tip: 'er_formula' },
    { key: 'newFollowers', aliases: ['follower_count'], label: 'new_followers', kind: 'signed' },
  ],
  threads: [
    { key: 'views', label: 'views' }, { key: 'likes', label: 'likes' }, { key: 'replies', aliases: ['comments'], label: 'replies' },
    { key: 'reposts', label: 'reposts' }, { key: 'linkClicks', aliases: ['link_clicks', 'clicks'], label: 'link_clicks' },
    { key: 'followers', aliases: ['followersTotal', 'followers_total'], label: 'followers' },
    { key: 'newFollowers', aliases: ['follower_count'], label: 'new_followers', kind: 'signed' },
    { key: 'er', label: 'er', kind: 'pct', tip: 'er_formula' },
  ],
  youtube: EXTRA_PLATFORMS.youtube.kpiSpecs,
  tiktok: EXTRA_PLATFORMS.tiktok.kpiSpecs,
};

/** Labels for extra KPI keys the backend may add that are not in SPECS. */
const EXTRA_LABELS: Record<string, Key> = { quotes: 'quotes', shares: 'shares', saved: 'saved', comments: 'comments' };

/**
 * KPI tiles for an account, in platform order. Only keys present in `kpis` are shown, and capability-gated keys
 * are dropped (so a pre-v1.3 payload with saveRate for a Facebook Page still hides it).
 */
export function accountKpiDefs(a: AccountAnalyticsV13, platform: Platform, caps: PlatformCapabilities, t: T, { posts = false, maxExtra = 2 } = {}): KpiDef[] {
  const kpis = (a.kpis ?? {}) as Record<string, Kpi | undefined>;
  const used = new Set<string>();
  const defs: KpiDef[] = [];
  for (const spec of SPECS[platform]) {
    if (spec.needs && !caps[spec.needs]) { [spec.key, ...(spec.aliases ?? [])].forEach((k) => used.add(k)); continue; }
    const hit = [spec.key, ...(spec.aliases ?? [])].find((k) => kpis[k] && !used.has(k));
    [spec.key, ...(spec.aliases ?? [])].forEach((k) => used.add(k));
    if (!hit) continue;
    defs.push({ key: spec.key, label: t(spec.label), kpi: kpis[hit]!, format: spec.kind ? FORMATS[spec.kind] : fmtCompact, tip: spec.tip ? t(spec.tip) : undefined });
  }
  used.add('posts');
  const extras = Object.keys(kpis).filter((k) => !used.has(k) && kpis[k] && typeof kpis[k] === 'object' && EXTRA_LABELS[k] && !(k === 'saveRate' && !caps.saveRate) && !(k === 'saved' && !caps.saveRate));
  for (const k of extras.slice(0, maxExtra)) defs.push({ key: k, label: t(EXTRA_LABELS[k]), kpi: kpis[k]!, format: fmtCompact });
  if (posts && kpis.posts) defs.push({ key: 'posts', label: t('posts'), kpi: kpis.posts, format: fmtNum });
  return defs;
}

export type SeriesDef = RegistrySeriesDef;

/** Daily chart series per platform: IG reach+accounts_engaged, FB viewers+post_engagements, Threads views+likes. */
export function accountChart(platform: Platform, t: T): { title: string; series: SeriesDef[] } {
  if (platform === 'facebook') return { title: t('chart_reach_post_engagements'), series: [{ key: 'reach', name: t('viewers'), color: '#4F7CFF', type: 'area' }, { key: 'post_engagements', name: t('post_engagements'), color: '#3FBF8F', axis: 'right' }] };
  if (platform === 'threads') return { title: t('chart_views_likes'), series: [{ key: 'views', name: t('views'), color: '#4F7CFF', type: 'area' }, { key: 'likes', name: t('likes'), color: '#3FBF8F', axis: 'right' }] };
  if (platform === 'youtube' || platform === 'tiktok') return EXTRA_PLATFORMS[platform].chart(t);
  return { title: t('chart_reach_engaged'), series: [{ key: 'reach', name: t('reach'), color: '#4F7CFF', type: 'area' }, { key: 'accounts_engaged', name: t('engaged'), color: '#3FBF8F', axis: 'right' }] };
}
