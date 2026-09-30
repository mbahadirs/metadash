import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { setConfig } from '../src/main/config/store.js';
import { msg, currentLang } from '../src/main/i18n.js';
import { makeL, weekdays } from '../src/main/export/reportI18n.js';
import { translate, interpolate, fallbackChain, resolveLang, intlLocale, reportLocale, LOCALES, LANGUAGE, namespaceFor, loadNamespace } from '../src/main/locales/catalog.js';
import { toUserError, NetworkError, MetaError } from '../src/main/meta/errors.js';
import { PUBLISHING_MESSAGES } from '../src/main/i18n/publishing.js';
import * as rCore from '../src/renderer/lib/i18nCore.ts';
import { checkSide, loadSide, localeCodes } from '../scripts/i18n-check.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-i18n-'));
beforeAll(() => openDb(path.join(dir, 'data.db')));
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('main-process i18n', () => {
  it('defaults to English', () => {
    expect(currentLang()).toBe('en');
    expect(msg('account_not_found')).toBe('Account not found.');
  });
  it('follows lang=tr from config and explicit lang overrides it', () => {
    setConfig('lang', 'tr');
    expect(currentLang()).toBe('tr');
    expect(msg('account_not_found')).toBe('Hesap bulunamadı.');
    expect(msg('account_not_found', null, 'en')).toBe('Account not found.');
    setConfig('lang', 'en');
  });
  it('interpolates variables and falls back to the key', () => {
    expect(msg('unknown_template', { t: 'foo' }, 'en')).toBe('Unknown template: foo');
    expect(msg('sync_errors', { n: 3 }, 'tr')).toBe('3 hata');
    expect(msg('no_such_key')).toBe('no_such_key');
  });
  it('report labels default to English', () => {
    expect(makeL()('date')).toBe('Date');
    expect(makeL('tr')('date')).toBe('Tarih');
    expect(weekdays()[1]).toBe('Mon');
    expect(weekdays('tr')[1]).toBe('Pzt');
  });
});

// ---- v2.0 locale files (src/{main,renderer}/locales/<lang>/<ns>.json) ----
describe('locale registry', () => {
  it('lists en/tr complete and de/es partial, with a folder per side', () => {
    expect(LOCALES.map((l) => l.code)).toEqual(['en', 'tr', 'de', 'es']);
    expect(LOCALES.filter((l) => l.partial).map((l) => l.code)).toEqual(['de', 'es']);
    for (const side of ['main', 'renderer']) expect(Object.keys(loadSide(side)).sort()).toEqual([...localeCodes()].sort());
    expect(LANGUAGE).toMatchObject({ en: 'English', tr: 'Turkish', de: 'German', es: 'Spanish' });
  });
  it('maps languages to Intl locales', () => {
    expect(intlLocale('tr')).toBe('tr-TR');
    expect(intlLocale('de-AT')).toBe('de-DE');
    expect(intlLocale('xx')).toBe('en-US');
    expect(reportLocale('en')).toBe('en-GB');
    expect(resolveLang('es-MX')).toBe('es');
    expect(rCore.intlLocale('es')).toBe('es-ES');
    expect(rCore.decimalSeparator('en')).toBe('.');
    expect(rCore.decimalSeparator('tr')).toBe(',');
  });
});

