import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { setConfig } from '../src/main/config/store.js';
import { msg, currentLang } from '../src/main/i18n.js';
import { makeL, weekdays } from '../src/main/export/reportI18n.js';

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
