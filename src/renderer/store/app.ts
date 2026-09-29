import { create } from 'zustand';
import { daysAgo, isoDate } from '@/lib/format';
import type { AuthPlatform, Platform, SyncProgress, SyncStatus } from '@/lib/types';

export interface TokenWarningState { platform: AuthPlatform; message: string }
const PLATFORM_KEYS: Platform[] = ['instagram', 'facebook', 'threads'];

export type Preset = 'today' | 'yesterday' | 7 | 30 | 'this_month' | 'last_month' | 28 | 90 | 'custom';
export interface Period { from: string; to: string; preset: Preset }

interface AppState {
  lang: 'tr' | 'en';
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;
  period: Period;
  tagFilter: number[];
  /** Global platform filter (empty = all). Persisted as ui.platformFilter. */
  platformFilter: Platform[];
  compareIds: string[];
  basket: string[];
  sync: SyncStatus | null;
  progress: SyncProgress | null;
  tokenWarning: TokenWarningState | null;
  online: boolean;
  demo: boolean;
  setLang: (l: 'tr' | 'en') => void;
  setTheme: (t: 'dark' | 'light') => void;
  toggleSidebar: () => void;
  setPreset: (p: Preset) => void;
  setCustomPeriod: (from: string, to: string) => void;
  setTagFilter: (ids: number[]) => void;
  setPlatformFilter: (p: Platform[]) => void;
  setCompareIds: (ids: string[]) => void;
  toggleBasket: (mediaId: string) => void;
  addToBasket: (ids: string[]) => void;
  clearBasket: () => void;
  setSync: (s: SyncStatus | null) => void;
  setProgress: (p: SyncProgress | null) => void;
  setTokenWarning: (w: TokenWarningState | null) => void;
  setOnline: (o: boolean) => void;
  setDemo: (d: boolean) => void;
}

export function presetPeriod(p: Preset): Period {
  const now = new Date();
  if (p === 'today') return { from: isoDate(now), to: isoDate(now), preset: p };
  if (p === 'yesterday') { const d = daysAgo(1); return { from: d, to: d, preset: p }; }
  if (p === 'this_month') return { from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDate(now), preset: p };
  if (p === 'last_month') return { from: isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: isoDate(new Date(now.getFullYear(), now.getMonth(), 0)), preset: p };
  const days = typeof p === 'number' ? p : 30;
  return { from: daysAgo(days - 1), to: isoDate(now), preset: typeof p === 'number' ? p : 30 };
}

function persistBasket(basket: string[]) {
  try { window.api?.settings?.set('ui.basket', basket); } catch { /* ignore */ }
}

function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
}

function applyLang(lang: 'tr' | 'en') {
  document.documentElement.lang = lang;
}

export const useAppStore = create<AppState>((set, get) => ({
  lang: 'en',
  theme: 'dark',
  sidebarCollapsed: false,
  period: presetPeriod(30),
  tagFilter: [],
  platformFilter: [],
  compareIds: [],
  basket: [],
  sync: null,
  progress: null,
  tokenWarning: null,
  online: true,
  demo: false,
  setLang: (lang) => { applyLang(lang); set({ lang }); window.api?.settings?.set('lang', lang); },
  setTheme: (theme) => { applyTheme(theme); set({ theme }); window.api?.settings?.set('theme', theme); },
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  setPreset: (preset) => { set({ period: presetPeriod(preset) }); window.api?.settings?.set('lastPeriod', preset); },
  setCustomPeriod: (from, to) => set({ period: { from, to, preset: 'custom' } }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  setPlatformFilter: (platformFilter) => { set({ platformFilter }); try { window.api?.settings?.set('ui.platformFilter', platformFilter); } catch { /* ignore */ } },
  setCompareIds: (compareIds) => set({ compareIds: compareIds.slice(0, 6) }),
  toggleBasket: (id) => { const basket = get().basket.includes(id) ? get().basket.filter((x) => x !== id) : [...get().basket, id]; set({ basket }); persistBasket(basket); },
  addToBasket: (ids) => { const basket = [...new Set([...get().basket, ...ids])]; set({ basket }); persistBasket(basket); },
  clearBasket: () => { set({ basket: [] }); persistBasket([]); },
  setSync: (sync) => set({ sync }),
  setProgress: (progress) => set({ progress }),
  setTokenWarning: (tokenWarning) => set({ tokenWarning }),
  setOnline: (online) => set({ online }),
  setDemo: (demo) => set({ demo }),
}));

/** Loads persisted preferences from the main process once at boot. */
export async function hydrateStore() {
  try {
    const res = await window.api.settings.all();
    if (!res?.ok) return;
    const s = res.data as { lang?: 'tr' | 'en'; theme?: 'dark' | 'light'; lastPeriod?: Preset; demoMode?: boolean; 'ui.basket'?: string[]; 'ui.platformFilter'?: unknown };
    const theme = s.theme === 'light' ? 'light' : 'dark';
    const lang = s.lang === 'tr' ? 'tr' : 'en';
    applyTheme(theme);
    applyLang(lang);
    useAppStore.setState({ lang, theme, period: presetPeriod(s.lastPeriod && s.lastPeriod !== 'custom' ? s.lastPeriod : 30), basket: Array.isArray(s['ui.basket']) ? s['ui.basket'] : [], platformFilter: parsePlatformFilter(s['ui.platformFilter']) });
  } catch {
    applyTheme('dark');
    applyLang('en');
  }
}

function parsePlatformFilter(v: unknown): Platform[] {
  return Array.isArray(v) ? PLATFORM_KEYS.filter((p) => v.includes(p)) : [];
}
