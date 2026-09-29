import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { openDb, closeDb, q } from '../src/main/db/index.js';
import { setConfig } from '../src/main/config/store.js';
import { createPost } from '../src/main/db/queries/planner.js';
import {
  STUDIO_TABLES, getBrandVoice, upsertBrandVoice, aiDisabledAccounts, insertGeneration, getGeneration, usageSummary,
  insertCaptionVariants, listCaptionVariants, setPostAiMeta, getPostAiMeta,
} from '../src/main/db/queries/studio.js';
import { recordGeneration, monthlyUsage, withUsage } from '../src/main/ai/usage.js';
import { buildSchemaDescription } from '../src/main/ai/ask/schema.js';
import { assertSafeQuery } from '../src/main/ai/ask/sqlGuard.js';
import { clearAll } from '../src/main/seed/index.js';
import { studioHandlers, STUDIO_CHANNELS, STUDIO_CORE_CHANNELS } from '../src/main/ai/studio/index.js';
import { assertAccountsAllowed, runGeneration, cancelRequest } from '../src/main/ai/studio/runtime.js';
import { AiError } from '../src/main/ai/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, '../src/main/db/migrations');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-studio-'));
const NOW = Date.UTC(2026, 8, 15, 12);
const DAY = 86_400_000;

beforeAll(() => {
  // A v1.4 database (001–009) with a planner post, then openDb applies 010 on top.
  const dbFile = path.join(dir, 'data.db');
  const raw = new Database(dbFile);
  raw.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER)');
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => /^\d+_.*\.sql$/.test(n)).sort()) {
    const v = Number.parseInt(f, 10);
    if (v > 9) continue;
    raw.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    raw.prepare('INSERT INTO schema_version VALUES (?, ?)').run(v, Date.now());
  }
  raw.prepare("INSERT INTO planner_posts (id, ref, caption, status, version, source, created_at, updated_at) VALUES (1, 'P-0001', 'old', 'draft', 1, 'manual', 1, 1)").run();
  raw.close();
  openDb(dbFile);
});
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('migration 010', () => {
  it('applies on top of 009 and creates every studio table and index', () => {
    expect(q.all('SELECT version FROM schema_version').map((r) => r.version)).toContain(10);
    const tables = q.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
    for (const t of ['brand_voice', 'ai_generations', 'caption_variants', 'ab_tests', 'ab_test_items', 'comment_replies']) expect(tables).toContain(t);
    const idx = q.all("SELECT name FROM sqlite_master WHERE type = 'index'").map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(['idx_ai_generations_at', 'idx_comments_media_created']));
    expect([...STUDIO_TABLES].sort()).toEqual(['ab_test_items', 'ab_tests', 'ai_generations', 'brand_voice', 'caption_variants', 'comment_replies']);
  });
  it('adds ai_meta and parent_post_id to planner_posts, keeping existing rows', () => {
    const cols = q.all('PRAGMA table_info(planner_posts)').map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['ai_meta', 'parent_post_id']));
    expect(q.get('SELECT caption, ai_meta, parent_post_id FROM planner_posts WHERE id = 1')).toEqual({ caption: 'old', ai_meta: null, parent_post_id: null });
    setPostAiMeta(1, { pillar: 'education', repurposedFrom: { mediaId: 'm1' } }, { parentPostId: null });
    expect(getPostAiMeta(1)).toEqual({ aiMeta: { pillar: 'education', repurposedFrom: { mediaId: 'm1' } }, parentPostId: null });
  });
});

