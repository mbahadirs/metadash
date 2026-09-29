import { describe, it, expect } from 'vitest';
import { pickNotifications, pruneSent, markSent, DAY_MS } from '../src/main/notifyRules.js';

const NOW = new Date(2026, 8, 20, 12, 0, 0).getTime(); // 20 Sep 2026, local noon
const PREFS = { enabled: true, anomalies: true, budget: true, silent: true, token: true };
const EMPTY = { anomalies: [], budgets: [], silent: [], token: null };
const pick = (data, extra = {}) => pickNotifications({ now: NOW, lang: 'en', data: { ...EMPTY, ...data }, sent: {}, prefs: PREFS, ...extra });

const anomalies = [
  { igId: '1', username: 'alpha', date: '2026-09-20' },
  { igId: '1', username: 'alpha', date: '2026-09-19' },
  { igId: '2', username: 'beta', date: '2026-09-18' },
  { igId: '3', username: 'gamma', date: '2026-09-10' }, // too old
];
const budgets = [
  { actId: 'act_1', name: 'Acme Ads', budget: 1000, spentMtd: 950 },
  { actId: 'act_2', name: 'Low', budget: 1000, spentMtd: 200 },
  { actId: 'act_3', name: 'No budget', budget: null, spentMtd: 500 },
];
const silent = [
  { igId: '1', username: 'alpha', daysSincePost: 9 },
  { igId: '2', username: 'beta', daysSincePost: 3 },
  { igId: '3', username: 'gamma', daysSincePost: null },
];

describe('pickNotifications — types', () => {
  it('summarises anomalies from the last 2 days by account', () => {
    const [n, ...rest] = pick({ anomalies });
    expect(rest).toHaveLength(0);
    expect(n.route).toBe('/');
    expect(n.body).toContain('2 accounts');
    expect(n.body).toContain('@alpha');
    expect(n.body).toContain('@beta');
    expect(n.body).not.toContain('@gamma');
  });
  it('flags ad accounts at or above 90% of the monthly budget', () => {
    const [n, ...rest] = pick({ budgets });
    expect(rest).toHaveLength(0);
    expect(n.route).toBe('/ads');
    expect(n.body).toContain('Acme Ads');
    expect(n.body).toContain('95%');
    expect(n.keys).toEqual(['budget:act_1:2026-09']);
  });
  it('summarises accounts silent for 7+ days (ignores unknown last post)', () => {
    const [n, ...rest] = pick({ silent });
    expect(rest).toHaveLength(0);
    expect(n.route).toBe('/');
    expect(n.body).toContain('@alpha');
    expect(n.body).not.toContain('@beta');
    expect(n.body).not.toContain('@gamma');
  });
  it('warns when the Meta token expires within 7 days', () => {
    const [n] = pick({ token: { expiresAt: NOW + 3 * DAY_MS } });
    expect(n.route).toBe('/settings');
    expect(n.body).toContain('3');
    expect(pick({ token: { expiresAt: NOW + 20 * DAY_MS } })).toHaveLength(0);
    expect(pick({ token: { expiresAt: null } })).toHaveLength(0);
    expect(pick({ token: { expiresAt: NOW - DAY_MS } })[0].body).toMatch(/expired/i);
  });
  it('returns nothing when there is nothing to report', () => {
    expect(pick({})).toEqual([]);
    expect(pick({ budgets: [budgets[1]], silent: [silent[1]] })).toEqual([]);
  });
});

describe('pickNotifications — prefs and demo', () => {
  const all = { anomalies, budgets, silent, token: { expiresAt: NOW + DAY_MS } };
  it('emits all four types when enabled', () => {
    expect(pick(all).map((n) => n.type).sort()).toEqual(['anomalies', 'budget', 'silent', 'token']);
  });
  it('master switch disables everything', () => {
    expect(pick(all, { prefs: { ...PREFS, enabled: false } })).toEqual([]);
  });
  it('per-type switches disable only that type', () => {
    for (const type of ['anomalies', 'budget', 'silent', 'token']) {
      const types = pick(all, { prefs: { ...PREFS, [type]: false } }).map((n) => n.type);
      expect(types).not.toContain(type);
      expect(types).toHaveLength(3);
    }
  });
  it('treats missing prefs as enabled', () => {
    expect(pick(all, { prefs: {} })).toHaveLength(4);
  });
  it('skips everything in demo mode', () => {
    expect(pick({ ...all, demo: true })).toEqual([]);
  });
});

describe('pickNotifications — dedup', () => {
  it('does not repeat a key within its cooldown', () => {
    const first = pick({ anomalies, budgets, silent, token: { expiresAt: NOW + DAY_MS } });
    const sent = markSent({}, first, NOW);
    const again = pickNotifications({ now: NOW + 2 * 3_600_000, lang: 'en', data: { anomalies, budgets, silent, token: { expiresAt: NOW + DAY_MS } }, sent, prefs: PREFS });
    expect(again).toEqual([]);
  });
  it('repeats the token warning after 24 h but not the budget alert in the same month', () => {
    const data = { ...EMPTY, budgets, token: { expiresAt: NOW + 5 * DAY_MS } };
    const sent = markSent({}, pick(data), NOW);
    const later = pickNotifications({ now: NOW + DAY_MS + 1000, lang: 'en', data, sent, prefs: PREFS });
    expect(later.map((n) => n.type)).toEqual(['token']);
  });
  it('only reports accounts that were not notified yet', () => {
    const sent = markSent({}, pick({ anomalies: [anomalies[0]] }), NOW);
    const [n] = pickNotifications({ now: NOW + 1000, lang: 'en', data: { ...EMPTY, anomalies }, sent, prefs: PREFS });
    expect(n.body).toContain('@beta');
    expect(n.body).not.toContain('@alpha');
  });
});

describe('pickNotifications — language', () => {
  it('produces Turkish and English text', () => {
    const data = { anomalies, budgets, silent, token: { expiresAt: NOW + 2 * DAY_MS } };
    const en = pickNotifications({ now: NOW, lang: 'en', data, sent: {}, prefs: PREFS });
    const tr = pickNotifications({ now: NOW, lang: 'tr', data, sent: {}, prefs: PREFS });
    expect(en.find((n) => n.type === 'anomalies').title).toBe('Unusual changes detected');
    expect(tr.find((n) => n.type === 'anomalies').title).toBe('Olağandışı değişiklikler');
    expect(tr.find((n) => n.type === 'token').body).toContain('gün');
    expect(en.find((n) => n.type === 'token').body).toContain('days');
  });
  it('uses singular wording in English for a single account', () => {
    const [n] = pick({ silent: [silent[0]] });
    expect(n.body).toMatch(/^@alpha hasn't posted/);
  });
});

describe('sent log helpers', () => {
  it('prunes entries older than 30 days without mutating', () => {
    const sent = Object.freeze({ old: new Date(NOW - 31 * DAY_MS).toISOString(), fresh: new Date(NOW - DAY_MS).toISOString(), bad: 'x' });
    expect(Object.keys(pruneSent(sent, NOW))).toEqual(['fresh']);
    expect(Object.keys(sent)).toHaveLength(3);
  });
  it('marks every key of each notification', () => {
    const out = markSent({ a: 'x' }, [{ key: 'k', keys: ['k1', 'k2'] }, { key: 'z' }], NOW);
    expect(Object.keys(out).sort()).toEqual(['a', 'k1', 'k2', 'z']);
  });
});
