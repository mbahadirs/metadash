/**
 * v2.0 F1 roles: IPC channel matrix per role / read-only workspace, client scope filtering of listAccounts and of
 * account/media/note ids in arguments, client-view PIN.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb, q } from '../src/main/db/index.js';
import { listAccounts, hasAccountScope } from '../src/main/db/queries/accounts.js';
import { setSetting } from '../src/main/db/queries/settings.js';
import { check } from '../src/main/team/policy.js';
import { getSession, setRole, enterClientView, exitClientView, hashPin, verifyPin } from '../src/main/team/session.js';
import { knownClientNames } from '../src/main/team/scope.js';
import { progressBus } from '../src/main/sync/progress.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-team-pol-'));
const S = (role, extra = {}) => ({ role, clientScope: null, readOnly: false, workspace: 'local', ...extra });
const allowed = (channel, args, session) => { try { check(channel, args, session); return true; } catch (e) { if (e.code !== 'FORBIDDEN') throw e; return false; } };

beforeAll(() => {
  openDb(path.join(dir, 'data.db'));
  q.run(`INSERT INTO accounts (ig_id, username, is_tracked, platform, external_id, client_name) VALUES
    ('a1', 'acme', 1, 'instagram', 'a1', 'Acme'), ('a2', 'acme_fb', 1, 'facebook', 'a2', 'Acme'), ('b1', 'bolt', 1, 'instagram', 'b1', 'Bolt')`);
  q.run("INSERT INTO media (media_id, ig_id, media_type, media_product_type, posted_at, is_deleted) VALUES ('ma', 'a1', 'IMAGE', 'FEED', 1, 0), ('mb', 'b1', 'IMAGE', 'FEED', 1, 0)");
});
afterAll(() => {
  closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('admin and analyst', () => {
  it('admin may call everything on the own install', () => {
    for (const ch of ['setup:saveApp', 'transfer:export', 'db:backup', 'worker:configure', 'ai:setKey', 'team:create', 'sync:run']) expect(allowed(ch, [{}], S('admin'))).toBe(true);
    expect(allowed('settings:set', ['reportBranding', {}], S('admin'))).toBe(true);
  });

  it('analyst is denied admin-only channels', () => {
    for (const ch of ['setup:saveApp', 'setup:exchangeToken', 'transfer:export', 'transfer:import', 'db:backup', 'db:restore', 'worker:configure', 'ai:setKey', 'team:create']) {
      expect(allowed(ch, [{}], S('analyst'))).toBe(false);
    }
    for (const ch of ['sync:run', 'analytics:portfolio', 'notes:add', 'planner:posts:list', 'inbox:reply', 'team:join', 'setup:getState']) expect(allowed(ch, [{}], S('analyst'))).toBe(true);
  });

  it('analyst may only change UI, language, theme and notification settings', () => {
    for (const k of ['ui.sidebar', 'lang', 'theme', 'lastPeriod', 'notify.mentions']) expect(allowed('settings:set', [k, 1], S('analyst'))).toBe(true);
    for (const k of ['reportBranding', 'autoSyncDaily', 'ai.enabled']) expect(allowed('settings:set', [k, 1], S('analyst'))).toBe(false);
  });

  it('a read-only workspace blocks sync, setup, replies, publishing and team publish', () => {
    const ro = S('analyst', { readOnly: true, workspace: 't1' });
    for (const ch of ['sync:run', 'sync:cancel', 'setup:saveApp', 'inbox:reply', 'inbox:hide', 'publishing:publishNow', 'publishing:schedule', 'worker:syncNow', 'team:publishNow', 'competitors:add']) {
      expect(allowed(ch, [{}], ro)).toBe(false);
    }
    for (const ch of ['sync:status', 'sync:history', 'setup:getState', 'analytics:portfolio', 'notes:add', 'inbox:setStatus', 'team:pullNow', 'team:leave', 'ai:setKey']) {
      expect(allowed(ch, [{}], ro)).toBe(true);
    }
    expect(allowed('sync:run', [{}], S('admin', { readOnly: true }))).toBe(false);
  });
});

describe('client view', () => {
  const client = S('client', { clientScope: ['Acme'] });

  it('is default-deny with an allowlist', () => {
    for (const ch of ['analytics:portfolio', 'analytics:definitions', 'accounts:list', 'platforms:list', 'export:preview', 'notes:list', 'session:get', 'session:exitClientView', 'settings:all']) {
      expect(allowed(ch, [{}], client)).toBe(true);
    }
    for (const ch of ['planner:posts:list', 'inbox:list', 'ai:ask', 'sql:run', 'competitors:list', 'notes:add', 'notes:delete', 'team:members', 'session:setRole', 'studio:usage', 'ads:insights', 'sync:run', 'export:csv', 'db:backup']) {
      expect(allowed(ch, [{}], client)).toBe(false);
    }
    expect(allowed('settings:set', ['ui.x', 1], client)).toBe(true);
    expect(allowed('settings:set', ['notify.enabled', false], client)).toBe(false);
  });

  it('checks account, media and note ids against the scope', () => {
    expect(allowed('accounts:list', [{ unscoped: true }], client)).toBe(false);
    expect(allowed('accounts:get', ['a1'], client)).toBe(true);
    expect(allowed('accounts:get', ['b1'], client)).toBe(false);
    expect(allowed('analytics:account', [{ igId: 'a2', from: '2026-01-01', to: '2026-01-31' }], client)).toBe(true);
    expect(allowed('analytics:account', [{ igId: 'b1' }], client)).toBe(false);
    expect(allowed('analytics:compare', [{ igIds: ['a1', 'b1'] }], client)).toBe(false);
    expect(allowed('analytics:media', ['ma'], client)).toBe(true);
    expect(allowed('analytics:media', ['mb'], client)).toBe(false);
    expect(allowed('analytics:media', ['unknown'], client)).toBe(false);
    expect(allowed('analytics:comparePosts', [{ mediaIds: ['ma', 'mb'] }], client)).toBe(false);
    expect(allowed('export:pdf', [{ template: 'monthly', params: { igId: 'b1' } }], client)).toBe(false);
    expect(allowed('export:pdf', [{ template: 'monthly', params: { igIds: ['a1'] } }], client)).toBe(true);
    expect(allowed('notes:list', [{ entityType: 'media', entityId: 'mb' }], client)).toBe(false);
    expect(allowed('notes:list', [{ entityType: 'account', entityId: 'a1' }], client)).toBe(true);
  });

  it('narrows "all accounts" content queries to the scope', () => {
    const args = [{ from: '2026-01-01', to: '2026-01-31' }];
    check('analytics:content', args, client);
    expect([...args[0].igIds].sort()).toEqual(['a1', 'a2']);
    const explicit = [{ igIds: ['a1'] }];
    check('analytics:contentAnalysis', explicit, client);
    expect(explicit[0].igIds).toEqual(['a1']);
  });
});

describe('session and PIN', () => {
  it('starts as admin on the own install and follows setRole', () => {
    expect(getSession()).toEqual({ role: 'admin', clientScope: null, readOnly: false, workspace: 'local' });
    expect(setRole('analyst').role).toBe('analyst');
    expect(() => setRole('client')).toThrow(expect.objectContaining({ code: 'TEAM_BAD_ROLE' }));
    expect(setRole('admin').role).toBe('admin');
  });

  it('a subscriber can never be admin', () => {
    setSetting('team.config', { mode: 'subscriber', teamId: 't9' });
    try {
      expect(getSession()).toMatchObject({ role: 'analyst', readOnly: true, workspace: 't9' });
      expect(() => setRole('admin')).toThrow(expect.objectContaining({ code: 'TEAM_SUBSCRIBER_NOT_ADMIN' }));
    } finally {
      setSetting('team.config', { mode: 'none' });
    }
  });

  it('client view scopes listAccounts, emits session:changed and needs the PIN to exit', () => {
    const events = [];
    const on = (s) => events.push(s);
    progressBus.on('session:changed', on);
    try {
      expect(knownClientNames()).toEqual(['Acme', 'Bolt']);
      expect(() => enterClientView({ clientNames: ['Nope'], pin: '1234' })).toThrow(expect.objectContaining({ code: 'TEAM_UNKNOWN_CLIENT' }));
      expect(() => enterClientView({ clientNames: ['Acme'], pin: '12' })).toThrow(expect.objectContaining({ code: 'TEAM_PIN_FORMAT' }));
      const s = enterClientView({ clientNames: ['Acme', 'Acme', ' '], pin: '2468' });
      expect(s).toMatchObject({ role: 'client', clientScope: ['Acme'] });
      expect(hasAccountScope()).toBe(true);
      expect(listAccounts().map((a) => a.igId).sort()).toEqual(['a1', 'a2']);
      expect(listAccounts({ unscoped: true })).toHaveLength(3);
      expect(q.get("SELECT value FROM settings WHERE key = 'session.clientPinHash'").value).not.toContain('2468');
      expect(() => setRole('admin')).toThrow();
      expect(() => exitClientView({ pin: '0000' })).toThrow(expect.objectContaining({ code: 'TEAM_PIN_WRONG' }));
      expect(getSession().role).toBe('client');
      expect(exitClientView({ pin: '2468' }).role).toBe('admin');
      expect(hasAccountScope()).toBe(false);
      expect(listAccounts()).toHaveLength(3);
      expect(events.map((e) => e.role)).toEqual(['client', 'admin']);
    } finally {
      progressBus.off('session:changed', on);
    }
  });

  it('locks the PIN prompt after repeated failures', () => {
    enterClientView({ clientNames: ['Bolt'], pin: '1357' });
    const t = Date.now();
    for (let i = 0; i < 5; i += 1) expect(() => exitClientView({ pin: '9999' }, t)).toThrow(expect.objectContaining({ code: 'TEAM_PIN_WRONG' }));
    expect(() => exitClientView({ pin: '1357' }, t + 1000)).toThrow(expect.objectContaining({ code: 'TEAM_PIN_LOCKED' }));
    expect(exitClientView({ pin: '1357' }, t + 31_000).role).toBe('admin');
  });

  it('hashes PINs with a salt', () => {
    const a = hashPin('1234');
    expect(a).not.toBe(hashPin('1234'));
    expect(verifyPin('1234', a)).toBe(true);
    expect(verifyPin('4321', a)).toBe(false);
    expect(verifyPin('1234', 'garbage')).toBe(false);
  });
});
