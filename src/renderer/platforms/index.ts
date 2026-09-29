import type { PlatformUi } from './types';
import { youtubeUi } from './youtube';
import { tiktokUi } from './tiktok';

/**
 * v2.0 platform registry for the renderer (B). lib/platforms.ts, lib/accountKpis.ts and components/PlatformBadge.tsx
 * read platforms not built into v1.x from here, so C1/C2 only edit their own file. Order = display order after the
 * v1.x platforms.
 */
export const EXTRA_PLATFORMS = { youtube: youtubeUi, tiktok: tiktokUi } as const;
export type ExtraPlatform = keyof typeof EXTRA_PLATFORMS;
export const EXTRA_PLATFORM_LIST: PlatformUi[] = Object.values(EXTRA_PLATFORMS);
export const extraPlatformUi = (p: string): PlatformUi | null => (EXTRA_PLATFORMS as Record<string, PlatformUi>)[p] ?? null;
export type { PlatformUi, KpiSpec, SeriesDef, T } from './types';
