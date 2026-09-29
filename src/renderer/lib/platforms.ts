import type { AccountAnalytics, Kpi, Media, Platform, PlatformCapabilities, PlatformInfo, TypeKey } from './types';

/** Display order everywhere (filters, splits, badges). */
export const PLATFORMS: Platform[] = ['instagram', 'facebook', 'threads'];

/** Brand names (not translated). Mirrors main/providers/capabilities.js PLATFORM_LABELS. */
export const PLATFORM_LABELS: Record<Platform, string> = { instagram: 'Instagram', facebook: 'Facebook', threads: 'Threads' };

/** Fallback capabilities when platforms:list has not loaded yet. Mirrors main/providers/capabilities.js. */
export const DEFAULT_CAPABILITIES: Record<Platform, PlatformCapabilities> = {
  instagram: { reach: true, saveRate: true, stories: true, demographics: true, competitors: true, comments: true, ads: true },
  facebook: { reach: true, saveRate: false, stories: false, demographics: false, competitors: false, comments: false, ads: true },
  threads: { reach: false, saveRate: false, stories: false, demographics: true, competitors: false, comments: false, ads: false },
};

export const DEFAULT_PRIMARY_METRIC: Record<Platform, 'reach' | 'views'> = { instagram: 'reach', facebook: 'reach', threads: 'views' };

/** Account keys: raw id = Instagram, 'fb-…' = Facebook Page, 'th-…' = Threads profile. */
export function platformOfKey(key: string | null | undefined): Platform {
  const k = String(key ?? '');
  if (k.startsWith('fb-')) return 'facebook';
  if (k.startsWith('th-')) return 'threads';
  return 'instagram';
}

export function isPlatform(v: unknown): v is Platform {
  return v === 'instagram' || v === 'facebook' || v === 'threads';
}

/** Platform of an account/media row; falls back to the key prefix for rows from older payloads. */
export function platformOf(row: { platform?: Platform | null; igId?: string } | null | undefined): Platform {
  return isPlatform(row?.platform) ? row!.platform! : platformOfKey(row?.igId);
}

export function capsOf(platform: Platform | null | undefined, list?: PlatformInfo[] | null): PlatformCapabilities {
  const p = isPlatform(platform) ? platform : 'instagram';
  return list?.find((x) => x.platform === p)?.capabilities ?? DEFAULT_CAPABILITIES[p];
}

export function primaryMetricOf(platform: Platform | null | undefined, list?: PlatformInfo[] | null): 'reach' | 'views' {
  const p = isPlatform(platform) ? platform : 'instagram';
  return list?.find((x) => x.platform === p)?.primaryMetric ?? DEFAULT_PRIMARY_METRIC[p];
}

/** Public profile URL for the "Open in …" buttons. */
export function profileUrl(acc: { platform?: Platform | null; igId: string; username: string; externalId?: string | null; pageId?: string | null }): string {
  const p = platformOf(acc);
  if (p === 'facebook') return `https://www.facebook.com/${encodeURIComponent(acc.externalId ?? acc.pageId ?? acc.igId.replace(/^fb-/, ''))}`;
  if (p === 'threads') return `https://www.threads.net/@${encodeURIComponent(acc.username)}`;
  return `https://www.instagram.com/${encodeURIComponent(acc.username)}/`;
}

export const TEXT_MEDIA_TYPES = ['TEXT_POST', 'TEXT', 'LINK', 'STATUS'];

/** Same buckets as main's mediaTypeKey. */
export function typeKeyOf(m: { mediaProductType: string; mediaType: string }): TypeKey {
  if (m.mediaProductType === 'REELS') return 'reels';
  if (m.mediaProductType === 'STORY') return 'story';
  if (TEXT_MEDIA_TYPES.includes(m.mediaType)) return 'text';
  if (m.mediaType === 'CAROUSEL_ALBUM') return 'carousel';
  if (m.mediaType === 'VIDEO') return 'video';
  return 'image';
}

/** Content type chips per platform (no Reels outside Instagram, no text posts on Instagram). */
export const TYPE_KEYS_BY_PLATFORM: Record<Platform, TypeKey[]> = {
  instagram: ['image', 'carousel', 'video', 'reels'],
  facebook: ['image', 'carousel', 'video', 'text'],
  threads: ['text', 'image', 'carousel', 'video'],
};

export function typeKeysFor(platforms: Platform[]): TypeKey[] {
  const set = new Set(platforms.flatMap((p) => TYPE_KEYS_BY_PLATFORM[p]));
  return (['image', 'carousel', 'video', 'reels', 'text'] as TypeKey[]).filter((k) => set.has(k));
}

/**
 * accountAnalytics as returned after v1.3 (D1): `platform`, `capabilities` and only the KPI keys that apply.
 * Every field is optional so the pre-v1.3 shape (IG KPIs only) still type-checks.
 */
export type AccountAnalyticsV13 = Omit<AccountAnalytics, 'kpis'> & {
  platform?: Platform; capabilities?: PlatformCapabilities; primaryMetric?: 'reach' | 'views';
  kpis: Partial<AccountAnalytics['kpis']> & Record<string, Kpi | undefined>;
};

/** Optional per-platform split of the portfolio KPIs (D1). Tolerates both `byPlatform` and `platforms` keys. */
export type PlatformSplit = Partial<Record<Platform, { followers?: number | null; reach?: number | null; views?: number | null; posts?: number | null; accounts?: number | null; [k: string]: unknown }>>;

export function portfolioSplit(p: unknown): PlatformSplit | null {
  const o = p as { byPlatform?: unknown; platforms?: unknown; kpis?: { byPlatform?: unknown } } | null;
  const raw = o?.byPlatform ?? o?.kpis?.byPlatform ?? (o?.platforms && !Array.isArray(o.platforms) ? o.platforms : null);
  if (!raw || typeof raw !== 'object') return null;
  const out: PlatformSplit = {};
  for (const pl of PLATFORMS) {
    const v = (raw as Record<string, unknown>)[pl];
    if (v && typeof v === 'object') out[pl] = flattenSplit(v as Record<string, unknown>);
  }
  return Object.keys(out).length ? out : null;
}

/** Accepts either plain numbers or Kpi objects ({ value }) per field. */
function flattenSplit(v: Record<string, unknown>): Record<string, number | null> {
  const num = (x: unknown): number | null => (typeof x === 'number' ? x : x && typeof x === 'object' && 'value' in x ? ((x as { value: number | null }).value ?? null) : null);
  const pick = (...keys: string[]) => { for (const k of keys) { const n = num(v[k]); if (n != null) return n; } return null; };
  return {
    followers: pick('followers', 'totalFollowers'),
    reach: pick('reach', 'totalReach'),
    views: pick('views', 'totalViews'),
    posts: pick('posts', 'totalPosts'),
    accounts: pick('accounts', 'count'),
  };
}

export function hasTextMedia(rows: Pick<Media, 'mediaType'>[]): boolean {
  return rows.some((m) => TEXT_MEDIA_TYPES.includes(m.mediaType));
}
