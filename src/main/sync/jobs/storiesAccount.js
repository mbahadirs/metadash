import * as stories from '../../meta/stories.js';
import { graphDelay } from '../../meta/client.js';
import { MetaError } from '../../meta/errors.js';
import { upsertStory } from '../../db/queries/stories.js';
import { disableMetric } from '../../db/queries/sync.js';

export async function syncStoriesAccount(ctx, account) {
  const { token, settings, report, log, signal } = ctx;
  report('stories');
  const list = await stories.fetchStories(account.igId, token);
  for (const s of list) {
    if (signal?.aborted) return;
    try {
      const { values, dropped } = await stories.fetchStoryInsights(s.storyId, token, { disabled: settings.disabledMetrics ?? [] });
      dropped.forEach((d) => { disableMetric(d.metric, 'story', d.message); log({ igId: account.igId, endpoint: 'story insights', code: 100, message: `metric dropped: ${d.metric}` }); });
      upsertStory({ storyId: s.storyId, igId: account.igId, mediaType: s.mediaType, permalink: s.permalink, thumbnailPath: s.thumbnailUrl, postedAt: new Date(s.timestamp).getTime(), ...values });
    } catch (e) {
      if (e instanceof MetaError && (e.isPermissionError || e.isInvalidParam)) { log({ igId: account.igId, endpoint: `/${s.storyId}/insights`, code: e.code, message: e.message }); continue; }
      throw e;
    }
    await graphDelay();
  }
}