describe('main catalog', () => {
  it('falls back lang → base → en → key', () => {
    expect(fallbackChain('de-AT')).toEqual(['de-AT', 'de', 'en']);
    expect(fallbackChain('../etc')).toEqual(['en']);
    expect(translate('err_network', null, 'de')).toBe(loadNamespace('de', 'errors').err_network);
    expect(translate('err_network', null, 'de-AT')).toBe(loadNamespace('de', 'errors').err_network);
    expect(translate('account_not_found', null, 'de')).toBe('Account not found.');
    expect(translate('account_not_found', null, 'zz')).toBe('Account not found.');
    expect(translate('nope_key', null, 'de')).toBe('nope_key');
    expect(msg('account_not_found', null, 'es')).toBe('Account not found.');
  });
  it('interpolates every occurrence in one pass and leaves unknown placeholders', () => {
    expect(interpolate('{a} and {a} {b}', { a: 1 })).toBe('1 and 1 {b}');
    expect(interpolate('{a}{b}', { a: '{b}', b: 'x' })).toBe('{b}x');
    expect(msg('ai_bad_request', { status: 400, detail: 'bad' }, 'en')).toBe('The AI provider rejected the request (400). bad');
  });
  it('accepts every registered language from config', () => {
    setConfig('lang', 'de');
    expect(currentLang()).toBe('de');
    setConfig('lang', 'klingon');
    expect(currentLang()).toBe('en');
    setConfig('lang', 'en');
  });
  it('report weekdays and document namespaces fall back per key', () => {
    expect(weekdays('de')).toEqual(['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']);
    expect(weekdays('es')).toHaveLength(7);
    expect(weekdays('es')[1]).toBe('lun');
    expect(makeL('de')('summary')).toBe('Zusammenfassung');
    expect(makeL('de')('best_time')).toBe('Best time to post');
    expect(namespaceFor('de', 'approval').title).toBe('Content for approval');
    expect(namespaceFor('tr', 'approval').title).toBe('Onay bekleyen içerikler');
  });
  it('localizes user errors', () => {
    expect(toUserError(new NetworkError('x'), 'tr').message).toMatch(/İnternet/);
    expect(toUserError(new NetworkError('x'), 'en').hint).toBe('Press Update once the connection is back.');
    expect(toUserError(new NetworkError('x'), 'de').hint).toBe('Press Update once the connection is back.');
  });
  it('words token, quota and API errors for the platform that raised them', () => {
    const err = (source, code, message = 'boom') => new MetaError({ code, message, source });
    expect(toUserError(err('google', 190), 'en').message).toMatch(/YouTube/);
    expect(toUserError(err('google', 190), 'tr').message).toMatch(/YouTube bağlantınız/);
    expect(toUserError(err('tiktok', 190), 'en').message).toMatch(/TikTok/);
    expect(toUserError(err('tiktok', 190), 'tr').hint).toMatch(/TikTok/);
    expect(toUserError(err('meta', 190), 'en').message).toMatch(/Meta/);
    expect(toUserError(err('google', 4), 'en').message).toMatch(/^YouTube .*quota/);
    const rejected = toUserError(err('tiktok', 200, 'scope_not_authorized'), 'en');
    expect(rejected.message).toBe('TikTok rejected the request: scope_not_authorized');
    expect(rejected.message).not.toMatch(/instagram_/);
  });
  it('keeps the pre-2.0 tuple view for compatibility', () => {
    expect(PUBLISHING_MESSAGES.pub_missed).toEqual([msg('pub_missed', null, 'en'), msg('pub_missed', null, 'tr')]);
  });
});

describe('renderer catalog', () => {
  it('falls back lang → base → en → key and interpolates', () => {
    expect(rCore.translate('nav_overview', 'tr')).toBe('Genel Bakış');
    expect(rCore.translate('nav_overview', 'de')).toBe('Übersicht');
    expect(rCore.translate('nav_overview', 'de-AT')).toBe('Übersicht');
    expect(rCore.translate('viewers', 'de')).toBe('Viewers');
    expect(rCore.translate('na_for_platform', 'en', { p: 'Threads' })).toBe('Not available for Threads');
    expect(rCore.translate('no_such_key', 'en')).toBe('no_such_key');
  });
  it('reports completeness and keeps content languages to tr/en', () => {
    expect(rCore.completeness('en')).toBe(100);
    expect(rCore.completeness('tr')).toBe(100);
    expect(rCore.completeness('de')).toBeLessThan(100);
    expect(rCore.contentLangFor('tr')).toBe('tr');
    expect(rCore.contentLangFor('de')).toBe('en');
  });
});

describe('i18n:check', () => {
  for (const side of ['renderer', 'main']) {
    it(`${side}: en/tr parity, placeholder parity, unique keys, every literal t()/msg()/L() key exists`, () => {
      const { errors, stats } = checkSide(side);
      expect(errors).toEqual([]);
      expect(stats.tr).toBe(100);
    });
    it(`${side}: every namespace exists for every locale`, () => {
      const data = loadSide(side);
      const ns = Object.keys(data.en).sort();
      for (const lang of localeCodes()) expect(Object.keys(data[lang]).sort()).toEqual(ns);
    });
  }
});
