import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { subDays } from 'date-fns';
import { openDb, closeDb } from '../src/main/db/index.js';
import { seedDemo } from '../src/main/seed/index.js';
import { listAccounts } from '../src/main/db/queries/accounts.js';
import { buildReport, sectionsFor, TEMPLATE_SECTIONS, SECTION_CAPABILITY } from '../src/main/export/htmlReport.js';
import { reportSheets } from '../src/main/export/xlsxReport.js';
import { makeL } from '../src/main/export/reportI18n.js';
import { CSV_QUERIES, runReadOnly } from '../src/main/export/csv.js';
import { fmtDate } from '../src/main/analytics/util.js';
import { ALL_PLATFORMS } from '../src/main/providers/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-reports-'));
const to = fmtDate(new Date());
const from = fmtDate(subDays(new Date(), 27));
const IG = '17840000';
let FB;
let TH;

beforeAll(() => {
  openDb(path.join(dir, 'data.db'));
  seedDemo({ reset: true });
  FB = listAccounts({ platforms: ['facebook'] }).find((a) => a.linkedAccountId === IG).igId;
  TH = listAccounts({ platforms: ['threads'] })[0].igId;
});
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('sectionsFor(template, platform)', () => {
  it('Instagram keeps every section of the template', () => {
    for (const t of Object.keys(TEMPLATE_SECTIONS)) expect(sectionsFor(t, 'instagram')).toEqual(TEMPLATE_SECTIONS[t]);
    expect(sectionsFor('monthly')).toEqual(TEMPLATE_SECTIONS.monthly);
  });
  it('Facebook drops stories, demographics and competitors', () => {
    const s = sectionsFor('monthly', 'facebook');
    expect(s).not.toContain('stories');
    expect(s).not.toContain('demographics');
    expect(s).not.toContain('competitors');
    expect(s).toEqual(expect.arrayContaining(['kpis', 'reach', 'posts', 'health', 'ads']));
  });
  it('Threads keeps demographics but drops stories, competitors and ads', () => {
    const s = sectionsFor('monthly', 'threads');
    expect(s).toContain('demographics');
    for (const k of ['stories', 'competitors', 'ads']) expect(s).not.toContain(k);
    expect(sectionsFor('campaign', 'threads')).toEqual(['kpis', 'posts', 'commentary']);
  });
  it('exposes which capability each optional section needs', () => {
    expect(SECTION_CAPABILITY).toMatchObject({ stories: 'stories', demographics: 'demographics', competitors: 'competitors', ads: 'ads' });
  });
});

describe('HTML reports per platform', () => {
  it('Instagram report is unchanged (stories, demographics, competitors)', () => {
    const html = buildReport('monthly', { igId: IG, from, to });
    for (const h of ['Story performance', 'Demographics', 'Competitors', 'Top 6 posts', 'Save rate']) expect(html).toContain(h);
  });
  it('Facebook report has no stories/demographics/competitors and labels reach as Viewers', () => {
    const html = buildReport('monthly', { igId: FB, from, to });
    for (const h of ['Story performance', '>Demographics<', 'Competitors', 'Save rate']) expect(html).not.toContain(h);
    for (const h of ['Viewers', 'Post engagements', 'Page views', 'Top 6 posts']) expect(html).toContain(h);
  });
  it('Threads report has demographics, views as the primary metric and no reach', () => {
    const html = buildReport('monthly', { igId: TH, from, to });
    expect(html).toContain('>Demographics<');
    for (const h of ['Story performance', 'Competitors', 'Save rate', '>Reach<']) expect(html).not.toContain(h);
    for (const h of ['Reposts', 'Link clicks', 'Likes']) expect(html).toContain(h);
    expect(buildReport('monthly', { igId: TH, from, to, lang: 'tr' })).toContain('Yeniden paylaşım');
  });
  it('multi-account reports mix platforms without crashing', () => {
    const html = buildReport('monthly', { igIds: [IG, FB, TH], from, to });
    expect(html).toContain('Story performance');
    expect(html).toContain('Facebook');
    expect(html).toContain('Threads');
  });
  it('portfolio and campaign reports build with all platforms', () => {
    expect(buildReport('portfolio', { from, to })).toContain('Threads');
    expect(buildReport('campaign', { igId: TH, from, to })).toContain('<html');
    expect(buildReport('weekly', { to })).toContain('<html');
  });
});

describe('XLSX reports per platform', () => {
  const names = (sheets) => sheets.map((s) => s.name);
  it('skips story/demographics sheets for Facebook; keeps demographics for Threads', () => {
    const fb = names(reportSheets('monthly', { igIds: [FB], from, to }));
    expect(fb.some((n) => n.endsWith('Story'))).toBe(false);
    expect(fb.some((n) => n.endsWith('Demographics'))).toBe(false);
    const th = reportSheets('monthly', { igIds: [TH], from, to });
    expect(names(th).some((n) => n.endsWith('Demographics'))).toBe(true);
    const daily = th.find((s) => s.name.endsWith('Daily'));
    expect(daily.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['views', 'likes', 'replies', 'reposts']));
    expect(daily.columns.map((c) => c.key)).not.toContain('reach');
    const ig = names(reportSheets('monthly', { igIds: [IG], from, to }));
    expect(ig.some((n) => n.endsWith('Story'))).toBe(true);
  });
  it('adds a platform column to multi-account sheets', () => {
    const p = reportSheets('portfolio', { from, to });
    const league = p.find((s) => s.columns.some((c) => c.key === 'health'));
    expect(league.columns.map((c) => c.key)).toContain('platform');
    expect(new Set(league.rows.map((r) => r.platform))).toEqual(new Set(['Instagram', 'Facebook', 'Threads', 'YouTube', 'TikTok']));
    const posts = p.find((s) => s.columns.some((c) => c.key === 'caption'));
    expect(posts.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['platform', 'reposts', 'quotes', 'clicks']));
    const multi = reportSheets('monthly', { igIds: [IG, TH], from, to });
    expect(multi[0].columns.map((c) => c.key)).toContain('platform');
  });
});

describe('report i18n and CSV', () => {
  it('has [tr, en] labels for the new platform metrics', () => {
    const en = makeL('en');
    const tr = makeL('tr');
    for (const k of ['viewers', 'reposts', 'quotes', 'link_clicks', 'post_engagements', 'page_views', 'instagram', 'facebook', 'threads', 'text', 'shares', 'replies']) {
      expect(en(k)).not.toBe(k);
      expect(tr(k)).not.toBe(k);
    }
    expect(en('viewers')).toBe('Viewers');
    expect(en('facebook')).toBe('Facebook');
  });
  it('CSV exports include the platform', () => {
    const acc = runReadOnly(CSV_QUERIES.accounts);
    expect(acc.columns).toContain('platform');
    expect(new Set(acc.rows.map((r) => r.platform))).toEqual(new Set(ALL_PLATFORMS));
    const media = runReadOnly(CSV_QUERIES.media, 5);
    expect(media.columns).toEqual(expect.arrayContaining(['platform', 'reposts', 'quotes', 'clicks']));
  });
});
