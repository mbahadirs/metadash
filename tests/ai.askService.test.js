import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, closeDb } from '../src/main/db/index.js';
import { seedDemo } from '../src/main/seed/index.js';
import { updateAiConfig } from '../src/main/ai/settings.js';
import { askData, cancelAsk, historyTurns } from '../src/main/ai/ask/service.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadash-ask-svc-'));
beforeAll(() => { openDb(path.join(dir, 'data.db')); seedDemo({ reset: true }); });
afterAll(() => { closeDb(); fs.rmSync(dir, { recursive: true, force: true }); });

/** Fake provider replaying scripted normalized responses; records every request. */
function fakeProvider(script) {
  const calls = [];
  let i = 0;
  return {
    id: 'fake',
    model: 'fake-1',
    calls,
    userMessage: (text) => ({ role: 'user', content: text }),
    assistantMessage: (text) => ({ role: 'assistant', content: text }),
    appendAssistant: (messages, res) => [...messages, { role: 'assistant', content: res.raw }],
    appendToolResults: (messages, res, results) => [...messages, { role: 'assistant', content: res.raw }, { role: 'user', results }],
    complete: async (req) => {
      calls.push(req);
      const next = typeof script === 'function' ? script(req) : script[Math.min(i++, script.length - 1)];
      return { text: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, raw: null, ...next };
    },
  };
}

const sqlCall = (id, query, purpose = 'p') => ({ stopReason: 'tool_use', toolCalls: [{ id, name: 'run_sql', input: { query, purpose } }] });
const PERIOD = { from: '2026-09-01', to: '2026-09-29', preset: 30 };

describe('askData gating', () => {
  it('refuses with ai_off before touching the provider', async () => {
    updateAiConfig({ enabled: false });
    const p = fakeProvider([{ text: 'x', stopReason: 'end' }]);
    await expect(askData({ question: 'hi' }, { provider: p })).rejects.toMatchObject({ key: 'ai_off' });
    expect(p.calls).toHaveLength(0);
  });
});

describe('askData', () => {
  beforeAll(() => updateAiConfig({ enabled: true }));
  afterAll(() => updateAiConfig({ enabled: false }));

  it('runs a tool call, records the step and returns the answer', async () => {
    const p = fakeProvider([sqlCall('t1', 'SELECT username FROM accounts ORDER BY username LIMIT 3', 'names'), { text: '**3** accounts', stopReason: 'end' }]);
    const res = await askData({ question: 'List 3 accounts', period: PERIOD, lang: 'en' }, { provider: p });
    expect(res.answer).toBe('**3** accounts');
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0]).toMatchObject({ sql: 'SELECT username FROM accounts ORDER BY username LIMIT 3', purpose: 'names', rowCount: 3, columns: ['username'] });
    expect(res.steps[0].rows).toHaveLength(3);
    expect(res.truncated).toBe(false);
    expect(p.calls[0].tools.map((t) => t.name)).toEqual(['run_sql', 'get_period']);
    expect(p.calls[0].system).toMatch(/account_insights_daily\(/);
    expect(p.calls[0].system).toMatch(/English/);
    expect(p.calls[0].system).not.toMatch(/\bsettings\(/);
  });

  it('a tool error becomes a step error and the loop continues', async () => {
    const p = fakeProvider([sqlCall('t1', 'SELECT * FROM settings'), sqlCall('t2', "SELECT COUNT(*) AS n FROM accounts WHERE platform = 'instagram'"), { text: 'There are 40 accounts.', stopReason: 'end' }]);
    const res = await askData({ question: 'How many?', lang: 'tr' }, { provider: p });
    expect(res.answer).toBe('There are 40 accounts.');
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0].error).toBeTruthy();
    expect(res.steps[1]).toMatchObject({ rowCount: 1, rows: [[40]] });
    const toolMsg = p.calls[1].messages.at(-1).results[0];
    expect(toolMsg.isError).toBe(true);
    expect(p.calls[0].system).toMatch(/Turkish/);
  });

  it('get_period resolves the selected period', async () => {
    const p = fakeProvider([{ stopReason: 'tool_use', toolCalls: [{ id: 'g', name: 'get_period', input: {} }] }, { text: 'ok', stopReason: 'end' }]);
    await askData({ question: 'this period?', period: PERIOD }, { provider: p });
    const out = JSON.parse(p.calls[1].messages.at(-1).results[0].content);
    expect(out.selected).toMatchObject({ from: '2026-09-01', to: '2026-09-29' });
    expect(out.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('passes prior turns as plain text (last 6) before the new question', async () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ question: `q${i}`, answer: `a${i}` }));
    const p = fakeProvider([{ text: 'done', stopReason: 'end' }]);
    await askData({ question: 'next', history }, { provider: p });
    const msgs = p.calls[0].messages;
    expect(msgs).toHaveLength(13);
    expect(msgs[0]).toEqual({ role: 'user', content: 'q2' });
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'a2' });
    expect(msgs.at(-1).role).toBe('user');
    expect(msgs.at(-1).content).toContain('next');
  });

  it('validates the question', async () => {
    const p = fakeProvider([{ text: 'x', stopReason: 'end' }]);
    await expect(askData({ question: '   ' }, { provider: p })).rejects.toMatchObject({ key: 'ai_bad_input' });
    await expect(askData({ question: 'x'.repeat(5000) }, { provider: p })).rejects.toMatchObject({ key: 'ai_bad_input' });
  });

  it('can be cancelled by request id', async () => {
    const p = fakeProvider(async () => ({}));
    p.complete = (req) => new Promise((resolve, reject) => {
      req.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const pending = askData({ requestId: 'r1', question: 'slow' }, { provider: p });
    await new Promise((r) => setTimeout(r, 10));
    expect(cancelAsk('r1')).toBe(true);
    await expect(pending).rejects.toMatchObject({ key: 'ai_cancelled' });
    expect(cancelAsk('r1')).toBe(false);
  });
});

describe('historyTurns', () => {
  it('drops invalid turns, trims and caps', () => {
    const turns = historyTurns([{ question: 'a', answer: 'b' }, { question: '', answer: 'x' }, null, { question: 'c', answer: 5 }, { question: 'd', answer: 'e'.repeat(9000) }]);
    expect(turns).toHaveLength(2);
    expect(turns[1].answer.length).toBeLessThanOrEqual(4000);
    expect(historyTurns('nope')).toEqual([]);
  });
});