describe('studio queries', () => {
  it('brand voice upsert/get with parsed profile and per-account AI opt-out', () => {
    expect(getBrandVoice('17840001')).toBeNull();
    upsertBrandVoice('17840001', { brief: 'Warm, playful.', profile: { tone: ['warm'] }, source: 'ai', provider: 'anthropic', model: 'claude-opus-5', derivedFrom: 50, derivedAt: NOW }, { now: NOW });
    upsertBrandVoice('17840002', { aiDisabled: true }, { now: NOW });
    expect(getBrandVoice('17840001')).toMatchObject({ accountId: '17840001', brief: 'Warm, playful.', profile: { tone: ['warm'] }, source: 'ai', aiDisabled: false, updatedAt: NOW });
    upsertBrandVoice('17840001', { brief: 'Edited', source: 'ai_edited' }, { now: NOW + 1 });
    expect(getBrandVoice('17840001')).toMatchObject({ brief: 'Edited', source: 'ai_edited', profile: { tone: ['warm'] }, model: 'claude-opus-5' });
    expect(aiDisabledAccounts(['17840001', '17840002', 'x'])).toEqual(['17840002']);
    expect(() => assertAccountsAllowed(['17840001'])).not.toThrow();
    expect(() => assertAccountsAllowed(['17840001', '17840002'])).toThrow(AiError);
  });

  it('caption variants belong to a planner post and cascade with it', () => {
    const postId = createPost({ caption: 'c', targets: [] }, { now: NOW });
    const gen = insertGeneration({ at: NOW - 100 * DAY, feature: 'caption', provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 10, outputTokens: 5 });
    insertCaptionVariants(postId, [{ label: 'A', lang: 'tr', angle: 'story', text: 'Merhaba' }, { label: 'B', lang: 'en', angle: 'question-hook', text: 'Hi?' }], { generationId: gen, now: NOW, chosenLabel: 'B' });
    const rows = listCaptionVariants(postId);
    expect(rows.map((r) => [r.label, r.chosen])).toEqual([['A', false], ['B', true]]);
    expect(rows[0]).toMatchObject({ postId, generationId: gen, lang: 'tr', angle: 'story', text: 'Merhaba' });
    q.run('DELETE FROM planner_posts WHERE id = ?', postId);
    expect(listCaptionVariants(postId)).toEqual([]);
  });

  it('comment_replies reference comments; generations can be pruned without breaking references', () => {
    q.run("INSERT INTO accounts (ig_id, username, is_tracked, first_seen_at) VALUES ('17840001', 'acc', 1, 1)");
    q.run("INSERT INTO media (media_id, ig_id, media_type, posted_at) VALUES ('m1', '17840001', 'IMAGE', 1)");
    q.run("INSERT INTO comments (comment_id, media_id, username, text, created_at, is_from_owner) VALUES ('c1', 'm1', 'u', 'nice', 1, 0)");
    const gen = insertGeneration({ at: NOW, feature: 'reply' });
    q.run("INSERT INTO comment_replies (comment_id, suggestion, generation_id, created_at) VALUES ('c1', 'Thanks!', ?, 1)", gen);
    expect(() => q.run("INSERT INTO comment_replies (comment_id, suggestion, created_at) VALUES ('nope', 'x', 1)")).toThrow();
    q.run('DELETE FROM ai_generations WHERE id = ?', gen);
    expect(q.get("SELECT generation_id FROM comment_replies WHERE comment_id = 'c1'").generation_id).toBeNull();
  });
});

