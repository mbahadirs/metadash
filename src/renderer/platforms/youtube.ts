import type { PlatformUi } from './types';

/**
 * YouTube renderer vocabulary — owned by chunk C1 (B ships the contract values). Labels needing new strings go to
 * locales/<lang>/youtube.json.
 */
export const youtubeUi: PlatformUi = {
  platform: 'youtube',
  label: 'YouTube',
  keyPrefix: 'yt-',
  icon: { bg: '#FF0000', fg: '#fff', glyph: '▶' },
  defaultCapabilities: {
    reach: false, saveRate: false, stories: false, demographics: true, competitors: false, comments: true, ads: false,
    inbox: true, inboxReply: 'scope', watchTime: true, dailySeries: 'native', experimental: false,
  },
  primaryMetric: 'views',
  typeKeys: ['video', 'short', 'live'],
  profileUrl: (acc) => `https://www.youtube.com/channel/${encodeURIComponent(acc.externalId ?? acc.igId.replace(/^yt-/, ''))}`,
  kpiSpecs: [
    { key: 'views', label: 'views' }, { key: 'likes', label: 'likes' }, { key: 'comments', label: 'comments' }, { key: 'shares', label: 'shares' },
    { key: 'newFollowers', aliases: ['follower_count'], label: 'new_followers', kind: 'signed' },
  ],
  chart: (t) => ({ title: t('views'), series: [{ key: 'views', name: t('views'), color: '#4F7CFF', type: 'area' }] }),
};
