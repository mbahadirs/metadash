import type { PlatformUi } from './types';

/**
 * YouTube renderer vocabulary (chunk C1). defaultCapabilities mirror main providers/youtube/meta.js; KPI keys follow
 * meta.kpis.keys (watchTime = minutes → shown in hours, avgViewDuration = seconds → m:ss). Strings: locales/<lang>/youtube.json.
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
    { key: 'views', label: 'views' },
    { key: 'watchTime', label: 'yt_watch_time', kind: 'hours', needs: 'watchTime' },
    { key: 'avgViewDuration', label: 'yt_avg_view_duration', kind: 'duration', needs: 'watchTime' },
    { key: 'newFollowers', aliases: ['follower_count'], label: 'yt_net_subscribers', kind: 'signed' },
    { key: 'likes', label: 'likes' }, { key: 'comments', label: 'comments' }, { key: 'shares', label: 'shares' },
  ],
  chart: (t) => ({
    title: `${t('views')} · ${t('yt_watch_time_min')}`,
    series: [
      { key: 'views', name: t('views'), color: '#4F7CFF', type: 'area' },
      { key: 'watch_time_min', name: t('yt_watch_time_min'), color: '#3FBF8F', axis: 'right' },
    ],
  }),
};
