import { describe, it, expect } from 'vitest';
import { mediaMetricsFor, accountMetricsFor, normalizeMetricName, mediaFamily, metricFromErrorMessage } from '../src/main/meta/metricMap.js';

describe('metricMap', () => {
  it('maps aliases to the new metric name', () => {
    expect(normalizeMetricName('impressions')).toBe('views');
    expect(normalizeMetricName('plays')).toBe('views');
    expect(normalizeMetricName('reach')).toBe('reach');
  });
  it('picks metric family from product/media type', () => {
    expect(mediaFamily('REELS', 'VIDEO')).toBe('REELS');
    expect(mediaFamily('FEED', 'CAROUSEL_ALBUM')).toBe('CAROUSEL');
    expect(mediaFamily('STORY', 'IMAGE')).toBe('STORY');
    expect(mediaFamily('FEED', 'IMAGE')).toBe('FEED');
  });
  it('drops disabled metrics and honours user overrides', () => {
    expect(mediaMetricsFor('FEED', 'IMAGE', { disabled: ['views'] })).not.toContain('views');
    expect(mediaMetricsFor('FEED', 'IMAGE', { overrides: { media: { FEED: ['reach'] } } })).toEqual(['reach']);
    expect(accountMetricsFor('daily', { disabled: ['profile_views'] })).toEqual(['reach', 'views', 'accounts_engaged']);
  });
  it('extracts the offending metric from Meta error messages', () => {
    expect(metricFromErrorMessage('(#100) The following metrics are not supported: "impressions"')).toBe('impressions');
    expect(metricFromErrorMessage('metric plays is not supported')).toBe('plays');
    expect(metricFromErrorMessage('The impressions metric is no longer supported for versions v22.0+')).toBe('impressions');
    expect(metricFromErrorMessage('(#100) Invalid parameter: views', ['reach', 'views'])).toBe('views');
    expect(metricFromErrorMessage('something else')).toBeNull();
  });
});