describe('usage recording', () => {
  it('stores counts only by default and the output only with ai.keepHistory', () => {
    const id = recordGeneration({ feature: 'caption', accountId: '17840001', provider: 'anthropic', model: 'claude-opus-5', usage: { inputTokens: 1000, outputTokens: 1000 }, images: 2, ms: 1200, status: 'ok', sentSummary: { captions: 3, chars: 900, leaked: 'secret text', nested: { a: 1 } }, output: { text: 'hello' } }, { now: NOW });
    const row = getGeneration(id);
    expect(row).toMatchObject({ feature: 'caption', inputTokens: 1000, outputTokens: 1000, images: 2, status: 'ok', output: null });
    expect(row.estCostUsd).toBeCloseTo(0.03, 10);
    expect(row.sentSummary).toEqual({ captions: 3, chars: 900 });
    setConfig('ai.keepHistory', true);
    const id2 = recordGeneration({ feature: 'caption', provider: 'anthropic', model: 'claude-opus-5', usage: { inputTokens: 1, outputTokens: 1 }, status: 'ok', output: { text: 'hello' } }, { now: NOW });
    expect(getGeneration(id2).output).toEqual({ text: 'hello' });
    setConfig('ai.keepHistory', false);
  });

  it('unknown pricing stores a null cost; ollama stores 0', () => {
    const a = recordGeneration({ feature: 'ideas', provider: 'openai', model: 'custom-x', usage: { inputTokens: 5, outputTokens: 5 }, status: 'ok' }, { now: NOW });
    const b = recordGeneration({ feature: 'ideas', provider: 'ollama', model: 'llama3.1', usage: { inputTokens: 5, outputTokens: 5 }, status: 'ok' }, { now: NOW });
    expect(getGeneration(a).estCostUsd).toBeNull();
    expect(getGeneration(b).estCostUsd).toBe(0);
  });

  it('monthlyUsage groups by feature and model within the month and flags the budget', () => {
    recordGeneration({ feature: 'commentary', provider: 'anthropic', model: 'claude-haiku-4-5', usage: { inputTokens: 1_000_000, outputTokens: 0 }, status: 'ok' }, { now: NOW - 40 * DAY });
    setConfig('ai.monthlyBudgetUsd', 0.01);
    const u = monthlyUsage({ now: NOW });
    expect(u.calls).toBeGreaterThanOrEqual(4);
    expect(u.byFeature.find((f) => f.feature === 'commentary')).toBeUndefined();
    const cap = u.byFeature.find((f) => f.feature === 'caption');
    expect(cap).toMatchObject({ calls: 2, inputTokens: 1001, outputTokens: 1001 });
    expect(u.byModel.find((m) => m.model === 'custom-x')).toMatchObject({ usd: null });
    expect(u.unknownCostCalls).toBeGreaterThanOrEqual(1);
    expect(u.totalUsd).toBeGreaterThan(0.03);
    expect(u).toMatchObject({ budgetUsd: 0.01, overBudget: true });
    const all = usageSummary({ from: 0, to: NOW + 1 });
    expect(all.byFeature.find((f) => f.feature === 'commentary').calls).toBe(1);
    setConfig('ai.monthlyBudgetUsd', null);
  });

  it('withUsage records ok/error/cancelled and returns cost + generation id', async () => {
    const meta = { feature: 'test', provider: 'anthropic', model: 'claude-sonnet-5' };
    const ok = await withUsage(meta, async () => ({ text: 'OK', usage: { inputTokens: 1000, outputTokens: 100 } }));
    expect(ok).toMatchObject({ text: 'OK', costUsd: 0.003 });
    expect(getGeneration(ok.generationId).status).toBe('ok');
    await expect(withUsage(meta, async () => { throw new AiError('ai_cancelled'); })).rejects.toMatchObject({ key: 'ai_cancelled' });
    await expect(withUsage(meta, async () => { throw new AiError('ai_auth'); })).rejects.toMatchObject({ key: 'ai_auth' });
    const last = q.all("SELECT status, error_code FROM ai_generations WHERE feature = 'test' ORDER BY id DESC LIMIT 2");
    expect(last).toEqual([{ status: 'error', error_code: 'AI_AUTH' }, { status: 'cancelled', error_code: 'AI_CANCELLED' }]);
  });
});

