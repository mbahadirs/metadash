import { describe, it, expect } from 'vitest';
import { runToolLoop } from '../src/main/ai/toolLoop.js';
import { AiError } from '../src/main/ai/errors.js';

/** Fake provider: replays scripted normalized responses and records every call's messages. */
function fakeProvider(script) {
  const calls = [];
  let i = 0;
  return {
    id: 'fake',
    calls,
    userMessage: (text) => ({ role: 'user', content: text }),
    appendAssistant: (messages, res) => [...messages, { role: 'assistant', content: res.raw }],
    appendToolResults: (messages, res, results) => [...messages, { role: 'assistant', content: res.raw }, { role: 'user', results }],
    complete: async (req) => {
      calls.push(req);
      const next = script[Math.min(i++, script.length - 1)];
      return { text: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 2 }, raw: null, ...next };
    },
  };
}

const TOOL = { name: 'get_metric', description: 'metric', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } };

describe('runToolLoop', () => {
  it('returns final text directly when no tools are called', async () => {
    const p = fakeProvider([{ text: '  Hello  ', stopReason: 'end' }]);
    const res = await runToolLoop({ provider: p, system: 'sys', userText: 'hi' });
    expect(res.text).toBe('Hello');
    expect(res.steps).toBe(1);
    expect(res.truncated).toBe(false);
    expect(p.calls[0].messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(p.calls[0].system).toBe('sys');
  });

  it('executes tool calls and feeds results back before the final answer', async () => {
    const p = fakeProvider([
      { stopReason: 'tool_use', toolCalls: [{ id: 't1', name: 'get_metric', input: { name: 'reach' } }], raw: 'A1' },
      { text: 'Reach was 10.', stopReason: 'end' },
    ]);
    const seen = [];
    const res = await runToolLoop({ provider: p, system: 's', userText: 'q', tools: [TOOL], execute: async (name, input) => { seen.push([name, input]); return { value: 10 }; } });
    expect(seen).toEqual([['get_metric', { name: 'reach' }]]);
    expect(res.text).toBe('Reach was 10.');
    expect(res.steps).toBe(2);
    expect(res.usage).toEqual({ inputTokens: 2, outputTokens: 4 });
    const last = p.calls[1].messages;
    expect(last[1]).toEqual({ role: 'assistant', content: 'A1' });
    expect(last[2].results).toEqual([{ id: 't1', name: 'get_metric', content: '{"value":10}' }]);
  });

  it('turns a throwing tool into an is_error result instead of failing the loop', async () => {
    const p = fakeProvider([
      { stopReason: 'tool_use', toolCalls: [{ id: 't1', name: 'get_metric', input: {} }] },
      { text: 'Could not fetch.', stopReason: 'end' },
    ]);
    const res = await runToolLoop({ provider: p, system: 's', userText: 'q', tools: [TOOL], execute: () => { throw new Error('boom'); } });
    expect(res.text).toBe('Could not fetch.');
    expect(p.calls[1].messages[2].results[0]).toEqual({ id: 't1', name: 'get_metric', content: 'boom', isError: true });
  });

  it('reports a missing executor as a tool error', async () => {
    const p = fakeProvider([{ stopReason: 'tool_use', toolCalls: [{ id: 'x', name: 'get_metric', input: {} }] }, { text: 'ok', stopReason: 'end' }]);
    await runToolLoop({ provider: p, system: 's', userText: 'q', tools: [TOOL] });
    expect(p.calls[1].messages[2].results[0].isError).toBe(true);
  });

  it('stops after maxSteps when the model keeps calling tools', async () => {
    const p = fakeProvider([{ stopReason: 'tool_use', toolCalls: [{ id: 't', name: 'get_metric', input: {} }] }]);
    await expect(runToolLoop({ provider: p, system: 's', userText: 'q', tools: [TOOL], execute: () => 'x', maxSteps: 3 })).rejects.toMatchObject({ key: 'ai_max_steps' });
    expect(p.calls).toHaveLength(3);
  });

  it('continues after pause_turn with the assistant content appended', async () => {
    const p = fakeProvider([{ stopReason: 'pause_turn', raw: 'partial' }, { text: 'done', stopReason: 'end' }]);
    const res = await runToolLoop({ provider: p, system: 's', userText: 'q' });
    expect(res.text).toBe('done');
    expect(p.calls[1].messages.at(-1)).toEqual({ role: 'assistant', content: 'partial' });
    expect(p.calls[1].continuation).toBe(true);
    expect(p.calls[0].continuation).toBe(false);
  });

  it('throws a localized refusal error carrying the category', async () => {
    const p = fakeProvider([{ stopReason: 'refusal', refusalCategory: 'cyber' }]);
    const err = await runToolLoop({ provider: p, system: 's', userText: 'q' }).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.key).toBe('ai_refusal');
    expect(err.category).toBe('cyber');
    expect(err.message.length).toBeGreaterThan(10);
  });

  it('flags truncated output and rejects empty truncated output', async () => {
    const ok = await runToolLoop({ provider: fakeProvider([{ text: 'partial text', stopReason: 'max_tokens' }]), system: 's', userText: 'q' });
    expect(ok.truncated).toBe(true);
    await expect(runToolLoop({ provider: fakeProvider([{ text: '', stopReason: 'max_tokens' }]), system: 's', userText: 'q' })).rejects.toMatchObject({ key: 'ai_truncated' });
    await expect(runToolLoop({ provider: fakeProvider([{ text: ' ', stopReason: 'end' }]), system: 's', userText: 'q' })).rejects.toMatchObject({ key: 'ai_empty' });
  });
});

describe('runToolLoop history', () => {
  it('replays prior plain-text turns before the new user message', async () => {
    const p = { ...fakeProvider([{ text: 'ok', stopReason: 'end' }]), assistantMessage: (text) => ({ role: 'assistant', content: text }) };
    await runToolLoop({ provider: p, system: 's', userText: 'q2', history: [{ question: 'q1', answer: 'a1' }] });
    expect(p.calls[0].messages).toEqual([{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }]);
  });

  it('refuses history when the provider cannot express assistant turns', async () => {
    const p = fakeProvider([{ text: 'ok', stopReason: 'end' }]);
    await expect(runToolLoop({ provider: p, system: 's', userText: 'q', history: [{ question: 'a', answer: 'b' }] })).rejects.toThrow(/history/);
  });
});
