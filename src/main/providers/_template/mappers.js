import meta from './meta.js';
import { POST_METRICS } from './metrics.js';

/** TEMPLATE — vendor objects → provider contract shapes (providers/types.js Profile / Post). Pure and unit-tested. */
export const accountKey = (externalId) => `${meta.keyPrefix}${externalId}`;

export function mapProfile(me) {
  return { username: me.username, name: me.display_name ?? null, profilePicUrl: me.avatar_url ?? null, followers: me.follower_count ?? null };
}

export function mapPost(v) {
  const inline = Object.fromEntries(Object.entries(POST_METRICS).filter(([k]) => typeof v[k] === 'number').map(([k, c]) => [c, v[k]]));
  return {
    mediaId: `${meta.keyPrefix}${v.id}`, externalId: String(v.id), mediaType: 'VIDEO', mediaProductType: 'EXAMPLE',
    caption: v.title ?? '', permalink: v.url ?? null, thumbnailUrl: v.cover ?? null, timestamp: new Date(v.created * 1000).toISOString(), inline,
  };
}
