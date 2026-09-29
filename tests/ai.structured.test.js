import { describe, it, expect } from 'vitest';
import { runStructured, parseJsonText, validateSchema, strictJsonSchema, STRUCTURED_TOOL } from '../src/main/ai/structured.js';
import { buildAnthropicRequest, createAnthropicProvider } from '../src/main/ai/providers/anthropic.js';
import { buildOpenAIRequest } from '../src/main/ai/providers/openai.js';
import { buildGeminiRequest } from '../src/main/ai/providers/gemini.js';
import { buildOllamaRequest } from '../src/main/ai/providers/ollama.js';
import { AiError } from '../src/main/ai/errors.js';

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 20 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    tone: { type: 'string', enum: ['warm', 'formal'] },
  },
  required: ['title', 'tags'],
};

/** Fake provider replaying normalized responses; records every complete() request and appended messages. */
function fakeProvider(script, { id = 'fake', structuredModes } = {}) {
  const calls = [];
  let i = 0;
  return {
    id,
    model: 'm',
    calls,
    structuredModes,
    userMessage: (text, { images = [] } = {}) => ({ role: 'user', content: text, images: images.length }),
    appendAssistant: (messages, res) => [...messages, { role: 'assistant', content: res.text }],
    appendToolResults: (messages, res, results) => [...messages, { role: 'assistant', calls: res.toolCalls }, { role: 'user', results }],
    complete: async (req) => {
      calls.push(req);
      const next = script[Math.min(i++, script.length - 1)];
      if (next instanceof Error) throw next;
      return { text: '', toolCalls: [], stopReason: 'end', raw: null, usage: { inputTokens: 10, outputTokens: 5 }, ...next };
    },
  };
}

