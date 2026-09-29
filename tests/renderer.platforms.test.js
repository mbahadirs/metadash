import { describe, it, expect } from 'vitest';
import {
  platformOfKey, platformOf, capsOf, primaryMetricOf, typeKeyOf, typeKeysFor, profileUrl, portfolioSplit, DEFAULT_CAPABILITIES,
} from '../src/renderer/lib/platforms.ts';
import { CAPABILITIES, PRIMARY_METRIC } from '../src/main/providers/capabilities.js';

describe('renderer platform helpers', () => {
  it('keeps fallback capabilities in sync with main', () => {
    expect(DEFAULT_CAPABILITIES).toEqual(JSON.parse(JSON.stringify(CAPABILITIES)));
    for (const p of ['instagram', 'facebook', 'threads']) expect(primaryMetricOf(p)).toBe(PRIMARY_METRIC[p]);
  });

  it('derives the platform from the row or the account key prefix', () => {
    expect(platformOfKey('17840000')).toBe('instagram');
    expect(platformOfKey('fb-123')).toBe('facebook');
    expect(platformOfKey('th-9')).toBe('threads');
    expect(platformOf({ igId: 'fb-1' })).toBe('facebook');
    expect(platformOf({ igId: 'fb-1', platform: 'threads' })).toBe('threads');
    expect(platformOf(null)).toBe('instagram');
  });

  it('prefers platforms:list capabilities over the static fallback', () => {
    const list = [{ platform: 'facebook', capabilities: { ...DEFAULT_CAPABILITIES.facebook, comments: true }, primaryMetric: 'reach' }];
    expect(capsOf('facebook', list).comments).toBe(true);
    expect(capsOf('threads', list).reach).toBe(false);
    expect(capsOf(undefined).saveRate).toBe(true);
  });

  it('maps media to type keys including text posts', () => {
    expect(typeKeyOf({ mediaProductType: 'REELS', mediaType: 'VIDEO' })).toBe('reels');
    expect(typeKeyOf({ mediaProductType: 'THREADS', mediaType: 'TEXT_POST' })).toBe('text');
    expect(typeKeyOf({ mediaProductType: 'FB_POST', mediaType: 'LINK' })).toBe('text');
    expect(typeKeyOf({ mediaProductType: 'FB_POST', mediaType: 'CAROUSEL_ALBUM' })).toBe('carousel');
    expect(typeKeyOf({ mediaProductType: 'FEED', mediaType: 'IMAGE' })).toBe('image');
    expect(typeKeysFor(['instagram'])).toEqual(['image', 'carousel', 'video', 'reels']);
    expect(typeKeysFor(['instagram', 'threads'])).toEqual(['image', 'carousel', 'video', 'reels', 'text']);
  });

  it('builds profile URLs per platform', () => {
    expect(profileUrl({ igId: '1', username: 'brand' })).toBe('https://www.instagram.com/brand/');
    expect(profileUrl({ igId: 'fb-42', platform: 'facebook', username: 'Brand', externalId: '42' })).toBe('https://www.facebook.com/42');
    expect(profileUrl({ igId: 'th-7', platform: 'threads', username: 'brand' })).toBe('https://www.threads.net/@brand');
  });

  it('reads an optional per-platform portfolio split in either shape', () => {
    expect(portfolioSplit({ kpis: {} })).toBeNull();
    expect(portfolioSplit({ byPlatform: { facebook: { followers: 10, reach: 5, posts: 2 } } })).toEqual({ facebook: { followers: 10, reach: 5, views: null, posts: 2, accounts: null } });
    const split = portfolioSplit({ platforms: { threads: { totalFollowers: { value: 3 }, totalViews: { value: 9 } } } });
    expect(split.threads).toMatchObject({ followers: 3, views: 9 });
    expect(portfolioSplit({ platforms: ['instagram'] })).toBeNull();
  });
});
