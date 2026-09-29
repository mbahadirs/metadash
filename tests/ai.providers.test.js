import { describe, it, expect } from 'vitest';
import { buildOpenAIRequest, normalizeOpenAIResponse, createOpenAIProvider } from '../src/main/ai/providers/openai.js';
import { buildGeminiRequest, normalizeGeminiResponse, createGeminiProvider } from '../src/main/ai/providers/gemini.js';
import { buildOllamaRequest, normalizeOllamaResponse, createOllamaProvider } from '../src/main/ai/providers/ollama.js';
import { resolveModel, normalizeOllamaUrl, sanitizeAiPatch, maskKey } from '../src/main/ai/models.js';

const TOOL = { name: 'get_posts', description: 'List posts', parameters: { type: 'object', properties: { day: { type: 'string' } }, required: ['day'] } };
const USER = [{ role: 'user', content: 'hi' }];

/** fetch stub: records requests and replies with the given status/body. */
function fakeFetch(status, body) {
  const log = [];
  const impl = async (url, init) => {
    log.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return { impl, log };
}

describe('openai', () => {
  it('builds a chat completions request with system first and function tools', () => {
    const req = buildOpenAIRequest({ model: 'gpt-5-mini', system: 'sys', messages: USER, tools: [TOOL], maxTokens: 900 });
    expect(req.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(req.messages[1]).toEqual(USER[0]);
    expect(req.tools[0]).toEqual({ type: 'function', function: { name: 'get_posts', description: 'List posts', parameters: TOOL.parameters } });
    expect(req.max_completion_tokens).toBe(900);
  });
  it('omits tools when none are given', () => {
    expect(buildOpenAIRequest({ model: 'm', system: 's', messages: USER })).not.toHaveProperty('tools');
  });
  it('normalizes text, tool calls (parsed arguments), finish reasons and usage', () => {
    const msg = { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_posts', arguments: '{"day":"2026-09-01"}' } }] };
    const n = normalizeOpenAIResponse({ choices: [{ message: msg, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 7 } });
    expect(n).toMatchObject({ text: '', stopReason: 'tool_use', toolCalls: [{ id: 'call_1', name: 'get_posts', input: { day: '2026-09-01' } }], usage: { inputTokens: 5, outputTokens: 7 }, raw: msg });
    expect(normalizeOpenAIResponse({ choices: [{ message: { content: 'hey' }, finish_reason: 'stop' }] })).toMatchObject({ text: 'hey', stopReason: 'end' });
    expect(normalizeOpenAIResponse({ choices: [{ message: { content: 'x' }, finish_reason: 'length' }] }).stopReason).toBe('max_tokens');
    expect(normalizeOpenAIResponse({ choices: [{ message: { content: null, refusal: 'no' }, finish_reason: 'stop' }] }).stopReason).toBe('refusal');
    expect(normalizeOpenAIResponse({ choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }).stopReason).toBe('refusal');
  });
  it('tolerates malformed tool arguments', () => {
    const n = normalizeOpenAIResponse({ choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'x', arguments: '{oops' } }] }, finish_reason: 'tool_calls' }] });
    expect(n.toolCalls[0].input).toEqual({});
  });
  it('sends bearer auth, appends tool messages and maps HTTP errors', async () => {
    const f = fakeFetch(200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
    const p = createOpenAIProvider({ apiKey: 'sk-test', model: 'gpt-5-mini', fetchImpl: f.impl });
    expect((await p.complete({ system: 's', messages: USER })).text).toBe('ok');
    expect(f.log[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(f.log[0].init.headers.Authorization).toBe('Bearer sk-test');
    const next = p.appendToolResults(USER, { raw: { role: 'assistant', tool_calls: [] } }, [{ id: 'c1', name: 'x', content: 'r' }]);
    expect(next.slice(1)).toEqual([{ role: 'assistant', tool_calls: [] }, { role: 'tool', tool_call_id: 'c1', content: 'r' }]);
    await expect(createOpenAIProvider({ apiKey: 'k', model: 'm', fetchImpl: fakeFetch(401, { error: { message: 'Incorrect API key provided: sk-abc' } }).impl }).complete({ system: 's', messages: USER })).rejects.toMatchObject({ key: 'ai_auth' });
    await expect(createOpenAIProvider({ apiKey: 'k', model: 'm', fetchImpl: fakeFetch(429, {}).impl }).complete({ system: 's', messages: USER })).rejects.toMatchObject({ key: 'ai_rate_limit' });
    const bad = await createOpenAIProvider({ apiKey: 'k', model: 'm', fetchImpl: fakeFetch(404, { error: { message: 'model not found' } }).impl }).complete({ system: 's', messages: USER }).catch((e) => e);
    expect(bad.key).toBe('ai_bad_request');
    expect(bad.message).toContain('model not found');
  });
  it('maps network failures', async () => {
    const p = createOpenAIProvider({ apiKey: 'k', model: 'm', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    await expect(p.complete({ system: 's', messages: USER })).rejects.toMatchObject({ key: 'ai_network' });
  });
});

describe('gemini', () => {
  it('builds generateContent body with systemInstruction and functionDeclarations (no additionalProperties)', () => {
    const body = buildGeminiRequest({ system: 'sys', messages: [{ role: 'user', parts: [{ text: 'hi' }] }], tools: [{ ...TOOL, parameters: { ...TOOL.parameters, additionalProperties: false } }], maxTokens: 800 });
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(body.contents).toHaveLength(1);
    expect(body.tools[0].functionDeclarations[0]).toEqual({ name: 'get_posts', description: 'List posts', parameters: TOOL.parameters });
    expect(body.generationConfig.maxOutputTokens).toBe(800);
  });
  it('normalizes text, functionCall parts, finish reasons, blocked prompts and usage', () => {
    const content = { role: 'model', parts: [{ text: 'Checking' }, { functionCall: { name: 'get_posts', args: { day: 'x' } } }] };
    const n = normalizeGeminiResponse({ candidates: [{ content, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } });
    expect(n).toMatchObject({ text: 'Checking', stopReason: 'tool_use', toolCalls: [{ id: 'call_0', name: 'get_posts', input: { day: 'x' } }], usage: { inputTokens: 3, outputTokens: 4 }, raw: content });
    expect(normalizeGeminiResponse({ candidates: [{ content: { parts: [{ text: 'a' }] }, finishReason: 'MAX_TOKENS' }] }).stopReason).toBe('max_tokens');
    expect(normalizeGeminiResponse({ candidates: [{ finishReason: 'SAFETY' }] }).stopReason).toBe('refusal');
    expect(normalizeGeminiResponse({ promptFeedback: { blockReason: 'SAFETY' } }).stopReason).toBe('refusal');
    expect(normalizeGeminiResponse({ candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'answer' }] }, finishReason: 'STOP' }] }).text).toBe('answer');
  });
  it('uses the API key header (not the URL) and appends functionResponse parts', async () => {
    const f = fakeFetch(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] });
    const p = createGeminiProvider({ apiKey: 'g-key', model: 'gemini-2.5-flash', fetchImpl: f.impl });
    expect(p.userMessage('hi')).toEqual({ role: 'user', parts: [{ text: 'hi' }] });
    expect((await p.complete({ system: 's', messages: [p.userMessage('hi')] })).text).toBe('ok');
    expect(f.log[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(f.log[0].url).not.toContain('g-key');
    expect(f.log[0].init.headers['x-goog-api-key']).toBe('g-key');
    const raw = { role: 'model', parts: [{ functionCall: { name: 'x', args: {} } }] };
    const next = p.appendToolResults([], { raw }, [{ id: 'call_0', name: 'x', content: '{"a":1}' }, { id: 'call_1', name: 'y', content: 'fail', isError: true }]);
    expect(next).toEqual([raw, { role: 'user', parts: [{ functionResponse: { name: 'x', response: { content: '{"a":1}' } } }, { functionResponse: { name: 'y', response: { error: 'fail' } } }] }]);
  });
  it('encodes odd model names safely', async () => {
    const f = fakeFetch(200, { candidates: [] });
    await createGeminiProvider({ apiKey: 'k', model: 'models/../x?y', fetchImpl: f.impl }).complete({ system: 's', messages: [] }).catch(() => {});
    expect(f.log[0].url).not.toContain('?y');
  });
});

