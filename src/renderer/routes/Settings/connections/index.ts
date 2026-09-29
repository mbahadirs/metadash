import type { ComponentType } from 'react';
import type { Platform, PlatformInfo } from '@/lib/types';
import { YouTubeCard } from './YouTubeCard';
import { TikTokCard } from './TikTokCard';

/**
 * Connection cards of v2.0 platforms (provider meta `connectionCard`), rendered by ConnectionsSection below the
 * built-in Facebook/Threads panels when the platform is enabled in this build.
 */
export interface ConnectionCardProps { info: PlatformInfo; onChange: () => void }
export const CONNECTION_CARDS: Partial<Record<Platform, ComponentType<ConnectionCardProps>>> = {
  youtube: YouTubeCard,
  tiktok: TikTokCard,
};
