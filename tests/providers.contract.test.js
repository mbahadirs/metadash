/**
 * Provider contract (v2.0 chunk B): runs for every registered provider — enabled ones and stubs marked
 * `contract: true` (YouTube, TikTok). Adding a platform must keep this green (docs/providers.md "definition of done").
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { listAllProviders, KNOWN_PLATFORMS, ALL_PLATFORMS } from '../src/main/providers/index.js';
import { PROVIDER_METAS } from '../src/main/providers/metas.js';
import { CAPABILITY_SCHEMA, CAPABILITY_KEYS, KEY_PREFIX, platformOfKey, accountKeyFor, AUTHS, MULTI_PROFILE } from '../src/main/providers/capabilities.js';
import { kpiKeysFor, chartMetricsFor, dailyMetricsFor } from '../src/main/analytics/platform.js';
import { AUTH_PLATFORMS, MULTI_PROFILE_AUTHS } from '../src/main/db/queries/profiles.js';
import template from '../src/main/providers/_template/index.js';
import { DEFAULT_CAPABILITIES, DEFAULT_PRIMARY_METRIC, PLATFORM_LABELS as UI_LABELS, platformOfKey as uiPlatformOfKey } from '../src/renderer/lib/platforms.ts';

const ROOT = path.join(import.meta.dirname, '..');
const BUILT_IN = ['instagram', 'facebook', 'threads'];
const FIXTURES = { meta: 'fixtures/graph/instagram.js', threads: 'fixtures/graph/threads.js', google: 'fixtures/google.js', tiktok: 'fixtures/tiktok.js' };
const checked = listAllProviders().filter((p) => p.enabled || p.contract);
const valid = { boolean: (v) => typeof v === 'boolean', 'boolean|scope': (v) => typeof v === 'boolean' || v === 'scope', 'native|derived|none': (v) => ['native', 'derived', 'none'].includes(v) };

describe('registry', () => {
  it('providers/index.js and providers/metas.js list the same platforms in the same order', () => {
    expect(KNOWN_PLATFORMS).toEqual(PROVIDER_METAS.map((m) => m.platform));
    expect(checked.map((p) => p.platform)).toEqual(KNOWN_PLATFORMS);
    expect(KNOWN_PLATFORMS).not.toContain(template.platform);
    expect(KNOWN_PLATFORMS.filter((p) => ALL_PLATFORMS.includes(p))).toEqual(ALL_PLATFORMS);
  });

  it('key prefixes are unique and at most one platform uses raw ids', () => {
    const prefixes = PROVIDER_METAS.map((m) => m.keyPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes.filter((p) => p === '')).toHaveLength(1);
  });

  it('auth tables agree with db/queries/profiles.js', () => {
    expect([...AUTHS].sort()).toEqual([...AUTH_PLATFORMS].sort());
    expect(AUTHS.filter((a) => MULTI_PROFILE[a]).sort()).toEqual([...MULTI_PROFILE_AUTHS].sort());
  });
});

describe.each(checked.map((p) => [p.platform, p]))('%s', (platform, p) => {
  const meta = p.meta;

  it('exposes its static meta', () => {
    expect(meta).toBe(PROVIDER_METAS.find((m) => m.platform === platform));
    for (const k of ['platform', 'auth', 'primaryMetric', 'capabilities']) expect(p[k], k).toEqual(meta[k]);
    expect(typeof meta.label).toBe('string');
    expect(typeof meta.multiProfile).toBe('boolean');
  });

  it('declares every capability key with a valid value', () => {
    expect(Object.keys(meta.capabilities).sort()).toEqual([...CAPABILITY_KEYS].sort());
    for (const [k, type] of Object.entries(CAPABILITY_SCHEMA)) expect(valid[type](meta.capabilities[k]), `${k}=${meta.capabilities[k]}`).toBe(true);
    expect(meta.capabilities.experimental).toBe(!!meta.experimental);
  });

  it('implements the required methods', () => {
    for (const m of ['discover', 'fetchProfile', 'fetchPosts', 'fetchDailyInsights', 'accountKey']) expect(typeof p[m], m).toBe('function');
    expect(typeof p.fetchPostInsights === 'function' || typeof p.fetchPostInsightsBatch === 'function').toBe(true);
    expect(Number.isInteger(p.concurrency) && p.concurrency > 0).toBe(true);
    expect(p.dailyWindow.windowDays).toBeGreaterThan(0);
    expect(p.dailyWindow.maxLookbackDays).toBeGreaterThanOrEqual(p.dailyWindow.windowDays);
    if (meta.multiProfile) expect(typeof p.refreshToken, 'multi-profile auths refresh tokens').toBe('function');
    if (meta.capabilities.demographics) expect(typeof p.fetchDemographics).toBe('function');
  });

  it('builds account keys that round-trip through platformOfKey (main and renderer)', () => {
    const key = p.accountKey('12345');
    expect(key).toBe(accountKeyFor(platform, '12345'));
    expect(key).toBe(`${KEY_PREFIX[platform]}12345`);
    expect(p.accountKey('12345')).toBe(key);
    expect(platformOfKey(key)).toBe(platform);
    expect(uiPlatformOfKey(key)).toBe(platform);
  });

  it('has a KPI vocabulary containing its primary metric', () => {
    if (!BUILT_IN.includes(platform)) expect(meta.kpis, 'non-built-in platforms declare meta.kpis').toBeTruthy();
    expect(kpiKeysFor(platform)).toContain(meta.primaryMetric);
    expect(chartMetricsFor(platform)).toHaveLength(2);
    expect(dailyMetricsFor(platform).length).toBeGreaterThan(0);
  });

  it('mirrors the renderer fallbacks', () => {
    expect(DEFAULT_CAPABILITIES[platform]).toEqual({ ...meta.capabilities });
    expect(DEFAULT_PRIMARY_METRIC[platform]).toBe(meta.primaryMetric);
    expect(UI_LABELS[platform]).toBe(meta.label);
  });

  it('has a fixture module for its auth', () => {
    expect(fs.existsSync(path.join(ROOT, 'tests', FIXTURES[meta.auth])), FIXTURES[meta.auth]).toBe(true);
  });

  it('has locale namespaces (en + tr, renderer + main) unless built in', () => {
    if (BUILT_IN.includes(platform)) return;
    for (const side of ['src/renderer/locales', 'src/main/locales']) {
      for (const lang of ['en', 'tr']) expect(fs.existsSync(path.join(ROOT, side, lang, `${platform}.json`)), `${side}/${lang}/${platform}.json`).toBe(true);
    }
  });

  it('exposes a well-formed inbox adapter when it has one', () => {
    const a = p.inbox;
    if (p.enabled && meta.capabilities.inbox && !BUILT_IN.includes(platform)) expect(a, 'enabled inbox platforms need provider.inbox').toBeTruthy();
    if (!a) return;
    expect(typeof a.fetch).toBe('function');
    for (const k of ['read', 'reply', 'hide']) expect(Array.isArray(a.scopes?.[k]), `scopes.${k}`).toBe(true);
    expect(a.maxReplyLength).toBeGreaterThan(0);
    if (meta.capabilities.inboxReply) expect(typeof a.reply).toBe('function');
  });

  it('report sections and demo hooks have the right shape', () => {
    for (const s of p.reportSections ?? []) {
      expect(typeof s.key).toBe('string');
      expect(Array.isArray(s.templates)).toBe(true);
      expect(typeof s.html).toBe('function');
    }
    if (p.demo) expect(typeof p.demo.seed).toBe('function');
  });
});
