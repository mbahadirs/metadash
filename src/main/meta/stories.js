import { graphGet, graphGetAll, graphDelay } from './client.js';
import { MetaError } from './errors.js';
import { METRIC_SETS } from './metricMap.js';

export async function fetchStories(igId, token) {
  const items = await graphGetAll(`/${igId}/stories`, { fields: 'id,media_type,timestamp,permalink,thumbnail_url', limit: 50 }, { token });
  return items.map((s) => ({
    storyId: s.id, mediaType: s.media_type, timestamp: s.timestamp, permalink: s.permalink, thumbnailUrl: s.thumbnail_url ?? null,
  }));
}

export async function fetchStoryInsights(storyId, token, { disabled = [] } = {}) {
  let metrics = METRIC_SETS.media.STORY.filter((m) => !disabled.includes(m));
  const dropped = [];
  for (let attempt = 0; attempt < 5 && metrics.length; attempt += 1) {
    try {
      const params = { metric: metrics.join(',') };
      if (metrics.includes('navigation')) params.breakdown = 'story_navigation_action_type';
      const body = await graphGet(`/${storyId}/insights`, params, { token });
      const out = { reach: null, views: null, replies: null, navForward: null, navBack: null, navExit: null, navNextStory: null };
      for (const row of body.data ?? []) {
        if (row.name === 'navigation') {
          const results = row.total_value?.breakdowns?.[0]?.results ?? [];
          for (const r of results) {
            const key = r.dimension_values?.[0];
            const v = r.value ?? 0;
            if (key === 'tap_forward') out.navForward = v;
            else if (key === 'tap_back') out.navBack = v;
            else if (key === 'tap_exit') out.navExit = v;
            else if (key === 'swipe_forward') out.navNextStory = v;
          }
          continue;
        }
        const v = row.values?.[0]?.value ?? row.total_value?.value ?? null;
        if (row.name === 'reach') out.reach = v;
        else if (row.name === 'views' || row.name === 'impressions') out.views = v;
        else if (row.name === 'replies') out.replies = v;
      }
      return { values: out, dropped };
    } catch (e) {
      if (e instanceof MetaError && e.isInvalidParam) {
        const bad = metrics[metrics.length - 1];
        dropped.push({ metric: bad, message: e.message });
        metrics = metrics.filter((m) => m !== bad);
        await graphDelay();
        continue;
      }
      throw e;
    }
  }
  return { values: {}, dropped };
}
