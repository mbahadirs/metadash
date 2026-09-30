import type { PlatformUi } from './types';

/** TikTok renderer vocabulary (experimental, chunk C2). defaultCapabilities mirror main providers/tiktok/meta.js. */
export const tiktokUi: PlatformUi = {
  platform: 'tiktok',
  label: 'TikTok',
  keyPrefix: 'tt-',
  icon: { bg: '#010101', fg: '#fff', glyph: '♪' },
  defaultCapabilities: {
    reach: false, saveRate: false, stories: false, demographics: false, competitors: false, comments: false, ads: false,
    inbox: false, inboxReply: false, watchTime: false, dailySeries: 'derived', experimental: true,
  },
  primaryMetric: 'views',
  typeKeys: ['video'],
  profileUrl: (acc) => `https://www.tiktok.com/@${encodeURIComponent(acc.username)}`,
  kpiSpecs: [
    { key: 'views', label: 'views' }, { key: 'likes', label: 'likes' }, { key: 'comments', label: 'comments' }, { key: 'shares', label: 'shares' },
    { key: 'newFollowers', aliases: ['follower_count'], label: 'new_followers', kind: 'signed' },
    { key: 'er', label: 'er', kind: 'pct', tip: 'er_formula' },
  ],
  // Display API has no daily series: views/day are derived from snapshot deltas (main analytics/derived.js).
  chart: (t) => ({ title: `${t('views')} · ${t('tt_estimated')}`, series: [{ key: 'views', name: t('views'), color: '#4F7CFF', type: 'area' }] }),
};