describe('ollama', () => {
  it('builds a non-streaming chat request with tools and num_predict', () => {
    const req = buildOllamaRequest({ model: 'llama3.1', system: 'sys', messages: USER, tools: [TOOL], maxTokens: 300 });
    expect(req).toMatchObject({ model: 'llama3.1', stream: false, options: { num_predict: 300 } });
    expect(req.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(req.tools[0].function.name).toBe('get_posts');
  });
  it('normalizes content, tool calls (object arguments) and done_reason', () => {
    const message = { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_posts', arguments: { day: 'd' } } }] };
    const n = normalizeOllamaResponse({ message, done_reason: 'stop', prompt_eval_count: 8, eval_count: 9 });
    expect(n).toMatchObject({ stopReason: 'tool_use', toolCalls: [{ id: 'call_0', name: 'get_posts', input: { day: 'd' } }], usage: { inputTokens: 8, outputTokens: 9 }, raw: message });
    expect(normalizeOllamaResponse({ message: { content: 'hi' }, done_reason: 'length' })).toMatchObject({ text: 'hi', stopReason: 'max_tokens' });
    expect(normalizeOllamaResponse({ message: { content: 'hi' }, done_reason: 'stop' }).stopReason).toBe('end');
  });
  it('posts to {url}/api/chat and appends tool messages', async () => {
    const f = fakeFetch(200, { message: { role: 'assistant', content: 'ok' }, done_reason: 'stop' });
    const p = createOllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'llama3.1', fetchImpl: f.impl });
    await p.complete({ system: 's', messages: USER });
    expect(f.log[0].url).toBe('http://127.0.0.1:11434/api/chat');
    expect(p.appendToolResults(USER, { raw: { role: 'assistant' } }, [{ id: 'call_0', name: 'x', content: 'r' }]).at(-1)).toEqual({ role: 'tool', content: 'r', tool_name: 'x' });
  });
});