describe('runStructured', () => {
  it('tool mode: forces emit_result and captures its input object', async () => {
    const p = fakeProvider([{ toolCalls: [{ id: 't1', name: STRUCTURED_TOOL, input: { title: 'Hi', tags: ['a'] } }], stopReason: 'tool_use' }]);
    const res = await runStructured({ provider: p, system: 'sys', userText: 'go', schema: SCHEMA, modes: ['tool', 'json'] });
    expect(res).toMatchObject({ data: { title: 'Hi', tags: ['a'] }, mode: 'tool', usage: { inputTokens: 10, outputTokens: 5 } });
    expect(p.calls[0].tools).toHaveLength(1);
    expect(p.calls[0].tools[0].name).toBe(STRUCTURED_TOOL);
    expect(p.calls[0].toolChoice).toBe(STRUCTURED_TOOL);
  });

  it('schema mode (Anthropic): sends responseFormat json_schema, no tools, parses the text answer', async () => {
    const p = fakeProvider([{ text: '{"title":"Yo","tags":[]}' }]);
    const res = await runStructured({ provider: p, system: 'sys', userText: 'go', schema: SCHEMA, modes: ['schema'] });
    expect(res.data).toEqual({ title: 'Yo', tags: [] });
    expect(res.mode).toBe('schema');
    expect(p.calls[0].responseFormat).toMatchObject({ type: 'json_schema' });
    expect(p.calls[0].tools ?? []).toEqual([]);
  });

  it('falls back to JSON mode when the model answers with text instead of calling the tool', async () => {
    const p = fakeProvider([{ text: 'Sure! Here you go.' }, { text: '```json\n{"title":"T","tags":["x"]}\n```' }]);
    const res = await runStructured({ provider: p, system: 'sys', userText: 'go', schema: SCHEMA, modes: ['tool', 'json'] });
    expect(res.mode).toBe('json');
    expect(res.data).toEqual({ title: 'T', tags: ['x'] });
    expect(p.calls[1].responseFormat).toEqual({ type: 'json' });
    expect(p.calls[1].system).toContain('JSON');
    expect(res.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it('falls back to JSON mode when the provider rejects tools', async () => {
    const err = new AiError('ai_bad_request', { vars: { status: 400, detail: 'model does not support tools' } });
    err.detail = 'model does not support tools';
    const p = fakeProvider([err, { text: '{"title":"T","tags":[]}' }]);
    const res = await runStructured({ provider: p, system: 's', userText: 'u', schema: SCHEMA, modes: ['tool', 'json'] });
    expect(res.mode).toBe('json');
  });

  it('schema failure → one repair retry that succeeds', async () => {
    const p = fakeProvider([
      { toolCalls: [{ id: 't1', name: STRUCTURED_TOOL, input: { title: 'x'.repeat(30), tags: ['a'] } }], stopReason: 'tool_use' },
      { toolCalls: [{ id: 't2', name: STRUCTURED_TOOL, input: { title: 'short', tags: ['a'] } }], stopReason: 'tool_use' },
    ]);
    const res = await runStructured({ provider: p, system: 's', userText: 'u', schema: SCHEMA, modes: ['tool'] });
    expect(res.data.title).toBe('short');
    expect(res.repaired).toBe(true);
    expect(p.calls).toHaveLength(2);
    const lastMsg = p.calls[1].messages.at(-1);
    expect(lastMsg.results[0].isError).toBe(true);
    expect(lastMsg.results[0].content).toContain('title');
  });

  it('schema failure twice → ai_schema_invalid error', async () => {
    const p = fakeProvider([{ text: '{"title":1}' }]);
    await expect(runStructured({ provider: p, system: 's', userText: 'u', schema: SCHEMA, modes: ['json'] })).rejects.toMatchObject({ key: 'ai_schema_invalid' });
    expect(p.calls).toHaveLength(2);
    expect(p.calls[1].messages.at(-1).role).toBe('user');
  });

  it('refusal and truncation surface as AiErrors', async () => {
    await expect(runStructured({ provider: fakeProvider([{ stopReason: 'refusal' }]), system: 's', userText: 'u', schema: SCHEMA, modes: ['schema'] })).rejects.toMatchObject({ key: 'ai_refusal' });
    await expect(runStructured({ provider: fakeProvider([{ stopReason: 'max_tokens', text: '{"ti' }]), system: 's', userText: 'u', schema: SCHEMA, modes: ['schema'] })).rejects.toMatchObject({ key: 'ai_truncated' });
  });

  it('passes images to userMessage and the abort signal to complete', async () => {
    const p = fakeProvider([{ text: '{"title":"a","tags":[]}' }]);
    const ctrl = new AbortController();
    await runStructured({ provider: p, system: 's', userText: 'u', images: [{ mime: 'image/jpeg', data: 'x' }], schema: SCHEMA, modes: ['json'], signal: ctrl.signal });
    expect(p.calls[0].messages[0].images).toBe(1);
    expect(p.calls[0].signal).toBe(ctrl.signal);
  });
});

describe('JSON helpers', () => {
  it('parseJsonText handles plain, fenced and embedded objects', () => {
    expect(parseJsonText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonText('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseJsonText('Here: {"a":{"b":"}"}} trailing')).toEqual({ a: { b: '}' } });
    expect(parseJsonText('no json')).toBeUndefined();
    expect(parseJsonText('[1,2]')).toBeUndefined();
  });
  it('validateSchema reports paths', () => {
    expect(validateSchema({ title: 'ok', tags: ['a'] }, SCHEMA)).toEqual([]);
    const errs = validateSchema({ title: 5, tags: ['a', 'b', 'c', 'd'], tone: 'loud', extra: 1 }, { ...SCHEMA, additionalProperties: false });
    expect(errs.join('\n')).toMatch(/\$\.title/);
    expect(errs.join('\n')).toMatch(/\$\.tags/);
    expect(errs.join('\n')).toMatch(/\$\.tone/);
    expect(errs.join('\n')).toMatch(/extra/);
    expect(validateSchema({ tags: [] }, SCHEMA)[0]).toMatch(/title/);
    expect(validateSchema(3, { type: 'integer' })).toEqual([]);
    expect(validateSchema(3.5, { type: 'integer' })).not.toEqual([]);
  });
  it('strictJsonSchema closes objects and strips constraints the API does not support', () => {
    const s = strictJsonSchema(SCHEMA);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.title).toEqual({ type: 'string' });
    expect(s.properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
    expect(SCHEMA.properties.title.maxLength).toBe(20); // input not mutated
  });
});

describe('provider structured-output mapping', () => {
  const U = [{ role: 'user', content: 'u' }];
  it('anthropic: output_config.format json_schema merged with effort; haiku gets format only', () => {
    const rf = { type: 'json_schema', name: 'emit_result', schema: SCHEMA };
    const { params } = buildAnthropicRequest({ model: 'claude-opus-5', system: 's', messages: U, responseFormat: rf });
    expect(params.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: strictJsonSchema(SCHEMA) } });
    expect(params.thinking).toEqual({ type: 'adaptive' });
    const haiku = buildAnthropicRequest({ model: 'claude-haiku-4-5', system: 's', messages: U, responseFormat: rf }).params;
    expect(haiku.output_config).toEqual({ format: { type: 'json_schema', schema: strictJsonSchema(SCHEMA) } });
    expect(haiku).not.toHaveProperty('thinking');
    expect(createAnthropicProvider({ apiKey: 'k', model: 'claude-opus-5', client: {} }).structuredModes).toEqual(['schema']);
  });
  it('openai: forced function tool_choice and json_object mode', () => {
    const tool = { name: 'emit_result', description: 'd', parameters: SCHEMA };
    expect(buildOpenAIRequest({ model: 'm', system: 's', messages: U, tools: [tool], toolChoice: 'emit_result' }).tool_choice).toEqual({ type: 'function', function: { name: 'emit_result' } });
    expect(buildOpenAIRequest({ model: 'm', system: 's', messages: U, responseFormat: { type: 'json' } }).response_format).toEqual({ type: 'json_object' });
  });
  it('gemini: toolConfig ANY with allowed name and responseMimeType json', () => {
    const tool = { name: 'emit_result', description: 'd', parameters: SCHEMA };
    expect(buildGeminiRequest({ system: 's', messages: U, tools: [tool], toolChoice: 'emit_result' }).toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['emit_result'] } });
    expect(buildGeminiRequest({ system: 's', messages: U, responseFormat: { type: 'json' } }).generationConfig.responseMimeType).toBe('application/json');
  });
  it('ollama: format json or schema', () => {
    expect(buildOllamaRequest({ model: 'm', system: 's', messages: U, responseFormat: { type: 'json' } }).format).toBe('json');
    expect(buildOllamaRequest({ model: 'm', system: 's', messages: U, responseFormat: { type: 'json_schema', schema: SCHEMA } }).format).toMatchObject({ type: 'object', additionalProperties: false });
    expect(buildOllamaRequest({ model: 'm', system: 's', messages: U })).not.toHaveProperty('format');
  });
});
