export const METRIC_SETS = {
  media: {
    FEED: ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
    REELS: ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
    CAROUSEL: ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
    STORY: ['reach', 'views', 'replies', 'navigation'],
  },
  account: {
    daily: ['reach', 'views', 'profile_views', 'accounts_engaged'],
    lifetime: ['audience_city', 'audience_gender_age', 'audience_country'],
  },
};

// Old name → new name. Charts always use the new name.
export const ALIASES = { impressions: 'views', plays: 'views', video_views: 'views' };

export function normalizeMetricName(name) {
  return ALIASES[name] ?? name;
}

/** Returns the metric family key for a media row. */
export function mediaFamily(mediaProductType, mediaType) {
  if (mediaProductType === 'STORY') return 'STORY';
  if (mediaProductType === 'REELS') return 'REELS';
  if (mediaType === 'CAROUSEL_ALBUM') return 'CAROUSEL';
  return 'FEED';
}

/** Metric list for a media item minus any disabled metrics; user overrides win. */
export function mediaMetricsFor(mediaProductType, mediaType, { disabled = [], overrides = null } = {}) {
  const family = mediaFamily(mediaProductType, mediaType);
  const base = overrides?.media?.[family] ?? METRIC_SETS.media[family] ?? METRIC_SETS.media.FEED;
  const off = new Set(disabled);
  return base.filter((m) => !off.has(m));
}

export function accountMetricsFor(kind, { disabled = [], overrides = null } = {}) {
  const base = overrides?.account?.[kind] ?? METRIC_SETS.account[kind] ?? [];
  const off = new Set(disabled);
  return base.filter((m) => !off.has(m));
}

/**
 * Extracts the offending metric name from a Meta "invalid metric" error message.
 * When `candidates` (the metrics that were requested) are given, the first one mentioned wins.
 */
export function metricFromErrorMessage(message = '', candidates = []) {
  const text = String(message);
  for (const c of candidates) {
    if (new RegExp(`(^|[^a-z_])${c}([^a-z_]|$)`, 'i').test(text)) return c;
  }
  const patterns = [
    /\bmetrics?\s+"?([a-z_]+)"?\s+(?:is|are)\s+(?:not|no longer)\s+supported/i,
    /\b(?:the\s+)?([a-z_]+)\s+metric\s+(?:is|are)\s+(?:not|no longer)\s+supported/i,
    /not\s+supported[^"]*"([a-z_]+)"/i,
    /"([a-z_]+)"/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]) return m[1];
  }
  return null;
}