describe('models/config helpers', () => {
  it('resolves models per provider', () => {
    expect(resolveModel('anthropic', null)).toBe('claude-opus-5');
    expect(resolveModel('anthropic', 'claude-haiku-4-5')).toBe('claude-haiku-4-5');
    expect(resolveModel('anthropic', 'gpt-5')).toBe('claude-opus-5');
    expect(resolveModel('openai', '')).toBeTruthy();
    expect(resolveModel('openai', ' gpt-5 ')).toBe('gpt-5');
    expect(resolveModel('ollama', null)).toBe('llama3.1');
  });
  it('validates the Ollama URL', () => {
    expect(normalizeOllamaUrl('http://localhost:11434/')).toBe('http://localhost:11434');
    expect(() => normalizeOllamaUrl('file:///etc/passwd')).toThrow();
    expect(() => normalizeOllamaUrl('not a url')).toThrow();
  });
  it('sanitizes settings patches', () => {
    expect(sanitizeAiPatch({ enabled: true, provider: 'gemini', model: ' gemini-2.5-pro ', junk: 1 })).toEqual({ 'ai.enabled': true, 'ai.provider': 'gemini', 'ai.model': 'gemini-2.5-pro' });
    expect(() => sanitizeAiPatch({ provider: 'bogus' })).toThrow();
    expect(sanitizeAiPatch({ model: '' })).toEqual({ 'ai.model': null });
  });
  it('masks keys to the last 4 characters', () => {
    expect(maskKey('sk-ant-1234567890abcd')).toEqual({ set: true, last4: 'abcd' });
    expect(maskKey(null)).toEqual({ set: false, last4: null });
  });
});

describe('assistantMessage (plain-text history turns)', () => {
  it('uses each provider\'s native assistant role', () => {
    expect(createOpenAIProvider({ apiKey: 'k', model: 'm' }).assistantMessage('a')).toEqual({ role: 'assistant', content: 'a' });
    expect(createOllamaProvider({ model: 'm' }).assistantMessage('a')).toEqual({ role: 'assistant', content: 'a' });
    expect(createGeminiProvider({ apiKey: 'k', model: 'm' }).assistantMessage('a')).toEqual({ role: 'model', parts: [{ text: 'a' }] });
  });
});

describe('gemini parameterless tools', () => {
  it('omits parameters when the tool takes no arguments', () => {
    const body = buildGeminiRequest({ system: 's', messages: [], tools: [{ name: 'get_period', description: 'd', parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } }] });
    expect(body.tools[0].functionDeclarations[0]).toEqual({ name: 'get_period', description: 'd' });
  });
});
