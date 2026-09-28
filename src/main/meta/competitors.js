import { graphGet } from './client.js';

/** Business discovery: public data only, no insights. */
export async function fetchCompetitor(igId, username, token) {
  const fields = `business_discovery.username(${username}){username,followers_count,media_count,media.limit(25){id,caption,media_type,timestamp,like_count,comments_count,permalink}}`;
  const body = await graphGet(`/${igId}`, { fields }, { token });
  const bd = body.business_discovery ?? {};
  const media = bd.media?.data ?? [];
  const weekAgo = Date.now() - 7 * 86_400_000;
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  return {
    username: bd.username,
    followers: bd.followers_count ?? null,
    mediaCount: bd.media_count ?? null,
    avgLikes: avg(media.map((m) => m.like_count ?? 0)),
    avgComments: avg(media.map((m) => m.comments_count ?? 0)),
    postsLast7d: media.filter((m) => new Date(m.timestamp).getTime() >= weekAgo).length,
    media,
  };
}