describe('studio runtime', () => {
  const fake = (text, gate) => ({
    id: 'anthropic', model: 'claude-haiku-4-5', structuredModes: ['schema'],
    userMessage: (t) => ({ role: 'user', content: t }),
    appendAssistant: (m) => m,
    complete: async ({ signal }) => {
      if (gate) await new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); gate(resolve); });
      return { text, toolCalls: [], stopReason: 'end', usage: { inputTokens: 1000, outputTokens: 1000 } };
    },
  });
  const caps = { vision: true, structuredModes: ['schema'], local: false };

  it('refuses while AI is off, then runs a structured generation and records it', async () => {
    setConfig('ai.enabled', false);
    await expect(runGeneration({ feature: 'caption' }, async () => ({}), { provider: fake('{}'), caps })).rejects.toMatchObject({ key: 'ai_off' });
    setConfig('ai.enabled', true);
    const out = await runGeneration(
      { feature: 'caption', accountIds: ['17840001'], sentSummary: { captions: 2 } },
      async ({ structured }) => structured({ system: 's', userText: 'u', schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } }),
      { provider: fake('{"a":"x"}'), caps },
    );
    expect(out).toMatchObject({ data: { a: 'x' }, mode: 'schema', provider: 'anthropic', model: 'claude-haiku-4-5', costUsd: 0.006 });
    expect(getGeneration(out.generationId)).toMatchObject({ feature: 'caption', accountId: '17840001', status: 'ok', sentSummary: { captions: 2, images: 0, imageBytes: 0 } });
  });

  it('blocks opted-out accounts before calling the provider', async () => {
    let called = false;
    const p = { ...fake('{}'), complete: async () => { called = true; return {}; } };
    await expect(runGeneration({ feature: 'caption', accountIds: ['17840002'] }, async ({ structured }) => structured({ system: 's', userText: 'u', schema: {} }), { provider: p, caps })).rejects.toMatchObject({ key: 'ai_account_disabled' });
    expect(called).toBe(false);
  });

  it('studio:cancel aborts by requestId and records a cancelled generation', async () => {
    let started;
    const ready = new Promise((r) => { started = r; });
    const run = runGeneration(
      { feature: 'ideas', requestId: 'req-1' },
      async ({ structured }) => structured({ system: 's', userText: 'u', schema: { type: 'object' } }),
      { provider: fake('{}', () => started()), caps },
    );
    await ready;
    expect(cancelRequest('req-1')).toBe(true);
    await expect(run).rejects.toMatchObject({ key: 'ai_cancelled' });
    expect(q.get("SELECT status FROM ai_generations WHERE feature = 'ideas' ORDER BY id DESC LIMIT 1").status).toBe('cancelled');
    expect(cancelRequest('req-1')).toBe(false);
    setConfig('ai.enabled', false);
  });
});

describe('ask-your-data and data reset', () => {
  it('hides ai_generations and comment_replies (and blocks queries on them) but describes A/B tests', () => {
    const text = buildSchemaDescription();
    expect(text).not.toContain('ai_generations');
    expect(text).not.toContain('comment_replies');
    expect(text).toContain('ab_tests(');
    expect(text).toContain('ab_test_items(');
    expect(() => assertSafeQuery('SELECT * FROM ai_generations')).toThrow();
    expect(() => assertSafeQuery('SELECT * FROM comment_replies')).toThrow();
  });
  it('clearAll empties the studio tables before the planner tables', () => {
    const postId = createPost({ caption: 'c', targets: [] }, { now: NOW });
    insertCaptionVariants(postId, [{ label: 'A', text: 'x' }], { now: NOW });
    expect(() => clearAll()).not.toThrow();
    for (const t of STUDIO_TABLES) expect(q.get(`SELECT COUNT(*) AS n FROM ${t}`).n).toBe(0);
  });
});

describe('studio registry', () => {
  it('lists every documented chunk channel; unregistered ones are NOT_IMPLEMENTED stubs', async () => {
    expect(STUDIO_CHANNELS).toEqual(expect.arrayContaining(['studio:voice:get', 'studio:captions:generate', 'studio:ideas:toDrafts', 'studio:repurpose', 'studio:replies:send', 'studio:ab:conclude']));
    expect(STUDIO_CORE_CHANNELS).toEqual(expect.arrayContaining(['studio:capabilities', 'studio:preview', 'studio:cancel', 'studio:usage']));
    const handlers = studioHandlers();
    for (const ch of STUDIO_CHANNELS) expect(typeof handlers[ch]).toBe('function');
    const registered = new Set(Object.keys(handlers));
    const stub = STUDIO_CHANNELS.find((c) => handlers[c].isStub);
    if (stub) await expect(handlers[stub]({})).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    for (const ch of registered) expect(ch.startsWith('studio:')).toBe(true);
  });
});
