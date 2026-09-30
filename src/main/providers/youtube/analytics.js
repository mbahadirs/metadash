import { DAILY_METRICS, VIDEO_METRICS } from './metrics.js';
import { mapDemographics } from './mappers.js';

/**
 * YouTube Analytics API v2 reports.query wrappers (ids=channel==MINE). Every function takes a client from
 * api.js createYtClient. Dates are 'YYYY-MM-DD'. See api.js for what is confirmed vs VERIFY.
 */
export const VIDEO_BATCH = 200;

/** resultTable → array of row objects keyed by column name. */
export function resultRows(table) {
  const names = (table?.columnHeaders ?? []).map((c) => c.name);
  return (table?.rows ?? []).map((row) => Object.fromEntries(names.map((n, i) => [n, row[i]])));
}

export const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Daily channel series (canonical names) between two dates, inclusive. */
export async function fetchDailyChannel(client, { startDate, endDate }) {
  const metrics = Object.keys(DAILY_METRICS);
  const table = await client.analytics({ startDate, endDate, dimensions: 'day', metrics: metrics.join(','), sort: 'day' });
  const series = {};
  for (const row of resultRows(table)) {
    for (const m of metrics) {
      const v = Number(row[m]);
      if (row.day && Number.isFinite(v)) (series[DAILY_METRICS[m]] ??= []).push({ date: String(row.day), value: v });
    }
  }
  return series;
}

/** Lifetime-to-date per-video metrics for up to any number of ids (200 per call) → Map videoId → canonical values. */
export async function fetchVideoMetrics(client, videoIds, { startDate, endDate }) {
  const metrics = Object.keys(VIDEO_METRICS);
  const out = new Map();
  for (let i = 0; i < videoIds.length; i += VIDEO_BATCH) {
    const chunk = videoIds.slice(i, i + VIDEO_BATCH);
    const table = await client.analytics({
      startDate, endDate, dimensions: 'video', metrics: metrics.join(','), filters: `video==${chunk.join(',')}`, sort: '-views', maxResults: chunk.length,
    });
    for (const row of resultRows(table)) {
      const values = {};
      for (const m of metrics) {
        const v = Number(row[m]);
        if (Number.isFinite(v)) values[VIDEO_METRICS[m]] = v;
      }
      if (row.video) out.set(String(row.video), values);
    }
  }
  return out;
}

/** creatorContentType per video (SHORTS | VIDEO_ON_DEMAND | LIVE_STREAM | …) → Map videoId → type (VERIFY). */
export async function fetchContentTypes(client, videoIds, { startDate, endDate }) {
  const out = new Map();
  for (let i = 0; i < videoIds.length; i += VIDEO_BATCH) {
    const chunk = videoIds.slice(i, i + VIDEO_BATCH);
    const table = await client.analytics({
      startDate, endDate, dimensions: 'video,creatorContentType', metrics: 'views', filters: `video==${chunk.join(',')}`, sort: '-views', maxResults: chunk.length,
    });
    for (const row of resultRows(table)) if (row.video && row.creatorContentType) out.set(String(row.video), String(row.creatorContentType));
  }
  return out;
}

/** Viewer demographics: ageGroup×gender viewerPercentage (percent) and views by country (count). */
export async function fetchDemographicsReport(client, { startDate, endDate }) {
  const ag = await client.analytics({ startDate, endDate, dimensions: 'ageGroup,gender', metrics: 'viewerPercentage', sort: 'gender,ageGroup' });
  const co = await client.analytics({ startDate, endDate, dimensions: 'country', metrics: 'views', sort: '-views', maxResults: 25 });
  return mapDemographics(resultRows(ag), resultRows(co));
}
