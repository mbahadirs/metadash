import type { Key } from '@/lib/i18n';
import type { Platform, PlatformCapabilities, TypeKey } from '@/lib/types';

/** Renderer-side vocabulary of a platform added after v1.x (v2.0 registry; built-ins stay in lib/platforms.ts / lib/accountKpis.ts). */
export type T = (key: Key, vars?: Record<string, string | number>) => string;
/** Account KPI tile spec (lib/accountKpis.ts): key in accountAnalytics().kpis, label key, format kind, tip, capability gate. */
export interface KpiSpec { key: string; aliases?: string[]; label: Key; kind?: 'pct' | 'signed' | 'count' | 'duration' | 'hours'; tip?: Key; needs?: keyof PlatformCapabilities }
export interface SeriesDef { key: string; name: string; color: string; type?: 'area'; axis?: 'right' }

export interface PlatformUi {
  platform: Platform;
  label: string;
  keyPrefix: string;
  icon: { bg: string; fg: string; glyph: string };
  /** Must equal main providers/<p>/meta.js capabilities (tests/renderer.platforms.test.js). */
  defaultCapabilities: Required<PlatformCapabilities>;
  primaryMetric: 'reach' | 'views';
  typeKeys: TypeKey[];
  profileUrl: (acc: { igId: string; username: string; externalId?: string | null }) => string;
  kpiSpecs: KpiSpec[];
  chart: (t: T) => { title: string; series: SeriesDef[] };
}
